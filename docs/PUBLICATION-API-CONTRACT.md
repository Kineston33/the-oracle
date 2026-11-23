# THE ORACLE — Publication API & Storage Contract

This document specifies the storage invariants, transaction boundaries, and read/write
separation required to back **Official Publication Protocol v1** (`src/data/publication-types.ts`
and `src/data/publication.ts`) with a persistent database and HTTP service.

> **Status in this repository**: No HTTP server and no database are shipped in v0.1.
> `InMemoryRegistry` (`src/data/publication.ts`) enforces the `PublicationRegistry`
> contract within a single JavaScript event loop for unit tests; it does not survive
> process restarts or coordinate across multiple processes. A production backend must
> implement the constraints below.

---

## 1. Separation of reads and writes

Exploration, identity comparison, candidate evaluation, and archive/event retrieval are
**read or non-publishing** operations. Official publication and terminal resolution are
**write** commands against the official ledger. No read, exploration, or evaluation
endpoint may ever call `claimIdentity` or insert a row into `official_predictions`.

### 1.1 Read, exploration, and analysis operations (never mutate the official archive)

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Submit exploratory query** | `POST /v1/queries:explore` | `readQuestion` (`src/lib/question.ts`); stage remains `exploratory-query` | **No** — returns lexical reading and matching archive records; never creates a prediction |
| **Match canonical proposition** | `POST /v1/identities:match` | `compareIdentities`, `identityDigest` (`src/data/canonical-identity.ts`), `registry.findByIdentity` | **No** — returns `IdentityMatch` (`equivalent` \| `distinct` \| `uncertain`) and any existing `predictionId` |
| **Evaluate candidate** | `POST /v1/candidates:evaluate` | `evaluateCandidate`, `verdictIsComplete` (`src/data/publication.ts`) | **No** — returns `EvaluationVerdict` (all 11 `RequirementResult` items and `clarificationsRequired`) |
| **Retrieve official prediction** | `GET /v1/predictions/:id` (and `GET /v1/predictions`) | `PredictionRecord` (`src/data/types.ts`), `registry.findByIdentity` | **No** — read-only lookup by `predictionId` or `identityDigest` |
| **Retrieve public event history** | `GET /v1/predictions/:id/events` | `RecordEvent[]`, `eventChainProblems`, `verifyPublicationLink` (`src/data/events.ts`) | **No** — returns the ordered append-only chain (`e0`, `e1`, …) with schema-2 envelopes and digests |

### 1.2 Candidate staging and official publication/event commands

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Create candidate** | `POST /v1/candidates` (and `PATCH /v1/candidates/:id/stage`) | `CandidateProposition`, `advance` (`exploratory-query` → `candidate-proposition` → `identity-matching` → `evaluation` → `eligible-for-publication`) | **No** — writes only to draft candidate storage; `candidateId` never becomes a `PredictionId` |
| **Publish official prediction** | `POST /v1/publications` | `publishCandidate(candidate, request, deps)` (`src/data/publication.ts`) | **Yes** — sole entry point permitted to call `registry.claimIdentity` and seal `e0` (`published`) |
| **Append resolution event** | `POST /v1/predictions/:id/events` | `appendEvent(record, event)` (`src/data/events.ts`, `resolved` \| `annulled`) | **Appends event only** — inserts `e1` into `prediction_events`; never modifies `sealed_payload` or `probability` |

---

## 2. Mapping `PublicationRegistry` to database constraints and transactions

`PublicationRegistry` (`src/data/publication-types.ts`) defines four methods. In a
relational store (such as PostgreSQL), their correctness depends on two `UNIQUE`
constraints and explicit transaction boundaries:

### 2.1 Schema constraints

