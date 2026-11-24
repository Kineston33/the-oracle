# THE ORACLE — Publication API & Storage Contract (v1.8)

This document specifies the storage invariants, transaction boundaries, `READ COMMITTED`
isolation-level enforcement, `TRUNCATE` and privilege hardening, controlled `SECURITY DEFINER`
database write boundary, PostgreSQL 16+ compatibility and effective-privilege auditing, and
read/write separation required to back **Official Publication Protocol v1.8**
(`src/data/publication-types.ts` and `src/data/publication.ts`) with a persistent PostgreSQL
16+ database and HTTP service.

> **Minimum supported PostgreSQL version**: **PostgreSQL 16** (`server_version_num >= 160000`).
> The deployment role-membership audit inspects `pg_catalog.pg_auth_members.inherit_option` and
> `pg_catalog.pg_auth_members.set_option`, which were introduced in PostgreSQL 16. Compatibility
> with PostgreSQL versions older than 16 is not claimed and is explicitly rejected by the
> preflight version guard in §2.5.

> **Status in this repository**: No HTTP server and no PostgreSQL database are shipped or
> running in this repository/sandbox. `InMemoryRegistry` (`src/data/publication.ts`)
> enforces the `PublicationRegistry` contract within a single JavaScript event loop for unit
> tests (`commitPublication` executes its idempotency check, identity claim, sealed record
> storage, and idempotency binding in one synchronous critical section with no `await`
> points); it does **not** survive process restarts or coordinate across multiple OS
> processes or nodes. Single-threaded `InMemoryRegistry` tests verify the domain state
> machine and contract invariants, and the PostgreSQL DDL, trigger, `SECURITY DEFINER`
> function, privilege, and transaction statements below are verified by static SQL contract
> inspection and in-memory state-machine / privilege simulation tests rather than executed
> against a live PostgreSQL instance. A production backend must implement the relational
> constraints, PL/pgSQL triggers, `SECURITY DEFINER` write functions, role separation,
> deployment audit queries, and `READ COMMITTED` ACID transaction specified below on
> PostgreSQL 16 or newer.

---

## 1. Separation of reads and writes

Exploration, identity comparison, candidate evaluation, and archive/event retrieval are
**read or non-publishing** operations. Official publication and terminal resolution are
**write** commands against the official ledger. No read, exploration, or evaluation
endpoint may ever call `commitPublication`, `claimIdentity`, or invoke any database write
function on `oracle_ledger`.

### 1.1 Read, exploration, and analysis operations (never mutate the official archive)

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Submit exploratory query** | `POST /v1/queries:explore` | `readQuestion` (`src/lib/question.ts`); stage remains `exploratory-query` | **No** — returns lexical reading and matching archive records; never creates a prediction |
| **Match canonical proposition** | `POST /v1/identities:match` | `compareIdentities`, `identityDigest` (`src/data/canonical-identity.ts`), `registry.findByIdentity` | **No** — returns `IdentityMatch` (`equivalent` \| `distinct` \| `uncertain`) and any existing `predictionId` |
| **Evaluate candidate** | `POST /v1/candidates:evaluate` | `evaluateCandidate(candidate, { publishedAt })`, `verdictIsComplete` (`src/data/publication.ts`) | **No** — returns `EvaluationVerdict` (all 11 `RequirementResult` items and `clarificationsRequired`) evaluated against the supplied or candidate timestamp |
| **Retrieve official prediction** | `GET /v1/predictions/:id` (and `GET /v1/predictions`) | `PredictionRecord` (`src/data/types.ts`), `registry.findByIdentity` | **No** — read-only `SELECT` lookup by `predictionId` or `identityDigest` |
| **Retrieve public event history** | `GET /v1/predictions/:id/events` | `RecordEvent[]`, `eventChainProblems`, `publishedLinkProblems` (`src/data/validate.ts`) | **No** — returns the ordered append-only chain (`e0`, `e1`, …) with schema-2 envelopes and digests |

### 1.2 Candidate staging and official publication/event commands

| Conceptual operation | Target endpoint | Domain contract / module | Mutates official archive? |
| --- | --- | --- | --- |
| **Create / advance candidate** | `POST /v1/candidates` (and `POST /v1/candidates/:id/advance`) | `CandidateProposition`, `advanceCandidate`, `qualifyCandidate` (`exploratory-query` → `candidate-proposition` → `identity-matching` → `evaluation` → `eligible-for-publication`) | **No** — writes only to draft candidate storage; `candidateId` never becomes a `PredictionId` |
| **Publish official prediction** | `POST /v1/publications` | `publishCandidate(candidate, request, deps)` (`src/data/publication.ts`) | **Yes** — sole entry point permitted to invoke `oracle_ledger.commit_official_publication` (or `oracle_ledger.record_rejected_or_conflict_idempotency` on steps 6–7 rejection) |
| **Append resolution event** | `POST /v1/predictions/:id/events` | `appendEvent(record, event)` (`src/data/events.ts`, `resolved` \| `annulled`) | **Appends event only** — invokes `oracle_ledger.append_terminal_prediction_event` to insert `e1` into `oracle_ledger.prediction_events`; never modifies `sealed_payload` or `probability` |

---

## 2. Mapping `PublicationRegistry` to PostgreSQL constraints, triggers, and controlled `SECURITY DEFINER` write functions

`PublicationRegistry` (`src/data/publication-types.ts`) defines five methods. In PostgreSQL,
their correctness and write-boundary integrity depend on:

1. `PRIMARY KEY` and `UNIQUE` constraints (`PRIMARY KEY (idempotency_key)` on
   `oracle_ledger.publication_idempotency_keys` and `UNIQUE (identity_digest)` on
   `oracle_ledger.official_predictions`),
2. A non-null transaction-local reservation sentinel (`'{"kind":"__pending__"}'::jsonb`)
   paired with:
   - an immediate `CHECK` constraint (`publication_idempotency_outcome_valid_shape`),
   - an immediate `BEFORE INSERT OR UPDATE OR DELETE` row trigger
     (`publication_idempotency_immutability_trg`) that forbids `DELETE`, forbids direct
     `INSERT` of already-finalized `'created'` or `'existing'` rows (requiring them to pass
     through the `'__pending__'` reservation transition and verify the existence of the
     corresponding row in `oracle_ledger.official_predictions`), forbids any `UPDATE` on
     already-finalized rows, protects `idempotency_key`, `request_digest`, and `recorded_at`
     from modification, and permits only the transition
     `'__pending__' -> ('created' | 'existing' | 'identity-conflict' | 'rejected')`,
   - immediate `BEFORE UPDATE OR DELETE` row triggers (`official_predictions_append_only_trg`
     and `prediction_events_append_only_trg`) that forbid any `UPDATE` or `DELETE` on
     `oracle_ledger.official_predictions` and `oracle_ledger.prediction_events`,
   - immediate `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers
     (`publication_idempotency_no_truncate_trg`, `official_predictions_no_truncate_trg`, and
     `prediction_events_no_truncate_trg`) that reject `TRUNCATE` (including indirect
     `TRUNCATE ... CASCADE`) with SQLSTATE `23514`, and
   - a `DEFERRABLE INITIALLY DEFERRED` `CONSTRAINT TRIGGER`
     (`publication_idempotency_outcome_complete_trg`) that validates the live row state at
     `COMMIT` and forces a rollback if the row disappeared (`NOT FOUND`) or remains
     `'__pending__'`,
3. A single `READ COMMITTED` ACID transaction executed through narrowly scoped,
   schema-qualified `SECURITY DEFINER` functions owned by `oracle_migrator`, and
4. Complete removal of direct runtime table DML privileges (`INSERT`, `UPDATE`, `DELETE`,
   `TRUNCATE`) from `oracle_app`, leaving `oracle_app` with only `SELECT` on ledger tables and
   `EXECUTE` on the three approved `SECURITY DEFINER` write functions (§2.5).

### 2.1 PostgreSQL schema, immutability triggers, `TRUNCATE` protection, and deferred constraint trigger

> **Why an ordinary `CHECK` constraint cannot be deferred in PostgreSQL**: PostgreSQL only
> supports `DEFERRABLE` on `PRIMARY KEY`, `UNIQUE`, `EXCLUDE`, and `FOREIGN KEY` table
> constraints, and on `CREATE CONSTRAINT TRIGGER`. A table `CHECK (...) DEFERRABLE INITIALLY DEFERRED`
> clause is a syntax error in PostgreSQL, and an immediate `CHECK (outcome IS NOT NULL)`
> would reject a `NULL` reservation `INSERT` before the transaction could arbitrate
> `oracle_ledger.official_predictions`.
>
> Instead, `oracle_ledger.publication_idempotency_keys.outcome` is declared `JSONB NOT NULL`
> with an immediate `CHECK` constraint allowing the transaction-local sentinel
> `'{"kind":"__pending__"}'::jsonb` during the reservation `INSERT`, an immediate
> `BEFORE INSERT OR UPDATE OR DELETE` row trigger enforces one-way finalization and row
> immutability, an immediate `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger blocks table
> truncation, and a `DEFERRABLE INITIALLY DEFERRED` `CONSTRAINT TRIGGER` queries the live row
> state at `COMMIT` time and aborts the transaction if the row disappeared (`NOT FOUND`) or if
> `outcome ->> 'kind'` is still `'__pending__'`.

