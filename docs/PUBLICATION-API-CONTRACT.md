# THE ORACLE — Publication API & Storage Contract (v1.2)

This document specifies the storage invariants, transaction boundaries, isolation-level
requirements, and read/write separation required to back **Official Publication Protocol v1.2**
(`src/data/publication-types.ts` and `src/data/publication.ts`) with a persistent database
and HTTP service.

> **Status in this repository**: No HTTP server and no database are shipped in v0.1.
> `InMemoryRegistry` (`src/data/publication.ts`) enforces the `PublicationRegistry`
> contract within a single JavaScript event loop for unit tests (`commitPublication`
> executes its idempotency check, identity claim, sealed record storage, and idempotency
> binding in one synchronous critical section with no `await` points); it does **not**
> survive process restarts or coordinate across multiple OS processes or nodes. Single-threaded
> `InMemoryRegistry` tests verify the domain state machine and contract invariants, not
> distributed database atomicity. A production backend must implement the relational
> constraints and ACID transaction specified below.

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
| **Evaluate candidate** | `POST /v1/candidates:evaluate` | `evaluateCandidate(candidate, { publishedAt })`, `verdictIsComplete` (`src/data/publication.ts`) | **No** — returns `EvaluationVerdict` (all 11 `RequirementResult` items and `clarificationsRequired`) evaluated against the supplied or candidate timestamp |
| **Retrieve official prediction** | `GET /v1/predictions/:id` (and `GET /v1/predictions`) | `PredictionRecord` (`src/data/types.ts`), `registry.findByIdentity` | **No** — read-only lookup by `predictionId` or `identityDigest` |
| **Retrieve public event history** | `GET /v1/predictions/:id/events` | `RecordEvent[]`, `eventChainProblems`, `publishedLinkProblems` (`src/data/validate.ts`) | **No** — returns the ordered append-only chain (`e0`, `e1`, …) with schema-2 envelopes and digests |

### 1.2 Candidate staging and official publication/event commands

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Create / advance candidate** | `POST /v1/candidates` (and `POST /v1/candidates/:id/advance`) | `CandidateProposition`, `advanceCandidate`, `qualifyCandidate` (`exploratory-query` → `candidate-proposition` → `identity-matching` → `evaluation` → `eligible-for-publication`) | **No** — writes only to draft candidate storage; `candidateId` never becomes a `PredictionId` |
| **Publish official prediction** | `POST /v1/publications` | `publishCandidate(candidate, request, deps)` (`src/data/publication.ts`) | **Yes** — sole entry point permitted to call `registry.commitPublication` and seal `e0` (`published`) with `demo: false` |
| **Append resolution event** | `POST /v1/predictions/:id/events` | `appendEvent(record, event)` (`src/data/events.ts`, `resolved` \| `annulled`) | **Appends event only** — inserts `e1` into `prediction_events`; never modifies `sealed_payload` or `probability` |

---

## 2. Mapping `PublicationRegistry` to database constraints and transactions

`PublicationRegistry` (`src/data/publication-types.ts`) defines five methods. In a
relational store (PostgreSQL), their correctness depends on `PRIMARY KEY` / `UNIQUE`
constraints, a deferred completeness constraint on `publication_idempotency_keys`, and a
single `READ COMMITTED` ACID transaction covering both idempotency reservation and
canonical identity claiming.

### 2.1 Schema constraints

