# THE ORACLE — Publication API & Storage Contract (v1.3)

This document specifies the storage invariants, transaction boundaries, isolation-level
requirements, and read/write separation required to back **Official Publication Protocol v1.3**
(`src/data/publication-types.ts` and `src/data/publication.ts`) with a persistent PostgreSQL
database and HTTP service.

> **Status in this repository**: No HTTP server and no PostgreSQL database are shipped or
> running in this repository/sandbox. `InMemoryRegistry` (`src/data/publication.ts`)
> enforces the `PublicationRegistry` contract within a single JavaScript event loop for unit
> tests (`commitPublication` executes its idempotency check, identity claim, sealed record
> storage, and idempotency binding in one synchronous critical section with no `await`
> points); it does **not** survive process restarts or coordinate across multiple OS
> processes or nodes. Single-threaded `InMemoryRegistry` tests verify the domain state
> machine and contract invariants, and the PostgreSQL DDL and transaction statements below
> are verified by static SQL contract inspection and automated tests rather than executed
> against a live PostgreSQL instance. A production backend must implement the relational
> constraints, PL/pgSQL deferred constraint trigger, and `READ COMMITTED` ACID transaction
> specified below.

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

## 2. Mapping `PublicationRegistry` to PostgreSQL constraints and transactions

`PublicationRegistry` (`src/data/publication-types.ts`) defines five methods. In PostgreSQL,
their correctness depends on:

1. `PRIMARY KEY` and `UNIQUE` constraints (`PRIMARY KEY (idempotency_key)` on
   `publication_idempotency_keys` and `UNIQUE (identity_digest)` on `official_predictions`),
2. A non-null transaction-local reservation sentinel (`'{"kind":"__pending__"}'::jsonb`)
   paired with:
   - an immediate `CHECK` constraint (`publication_idempotency_outcome_valid_shape`),
   - an immediate `BEFORE UPDATE OR DELETE` trigger (`publication_idempotency_immutability_trg`)
     that forbids `DELETE`, forbids any `UPDATE` on already-finalized rows, protects
     `idempotency_key`, `request_digest`, and `recorded_at` from modification, and permits
     only the transition `'__pending__' -> ('created' | 'existing' | 'identity-conflict' | 'rejected')`, and
   - a `DEFERRABLE INITIALLY DEFERRED` `CONSTRAINT TRIGGER`
     (`publication_idempotency_outcome_complete_trg`) that validates the live row state at
     `COMMIT` and forces a rollback if the row disappeared (`NOT FOUND`) or remains
     `'__pending__'`, and
3. A single `READ COMMITTED` ACID transaction covering idempotency reservation, canonical
   identity claiming, initial `e0` event insertion, and idempotency outcome finalization.

### 2.1 PostgreSQL schema, immutability trigger, and deferred constraint trigger

> **Why an ordinary `CHECK` constraint cannot be deferred in PostgreSQL**: PostgreSQL only
> supports `DEFERRABLE` on `PRIMARY KEY`, `UNIQUE`, `EXCLUDE`, and `FOREIGN KEY` table
> constraints, and on `CREATE CONSTRAINT TRIGGER`. A table `CHECK (...) DEFERRABLE INITIALLY DEFERRED`
> clause is a syntax error in PostgreSQL, and an immediate `CHECK (outcome IS NOT NULL)`
> would reject a `NULL` reservation `INSERT` before the transaction could arbitrate
> `official_predictions`.
>
> Instead, `publication_idempotency_keys.outcome` is declared `JSONB NOT NULL` with an
> immediate `CHECK` constraint allowing the transaction-local sentinel
> `'{"kind":"__pending__"}'::jsonb` during the reservation `INSERT`, an immediate
> `BEFORE UPDATE OR DELETE` trigger enforces one-way finalization and row immutability, and a
> `DEFERRABLE INITIALLY DEFERRED` `CONSTRAINT TRIGGER` queries the live row state at
> `COMMIT` time and aborts the transaction if the row disappeared (`NOT FOUND`) or if
> `outcome ->> 'kind'` is still `'__pending__'`.

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
  outcome          JSONB NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT publication_idempotency_outcome_valid_shape CHECK (
    jsonb_typeof(outcome) = 'object'
    AND (outcome ->> 'kind') IN (
      '__pending__',
      'created',
      'existing',
      'identity-conflict',
      'rejected'
    )
  )
);