```sql
CREATE SCHEMA oracle_ledger AUTHORIZATION oracle_migrator;

CREATE TABLE oracle_ledger.official_predictions (
  prediction_id   TEXT PRIMARY KEY,
  identity_digest CHAR(64) NOT NULL UNIQUE,
  sealed_payload  JSONB NOT NULL,
  payload_digest  CHAR(64) NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT official_predictions_recording_order
    CHECK (recorded_at > published_at)
);

CREATE TABLE oracle_ledger.prediction_events (
  prediction_id   TEXT NOT NULL REFERENCES oracle_ledger.official_predictions(prediction_id),
  seq             TEXT NOT NULL CHECK (seq IN ('e0', 'e1')),
  kind            TEXT NOT NULL CHECK (kind IN ('published', 'resolved', 'annulled')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  envelope        JSONB NOT NULL,
  digest          CHAR(64) NOT NULL,
  prev_digest     CHAR(64),
  PRIMARY KEY (prediction_id, seq),
  CONSTRAINT prediction_events_recording_order
    CHECK (recorded_at > occurred_at),
  CONSTRAINT prediction_events_seq_kind_consistency
    CHECK (
      (seq = 'e0' AND kind = 'published' AND prev_digest IS NULL)
      OR (seq = 'e1' AND kind IN ('resolved', 'annulled') AND prev_digest IS NOT NULL)
    )
);

CREATE TABLE oracle_ledger.publication_idempotency_keys (
  idempotency_key  TEXT PRIMARY KEY,
  request_digest   CHAR(64) NOT NULL,
  outcome          JSONB NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT publication_idempotency_outcome_valid_shape CHECK (
    pg_catalog.jsonb_typeof(outcome) = 'object'
    AND (outcome ->> 'kind') IN (
      '__pending__',
      'created',
      'existing',
      'identity-conflict',
      'rejected'
    )
  )
);

CREATE OR REPLACE FUNCTION oracle_ledger.enforce_append_only_ledger_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    '% on %.% is forbidden; official ledger rows are strictly append-only',
    TG_OP,
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER official_predictions_append_only_trg
  BEFORE UPDATE OR DELETE ON oracle_ledger.official_predictions
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_append_only_ledger_row();

CREATE TRIGGER prediction_events_append_only_trg
  BEFORE UPDATE OR DELETE ON oracle_ledger.prediction_events
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_append_only_ledger_row();

CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prediction_exists BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'DELETE on publication_idempotency_keys is forbidden (idempotency_key = %)',
      OLD.idempotency_key
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Direct insertion of 'created' or 'existing' outcomes is forbidden even for
    -- table-owner code paths: a 'created' or 'existing' outcome may only be reached
    -- by inserting '{"kind":"__pending__"}' first, arbitrating official_predictions,
    -- and updating the pending reservation in the same transaction.
    IF NEW.outcome IS NULL
       OR pg_catalog.jsonb_typeof(NEW.outcome) <> 'object'
       OR (NEW.outcome ->> 'kind') IS NULL
       OR (NEW.outcome ->> 'kind') NOT IN ('__pending__', 'identity-conflict', 'rejected')
    THEN
      RAISE EXCEPTION
        'publication_idempotency_keys row % cannot be inserted directly with outcome kind %; only __pending__, identity-conflict, or rejected may be inserted',
        NEW.idempotency_key,
        NEW.outcome ->> 'kind'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
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
       OR pg_catalog.jsonb_typeof(NEW.outcome) <> 'object'
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

    -- When finalizing to 'created' or 'existing', verify that the referenced official
    -- prediction actually exists in oracle_ledger.official_predictions.
    IF (NEW.outcome ->> 'kind') IN ('created', 'existing') THEN
      SELECT EXISTS (
        SELECT 1
          FROM oracle_ledger.official_predictions AS op
         WHERE op.prediction_id = (NEW.outcome ->> 'predictionId')
           AND op.identity_digest = (NEW.outcome ->> 'identityDigest')
      )
      INTO v_prediction_exists;

      IF NOT COALESCE(v_prediction_exists, FALSE) THEN
        RAISE EXCEPTION
          'publication_idempotency_keys row % cannot finalize as % without a matching row in oracle_ledger.official_predictions',
          OLD.idempotency_key,
          NEW.outcome ->> 'kind'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER publication_idempotency_immutability_trg
  BEFORE INSERT OR UPDATE OR DELETE ON oracle_ledger.publication_idempotency_keys
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_immutability();

CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'TRUNCATE on % is forbidden',
    TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER publication_idempotency_no_truncate_trg
  BEFORE TRUNCATE ON oracle_ledger.publication_idempotency_keys
  FOR EACH STATEMENT
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();

CREATE TRIGGER official_predictions_no_truncate_trg
  BEFORE TRUNCATE ON oracle_ledger.official_predictions
  FOR EACH STATEMENT
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();

CREATE TRIGGER prediction_events_no_truncate_trg
  BEFORE TRUNCATE ON oracle_ledger.prediction_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();

CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
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
    FROM oracle_ledger.publication_idempotency_keys
   WHERE idempotency_key = NEW.idempotency_key;

  -- If the reservation row disappeared before COMMIT, abort the transaction.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'publication_idempotency_keys row % disappeared before commit',
      NEW.idempotency_key
      USING ERRCODE = '23514';
  END IF;

  IF current_outcome IS NULL
     OR pg_catalog.jsonb_typeof(current_outcome) <> 'object'
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
  AFTER INSERT OR UPDATE ON oracle_ledger.publication_idempotency_keys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete();
```

#### How the triggers enforce intra-transaction finalization, append-only ledger integrity, and permanent immutability

1. **Compatible with `INSERT` followed by `UPDATE` in the same transaction**:
   When `oracle_ledger.commit_official_publication` executes `INSERT INTO oracle_ledger.publication_idempotency_keys ... VALUES (..., '{"kind":"__pending__"}'::jsonb, ...)`
   and later in the same transaction executes `UPDATE oracle_ledger.publication_idempotency_keys SET outcome = v_outcome WHERE idempotency_key = p_idempotency_key`,
   PostgreSQL queues two deferred trigger invocations for `COMMIT`: one for the `INSERT`
   (whose `NEW` record holds the `INSERT`-time snapshot with `NEW.outcome = '{"kind":"__pending__"}'`)
   and one for the `UPDATE` (whose `NEW` record holds the updated snapshot). Because
   `oracle_ledger.enforce_publication_idempotency_outcome_complete()` executes
   `SELECT outcome INTO current_outcome FROM oracle_ledger.publication_idempotency_keys WHERE idempotency_key = NEW.idempotency_key;`
   at `COMMIT`, both queued invocations inspect the **live, post-`UPDATE` tuple** at the end
   of the transaction and succeed once `current_outcome ->> 'kind'` has been finalized to
   `'created'`, `'existing'`, `'identity-conflict'`, or `'rejected'`.