```sql
CREATE TABLE official_predictions (
  prediction_id   TEXT PRIMARY KEY,
  identity_digest CHAR(64) NOT NULL UNIQUE,
  sealed_payload  JSONB NOT NULL,
  payload_digest  CHAR(64) NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT official_predictions_recording_order
    CHECK (recorded_at > published_at)
);

CREATE TABLE prediction_events (
  prediction_id   TEXT NOT NULL REFERENCES official_predictions(prediction_id),
  seq             TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('published', 'resolved', 'annulled')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  envelope        JSONB NOT NULL,
  digest          CHAR(64) NOT NULL,
  prev_digest     CHAR(64),
  PRIMARY KEY (prediction_id, seq),
  CONSTRAINT prediction_events_recording_order
    CHECK (recorded_at > occurred_at)
);

CREATE TABLE publication_idempotency_keys (
  idempotency_key  TEXT PRIMARY KEY,
  request_digest   CHAR(64) NOT NULL,
  outcome          JSONB,
  recorded_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT publication_idempotency_outcome_complete
    CHECK (outcome IS NOT NULL)
    DEFERRABLE INITIALLY DEFERRED
);
```

Why `publication_idempotency_outcome_complete` is `DEFERRABLE INITIALLY DEFERRED`:

- A transaction that reserves `idempotency_key` at the start of `commitPublication` inserts
  `outcome = NULL` before it knows whether `official_predictions` will yield `created` or
  `existing`, and updates `outcome` to the non-null JSON result before `COMMIT`.
- Because the `CHECK (outcome IS NOT NULL)` constraint is enforced at `COMMIT` time, no
  transaction can ever commit a placeholder row with `outcome IS NULL`. If any statement in
  the transaction fails — or if the process crashes or omits the final `UPDATE` —
  PostgreSQL aborts the entire transaction and rolls back the reservation automatically.

### 2.2 Registry method mapping

| `PublicationRegistry` method | Read / Write | Database constraint & SQL contract |
| --- | --- | --- |
| `findByIdempotencyKey(key, requestDigest)` | **Read** | `SELECT request_digest, outcome FROM publication_idempotency_keys WHERE idempotency_key = $1`. Returns `{ status: 'miss' }` if absent, `{ status: 'match', requestDigest, outcome }` if `request_digest = $2`, or `{ status: 'conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }` if `request_digest <> $2`. |
| `findByIdentity(identityDigest)` | **Read** | `SELECT prediction_id, sealed_payload FROM official_predictions WHERE identity_digest = $1`. Read-only lookup by canonical identity digest. |
| `recordIdempotencyKey(key, requestDigest, outcome)` | **Write (atomic)** | Enforced by `PRIMARY KEY (idempotency_key)` on `publication_idempotency_keys`. Runs `INSERT INTO publication_idempotency_keys (idempotency_key, request_digest, outcome, recorded_at) VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING request_digest` with non-null `$3`. If 0 rows are returned, selects the committed `(request_digest, outcome)` in the next statement under `READ COMMITTED` and returns `replayed` (when equal to `$2`) or `idempotency-conflict` (when unequal). |
| `claimIdentity(identityDigest, predictionId, record)` | **Write (atomic)** | Enforced by `UNIQUE (identity_digest)` on `official_predictions`. Low-level single-table claim used by direct contract tests. |
| `commitPublication(commit)` | **Write (single ACID transaction)** | Enforced jointly by `PRIMARY KEY (idempotency_key)`, `DEFERRABLE INITIALLY DEFERRED CHECK (outcome IS NOT NULL)`, and `UNIQUE (identity_digest)`. Executes the four-step ACID transaction in §2.3 so the winning prediction, its initial `e0` event, and its idempotency outcome are committed together. |

### 2.3 Single ACID transaction for `commitPublication`

> **Why `SELECT ... FOR UPDATE` on a missing row is forbidden**: In PostgreSQL, `SELECT ... FOR UPDATE`
> locks only existing tuples matching the `WHERE` clause. When `idempotency_key` does not yet
> exist in `publication_idempotency_keys`, two concurrent transactions executing `SELECT ... FOR UPDATE`
> both see 0 rows, acquire no lock, and would both proceed to insert into `official_predictions`.
> Conversely, under `REPEATABLE READ` or `SERIALIZABLE`, a transaction whose `INSERT ... ON CONFLICT DO NOTHING`
> returns 0 rows after waiting for a concurrent writer cannot see the newly committed row in a
> subsequent `SELECT` because its transaction snapshot was frozen at the first statement.
> Therefore, `commitPublication` **must** run under `READ COMMITTED` isolation and **must**
> arbitrate the idempotency key via `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
> before touching `official_predictions`.

When steps 1–8 of `publishCandidate` succeed, step 9 calls `commitPublication`, which a
PostgreSQL backend executes inside one `READ COMMITTED` transaction:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
```