```sql
CREATE TABLE official_predictions (
  prediction_id   TEXT PRIMARY KEY,
  identity_digest CHAR(64) NOT NULL UNIQUE,
  sealed_payload  JSONB NOT NULL,
  payload_digest  CHAR(64) NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE prediction_events (
  prediction_id   TEXT NOT NULL REFERENCES official_predictions(prediction_id),
  seq             TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('published', 'resolved', 'annulled')),
  envelope        JSONB NOT NULL,
  digest          CHAR(64) NOT NULL,
  prev_digest     CHAR(64),
  PRIMARY KEY (prediction_id, seq)
);

CREATE TABLE publication_idempotency_keys (
  idempotency_key  TEXT PRIMARY KEY,
  candidate_digest CHAR(64) NOT NULL,
  outcome          JSONB NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL
);
```

### 2.2 Registry method mapping

| `PublicationRegistry` method |Read / Write | Database constraint & SQL contract |
| --- | --- | --- |
| `findByIdempotencyKey(key)` | **Read** | `SELECT outcome, candidate_digest FROM publication_idempotency_keys WHERE idempotency_key = $1`. If present and `candidate_digest` matches `request.candidateDigest`, returns the stored `PublicationOutcome` so `publishCandidate` wraps it in `{ kind: 'replayed', original }`. |
| `findByIdentity(identityDigest)` | **Read** | `SELECT prediction_id FROM official_predictions WHERE identity_digest = $1`. Read-only fast path before running evaluation. |
| `claimIdentity(identityDigest, predictionId)` | **Write (atomic)** | Enforced by `UNIQUE (identity_digest)` on `official_predictions`. Runs `INSERT INTO official_predictions (...) VALUES (...) ON CONFLICT (identity_digest) DO NOTHING RETURNING prediction_id`. If a row is returned, returns `{ status: 'claimed' }`. If 0 rows are returned, selects `prediction_id WHERE identity_digest = $1` within the same transaction and returns `{ status: 'already-claimed', predictionId }`. |
| `recordIdempotencyKey(key, outcome)` | **Write** | Enforced by `PRIMARY KEY (idempotency_key)` on `publication_idempotency_keys`. Runs `INSERT INTO publication_idempotency_keys (idempotency_key, candidate_digest, outcome, recorded_at) VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`. |

### 2.3 Transaction boundary for step 6 (`claimIdentity`)

When steps 1–5 of `publishCandidate` succeed, step 6 must execute inside a single ACID
database transaction:

1. Insert the `official_predictions` row and initial `e0` (`published`) row in
   `prediction_events`, gated by `ON CONFLICT (identity_digest) DO NOTHING`.
2. If the insert conflicts on `identity_digest`, read the existing `prediction_id` and
   construct `{ kind: 'existing', predictionId, identityDigest }`; otherwise construct
   `{ kind: 'created', predictionId, identityDigest }`.
3. Insert the resulting `PublicationOutcome` into `publication_idempotency_keys` inside the
   same transaction before committing.

Because `UNIQUE (identity_digest)` is enforced by the database engine, two concurrent
workers racing on the same canonical proposition can never both commit `status: 'claimed'`.

---

## 3. Mapping `PublicationOutcome` to HTTP responses

Every call to `POST /v1/publications` returns one of the six `PublicationOutcome` variants:

| `PublicationOutcome['kind']` | HTTP status | Meaning |
| --- | --- | --- |
| `created` | `201 Created` | New official prediction sealed; returns `{ kind: 'created', predictionId, identityDigest }`. |
| `existing` | `200 OK` | An official prediction already exists for `identityDigest`; returns the winning `predictionId`. |
| `replayed` | `200 OK` (or original status) | `idempotencyKey` was already processed; returns `{ kind: 'replayed', original }` with the original outcome untouched. |
| `wrong-stage` | `409 Conflict` | Candidate is in `stage` rather than `eligible-for-publication`. Nothing written to `official_predictions`. |
| `identity-conflict` | `422 Unprocessable Entity` | At least one component of `PropositionIdentity` is `unresolved` (`match.outcome === 'uncertain'`). Nothing written to `official_predictions`. |
| `rejected` | `422 Unprocessable Entity` | `evaluateCandidate` returned `eligible: false`; response includes all eleven `verdict.results` and `verdict.clarificationsRequired`. Nothing written to `official_predictions`. |