2. **Direct insertion of `'created'` or `'existing'` is forbidden; transition is exclusively `'__pending__' -> final` within the same transaction, and strictly immutable thereafter**:
   - `publication_idempotency_immutability_trg` (`BEFORE INSERT OR UPDATE OR DELETE`) rejects
     any `INSERT` whose `NEW.outcome ->> 'kind'` is `'created'` or `'existing'`; only
     `'__pending__'`, `'identity-conflict'`, or `'rejected'` may be inserted.
   - On `UPDATE`, `publication_idempotency_immutability_trg` rejects any row unless
     `(OLD.outcome ->> 'kind') = '__pending__'` and
     `(NEW.outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected')`,
     and when finalizing to `'created'` or `'existing'` it verifies that the referenced
     `(predictionId, identityDigest)` exists in `oracle_ledger.official_predictions`.
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
3. **`DELETE` and `TRUNCATE` (including `TRUNCATE ... CASCADE`) are forbidden, and disappearing reservations force a rollback**:
   - `publication_idempotency_immutability_trg` (`BEFORE DELETE ... FOR EACH ROW`)
     unconditionally rejects row-level `DELETE` on `oracle_ledger.publication_idempotency_keys`
     (`ERRCODE = '23514'`), and `official_predictions_append_only_trg` /
     `prediction_events_append_only_trg` unconditionally reject any `UPDATE` or `DELETE` on
     `oracle_ledger.official_predictions` and `oracle_ledger.prediction_events`.
   - Because PostgreSQL `TRUNCATE` bypasses `FOR EACH ROW` `BEFORE DELETE` triggers,
     `publication_idempotency_no_truncate_trg` (`BEFORE TRUNCATE ON oracle_ledger.publication_idempotency_keys FOR EACH STATEMENT`)
     invokes `oracle_ledger.enforce_publication_idempotency_no_truncate()` and unconditionally
     raises SQLSTATE `23514` (`check_violation`) before any truncation can occur.
   - **Protection against indirect `TRUNCATE ... CASCADE`**:
     1. `oracle_ledger.publication_idempotency_keys` defines **no** `FOREIGN KEY`
        (`REFERENCES`) to `oracle_ledger.official_predictions`,
        `oracle_ledger.prediction_events`, or any other table — and must never add a foreign
        key referencing another table — so `TRUNCATE <other_table> CASCADE` can never
        propagate to `oracle_ledger.publication_idempotency_keys`.
     2. In PostgreSQL, when `TRUNCATE ... CASCADE` expands to dependent tables, PostgreSQL
        fires `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers on every affected table in
        the cascade; furthermore, `official_predictions_no_truncate_trg` and
        `prediction_events_no_truncate_trg` forbid `TRUNCATE` on the prediction and event
        tables as well.
   - As defense-in-depth, if a pending reservation row ever disappeared before `COMMIT`,
     `oracle_ledger.enforce_publication_idempotency_outcome_complete()` detects `IF NOT FOUND`
     at `COMMIT` and raises `ERRCODE = '23514'`, aborting the transaction and rolling back
     any writes to `oracle_ledger.official_predictions` or `oracle_ledger.prediction_events`.
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

---

### 2.2 Controlled `SECURITY DEFINER` database write operations

Because the application runtime role (`oracle_app`) has **no** direct `INSERT`, `UPDATE`,
`DELETE`, or `TRUNCATE` privileges on any table in `oracle_ledger`, all ledger writes must
pass through three narrowly scoped `SECURITY DEFINER` PL/pgSQL functions owned by
`oracle_migrator`:

| Approved function in `oracle_ledger` | Purpose | Tables written | Executable by `oracle_app`? |
| --- | --- | --- | --- |
| `oracle_ledger.commit_official_publication(...)` | Atomic publication under `READ COMMITTED`: reserves `idempotency_key` with `'{"kind":"__pending__"}'::jsonb`, arbitrates `identity_digest` in `official_predictions`, inserts initial `e0` (`published`) event into `prediction_events` when `created`, and finalizes `publication_idempotency_keys.outcome` to `'created'` or `'existing'`. | `publication_idempotency_keys`, `official_predictions`, `prediction_events` | **Yes** (`GRANT EXECUTE`) |
| `oracle_ledger.record_rejected_or_conflict_idempotency(...)` | Records a domain validation rejection (`kind = 'rejected'`) or unresolved identity conflict (`kind = 'identity-conflict'`) in `publication_idempotency_keys` (steps 6–7 of `publishCandidate`) without touching `official_predictions` or `prediction_events`. Rejects `'created'`, `'existing'`, or `'__pending__'` outcomes. | `publication_idempotency_keys` only | **Yes** (`GRANT EXECUTE`) |
| `oracle_ledger.append_terminal_prediction_event(...)` | Appends the single permitted terminal resolution or annulment event (`seq = 'e1'`, `kind IN ('resolved', 'annulled')`) to `prediction_events` after verifying `e0` digest linkage (`prev_digest = e0.digest`), timestamp monotonicity, and absence of any prior `e1` event. Never modifies `official_predictions`. | `prediction_events` only | **Yes** (`GRANT EXECUTE`) |

#### Security properties enforced on every `SECURITY DEFINER` function

1. **Explicit, fixed `search_path` excluding user/attacker schemas**:
   Every function specifies `SET search_path = pg_catalog, pg_temp` in its DDL header, so
   unqualified built-in types and operators resolve strictly against `pg_catalog` and no
   session `search_path` manipulation can shadow functions, operators, or tables.
2. **Fully qualified object references**:
   Every table (`oracle_ledger.official_predictions`, `oracle_ledger.prediction_events`,
   `oracle_ledger.publication_idempotency_keys`) and built-in function (`pg_catalog.jsonb_typeof`,
   `pg_catalog.jsonb_build_object`, `pg_catalog.length`, `pg_catalog.btrim`) is explicitly
   schema-qualified.
3. **Non-superuser, non-application owner (`oracle_migrator`)**:
   Every function is owned by `oracle_migrator` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN`).
   Because `oracle_migrator` is **not** a superuser, all table `CHECK` constraints, `UNIQUE`
   constraints, `FOREIGN KEY` constraints, `BEFORE` row/statement triggers, and `DEFERRABLE`
   constraint triggers still fire normally when the `SECURITY DEFINER` functions execute.
4. **Zero dynamic SQL (`EXECUTE`)**:
   None of the functions uses dynamic SQL (`EXECUTE <string>`); every statement is static,
   compile-time bound PL/pgSQL using typed parameters.
5. **Up-front argument validation (format and structural checks)**:
   Each function validates its parameters (non-null, non-empty strings, 64-character lowercase
   hex digest format `^[0-9a-f]{64}$`, valid JSONB object shapes, timestamp ordering, and
   allowed `kind` / `seq` values) before touching any table, raising SQLSTATE `22023`
   (`invalid_parameter_value`) or `23514` (`check_violation`) on invalid input.
6. **Mandatory `READ COMMITTED` transaction isolation check before any table access (`ERRCODE = '25001'`)**:
   Before reading or writing any table, `oracle_ledger.commit_official_publication` (and
   `oracle_ledger.record_rejected_or_conflict_idempotency`) inspects
   `pg_catalog.current_setting('transaction_isolation')` and requires it to equal
   `'read committed'` exactly. If the active transaction was started under `'repeatable read'`,
   `'serializable'`, or any other isolation level, the function immediately raises SQLSTATE
   `25001` (`active_sql_transaction`) before performing any mutation. The function **never**
   attempts to change transaction isolation from inside PL/pgSQL (`SET TRANSACTION ISOLATION LEVEL`
   is not used); callers must invoke the function inside an explicit `READ COMMITTED`
   transaction (`BEGIN ISOLATION LEVEL READ COMMITTED;`).
7. **Digest format validation in SQL vs. cryptographic SHA-256 verification in the domain/client layer**:
   The PostgreSQL PL/pgSQL functions validate **digest format** (`^[0-9a-f]{64}$` — 64-character
   lowercase hexadecimal string) and **relational/referential equality** (such as
   `p_prev_digest = e0.digest` and `request_digest` equality on idempotency replay), **not**
   independent cryptographic SHA-256 recomputation over canonicalized JSON inside PostgreSQL
   (no `pgcrypto` or external extension is used, and PostgreSQL's binary `JSONB` storage does
   not preserve canonical JSON key ordering on its own). Actual canonical serialization and
   SHA-256 cryptographic calculation/verification (`identityDigest`, `candidateContentDigest`,
   `publicationRequestDigest`, `sealPredictionPayload`, `createPublishedEvent`,
   `verifyRecordIntegrity`, `publishedLinkProblems`, `eventChainProblems`) are performed in the
   TypeScript domain and archive/client verification layers.

