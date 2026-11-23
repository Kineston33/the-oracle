# THE ORACLE — Publication API & Storage Contract (v1.1)

This document specifies the storage invariants, transaction boundaries, and read/write
separation required to back **Official Publication Protocol v1.1**
(`src/data/publication-types.ts` and `src/data/publication.ts`) with a persistent database
and HTTP service.

> **Status in this repository**: No HTTP server and no database are shipped in v0.1.
> `InMemoryRegistry` (`src/data/publication.ts`) enforces the `PublicationRegistry`
> contract within a single JavaScript event loop for unit tests (`commitPublication`
> executes its idempotency check, identity claim, sealed record storage, and idempotency
> binding in one synchronous critical section with no `await` points); it does **not**
> survive process restarts or coordinate across multiple OS processes or nodes. A
> production backend must implement the relational constraints and ACID transaction below.

---

## 1. Separation of reads and writes

Exploration, identity comparison, candidate evaluation, and archive/event retrieval are
**read or non-publishing** operations. Official publication and terminal resolution are
**write** commands against the official ledger. No read, exploration, or evaluation
endpoint may ever call `commitPublication`, `claimIdentity`, or insert a row into
`official_predictions`.

### 1.1 Read, exploration, and analysis operations (never mutate the official archive)

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Submit exploratory query** | `POST /v1/queries:explore` | `readQuestion` (`src/lib/question.ts`); stage remains `exploratory-query` | **No** — returns lexical reading and matching archive records; never creates a prediction |
| **Match canonical proposition** | `POST /v1/identities:match` | `compareIdentities`, `identityDigest` (`src/data/canonical-identity.ts`), `registry.findByIdentity` | **No** — returns `IdentityMatch` (`equivalent` \| `distinct` \| `uncertain`) and any existing `predictionId` |
| **Evaluate candidate** | `POST /v1/candidates:evaluate` | `evaluateCandidate`, `verdictIsComplete` (`src/data/publication.ts`) | **No** — returns `EvaluationVerdict` (all 11 `RequirementResult` items and `clarificationsRequired`) |
| **Retrieve official prediction** | `GET /v1/predictions/:id` (and `GET /v1/predictions`) | `PredictionRecord` (`src/data/types.ts`), `registry.findByIdentity` | **No** — read-only lookup by `predictionId` or `identityDigest` |
| **Retrieve public event history** | `GET /v1/predictions/:id/events` | `RecordEvent[]`, `eventChainProblems`, `publishedLinkProblems` (`src/data/validate.ts`) | **No** — returns the ordered append-only chain (`e0`, `e1`, …) with schema-2 envelopes and digests |

### 1.2 Candidate staging and official publication/event commands

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Create / advance candidate** | `POST /v1/candidates` (and `POST /v1/candidates/:id/advance`) | `CandidateProposition`, `advanceCandidate`, `qualifyCandidate` (`exploratory-query` → `candidate-proposition` → `identity-matching` → `evaluation` → `eligible-for-publication`) | **No** — writes only to draft candidate storage; `candidateId` never becomes a `PredictionId` |
| **Publish official prediction** | `POST /v1/publications` | `publishCandidate(candidate, request, deps)` (`src/data/publication.ts`) | **Yes** — sole entry point permitted to call `registry.commitPublication` and seal `e0` (`published`) |
| **Append resolution event** | `POST /v1/predictions/:id/events` | `appendEvent(record, event)` (`src/data/events.ts`, `resolved` \| `annulled`) | **Appends event only** — inserts `e1` into `prediction_events`; never modifies `sealed_payload` or `probability` |

---

## 2. Mapping `PublicationRegistry` to database constraints and transactions