1. **Step 1 — Reserve the idempotency key via unique-index conflict arbitration**:
   ```sql
   INSERT INTO publication_idempotency_keys (idempotency_key, request_digest, outcome, recorded_at)
   VALUES ($1, $2, NULL, $3)
   ON CONFLICT (idempotency_key) DO NOTHING
   RETURNING idempotency_key;
   ```
   - **Concurrency behavior**: PostgreSQL acquires the unique-index insertion lock for `$1`.
     If a concurrent transaction has already inserted `$1` and is still in flight, this
     `INSERT` blocks until that transaction either commits or rolls back.
   - If the concurrent transaction **rolls back**, PostgreSQL wakes this statement, inserts
     the row, and returns 1 row (`idempotency_key`). Execution proceeds to Step 2.
   - If a prior or concurrent transaction **committed** `$1`, `ON CONFLICT DO NOTHING`
     returns 0 rows. Because PostgreSQL `READ COMMITTED` takes a fresh snapshot at the
     start of each SQL statement, the next statement in the same transaction sees the
     committed row (whose `outcome` is guaranteed non-null by `publication_idempotency_outcome_complete`):
     ```sql
     SELECT request_digest, outcome
     FROM publication_idempotency_keys
     WHERE idempotency_key = $1;
     ```
     - If `request_digest = $2`, `ROLLBACK` (no writes were made by this transaction) and
       return `{ status: 'replayed', original: outcome }`.
     - If `request_digest <> $2`, `ROLLBACK` (nothing was written to `official_predictions`
       or `prediction_events`) and return
       `{ status: 'idempotency-conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }`.

2. **Step 2 — Claim canonical identity or observe winner (reached only by the transaction that won Step 1)**:
   ```sql
   INSERT INTO official_predictions (
     prediction_id, identity_digest, sealed_payload, payload_digest, published_at, recorded_at
   )
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (identity_digest) DO NOTHING
   RETURNING prediction_id;
   ```
   - If 1 row is returned (`status: 'created'`), insert the initial `e0` (`published`) row
     into `prediction_events` in the same transaction:
     ```sql
     INSERT INTO prediction_events (
       prediction_id, seq, kind, occurred_at, recorded_at, envelope, digest, prev_digest
     )
     VALUES ($1, 'e0', 'published', $2, $3, $4, $5, NULL);
     ```
     and construct
     `outcome = { kind: 'created', predictionId, identityDigest, requestDigest, record }`.
   - If 0 rows are returned (`status: 'existing'`), another transaction with a different
     `idempotency_key` already committed the same `identity_digest`. Execute a fresh-snapshot
     `SELECT` in the same `READ COMMITTED` transaction:
     ```sql
     SELECT prediction_id, sealed_payload
     FROM official_predictions
     WHERE identity_digest = $2;
     ```
     and construct
     `outcome = { kind: 'existing', predictionId: winnerId, identityDigest, requestDigest, record: winnerRecord }`.

3. **Step 3 — Complete the reserved idempotency row in the same transaction**:
   ```sql
   UPDATE publication_idempotency_keys
   SET outcome = $2
   WHERE idempotency_key = $1;
   ```

4. **Step 4 — Commit and verify deferred constraints**:
   ```sql
   COMMIT;
   ```
   At `COMMIT`, PostgreSQL validates the deferred constraint
   `publication_idempotency_outcome_complete` (`CHECK (outcome IS NOT NULL)`). If any step
   between `BEGIN` and `COMMIT` failed, threw an exception, lost its database connection, or
   left `outcome` null, the entire transaction rolls back atomically: neither a placeholder
   idempotency row nor an orphaned `official_predictions` row can ever persist.