```sql
-- 1. Atomic publication entry point (Step 9 of publishCandidate)
-- Callers MUST invoke this function inside a READ COMMITTED transaction.
CREATE OR REPLACE FUNCTION oracle_ledger.commit_official_publication(
  p_idempotency_key TEXT,
  p_request_digest  CHAR(64),
  p_prediction_id   TEXT,
  p_identity_digest CHAR(64),
  p_sealed_payload  JSONB,
  p_payload_digest  CHAR(64),
  p_published_at    TIMESTAMPTZ,
  p_recorded_at     TIMESTAMPTZ,
  p_e0_envelope     JSONB,
  p_e0_digest       CHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_isolation_level         TEXT;
  v_reserved_key            TEXT;
  v_existing_request_digest CHAR(64);
  v_existing_outcome        JSONB;
  v_claimed_prediction_id   TEXT;
  v_winner_id               TEXT;
  v_winner_payload          JSONB;
  v_outcome                 JSONB;
  v_status                  TEXT;
BEGIN
  -- Enforce active READ COMMITTED isolation before any table access or mutation.
  -- Rejects repeatable read and serializable (which would freeze the transaction
  -- snapshot and prevent post-conflict SELECTs from seeing concurrent commits).
  v_isolation_level := pg_catalog.current_setting('transaction_isolation');
  IF v_isolation_level IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION
      'commit_official_publication requires transaction_isolation = read committed, got: %',
      v_isolation_level
      USING ERRCODE = '25001';
  END IF;

  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'p_idempotency_key must be non-empty'
      USING ERRCODE = '22023';
  END IF;

  IF p_prediction_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_prediction_id)) = 0 THEN
    RAISE EXCEPTION 'p_prediction_id must be non-empty'
      USING ERRCODE = '22023';
  END IF;

  -- Format validation only (64-char lowercase hex); cryptographic SHA-256 computation
  -- and verification over canonical JSON occur in the TypeScript domain/verification layer.
  IF p_request_digest IS NULL OR p_request_digest !~ '^[0-9a-f]{64}$'
     OR p_identity_digest IS NULL OR p_identity_digest !~ '^[0-9a-f]{64}$'
     OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$'
     OR p_e0_digest IS NULL OR p_e0_digest !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'all digest arguments must match 64-character lowercase hex format'
      USING ERRCODE = '22023';
  END IF;

  IF p_published_at IS NULL OR p_recorded_at IS NULL OR p_recorded_at <= p_published_at THEN
    RAISE EXCEPTION 'p_recorded_at (%) must be strictly greater than p_published_at (%)',
      p_recorded_at, p_published_at
      USING ERRCODE = '23514';
  END IF;

  IF p_sealed_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_sealed_payload) <> 'object'
     OR (p_sealed_payload ->> 'id') IS DISTINCT FROM p_prediction_id
     OR COALESCE((p_sealed_payload ->> 'demo')::boolean, TRUE) IS NOT FALSE
  THEN
    RAISE EXCEPTION 'p_sealed_payload must be a non-demo official PredictionRecord object matching p_prediction_id'
      USING ERRCODE = '23514';
  END IF;

  IF p_e0_envelope IS NULL OR pg_catalog.jsonb_typeof(p_e0_envelope) <> 'object' THEN
    RAISE EXCEPTION 'p_e0_envelope must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  -- Step 1: Reserve the idempotency key with the transaction-local '__pending__' sentinel
  INSERT INTO oracle_ledger.publication_idempotency_keys (
    idempotency_key,
    request_digest,
    outcome,
    recorded_at
  )
  VALUES (
    p_idempotency_key,
    p_request_digest,
    '{"kind":"__pending__"}'::jsonb,
    p_recorded_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_reserved_key;

  IF NOT FOUND THEN
    -- Key was already committed by an earlier or concurrent transaction;
    -- read the committed row in a fresh READ COMMITTED statement snapshot.
    SELECT pik.request_digest, pik.outcome
      INTO v_existing_request_digest, v_existing_outcome
      FROM oracle_ledger.publication_idempotency_keys AS pik
     WHERE pik.idempotency_key = p_idempotency_key
       AND (pik.outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'publication_idempotency_keys row % not found after conflict',
        p_idempotency_key
        USING ERRCODE = '23514';
    END IF;

    IF v_existing_request_digest = p_request_digest THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'replayed',
        'original', v_existing_outcome
      );
    ELSE
      RETURN pg_catalog.jsonb_build_object(
        'status', 'idempotency-conflict',
        'existingRequestDigest', v_existing_request_digest,
        'incomingRequestDigest', p_request_digest
      );
    END IF;
  END IF;

  -- Step 2: Claim canonical identity or observe the committed winner
  INSERT INTO oracle_ledger.official_predictions (
    prediction_id,
    identity_digest,
    sealed_payload,
    payload_digest,
    published_at,
    recorded_at
  )
  VALUES (
    p_prediction_id,
    p_identity_digest,
    p_sealed_payload,
    p_payload_digest,
    p_published_at,
    p_recorded_at
  )
  ON CONFLICT (identity_digest) DO NOTHING
  RETURNING prediction_id INTO v_claimed_prediction_id;

  IF FOUND THEN
    INSERT INTO oracle_ledger.prediction_events (
      prediction_id,
      seq,
      kind,
      occurred_at,
      recorded_at,
      envelope,
      digest,
      prev_digest
    )
    VALUES (
      p_prediction_id,
      'e0',
      'published',
      p_published_at,
      p_recorded_at,
      p_e0_envelope,
      p_e0_digest,
      NULL
    );

    v_status := 'created';
    v_outcome := pg_catalog.jsonb_build_object(
      'kind', 'created',
      'predictionId', p_prediction_id,
      'identityDigest', p_identity_digest,
      'requestDigest', p_request_digest,
      'record', p_sealed_payload
    );
  ELSE
    SELECT op.prediction_id, op.sealed_payload
      INTO v_winner_id, v_winner_payload
      FROM oracle_ledger.official_predictions AS op
     WHERE op.identity_digest = p_identity_digest;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'official_predictions winner for identity_digest % not found after conflict',
        p_identity_digest
        USING ERRCODE = '23514';
    END IF;

    v_status := 'existing';
    v_outcome := pg_catalog.jsonb_build_object(
      'kind', 'existing',
      'predictionId', v_winner_id,
      'identityDigest', p_identity_digest,
      'requestDigest', p_request_digest,
      'record', v_winner_payload
    );
  END IF;

  -- Step 3: Finalize the reserved idempotency row in the same transaction
  UPDATE oracle_ledger.publication_idempotency_keys
     SET outcome = v_outcome
   WHERE idempotency_key = p_idempotency_key;

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'outcome', v_outcome
  );
END;
$$;

-- 2. Controlled idempotency recording for rejected or identity-conflict outcomes (Steps 6-7)
-- Callers MUST invoke this function inside a READ COMMITTED transaction.
CREATE OR REPLACE FUNCTION oracle_ledger.record_rejected_or_conflict_idempotency(
  p_idempotency_key TEXT,
  p_request_digest  CHAR(64),
  p_outcome         JSONB,
  p_recorded_at     TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_isolation_level         TEXT;
  v_inserted_key            TEXT;
  v_existing_request_digest CHAR(64);
  v_existing_outcome        JSONB;
BEGIN
  v_isolation_level := pg_catalog.current_setting('transaction_isolation');
  IF v_isolation_level IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION
      'record_rejected_or_conflict_idempotency requires transaction_isolation = read committed, got: %',
      v_isolation_level
      USING ERRCODE = '25001';
  END IF;

  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'p_idempotency_key must be non-empty'
      USING ERRCODE = '22023';
  END IF;

  -- Format validation only (64-char lowercase hex); cryptographic SHA-256 computation
  -- over canonical JSON occurs in the TypeScript domain layer.
  IF p_request_digest IS NULL OR p_request_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'p_request_digest must match 64-character lowercase hex format'
      USING ERRCODE = '22023';
  END IF;

  IF p_recorded_at IS NULL THEN
    RAISE EXCEPTION 'p_recorded_at must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- Strictly restrict this entry point to 'identity-conflict' and 'rejected' outcomes;
  -- it can never be used to forge 'created', 'existing', or '__pending__' rows.
  IF p_outcome IS NULL
     OR pg_catalog.jsonb_typeof(p_outcome) <> 'object'
     OR (p_outcome ->> 'kind') IS NULL
     OR (p_outcome ->> 'kind') NOT IN ('identity-conflict', 'rejected')
  THEN
    RAISE EXCEPTION
      'record_rejected_or_conflict_idempotency only accepts identity-conflict or rejected outcomes, got: %',
      p_outcome ->> 'kind'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO oracle_ledger.publication_idempotency_keys (
    idempotency_key,
    request_digest,
    outcome,
    recorded_at
  )
  VALUES (
    p_idempotency_key,
    p_request_digest,
    p_outcome,
    p_recorded_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_inserted_key;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'recorded',
      'outcome', p_outcome
    );
  END IF;

  SELECT pik.request_digest, pik.outcome
    INTO v_existing_request_digest, v_existing_outcome
    FROM oracle_ledger.publication_idempotency_keys AS pik
   WHERE pik.idempotency_key = p_idempotency_key
     AND (pik.outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication_idempotency_keys row % not found after conflict',
      p_idempotency_key
      USING ERRCODE = '23514';
  END IF;

  IF v_existing_request_digest = p_request_digest THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'replayed',
      'original', v_existing_outcome
    );
  ELSE
    RETURN pg_catalog.jsonb_build_object(
      'status', 'idempotency-conflict',
      'existingRequestDigest', v_existing_request_digest,
      'incomingRequestDigest', p_request_digest
    );
  END IF;
END;
$$;

-- 3. Controlled append-only entry point for terminal resolution or annulment events (e1)
CREATE OR REPLACE FUNCTION oracle_ledger.append_terminal_prediction_event(
  p_prediction_id TEXT,
  p_kind          TEXT,
  p_occurred_at   TIMESTAMPTZ,
  p_recorded_at   TIMESTAMPTZ,
  p_envelope      JSONB,
  p_digest        CHAR(64),
  p_prev_digest   CHAR(64)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_locked_prediction_id TEXT;
  v_e0_digest            CHAR(64);
  v_e0_occurred_at       TIMESTAMPTZ;
  v_has_terminal_event   BOOLEAN;
BEGIN
  IF p_prediction_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_prediction_id)) = 0 THEN
    RAISE EXCEPTION 'p_prediction_id must be non-empty'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('resolved', 'annulled') THEN
    RAISE EXCEPTION 'append_terminal_prediction_event only permits resolved or annulled events, got: %',
      p_kind
      USING ERRCODE = '23514';
  END IF;

  IF p_occurred_at IS NULL OR p_recorded_at IS NULL OR p_recorded_at <= p_occurred_at THEN
    RAISE EXCEPTION 'p_recorded_at (%) must be strictly greater than p_occurred_at (%)',
      p_recorded_at, p_occurred_at
      USING ERRCODE = '23514';
  END IF;

  IF p_envelope IS NULL OR pg_catalog.jsonb_typeof(p_envelope) <> 'object' THEN
    RAISE EXCEPTION 'p_envelope must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  -- Format validation only (64-char lowercase hex); cryptographic SHA-256 computation
  -- and verification over canonical JSON occur in the TypeScript domain/verification layer.
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
     OR p_prev_digest IS NULL OR p_prev_digest !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'p_digest and p_prev_digest must match 64-character lowercase hex format'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize terminal event appends per prediction without firing UPDATE triggers
  SELECT op.prediction_id
    INTO v_locked_prediction_id
    FROM oracle_ledger.official_predictions AS op
   WHERE op.prediction_id = p_prediction_id
     FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'official_predictions row % does not exist',
      p_prediction_id
      USING ERRCODE = '23503';
  END IF;

  -- Verify initial e0 ('published') event exists and matches p_prev_digest
  SELECT pe.digest, pe.occurred_at
    INTO v_e0_digest, v_e0_occurred_at
    FROM oracle_ledger.prediction_events AS pe
   WHERE pe.prediction_id = p_prediction_id
     AND pe.seq = 'e0'
     AND pe.kind = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'initial e0 published event missing for prediction_id %',
      p_prediction_id
      USING ERRCODE = '23514';
  END IF;

  IF p_prev_digest IS DISTINCT FROM v_e0_digest THEN
    RAISE EXCEPTION 'p_prev_digest (%) does not match e0 digest (%) for prediction_id %',
      p_prev_digest, v_e0_digest, p_prediction_id
      USING ERRCODE = '23514';
  END IF;

  IF p_occurred_at <= v_e0_occurred_at THEN
    RAISE EXCEPTION 'terminal event occurred_at (%) must be strictly after e0 occurred_at (%)',
      p_occurred_at, v_e0_occurred_at
      USING ERRCODE = '23514';
  END IF;

  -- Reject if a terminal event (e1) already exists for this prediction
  SELECT EXISTS (
    SELECT 1
      FROM oracle_ledger.prediction_events AS pe
     WHERE pe.prediction_id = p_prediction_id
       AND (pe.seq = 'e1' OR pe.kind IN ('resolved', 'annulled'))
  )
  INTO v_has_terminal_event;

  IF COALESCE(v_has_terminal_event, FALSE) THEN
    RAISE EXCEPTION 'prediction_id % already has a terminal event (e1)',
      p_prediction_id
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO oracle_ledger.prediction_events (
    prediction_id,
    seq,
    kind,
    occurred_at,
    recorded_at,
    envelope,
    digest,
    prev_digest
  )
  VALUES (
    p_prediction_id,
    'e1',
    p_kind,
    p_occurred_at,
    p_recorded_at,
    p_envelope,
    p_digest,
    p_prev_digest
  );
END;
$$;
```