`PublicationRegistry` (`src/data/publication-types.ts`) defines five methods. In a
relational store (such as PostgreSQL), their correctness depends on `UNIQUE` / `PRIMARY KEY`
constraints and a single ACID transaction covering both idempotency and identity claiming.

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
  request_digest   CHAR(64) NOT NULL,
  outcome          JSONB NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL
);
```

### 2.2 Registry method mapping

| `PublicationRegistry` method | Read / Write | Database constraint & SQL contract |
| --- | --- | --- |
| `findByIdempotencyKey(key, requestDigest)` | **Read** | `SELECT request_digest, outcome FROM publication_idempotency_keys WHERE idempotency_key = $1`. Returns `{ status: 'miss' }` if absent, `{ status: 'match', requestDigest, outcome }` if `request_digest = $2`, or `{ status: 'conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }` if `request_digest <> $2`. |
| `findByIdentity(identityDigest)` | **Read** | `SELECT prediction_id, sealed_payload FROM official_predictions WHERE identity_digest = $1`. Read-only lookup by canonical identity digest. |
| `recordIdempotencyKey(key, requestDigest, outcome)` | **Write (atomic)** | Enforced by `PRIMARY KEY (idempotency_key)` on `publication_idempotency_keys`. Runs `INSERT INTO publication_idempotency_keys (idempotency_key, request_digest, outcome, recorded_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING request_digest`. If 0 rows are returned, selects the existing `(request_digest, outcome)` in the same transaction and returns `replayed` (when equal to `$2`) or `idempotency-conflict` (when unequal). |
| `claimIdentity(identityDigest, predictionId, record)` | **Write (atomic)** | Enforced by `UNIQUE (identity_digest)` on `official_predictions`. Low-level single-table claim used by direct contract tests. |
| `commitPublication(commit)` | **Write (single ACID transaction)** | Enforced jointly by `PRIMARY KEY (idempotency_key)` and `UNIQUE (identity_digest)`. Executes the four-step ACID transaction in §2.3 so the winning prediction, its initial `e0` event, and its idempotency outcome are committed together. |

### 2.3 Single ACID transaction for `commitPublication`

When steps 1–6 of `publishCandidate` succeed, step 7 calls `commitPublication`, which a
relational backend must execute inside one transaction (`BEGIN` … `COMMIT`):

1. **Reserve idempotency key first**:
   Attempt `INSERT INTO publication_idempotency_keys` or `SELECT request_digest, outcome FROM publication_idempotency_keys WHERE idempotency_key = $1 FOR UPDATE` (or advisory lock on `hashtext(idempotency_key)`).
   - If a row already exists with `request_digest = $2`, `COMMIT` and return
     `{ status: 'replayed', original: outcome }`.
   - If a row already exists with `request_digest <> $2`, `ROLLBACK` (nothing written to
     `official_predictions`) and return
     `{ status: 'idempotency-conflict', existingRequestDigest, incomingRequestDigest }`.
2. **Claim canonical identity or observe winner**:
   Run:
   ```sql
   INSERT INTO official_predictions (prediction_id, identity_digest, sealed_payload, payload_digest, published_at)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (identity_digest) DO NOTHING
   RETURNING prediction_id;
   ```
   - If the row is inserted (`status: 'created'`), insert the initial `e0` (`published`)
     row into `prediction_events` in the same transaction and construct
     `outcome = { kind: 'created', predictionId, identityDigest, requestDigest, record }`.
   - If `RETURNING` yields 0 rows (`status: 'existing'`), select the winning
     `prediction_id` from `official_predictions WHERE identity_digest = $2` in the same
     transaction and construct
     `outcome = { kind: 'existing', predictionId: winnerId, identityDigest, requestDigest }`.
3. **Persist idempotency outcome**:
   Insert `(idempotency_key, request_digest, outcome, NOW())` into
   `publication_idempotency_keys`.
4. **Commit**:
   `COMMIT` the transaction.

Because step 1 arbitrates `idempotency_key` before step 2 touches `official_predictions`,
concurrent requests sharing an `idempotency_key` with different contents can never both
proceed to claim identities. Because step 2 arbitrates `UNIQUE (identity_digest)` inside
the same transaction, concurrent requests with different `idempotency_key` values and the
same canonical proposition produce exactly one `created` winner and one `existing`
response.

---

## 3. Mapping `PublicationOutcome` to HTTP responses

Every call to `POST /v1/publications` returns one of the eight `PublicationOutcome`
variants:

| `PublicationOutcome['kind']` | HTTP status | Meaning |
| --- | --- | --- |
| `created` | `201 Created` | New official prediction sealed and committed; returns `{ kind: 'created', predictionId, identityDigest, requestDigest, record }`. |
| `existing` | `200 OK` | An official prediction already exists for `identityDigest`; returns the winning `predictionId`. |
| `replayed` | `200 OK` (or original status) | `idempotencyKey` was already processed with the identical `requestDigest`; returns `{ kind: 'replayed', original }` with the original outcome untouched. |
| `idempotency-conflict` | `409 Conflict` | `idempotencyKey` was reused with different candidate or request content (`existingRequestDigest !== incomingRequestDigest`). Never treated as a replay or publication. |
| `candidate-mismatch` | `422 Unprocessable Entity` | `request.candidateId !== candidate.candidateId` (`reason: 'candidate-id'`) or `request.identity` does not match `candidate.proposedIdentity` under the alias table (`reason: 'proposed-identity'`). Rejected before any registry lookup or mutation. |
| `wrong-stage` | `409 Conflict` | Candidate is not in `eligible-for-publication` (`reason: 'invalid-stage'`) or its `eligible-for-publication` stage was forged/modified without a verified lifecycle attestation (`reason: 'forged-stage'`). Nothing written to `official_predictions`. |
| `identity-conflict` | `422 Unprocessable Entity` | At least one component of `PropositionIdentity` is `unresolved` (`match.outcome === 'uncertain'`). Nothing written to `official_predictions`. |
| `rejected` | `422 Unprocessable Entity` | `evaluateCandidate` returned `eligible: false`; response includes all eleven `verdict.results` and `verdict.clarificationsRequired`. Nothing written to `official_predictions`. |