### 2.4 Why rejected publication requests never reserve an identity

All pre-commit rejections in `publishCandidate` occur **before** `commitPublication` is
called:

- `candidate-mismatch` (step 1), `candidate-digest-mismatch` (step 2), `wrong-stage` with
  `reason: 'invalid-stage'` (step 3), and `invalid-clock` (step 4) return before any
  registry read or write.
- `identity-conflict` (step 6) and `rejected` (step 7, including expired horizons
  `publishedAt >= horizon.endsAt` and post-publication evidence `evidence[i].publishedAt > publishedAt`)
  call only `recordIdempotencyKey` on `publication_idempotency_keys` and never touch
  `official_predictions`.
- `wrong-stage` with `reason: 'forged-stage'` (step 8) returns before `commitPublication`
  and never touches `official_predictions`.

Consequently, a rejected publication attempt can never claim an `identity_digest` in
`official_predictions` or block a later valid candidate for the same canonical proposition
with a fresh `idempotencyKey`.

---

## 3. Mapping `PublicationOutcome` to HTTP responses

Every call to `POST /v1/publications` returns one of the ten `PublicationOutcome` variants:

| `PublicationOutcome['kind']` | HTTP status | Meaning |
| --- | --- | --- |
| `created` | `201 Created` | New official prediction (`demo: false`) sealed and committed; returns `{ kind: 'created', predictionId, identityDigest, requestDigest, record }`. |
| `existing` | `200 OK` | An official prediction already exists for `identityDigest`; returns `{ kind: 'existing', predictionId, identityDigest, requestDigest, record }` for the winning prediction. |
| `replayed` | `200 OK` (or original status) | `idempotencyKey` was already processed with the identical `requestDigest`; returns `{ kind: 'replayed', original }` with the original outcome untouched. |
| `idempotency-conflict` | `409 Conflict` | `idempotencyKey` was reused with different candidate or request content (`existingRequestDigest !== incomingRequestDigest`). Never treated as a replay or publication. |
| `candidate-mismatch` | `422 Unprocessable Entity` | `request.candidateId !== candidate.candidateId` (`reason: 'candidate-id'`) or `request.identity` does not match `candidate.proposedIdentity` under the alias table (`reason: 'proposed-identity'`). Rejected before any registry lookup or mutation. |
| `candidate-digest-mismatch` | `422 Unprocessable Entity` | `request.candidateDigest` is empty (`reason: 'missing'`), not a 64-character lowercase hex SHA-256 (`reason: 'malformed'`), or does not equal `candidateContentDigest(candidate, aliases)` (`reason: 'mismatch'`). Rejected before any registry lookup or mutation. |
| `invalid-clock` | `500 Internal Server Error` (or `422` if caller-supplied clock in test harness) | Injected clock produced a non-ISO/invalid calendar `publishedAt` or `recordedAt`, or failed `recordedAt > publishedAt`. Rejected before any registry lookup or mutation. |
| `wrong-stage` | `409 Conflict` | Candidate is not in `eligible-for-publication` (`reason: 'invalid-stage'`) or its `eligible-for-publication` stage was forged/modified without a verified lifecycle attestation (`reason: 'forged-stage'`). Nothing written to `official_predictions`. |
| `identity-conflict` | `422 Unprocessable Entity` | At least one component of `PropositionIdentity` is `unresolved` (`match.outcome === 'uncertain'`). Nothing written to `official_predictions`. |
| `rejected` | `422 Unprocessable Entity` | `evaluateCandidate(candidate, { publishedAt })` returned `eligible: false` (including `publishedAt >= horizon.endsAt` or `evidence[i].publishedAt > publishedAt`); response includes all eleven `verdict.results` and `verdict.clarificationsRequired`. Nothing written to `official_predictions`. |