### 2.3 Registry method mapping

| `PublicationRegistry` method | Read / Write | Database constraint & SQL contract |
| --- | --- | --- |
| `findByIdempotencyKey(key, requestDigest)` | **Read (`SELECT`)** | `SELECT request_digest, outcome FROM oracle_ledger.publication_idempotency_keys WHERE idempotency_key = $1 AND (outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected');`. Returns `{ status: 'miss' }` if absent, `{ status: 'match', requestDigest, outcome }` if `request_digest = $2`, or `{ status: 'conflict', existingRequestDigest: request_digest, incomingRequestDigest: $2 }` if `request_digest <> $2`. |
| `findByIdentity(identityDigest)` | **Read (`SELECT`)** | `SELECT prediction_id, sealed_payload FROM oracle_ledger.official_predictions WHERE identity_digest = $1;`. Read-only lookup by canonical identity digest. |
| `recordIdempotencyKey(key, requestDigest, outcome)` | **Write (`EXECUTE` `SECURITY DEFINER`)** | Used in steps 6 (`identity-conflict`) and 7 (`rejected`). Calls `SELECT oracle_ledger.record_rejected_or_conflict_idempotency($1, $2, $3, $4);` inside a `READ COMMITTED` transaction. The function enforces `(p_outcome ->> 'kind') IN ('identity-conflict', 'rejected')`, inserts with `ON CONFLICT (idempotency_key) DO NOTHING`, and returns `recorded`, `replayed`, or `idempotency-conflict` without ever touching `official_predictions`. |
| `claimIdentity(identityDigest, predictionId, record)` | **Internal / unit-test primitive** | Enforced in PostgreSQL inside `oracle_ledger.commit_official_publication` via `UNIQUE (identity_digest)` on `oracle_ledger.official_predictions`; `oracle_app` has no direct `INSERT` privilege on `official_predictions`. |
| `commitPublication(commit)` | **Write (`EXECUTE` `SECURITY DEFINER` in single ACID transaction)** | Calls `SELECT oracle_ledger.commit_official_publication($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);` inside a `READ COMMITTED` transaction (§2.4), executing the `'__pending__'` reservation, `UNIQUE (identity_digest)` arbitration, `e0` event insertion, and `'__pending__' -> ('created' \| 'existing')` finalization atomically. |

### 2.4 Single `READ COMMITTED` ACID transaction for `commitPublication`

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
>   each subsequent `SELECT` statement inside `oracle_ledger.commit_official_publication`
>   takes a fresh statement snapshot that sees all rows committed before that statement began.

When steps 1–8 of `publishCandidate` succeed, step 9 must invoke
`oracle_ledger.commit_official_publication` inside an explicit `READ COMMITTED` transaction.
The function inspects `pg_catalog.current_setting('transaction_isolation')` before any table
access and raises SQLSTATE `25001` (`active_sql_transaction`) if the active transaction
isolation level is `'repeatable read'`, `'serializable'`, or anything other than
`'read committed'`. It never attempts to change transaction isolation from inside the function:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;

SELECT oracle_ledger.commit_official_publication(
  $1,  -- p_idempotency_key
  $2,  -- p_request_digest
  $3,  -- p_prediction_id
  $4,  -- p_identity_digest
  $5,  -- p_sealed_payload
  $6,  -- p_payload_digest
  $7,  -- p_published_at
  $8,  -- p_recorded_at
  $9,  -- p_e0_envelope
  $10  -- p_e0_digest
);