CREATE OR REPLACE FUNCTION enforce_publication_idempotency_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'DELETE on publication_idempotency_keys is forbidden (idempotency_key = %)',
      OLD.idempotency_key
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Finalized idempotency rows are strictly immutable; only a row currently in
    -- the transaction-local '__pending__' state may be updated.
    IF (OLD.outcome ->> 'kind') IS DISTINCT FROM '__pending__' THEN
      RAISE EXCEPTION
        'publication_idempotency_keys row % is already finalized (%) and cannot be updated',
        OLD.idempotency_key,
        OLD.outcome ->> 'kind'
        USING ERRCODE = '23514';
    END IF;

    -- Immutable identity and audit columns may never change during finalization.
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    THEN
      RAISE EXCEPTION
        'publication_idempotency_keys immutable columns (idempotency_key, request_digest, recorded_at) cannot be modified for %',
        OLD.idempotency_key
        USING ERRCODE = '23514';
    END IF;

    -- The only permitted UPDATE transition is '__pending__' -> valid final outcome.
    IF NEW.outcome IS NULL
       OR jsonb_typeof(NEW.outcome) <> 'object'
       OR (NEW.outcome ->> 'kind') IS NULL
       OR (NEW.outcome ->> 'kind') NOT IN (
         'created',
         'existing',
         'identity-conflict',
         'rejected'
       )
    THEN
      RAISE EXCEPTION
        'publication_idempotency_keys row % must transition from __pending__ to a valid final outcome, got: %',
        OLD.idempotency_key,
        NEW.outcome
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER publication_idempotency_immutability_trg
  BEFORE UPDATE OR DELETE ON publication_idempotency_keys
  FOR EACH ROW
  EXECUTE FUNCTION enforce_publication_idempotency_immutability();

CREATE OR REPLACE FUNCTION enforce_publication_idempotency_outcome_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_outcome JSONB;
BEGIN
  -- Query the current row state by primary key at COMMIT time rather than
  -- inspecting NEW.outcome directly: in PostgreSQL, a deferred AFTER INSERT
  -- row trigger receives the INSERT-time tuple in NEW ('{"kind":"__pending__"}')
  -- even when a subsequent UPDATE in the same transaction has finalized the row.
  SELECT outcome
    INTO current_outcome
    FROM publication_idempotency_keys
   WHERE idempotency_key = NEW.idempotency_key;

  -- If the reservation row disappeared before COMMIT, abort the transaction.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'publication_idempotency_keys row % disappeared before commit',
      NEW.idempotency_key
      USING ERRCODE = '23514';
  END IF;

  IF current_outcome IS NULL
     OR jsonb_typeof(current_outcome) <> 'object'
     OR (current_outcome ->> 'kind') IS NULL
     OR (current_outcome ->> 'kind') = '__pending__'
     OR (current_outcome ->> 'kind') NOT IN (
       'created',
       'existing',
       'identity-conflict',
       'rejected'
     )
  THEN
    RAISE EXCEPTION
      'publication_idempotency_keys row % cannot commit with incomplete or sentinel outcome: %',
      NEW.idempotency_key,
      current_outcome
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER publication_idempotency_outcome_complete_trg
  AFTER INSERT OR UPDATE ON publication_idempotency_keys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_publication_idempotency_outcome_complete();
