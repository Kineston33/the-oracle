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

Exploration, identity comparison, and candidate evaluation are **read/analysis**
operations. Official publication and terminal resolution are **write** commands. No read or
evaluation endpoint may ever call `claimIdentity` or insert a row into the official archive.

| Operation class | Endpoint (target) | Domain function | Mutates official archive? |
| --- | --- | --- | --- |
| Read — archive lookup | `GET /v1/predictions` / `GET /v1/predictions/:id` | Archive query / `findByIdentity` | **No** |
| Read — identity check | `POST /v1/identities:compare` | `compareIdentities`, `identityDigest` | **No** |
| Read — dry-run evaluation | `POST /v1/candidates:evaluate` | `evaluateCandidate` | **No** |
| Write — candidate staging | `POST /v1/candidates` / `PATCH /v1/candidates/:id` | `advance` (`exploratory-query` → … → `eligible-for-publication`) | **No** (writes only to draft candidate storage) |
| Write — official publication | `POST /v1/publications` | `publishCandidate` | **Yes** — sole entry point that may call `claimIdentity` |
| Write — terminal event | `POST /v1/predictions/:id/events` | `appendEvent` (`resolved` \| `annulled`) | **Appends event only** — never updates `sealed_payload` |

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