COMMIT;
```

Inside `oracle_ledger.commit_official_publication`, PostgreSQL executes the three steps
defined in §2.2:

1. **Step 1 — Reserve the idempotency key with the transaction-local sentinel**:
   Inserts `(p_idempotency_key, p_request_digest, '{"kind":"__pending__"}'::jsonb, p_recorded_at)`
   into `oracle_ledger.publication_idempotency_keys` with `ON CONFLICT (idempotency_key) DO NOTHING`.
   - **If 1 row is returned**: This transaction holds the uncommitted reservation and proceeds
     to Step 2.
   - **If 0 rows are returned**: Another transaction already committed `p_idempotency_key`.
     Because this `INSERT` modified 0 rows, `publication_idempotency_outcome_complete_trg` is
     not queued for this transaction. The function executes a fresh-snapshot `SELECT` in the
     same `READ COMMITTED` transaction and returns `{ status: 'replayed', original }` (when
     `request_digest` matches) or `{ status: 'idempotency-conflict', ... }` (when
     `request_digest` differs), without touching `official_predictions` or `prediction_events`.
2. **Step 2 — Claim canonical identity or observe the committed winner (reached only when Step 1 returned 1 row)**:
   Inserts into `oracle_ledger.official_predictions` with `ON CONFLICT (identity_digest) DO NOTHING`.
   - **If 1 row is returned (`status: 'created'`)**: Inserts the initial `e0` (`published`)
     event into `oracle_ledger.prediction_events` in the same transaction and constructs the
     completed `'created'` outcome JSON.
   - **If 0 rows are returned (`status: 'existing'`)**: Selects the committed winner
     `(prediction_id, sealed_payload)` from `oracle_ledger.official_predictions` in a fresh
     `READ COMMITTED` statement snapshot and constructs the completed `'existing'` outcome JSON.
3. **Step 3 — Finalize the reserved idempotency row in the same transaction**:
   Executes `UPDATE oracle_ledger.publication_idempotency_keys SET outcome = v_outcome WHERE idempotency_key = p_idempotency_key;`.
   `publication_idempotency_immutability_trg` (`BEFORE UPDATE`) verifies that
   `OLD.outcome ->> 'kind' = '__pending__'`, that `idempotency_key`, `request_digest`, and
   `recorded_at` are unchanged, that `NEW.outcome ->> 'kind'` is a valid final outcome, and
   that the referenced `(predictionId, identityDigest)` exists in
   `oracle_ledger.official_predictions`.
4. **Step 4 — Commit and run the deferred constraint trigger**:
   During `COMMIT`, PostgreSQL fires `publication_idempotency_outcome_complete_trg`, which
   selects the live `outcome` for `idempotency_key = p_idempotency_key` and verifies that the
   row still exists (`IF NOT FOUND THEN RAISE EXCEPTION`) and that `outcome ->> 'kind'` is in
   `('created', 'existing', 'identity-conflict', 'rejected')` and is not `'__pending__'`.

#### Exact concurrency, crash/rollback, and idempotency-key consumption guarantees

1. **Same `idempotency_key`, concurrent requests (identical or different `request_digest`)**:
   - Transaction A and Transaction B both call `oracle_ledger.commit_official_publication`
     with the same `p_idempotency_key`.
   - PostgreSQL grants the unique-index lock on
     `oracle_ledger.publication_idempotency_keys(idempotency_key)` to A and blocks B at Step 1
     before B can touch `oracle_ledger.official_predictions`.
   - When A commits (having finalized `outcome` in Step 3), B unblocks, receives 0 rows from
     `ON CONFLICT (idempotency_key) DO NOTHING`, reads A's committed `(request_digest, outcome)`
     in a fresh `READ COMMITTED` statement snapshot, and returns `replayed` (if
     `request_digest` matches) or `idempotency-conflict` (if `request_digest` differs).
     Neither replay nor conflict ever inserts a duplicate prediction or event.
2. **Different `idempotency_key` values, same `identity_digest` (competing for the same canonical proposition)**:
   - Transaction A (`key-1`) and Transaction B (`key-2`) both win Step 1 for their distinct
     keys and reach Step 2 (`INSERT INTO oracle_ledger.official_predictions ... ON CONFLICT (identity_digest) DO NOTHING`).
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
   - If a buggy function or migration owner executes Step 1 and attempts `COMMIT` without
     executing Step 3 (`UPDATE`), or if the reservation row disappeared before `COMMIT`
     (`NOT FOUND`), `publication_idempotency_outcome_complete_trg` raises SQLSTATE `23514` at
     `COMMIT` and forces a full transaction rollback.
   - If any caller attempts to `DELETE` a row from `oracle_ledger.publication_idempotency_keys`,
     insert a finalized `'created'` or `'existing'` row directly without `'__pending__'`,
     modify `idempotency_key`, `request_digest`, or `recorded_at`, or `UPDATE` an
     already-finalized row, `publication_idempotency_immutability_trg`
     (`BEFORE INSERT OR UPDATE OR DELETE`) immediately raises SQLSTATE `23514` and aborts the
     operation.
4. **Why rejected publication attempts never claim an official identity — and when an `idempotency_key` is consumed**:
   - **Pre-idempotency rejections (steps 1–4 and step 8)**: `candidate-mismatch` (step 1),
     `candidate-digest-mismatch` (step 2), `wrong-stage` with `reason: 'invalid-stage'`
     (step 3), `invalid-clock` (step 4), and `wrong-stage` with `reason: 'forged-stage'`
     (step 8) return without calling any database write function.
   - **Domain validation rejections (step 6 `identity-conflict` and step 7 `rejected`)**:
     When a request reaches step 6 (unresolved identity component) or step 7 (failed
     evaluation, including `publishedAt >= horizon.endsAt` or
     `evidence[i].publishedAt > publishedAt`), `publishCandidate` invokes
     `oracle_ledger.record_rejected_or_conflict_idempotency` to persist the complete
     `identity-conflict` or `rejected` outcome in `oracle_ledger.publication_idempotency_keys`,
     and returns **without ever touching `oracle_ledger.official_predictions`**.
   - **Consequence for retries**: Neither `identity-conflict` nor `rejected` ever claims an
     `identity_digest` in `oracle_ledger.official_predictions`. However, because
     `record_rejected_or_conflict_idempotency` binds the caller's `idempotencyKey` to the
     rejected request's `requestDigest`:
     - Retrying the **identical** rejected request with the same `idempotencyKey` returns
       `{ kind: 'replayed', original }` (replaying the rejection).
     - Modifying the candidate to fix the issue (which changes `candidateContentDigest` and
       `publicationRequestDigest`) while reusing that same consumed `idempotencyKey` returns
       `{ kind: 'idempotency-conflict', ... }`.
     - **A corrected/retried candidate submission must therefore supply a new
       `idempotencyKey`**, which will pass all nine steps and claim the official identity
       with `{ kind: 'created', ... }`.

---

### 2.5 Production database role separation and controlled write-boundary privilege model

Database triggers (`publication_idempotency_immutability_trg`,
`publication_idempotency_no_truncate_trg`, `publication_idempotency_outcome_complete_trg`,
`official_predictions_append_only_trg`, `prediction_events_append_only_trg`) cannot protect
against a PostgreSQL superuser or the table owner (`oracle_migrator`), because a table owner
or superuser can execute `ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`, `DROP TABLE`, or
(for a superuser) `SET session_replication_role = 'replica'`. In addition, granting the
application runtime role direct `INSERT` or `UPDATE` privileges on the ledger tables would
allow a compromised or buggy application query to insert rows directly into
`official_predictions`, `prediction_events`, or `publication_idempotency_keys` outside the
controlled publication workflow.

A production deployment must therefore enforce both **role separation** and a **controlled
`SECURITY DEFINER` write boundary** where the application runtime role has **zero direct write
privileges (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) on any ledger table**.

The role names below (`oracle_migrator` and `oracle_app`) are **illustrative** and must be
configured with concrete role names and secrets during deployment:

1. **Migration and object-owner role (`oracle_migrator` — schema, table, trigger, and function owner)**:
   - Created with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN` in steady-state
     production (enabled for login only during controlled offline schema migrations, or
     assumed by a dedicated migration runner; **never** used by the HTTP/application service
     at runtime).
   - Owns schema `oracle_ledger`, all three ledger tables, all trigger functions, and the
     three `SECURITY DEFINER` write functions.
   - Because `oracle_migrator` is `NOSUPERUSER`, all table constraints and triggers fire
     normally inside its `SECURITY DEFINER` functions, and `oracle_migrator` cannot execute
     `SET session_replication_role = 'replica'`.
2. **Application runtime role (`oracle_app` — read-only table access + `EXECUTE` on approved functions only)**:
   - Created with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN`.
   - Is **never** granted membership in `oracle_migrator` or any other privileged role
     (`REVOKE oracle_migrator FROM oracle_app, PUBLIC;`).
   - Does **not** own any schema, table, function, or trigger, and therefore cannot execute
     `ALTER TABLE`, `DROP TABLE`, `DROP TRIGGER`, `ALTER TABLE ... DISABLE TRIGGER`,
     `CREATE OR REPLACE FUNCTION`, `GRANT`, or `REVOKE`.
   - Receives **zero** direct write or DDL privileges on any ledger table: **no `INSERT`, no
     `UPDATE`, no `DELETE`, no `TRUNCATE`, no `TRIGGER`, and no `REFERENCES`**.
   - Receives only:
     - `USAGE` on schema `oracle_ledger` (no `CREATE` privilege),
     - `SELECT` on `oracle_ledger.official_predictions`, `oracle_ledger.prediction_events`,
       and `oracle_ledger.publication_idempotency_keys` (for read-only archive queries and
       idempotency/identity lookups), and
     - `EXECUTE` on the three approved `SECURITY DEFINER` write functions
       (`oracle_ledger.commit_official_publication`,
       `oracle_ledger.record_rejected_or_conflict_idempotency`, and
       `oracle_ledger.append_terminal_prediction_event`), with default `PUBLIC` execution
       revoked on all functions in `oracle_ledger`:

```sql
-- Illustrative role names; configure concrete role names and credentials during deployment.
-- oracle_migrator is NOLOGIN at runtime and is NEVER used by the application service.
CREATE ROLE oracle_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
CREATE ROLE oracle_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN;

-- Ensure oracle_app is never a member of oracle_migrator
REVOKE oracle_migrator FROM oracle_app, PUBLIC;

-- Lock down schema-level privileges
ALTER SCHEMA oracle_ledger OWNER TO oracle_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, oracle_app;
REVOKE ALL ON SCHEMA oracle_ledger FROM PUBLIC, oracle_app;
GRANT USAGE ON SCHEMA oracle_ledger TO oracle_app;

-- Assign ownership of all ledger tables to oracle_migrator
ALTER TABLE oracle_ledger.official_predictions OWNER TO oracle_migrator;
ALTER TABLE oracle_ledger.prediction_events OWNER TO oracle_migrator;
ALTER TABLE oracle_ledger.publication_idempotency_keys OWNER TO oracle_migrator;

-- Assign ownership of all trigger and write functions to oracle_migrator
ALTER FUNCTION oracle_ledger.enforce_append_only_ledger_row() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_immutability() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.commit_official_publication(TEXT, CHAR(64), TEXT, CHAR(64), JSONB, CHAR(64), TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64)) OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.record_rejected_or_conflict_idempotency(TEXT, CHAR(64), JSONB, TIMESTAMPTZ) OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.append_terminal_prediction_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64), CHAR(64)) OWNER TO oracle_migrator;

-- Revoke all table privileges from PUBLIC and oracle_app;
-- grant ONLY read-only SELECT on the three ledger tables to oracle_app.
-- oracle_app has NO INSERT, NO UPDATE, NO DELETE, NO TRUNCATE, NO TRIGGER, and NO REFERENCES.
REVOKE ALL ON TABLE
  oracle_ledger.official_predictions,
  oracle_ledger.prediction_events,
  oracle_ledger.publication_idempotency_keys