```

#### How the two triggers enforce intra-transaction finalization and permanent immutability

1. **Compatible with `INSERT` followed by `UPDATE` in the same transaction**:
   When a transaction executes `INSERT INTO publication_idempotency_keys ... VALUES ($1, $2, '{"kind":"__pending__"}'::jsonb, $3)`
   and later in the same transaction executes `UPDATE publication_idempotency_keys SET outcome = $2 WHERE idempotency_key = $1`,
   PostgreSQL queues two deferred trigger invocations for `COMMIT`: one for the `INSERT`
   (whose `NEW` record holds the `INSERT`-time snapshot with `NEW.outcome = '{"kind":"__pending__"}'`)
   and one for the `UPDATE` (whose `NEW` record holds the updated snapshot). Because
   `enforce_publication_idempotency_outcome_complete()` executes
   `SELECT outcome INTO current_outcome FROM publication_idempotency_keys WHERE idempotency_key = NEW.idempotency_key;`
   at `COMMIT`, both queued invocations inspect the **live, post-`UPDATE` tuple** at the end
   of the transaction and succeed once `current_outcome ->> 'kind'` has been finalized to
   `'created'`, `'existing'`, `'identity-conflict'`, or `'rejected'`.
2. **Exclusively `pending -> final` within the same transaction, and strictly immutable thereafter**:
   - `publication_idempotency_immutability_trg` (`BEFORE UPDATE OR DELETE`) rejects any
     `UPDATE` unless `(OLD.outcome ->> 'kind') = '__pending__'` and
     `(NEW.outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected')`.
   - During that single allowed transition (`'__pending__' -> final`), `NEW.idempotency_key`,
     `NEW.request_digest`, and `NEW.recorded_at` must remain identical to `OLD`
     (`IS NOT DISTINCT FROM`), so neither the key, the bound request digest, nor the
     recording timestamp can ever be altered.
   - Because `publication_idempotency_outcome_complete_trg` (`DEFERRABLE INITIALLY DEFERRED`)
     aborts any transaction that attempts to `COMMIT` with `(current_outcome ->> 'kind') = '__pending__'`,
     a `'__pending__'` row can never survive `COMMIT`: the transition `'__pending__' -> final`
     can only happen **inside the same transaction** that inserted the `'__pending__'` row.
   - Once finalized (`'created'`, `'existing'`, `'identity-conflict'`, or `'rejected'`), any
     subsequent `UPDATE` (whether in the same transaction or a later transaction) is
     immediately rejected because `(OLD.outcome ->> 'kind') IS DISTINCT FROM '__pending__'`.
3. **`DELETE` is forbidden and disappearing reservations force a rollback**:
   - `publication_idempotency_immutability_trg` (`BEFORE DELETE`) unconditionally rejects
     `DELETE` on `publication_idempotency_keys` (`ERRCODE = '23514'`), preventing deletion of
     consumed keys or pending reservations.
   - As defense-in-depth, if a pending reservation row ever disappeared before `COMMIT`,
     `enforce_publication_idempotency_outcome_complete()` detects `IF NOT FOUND` at `COMMIT`
     and raises `ERRCODE = '23514'`, aborting the transaction and rolling back any writes to
     `official_predictions` or `prediction_events`.
4. **Why the `'{"kind":"__pending__"}'` sentinel can never be committed or mistaken for a replayable outcome**:
   - **Never committed**: If a transaction inserts `'{"kind":"__pending__"}'` and reaches
     `COMMIT` without updating `outcome` to one of the four final kinds,
     `publication_idempotency_outcome_complete_trg` fires during `COMMIT`, sees
     `(current_outcome ->> 'kind') = '__pending__'`, raises SQLSTATE `23514`, and rolls back
     the entire transaction.
   - **Never visible to other transactions**: PostgreSQL never allows dirty reads. While the
     reserving transaction is uncommitted, no other transaction can see its uncommitted
     `'{"kind":"__pending__"}'` tuple; and because the deferred trigger forbids committing
     `'{"kind":"__pending__"}'`, no committed snapshot can ever contain it.
   - **Rejected by domain types and read queries**: `'__pending__'` is not a member of
     `PublicationOutcome['kind']`, and every read query (`findByIdempotencyKey` and the
     post-conflict `SELECT`) explicitly requires
     `(outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected')`.

### 2.2 Registry method mapping

| `PublicationRegistry` method | Read / Write | Database constraint & SQL contract |
| --- | --- | --- |
| `findByIdempotencyKey(key, requestDigest)` | **Read** | `SELECT request_digest, outcome FROM publication_idempotency_keys WHERE idempotency_key = $1 AND (outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected');`. Returns `{ status: 'miss' }` if absent, `{ status: 'match', requestDigest, outcome }` if `request_digest = $2`, or `{ status: 'conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }` if `request_digest <> $2`. |
| `findByIdentity(identityDigest)` | **Read** | `SELECT prediction_id, sealed_payload FROM official_predictions WHERE identity_digest = $1;`. Read-only lookup by canonical identity digest. |
| `recordIdempotencyKey(key, requestDigest, outcome)` | **Write (atomic)** | Used in steps 6 (`identity-conflict`) and 7 (`rejected`) where the complete non-sentinel `outcome` is already known. Runs `INSERT INTO publication_idempotency_keys (idempotency_key, request_digest, outcome, recorded_at) VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING request_digest;` inside a `READ COMMITTED` transaction with `$3` having `kind IN ('identity-conflict', 'rejected')`. Immediately locked against any future `UPDATE` or `DELETE` by `publication_idempotency_immutability_trg`. If 0 rows are returned, selects the committed `(request_digest, outcome)` in the next statement under `READ COMMITTED` and returns `replayed` (when `request_digest = $2`) or `idempotency-conflict` (when `request_digest <> $2`). |
| `claimIdentity(identityDigest, predictionId, record)` | **Write (atomic)** | Enforced by `UNIQUE (identity_digest)` on `official_predictions`. Low-level single-table claim used by direct contract tests. |
| `commitPublication(commit)` | **Write (single ACID transaction)** | Enforced jointly by `PRIMARY KEY (idempotency_key)`, `publication_idempotency_immutability_trg`, `publication_idempotency_outcome_complete_trg`, and `UNIQUE (identity_digest)`. Executes the four-step `READ COMMITTED` ACID transaction in §2.3 so the winning prediction, its initial `e0` event, and its finalized, permanently immutable idempotency outcome are committed together. |

### 2.3 Single `READ COMMITTED` ACID transaction for `commitPublication`

> **Why `READ COMMITTED` with `INSERT ... ON CONFLICT` is required**:
> - Under `READ COMMITTED`, `SELECT ... FOR UPDATE` on a non-existent `idempotency_key`
>   returns 0 rows and acquires no lock, allowing two concurrent callers to race past the
>   check.
> - Under `REPEATABLE READ` or `SERIALIZABLE`, a transaction whose
>   `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` returns 0 rows after waiting for a
>   concurrent writer cannot see the newly committed row in a subsequent `SELECT` because its
>   transaction snapshot was frozen at the first statement.
> - Under `READ COMMITTED`, `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` blocks a
>   second writer on the unique-index lock until the first writer commits or rolls back, and
>   each subsequent `SELECT` statement in the same transaction takes a fresh statement
>   snapshot that sees all rows committed before that statement began.

When steps 1–8 of `publishCandidate` succeed, step 9 calls `commitPublication`, which a
PostgreSQL backend executes inside one `READ COMMITTED` transaction:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
```

1. **Step 1 — Reserve the idempotency key with the transaction-local sentinel**:
   ```sql
   INSERT INTO publication_idempotency_keys (
     idempotency_key,
     request_digest,
     outcome,
     recorded_at
   )
   VALUES (
     $1,
     $2,
     '{"kind":"__pending__"}'::jsonb,
     $3
   )
   ON CONFLICT (idempotency_key) DO NOTHING
   RETURNING idempotency_key;
   ```
   - **If 1 row is returned**: This transaction holds the uncommitted reservation for `$1`
     and proceeds to Step 2.
   - **If 0 rows are returned**: Another transaction already committed `$1` (or was already
     committed before this transaction started). Because this `INSERT` modified 0 rows,
     `publication_idempotency_outcome_complete_trg` is not queued for this transaction.
     Execute a fresh-snapshot `SELECT` in the same `READ COMMITTED` transaction:
     ```sql
     SELECT request_digest, outcome
     FROM publication_idempotency_keys
     WHERE idempotency_key = $1
       AND (outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected');
     ```
     - If `request_digest = $2`, execute `ROLLBACK;` (no writes were performed by this
       transaction) and return `{ status: 'replayed', original: outcome }`.
     - If `request_digest <> $2`, execute `ROLLBACK;` (nothing was written to
       `official_predictions` or `prediction_events`) and return
       `{ status: 'idempotency-conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }`.

2. **Step 2 — Claim canonical identity or observe the committed winner (reached only when Step 1 returned 1 row)**:
   ```sql
   INSERT INTO official_predictions (
     prediction_id,
     identity_digest,
     sealed_payload,
     payload_digest,
     published_at,
     recorded_at
   )
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (identity_digest) DO NOTHING
   RETURNING prediction_id;
   ```
   - **If 1 row is returned (`status: 'created'`)**: Insert the initial `e0` (`published`)
     event into `prediction_events` in the same transaction:
     ```sql
     INSERT INTO prediction_events (
       prediction_id,
       seq,
       kind,
       occurred_at,
       recorded_at,
       envelope,
       digest,
       prev_digest
     )
     VALUES ($1, 'e0', 'published', $2, $3, $4, $5, NULL);
     ```
     and construct the completed JSON outcome:
     `outcome = { kind: 'created', predictionId, identityDigest, requestDigest, record }`.
   - **If 0 rows are returned (`status: 'existing'`)**: Another transaction with a different
     `idempotency_key` already committed the same `identity_digest`. Read the committed
     winner using a fresh statement snapshot in the same `READ COMMITTED` transaction:
     ```sql
     SELECT prediction_id, sealed_payload
     FROM official_predictions
     WHERE identity_digest = $2;
     ```
     and construct the completed JSON outcome:
     `outcome = { kind: 'existing', predictionId: winnerId, identityDigest, requestDigest, record: winnerRecord }`.

3. **Step 3 — Finalize the reserved idempotency row in the same transaction**:
   Replace the transaction-local `'{"kind":"__pending__"}'::jsonb` sentinel with the
   completed `outcome` JSON object constructed in Step 2:
   ```sql
   UPDATE publication_idempotency_keys
   SET outcome = $2
   WHERE idempotency_key = $1;
   ```
   When this `UPDATE` executes, `publication_idempotency_immutability_trg` (`BEFORE UPDATE`)
   verifies that `OLD.outcome ->> 'kind' = '__pending__'`, that `idempotency_key`,
   `request_digest`, and `recorded_at` are unchanged, and that `NEW.outcome ->> 'kind'` is a
   valid final outcome (`'created'`, `'existing'`, `'identity-conflict'`, or `'rejected'`).
   Once this `UPDATE` completes, the row is in a final state and any subsequent `UPDATE` or
   `DELETE` is permanently rejected by `publication_idempotency_immutability_trg`.

4. **Step 4 — Commit and run the deferred constraint trigger**:
   ```sql
   COMMIT;
   ```
   During `COMMIT`, PostgreSQL fires `publication_idempotency_outcome_complete_trg`, which
   selects the live `outcome` for `idempotency_key = $1` and verifies that the row still
   exists (`IF NOT FOUND THEN RAISE EXCEPTION`) and that `outcome ->> 'kind'` is in
   `('created', 'existing', 'identity-conflict', 'rejected')` and is not `'__pending__'`.
   Only after the trigger succeeds does the transaction become visible to other sessions.

### 2.4 Exact concurrency, crash/rollback, and idempotency-key consumption guarantees

1. **Same `idempotency_key`, concurrent requests (identical or different `request_digest`)**:
   - Transaction A and Transaction B both execute Step 1 with the same `idempotency_key`.
   - PostgreSQL grants the unique-index lock on `publication_idempotency_keys(idempotency_key)`
     to A and blocks B at Step 1 before B can touch `official_predictions`.
   - When A commits (having finalized `outcome` in Step 3), B unblocks, receives 0 rows from
     `ON CONFLICT (idempotency_key) DO NOTHING`, reads A's committed `(request_digest, outcome)`
     in a fresh `READ COMMITTED` statement snapshot, rolls back its empty transaction, and
     returns `replayed` (if `request_digest` matches) or `idempotency-conflict` (if
     `request_digest` differs). Neither replay nor conflict ever inserts a duplicate
     prediction or event.
2. **Different `idempotency_key` values, same `identity_digest` (competing for the same canonical proposition)**:
   - Transaction A (`key-1`) and Transaction B (`key-2`) both win Step 1 for their distinct
     keys and reach Step 2 (`INSERT INTO official_predictions ... ON CONFLICT (identity_digest) DO NOTHING`).
   - PostgreSQL serializes Step 2 on `UNIQUE (identity_digest)`. If A commits first, A
     inserts the prediction and `e0` event and commits `outcome.kind = 'created'` for
     `key-1`. B then unblocks at Step 2, receives 0 rows from `ON CONFLICT (identity_digest) DO NOTHING`,
     selects A's committed `(prediction_id, sealed_payload)` in a fresh `READ COMMITTED`
     statement snapshot, updates `key-2` to `outcome.kind = 'existing'` referencing A's
     winning `prediction_id`, and commits. Exactly one official prediction and one `e0`
     event are created.
3. **Crash, rollback, incomplete transaction state, or attempted mutation/deletion**:
   - If a transaction crashes, loses its connection, encounters a runtime error, or executes
     `ROLLBACK` at any point after Step 1, PostgreSQL aborts the transaction, discards the
     uncommitted `'{"kind":"__pending__"}'` tuple (and any uncommitted Step 2 writes), and
     releases the unique-index lock so any waiting concurrent transaction immediately wins
     Step 1.
   - If a buggy caller executes Step 1 and attempts `COMMIT` without executing Step 3
     (`UPDATE`), or if the reservation row disappeared before `COMMIT` (`NOT FOUND`),
     `publication_idempotency_outcome_complete_trg` raises SQLSTATE `23514` at `COMMIT` and
     forces a full transaction rollback.
   - If any caller attempts to `DELETE` a row from `publication_idempotency_keys`, modify
     `idempotency_key`, `request_digest`, or `recorded_at`, or `UPDATE` an already-finalized
     row, `publication_idempotency_immutability_trg` (`BEFORE UPDATE OR DELETE`) immediately
     raises SQLSTATE `23514` and aborts the operation.
4. **Why rejected publication attempts never claim an official identity — and when an `idempotency_key` is consumed**:
   - **Pre-idempotency rejections (steps 1–4 and step 8)**: `candidate-mismatch` (step 1),
     `candidate-digest-mismatch` (step 2), `wrong-stage` with `reason: 'invalid-stage'`
     (step 3), `invalid-clock` (step 4), and `wrong-stage` with `reason: 'forged-stage'`
     (step 8) return without writing to either `publication_idempotency_keys` or
     `official_predictions`.
   - **Domain validation rejections (step 6 `identity-conflict` and step 7 `rejected`)**:
     When a request reaches step 6 (unresolved identity component) or step 7 (failed
     evaluation, including `publishedAt >= horizon.endsAt` or
     `evidence[i].publishedAt > publishedAt`), `publishCandidate` calls
     `recordIdempotencyKey` to persist the complete `identity-conflict` or `rejected`
     outcome in `publication_idempotency_keys`, and returns **without ever touching
     `official_predictions`**.
   - **Consequence for retries**: Neither `identity-conflict` nor `rejected` ever claims an
     `identity_digest` in `official_predictions`. However, because `recordIdempotencyKey`
     binds the caller's `idempotencyKey` to the rejected request's `requestDigest`:
     - Retrying the **identical** rejected request with the same `idempotencyKey` returns
       `{ kind: 'replayed', original }` (replaying the rejection).
     - Modifying the candidate to fix the issue (which changes `candidateContentDigest` and
       `publicationRequestDigest`) while reusing that same consumed `idempotencyKey` returns
       `{ kind: 'idempotency-conflict', ... }`.
     - **A corrected/retried candidate submission must therefore supply a new
       `idempotencyKey`**, which will pass all nine steps and claim the official identity
       with `{ kind: 'created', ... }`.

---

## 3. Mapping `PublicationOutcome` to HTTP responses

Every call to `POST /v1/publications` returns one of the ten `PublicationOutcome` variants:

| `PublicationOutcome['kind']` | HTTP status | Meaning |
| --- | --- | --- |
| `created` | `201 Created` | New official prediction (`demo: false`) sealed and committed; returns `{ kind: 'created', predictionId, identityDigest, requestDigest, record }`. |
| `existing` | `200 OK` | An official prediction already exists for `identityDigest`; returns `{ kind: 'existing', predictionId, identityDigest, requestDigest, record }` for the winning prediction. |
| `replayed` | `200 OK` (or original status) | `idempotencyKey` was already processed with the identical `requestDigest`; returns `{ kind: 'replayed', original }` with the original outcome untouched. |
| `idempotency-conflict` | `409 Conflict` | `idempotencyKey` was reused with different candidate or request content (`existingRequestDigest !== incomingRequestDigest`), including when a caller modifies a previously rejected candidate without generating a new `idempotencyKey`. Never treated as a replay or publication. |
| `candidate-mismatch` | `422 Unprocessable Entity` | `request.candidateId !== candidate.candidateId` (`reason: 'candidate-id'`) or `request.identity` does not match `candidate.proposedIdentity` under the alias table (`reason: 'proposed-identity'`). Rejected before any registry lookup or mutation. |
| `candidate-digest-mismatch` | `422 Unprocessable Entity` | `request.candidateDigest` is empty (`reason: 'missing'`), not a 64-character lowercase hex SHA-256 (`reason: 'malformed'`), or does not equal `candidateContentDigest(candidate, aliases)` (`reason: 'mismatch'`). Rejected before any registry lookup or mutation. |
| `invalid-clock` | `500 Internal Server Error` (or `422` if caller-supplied clock in test harness) | Injected clock produced a non-ISO/invalid calendar `publishedAt` or `recordedAt`, or failed `recordedAt > publishedAt`. Rejected before any registry lookup or mutation. |
| `wrong-stage` | `409 Conflict` | Candidate is not in `eligible-for-publication` (`reason: 'invalid-stage'`) or its `eligible-for-publication` stage was forged/modified without a verified lifecycle attestation (`reason: 'forged-stage'`). Nothing written to `official_predictions`. |
| `identity-conflict` | `422 Unprocessable Entity` | At least one component of `PropositionIdentity` is `unresolved` (`match.outcome === 'uncertain'`). Consumes `idempotencyKey` for that `requestDigest`, but writes nothing to `official_predictions`; a corrected candidate must use a new `idempotencyKey`. |
| `rejected` | `422 Unprocessable Entity` | `evaluateCandidate(candidate, { publishedAt })` returned `eligible: false` (including `publishedAt >= horizon.endsAt` or `evidence[i].publishedAt > publishedAt`); response includes all eleven `verdict.results` and `verdict.clarificationsRequired`. Consumes `idempotencyKey` for that `requestDigest`, but writes nothing to `official_predictions`; a corrected candidate must use a new `idempotencyKey`. |