FROM PUBLIC, oracle_app;

GRANT SELECT
  ON TABLE
    oracle_ledger.official_predictions,
    oracle_ledger.prediction_events,
    oracle_ledger.publication_idempotency_keys
  TO oracle_app;

-- Revoke default PUBLIC execution privileges on all existing and future functions in oracle_ledger
ALTER DEFAULT PRIVILEGES FOR ROLE oracle_migrator IN SCHEMA oracle_ledger
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA oracle_ledger FROM PUBLIC, oracle_app;

REVOKE ALL ON FUNCTION
  oracle_ledger.enforce_append_only_ledger_row(),
  oracle_ledger.enforce_publication_idempotency_immutability(),
  oracle_ledger.enforce_publication_idempotency_no_truncate(),
  oracle_ledger.enforce_publication_idempotency_outcome_complete(),
  oracle_ledger.commit_official_publication(TEXT, CHAR(64), TEXT, CHAR(64), JSONB, CHAR(64), TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64)),
  oracle_ledger.record_rejected_or_conflict_idempotency(TEXT, CHAR(64), JSONB, TIMESTAMPTZ),
  oracle_ledger.append_terminal_prediction_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64), CHAR(64))
FROM PUBLIC, oracle_app;

-- Grant EXECUTE to oracle_app ONLY on the three approved controlled write functions
GRANT EXECUTE ON FUNCTION
  oracle_ledger.commit_official_publication(TEXT, CHAR(64), TEXT, CHAR(64), JSONB, CHAR(64), TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64)),
  oracle_ledger.record_rejected_or_conflict_idempotency(TEXT, CHAR(64), JSONB, TIMESTAMPTZ),
  oracle_ledger.append_terminal_prediction_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64), CHAR(64))
TO oracle_app;
```

#### PostgreSQL 16+ version guard, indirect role-membership audit (`pg_catalog.pg_auth_members`), and effective privilege audit

Executing `REVOKE oracle_migrator FROM oracle_app, PUBLIC;` only removes direct membership of
`oracle_app` (and `PUBLIC`) in `oracle_migrator`. It does **not** by itself remove arbitrary
pre-existing role memberships or prove that `oracle_app` has no indirect or transitive path to
ownership, DDL, migration, or table-write capabilities; furthermore, inspecting static `GRANT`
statements in a migration script does not prove what privileges are actually effective in a
live database catalog. In PostgreSQL, `oracle_app` could still acquire unintended capabilities
through:

- pre-existing direct or transitive memberships in other roles (`pg_write_all_data`,
  `pg_read_all_data`, `pg_database_owner`, or an intermediate group role granted
  `oracle_migrator`),
- `SET ROLE` if `pg_auth_members.set_option` is `true` even when `inherit_option` is `false`,
- privileges granted to `PUBLIC` on schemas, tables, or functions (because `has_table_privilege`,
  `has_schema_privilege`, and `has_function_privilege` evaluate privileges inherited via
  `PUBLIC` as effective for every role), or
- residual object ownership in `pg_catalog.pg_namespace`, `pg_catalog.pg_class`, or
  `pg_catalog.pg_proc`.

Deployment verification must therefore run the **three executable audit steps** below before
serving traffic:

1. **Step A — PostgreSQL 16+ preflight version check (`server_version_num >= 160000`)**:
   Because `pg_catalog.pg_auth_members.inherit_option` and `pg_catalog.pg_auth_members.set_option`
   were introduced in **PostgreSQL 16**, **PostgreSQL 16** (`server_version_num >= 160000`) is
   the minimum supported database version. If the server is older than PostgreSQL 16, the
   preflight block below fails immediately with SQLSTATE `0A000` (`feature_not_supported`)
   rather than silently omitting membership checks. Compatibility with PostgreSQL versions
   older than 16 is not claimed.
2. **Step B — Recursive direct and transitive role-membership audit (`pg_catalog.pg_auth_members` + `pg_catalog.pg_roles`)**:
   Walks every direct and transitive role membership reachable from `oracle_app` (inspecting
   `admin_option`, `inherit_option`, `set_option`, `rolsuper`, `rolcreatedb`, `rolcreaterole`,
   `rolbypassrls`, and `rolreplication`) and **must return 0 rows**.
3. **Step C — Executable effective-privilege and object-ownership audit (`has_table_privilege`, `has_schema_privilege`, `has_function_privilege`, `pg_roles`, `pg_namespace`, `pg_class`, `pg_proc`)**:
   Evaluates the actual effective privileges in the live catalog (including privileges
   inherited through `PUBLIC` or any role path) and **must return 0 violation rows**. Specifically,
   Step C verifies:
   - `oracle_app` has **no** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, or
     `REFERENCES` privilege on any ledger table (`official_predictions`, `prediction_events`,
     `publication_idempotency_keys`) or any other relation in `oracle_ledger`.
   - `oracle_app` **does** have `SELECT` privilege on all three ledger tables.
   - `oracle_app` has **no** `CREATE` privilege on schema `oracle_ledger` or schema `public`,
     and **does** have `USAGE` privilege on schema `oracle_ledger`.
   - `oracle_app` has unprivileged role attributes (`rolsuper = false`, `rolinherit = false`,
     `rolcreaterole = false`, `rolcreatedb = false`, `rolbypassrls = false`,
     `rolreplication = false`) and owns **0** schemas (`pg_namespace`), relations (`pg_class`),
     or functions (`pg_proc`), while `oracle_migrator` (`rolsuper = false`, `rolcanlogin = false`)
     owns schema `oracle_ledger`, all three ledger tables, and all seven functions in
     `oracle_ledger`.
   - `oracle_app` has `EXECUTE` privilege on **exactly** the three approved `SECURITY DEFINER`
     functions (`commit_official_publication`, `record_rejected_or_conflict_idempotency`,
     `append_terminal_prediction_event`) and **cannot** execute any internal trigger function or
     other function in `oracle_ledger`.
   - `PUBLIC` has **no** write (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`,
     `REFERENCES`) or `SELECT` privileges on any ledger table, **no** `CREATE` privilege on
     `oracle_ledger` or `public`, and **cannot** execute any function in `oracle_ledger`
     (neither the internal trigger functions nor the `SECURITY DEFINER` write functions).

```sql
-- Step A: Preflight PostgreSQL 16+ version check (server_version_num >= 160000).
-- Fails immediately with SQLSTATE 0A000 if connected to PostgreSQL < 16 rather than
-- silently skipping pg_auth_members.inherit_option / set_option checks.
DO $$
DECLARE
  v_server_version_num INTEGER;
BEGIN
  v_server_version_num := pg_catalog.current_setting('server_version_num')::integer;
  IF v_server_version_num < 160000 THEN
    RAISE EXCEPTION
      'The Oracle ledger contract v1.8 requires PostgreSQL 16 or newer (server_version_num >= 160000), got: %',
      v_server_version_num
      USING ERRCODE = '0A000';
  END IF;
END;
$$;

-- Step B: Deployment audit query — recursively inspect all direct and transitive role
-- memberships and role attributes reachable from oracle_app (requires PostgreSQL 16+).
-- A compliant deployment MUST return 0 rows from this query.
WITH RECURSIVE role_membership_graph AS (
  SELECT
    m.member AS base_role_oid,
    m.roleid AS granted_role_oid,
    m.admin_option,
    m.inherit_option,
    m.set_option,
    1 AS depth,
    ARRAY[m.member, m.roleid] AS oid_path
  FROM pg_catalog.pg_auth_members AS m
  JOIN pg_catalog.pg_roles AS r_member
    ON r_member.oid = m.member
  WHERE r_member.rolname = 'oracle_app'

  UNION ALL

  SELECT
    g.base_role_oid,
    m.roleid AS granted_role_oid,
    m.admin_option,
    m.inherit_option,
    m.set_option,
    g.depth + 1 AS depth,
    g.oid_path || m.roleid
  FROM role_membership_graph AS g
  JOIN pg_catalog.pg_auth_members AS m
    ON m.member = g.granted_role_oid
  WHERE NOT (m.roleid = ANY (g.oid_path))
)
SELECT
  r_base.rolname AS runtime_role,
  r_granted.rolname AS reachable_role,
  g.depth,
  g.admin_option,
  g.inherit_option,
  g.set_option,
  r_granted.rolsuper,
  r_granted.rolcreatedb,
  r_granted.rolcreaterole,
  r_granted.rolbypassrls,
  r_granted.rolreplication
FROM role_membership_graph AS g
JOIN pg_catalog.pg_roles AS r_base
  ON r_base.oid = g.base_role_oid
JOIN pg_catalog.pg_roles AS r_granted
  ON r_granted.oid = g.granted_role_oid;

-- Step C: Executable effective-privilege and ownership audit query.
-- Evaluates actual effective privileges via has_table_privilege, has_schema_privilege,
-- has_function_privilege, pg_roles, pg_namespace, pg_class, and pg_proc.
-- A compliant deployment MUST return 0 violation rows from this query.
WITH ledger_tables(table_name) AS (
  VALUES
    ('oracle_ledger.official_predictions'),
    ('oracle_ledger.prediction_events'),
    ('oracle_ledger.publication_idempotency_keys')
),
forbidden_table_privs(priv) AS (
  VALUES
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('TRIGGER'),
    ('REFERENCES')
),
approved_functions(fn_sig, fn_name) AS (
  VALUES
    (
      'oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
      'commit_official_publication'
    ),
    (
      'oracle_ledger.record_rejected_or_conflict_idempotency(text,character,jsonb,timestamp with time zone)',
      'record_rejected_or_conflict_idempotency'
    ),
    (
      'oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)',
      'append_terminal_prediction_event'
    )
),
effective_privilege_violations AS (
  -- 1. Verify PostgreSQL 16+ minimum version inside the query result set as well
  SELECT
    'version_guard'::text AS check_category,
    'server_version_num'::text AS object_name,
    'PostgreSQL 16+ (server_version_num >= 160000) is required'::text AS violation_detail
  WHERE pg_catalog.current_setting('server_version_num')::integer < 160000

  UNION ALL

  -- 2. Verify oracle_app and oracle_migrator role flags in pg_catalog.pg_roles
  SELECT
    'role_attributes',
    r.rolname,
    'oracle_app has forbidden privileged role attribute (rolsuper/rolinherit/rolcreaterole/rolcreatedb/rolbypassrls/rolreplication)'
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'oracle_app'
    AND (
      r.rolsuper
      OR r.rolinherit
      OR r.rolcreaterole
      OR r.rolcreatedb
      OR r.rolbypassrls
      OR r.rolreplication
      OR NOT r.rolcanlogin
    )

  UNION ALL

  SELECT
    'role_attributes',
    r.rolname,
    'oracle_migrator must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN in steady state'
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'oracle_migrator'
    AND (
      r.rolsuper
      OR r.rolinherit
      OR r.rolcreaterole
      OR r.rolcreatedb
      OR r.rolcanlogin
    )

  UNION ALL

  -- 3. Verify oracle_app has NO forbidden table privileges (INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES)
  SELECT
    'oracle_app_forbidden_table_priv',
    lt.table_name,
    'oracle_app has forbidden effective privilege ' || ftp.priv
  FROM ledger_tables AS lt
  CROSS JOIN forbidden_table_privs AS ftp
  WHERE pg_catalog.has_table_privilege('oracle_app', lt.table_name, ftp.priv)

  UNION ALL

  -- 4. Verify oracle_app HAS effective SELECT privilege on all three ledger tables
  SELECT
    'oracle_app_missing_select_priv',
    lt.table_name,
    'oracle_app is missing required SELECT privilege'
  FROM ledger_tables AS lt
  WHERE NOT pg_catalog.has_table_privilege('oracle_app', lt.table_name, 'SELECT')

  UNION ALL

  -- 5. Verify PUBLIC has NO write or SELECT privileges on any ledger table
  SELECT
    'public_forbidden_table_priv',
    lt.table_name,
    'PUBLIC has forbidden effective table privilege ' || p.priv
  FROM ledger_tables AS lt
  CROSS JOIN (
    SELECT priv FROM forbidden_table_privs
    UNION ALL
    SELECT 'SELECT'
  ) AS p(priv)
  WHERE pg_catalog.has_table_privilege('public', lt.table_name, p.priv)

  UNION ALL

  -- 6. Verify schema privileges via has_schema_privilege (no CREATE on oracle_ledger or public; USAGE on oracle_ledger for oracle_app only)
  SELECT
    'schema_privilege',
    s.schema_name,
    'oracle_app has forbidden CREATE privilege on schema ' || s.schema_name
  FROM (VALUES ('oracle_ledger'), ('public')) AS s(schema_name)
  WHERE pg_catalog.has_schema_privilege('oracle_app', s.schema_name, 'CREATE')

  UNION ALL

  SELECT
    'schema_privilege',
    'oracle_ledger',
    'oracle_app is missing required USAGE privilege on schema oracle_ledger'
  WHERE NOT pg_catalog.has_schema_privilege('oracle_app', 'oracle_ledger', 'USAGE')

  UNION ALL

  SELECT
    'public_schema_privilege',
    s.schema_name,
    'PUBLIC has forbidden ' || s.priv || ' privilege on schema ' || s.schema_name
  FROM (
    VALUES
      ('oracle_ledger', 'CREATE'),
      ('oracle_ledger', 'USAGE'),
      ('public', 'CREATE')
  ) AS s(schema_name, priv)
  WHERE pg_catalog.has_schema_privilege('public', s.schema_name, s.priv)

  UNION ALL

  -- 7. Verify oracle_app owns zero schemas, relations, or functions
  SELECT
    'oracle_app_owns_schema',
    n.nspname,
    'oracle_app must not own any schema'
  FROM pg_catalog.pg_namespace AS n
  JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
  WHERE r.rolname = 'oracle_app'

  UNION ALL

  SELECT
    'oracle_app_owns_relation',
    n.nspname || '.' || c.relname,
    'oracle_app must not own any table, sequence, or view'
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = c.relowner
  WHERE r.rolname = 'oracle_app'

  UNION ALL

  SELECT
    'oracle_app_owns_function',
    n.nspname || '.' || p.proname,
    'oracle_app must not own any function or procedure'
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE r.rolname = 'oracle_app'

  UNION ALL

  -- 8. Verify oracle_app has EXECUTE on all three approved SECURITY DEFINER functions
  SELECT
    'oracle_app_missing_approved_execute',
    af.fn_sig,
    'oracle_app is missing EXECUTE privilege on approved function ' || af.fn_name
  FROM approved_functions AS af
  WHERE NOT pg_catalog.has_function_privilege('oracle_app', af.fn_sig, 'EXECUTE')

  UNION ALL

  -- 9. Verify oracle_app CANNOT execute any unapproved or trigger function in oracle_ledger
  SELECT
    'oracle_app_unapproved_function_execute',
    n.nspname || '.' || p.proname,
    'oracle_app has forbidden EXECUTE privilege on unapproved function ' || n.nspname || '.' || p.proname
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'oracle_ledger'
    AND p.proname NOT IN (SELECT fn_name FROM approved_functions)
    AND pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')

  UNION ALL

  -- 10. Verify PUBLIC CANNOT execute ANY function in oracle_ledger (approved or unapproved)
  SELECT
    'public_function_execute',
    n.nspname || '.' || p.proname,
    'PUBLIC has forbidden EXECUTE privilege on function ' || n.nspname || '.' || p.proname
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'oracle_ledger'
    AND pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
)
SELECT
  check_category,
  object_name,
  violation_detail
FROM effective_privilege_violations;
```

> **Honest boundary of database triggers, `SECURITY DEFINER` write functions, digest checks, and role separation**:
>
> 1. **What this boundary prevents**: Because `oracle_app` has no direct `INSERT`, `UPDATE`,
>    `DELETE`, or `TRUNCATE` privileges on any ledger table and no direct or transitive role
>    memberships, the application runtime cannot insert finalized idempotency rows directly,
>    cannot insert predictions without a matching `e0` event and finalized idempotency row,
>    cannot insert `e0` events outside publication or duplicate/unlinked `e1` events, cannot
>    invoke publication under `REPEATABLE READ` or `SERIALIZABLE` isolation (`ERRCODE = '25001'`),
>    and cannot mutate, delete, or truncate existing ledger rows.
> 2. **What this boundary does not prevent**:
>    - **Database superuser or migration-owner (`oracle_migrator`) compromise**: It does
>      **not** protect against a compromised PostgreSQL superuser or a caller who obtains DDL
>      control over the migration owner (`oracle_migrator`) and disables triggers, alters
>      functions, or rewrites tables directly.
>    - **Format-only digest validation in SQL vs. cryptographic SHA-256 in TypeScript**: The
>      PL/pgSQL functions validate that digest arguments match the 64-character lowercase hex
>      format (`^[0-9a-f]{64}$`) and enforce relational equality (`p_prev_digest = e0.digest`
>      and `request_digest` matching), but do **not** independently recompute SHA-256 over the
>      canonicalized `p_sealed_payload` or `p_e0_envelope` / `p_envelope` inside PostgreSQL.
>      Cryptographic SHA-256 computation and verification occur in the TypeScript domain and
>      client/archive verification layers.
>    - **Compromised application submitting new structurally valid publications/resolutions**:
>      Because the HTTP application service constructs and hashes candidate payloads before
>      calling `oracle_ledger.commit_official_publication`, a compromised application runtime
>      with `EXECUTE` on the three approved functions can still submit well-formed new
>      publications or resolve existing open predictions using structurally valid inputs
>      (though it cannot rewrite, delete, or truncate previously committed predictions,
>      events, or idempotency keys, nor forge a `'created'` idempotency row without a
>      committed prediction). Detecting privileged storage rewrites or equivocation requires
>      external cryptographic anchoring / transparency logs (not implemented in v0.1).

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
