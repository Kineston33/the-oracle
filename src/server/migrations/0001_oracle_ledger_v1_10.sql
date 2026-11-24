-- =============================================================================
-- THE ORACLE — Official Publication Protocol v1.10
-- Migration 0001: PostgreSQL 16+ Ledger Schema, Append-Only Triggers,
--                 Controlled SECURITY DEFINER Write Functions & Least-Privilege Roles
-- =============================================================================

-- 1. Preflight PostgreSQL 16+ version guard (server_version_num >= 160000)
DO $$
DECLARE
  v_server_version_num INTEGER;
BEGIN
  v_server_version_num := pg_catalog.current_setting('server_version_num')::integer;
  IF v_server_version_num < 160000 THEN
    RAISE EXCEPTION
      'The Oracle ledger contract v1.10 requires PostgreSQL 16 or newer (server_version_num >= 160000), got: %',
      v_server_version_num
      USING ERRCODE = '0A000';
  END IF;
END;
$$;

-- 2. Provision and harden roles (oracle_migrator = NOLOGIN owner, oracle_app = runtime)
DO $$
DECLARE
  v_membership RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'oracle_migrator') THEN
    CREATE ROLE oracle_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
  ELSE
    ALTER ROLE oracle_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'oracle_app') THEN
    CREATE ROLE oracle_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION LOGIN;
  ELSE
    ALTER ROLE oracle_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION LOGIN;
  END IF;

  -- Revoke any existing direct role memberships from oracle_app
  FOR v_membership IN
    SELECT r_role.rolname AS granted_role
      FROM pg_catalog.pg_auth_members AS m
      JOIN pg_catalog.pg_roles AS r_member ON r_member.oid = m.member
      JOIN pg_catalog.pg_roles AS r_role ON r_role.oid = m.roleid
     WHERE r_member.rolname = 'oracle_app'
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM oracle_app', v_membership.granted_role);
  END LOOP;
END;
$$;

REVOKE oracle_migrator FROM oracle_app;

-- 3. Create schema oracle_ledger owned by oracle_migrator
CREATE SCHEMA IF NOT EXISTS oracle_ledger AUTHORIZATION oracle_migrator;
ALTER SCHEMA oracle_ledger OWNER TO oracle_migrator;

-- 4. Create ledger tables
CREATE TABLE IF NOT EXISTS oracle_ledger.official_predictions (
  prediction_id   TEXT PRIMARY KEY,
  identity_digest CHAR(64) NOT NULL UNIQUE,
  sealed_payload  JSONB NOT NULL,
  payload_digest  CHAR(64) NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT official_predictions_recording_order
    CHECK (recorded_at > published_at)
);

CREATE TABLE IF NOT EXISTS oracle_ledger.prediction_events (
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

CREATE TABLE IF NOT EXISTS oracle_ledger.publication_idempotency_keys (
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

-- 5. Append-only, immutability, TRUNCATE-prevention, and deferred constraint triggers
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

DROP TRIGGER IF EXISTS official_predictions_append_only_trg ON oracle_ledger.official_predictions;
CREATE TRIGGER official_predictions_append_only_trg
  BEFORE UPDATE OR DELETE ON oracle_ledger.official_predictions
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_append_only_ledger_row();

DROP TRIGGER IF EXISTS prediction_events_append_only_trg ON oracle_ledger.prediction_events;
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
    IF (OLD.outcome ->> 'kind') IS DISTINCT FROM '__pending__' THEN
      RAISE EXCEPTION
        'publication_idempotency_keys row % is already finalized (%) and cannot be updated',
        OLD.idempotency_key,
        OLD.outcome ->> 'kind'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    THEN
      RAISE EXCEPTION
        'publication_idempotency_keys immutable columns (idempotency_key, request_digest, recorded_at) cannot be modified for %',
        OLD.idempotency_key
        USING ERRCODE = '23514';
    END IF;

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

DROP TRIGGER IF EXISTS publication_idempotency_immutability_trg ON oracle_ledger.publication_idempotency_keys;
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

DROP TRIGGER IF EXISTS publication_idempotency_no_truncate_trg ON oracle_ledger.publication_idempotency_keys;
CREATE TRIGGER publication_idempotency_no_truncate_trg
  BEFORE TRUNCATE ON oracle_ledger.publication_idempotency_keys
  FOR EACH STATEMENT
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();

DROP TRIGGER IF EXISTS official_predictions_no_truncate_trg ON oracle_ledger.official_predictions;
CREATE TRIGGER official_predictions_no_truncate_trg
  BEFORE TRUNCATE ON oracle_ledger.official_predictions
  FOR EACH STATEMENT
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();

DROP TRIGGER IF EXISTS prediction_events_no_truncate_trg ON oracle_ledger.prediction_events;
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
  SELECT outcome
    INTO current_outcome
    FROM oracle_ledger.publication_idempotency_keys
   WHERE idempotency_key = NEW.idempotency_key;

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

DROP TRIGGER IF EXISTS publication_idempotency_outcome_complete_trg ON oracle_ledger.publication_idempotency_keys;
CREATE CONSTRAINT TRIGGER publication_idempotency_outcome_complete_trg
  AFTER INSERT OR UPDATE ON oracle_ledger.publication_idempotency_keys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete();

-- 6. Controlled SECURITY DEFINER database write functions
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
  v_winner_events           JSONB;
  v_outcome                 JSONB;
  v_status                  TEXT;
BEGIN
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

    -- Reconstruct the current ordered event chain [e0] or [e0, e1] from prediction_events
    -- without mutating the immutable sealed_payload column in official_predictions.
    SELECT pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'seq', pe.seq,
               'kind', pe.kind,
               'occurredAt', pe.envelope -> 'occurredAt',
               'recordedAt', pe.envelope -> 'recordedAt',
               'origin', pe.envelope -> 'origin',
               'algorithm', pe.envelope -> 'algorithm',
               'schemaVersion', COALESCE(
                 (pg_catalog.substring(pe.envelope ->> 'schema', '^oracle\.event/([0-9]+)$'))::integer,
                 2
               ),
               'scope', pe.envelope -> 'scope',
               'body', pe.envelope -> 'body',
               'digest', pg_catalog.btrim(pe.digest),
               'prevDigest', CASE
                 WHEN pe.prev_digest IS NULL THEN NULL
                 ELSE pg_catalog.btrim(pe.prev_digest)
               END
             )
             ORDER BY pe.seq ASC
           )
      INTO v_winner_events
      FROM oracle_ledger.prediction_events AS pe
     WHERE pe.prediction_id = v_winner_id;

    IF v_winner_events IS NOT NULL AND pg_catalog.jsonb_array_length(v_winner_events) > 0 THEN
      v_winner_payload := pg_catalog.jsonb_set(
        v_winner_payload,
        '{events}',
        v_winner_events,
        true
      );
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

  IF p_request_digest IS NULL OR p_request_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'p_request_digest must match 64-character lowercase hex format'
      USING ERRCODE = '22023';
  END IF;

  IF p_recorded_at IS NULL THEN
    RAISE EXCEPTION 'p_recorded_at must not be null'
      USING ERRCODE = '22023';
  END IF;

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
  v_isolation_level      TEXT;
  v_locked_prediction_id TEXT;
  v_e0_digest            CHAR(64);
  v_e0_occurred_at       TIMESTAMPTZ;
  v_has_terminal_event   BOOLEAN;
BEGIN
  v_isolation_level := pg_catalog.current_setting('transaction_isolation');
  IF v_isolation_level IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION
      'append_terminal_prediction_event requires transaction_isolation = read committed, got: %',
      v_isolation_level
      USING ERRCODE = '25001';
  END IF;

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

  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
     OR p_prev_digest IS NULL OR p_prev_digest !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'p_digest and p_prev_digest must match 64-character lowercase hex format'
      USING ERRCODE = '22023';
  END IF;

  IF (p_envelope ->> 'seq') IS DISTINCT FROM 'e1'
     OR (p_envelope ->> 'kind') IS DISTINCT FROM p_kind
     OR (p_envelope ->> 'prevDigest') IS DISTINCT FROM p_prev_digest
  THEN
    RAISE EXCEPTION
      'p_envelope must match seq = e1, kind = %, and prevDigest = %',
      p_kind,
      p_prev_digest
      USING ERRCODE = '23514';
  END IF;

  SELECT op.prediction_id
    INTO v_locked_prediction_id
    FROM oracle_ledger.official_predictions AS op
   WHERE op.prediction_id = p_prediction_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'official_predictions row % does not exist',
      p_prediction_id
      USING ERRCODE = '23503';
  END IF;

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

-- 7. Ownership & privilege hardening
ALTER SCHEMA oracle_ledger OWNER TO oracle_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, oracle_app;
REVOKE ALL ON SCHEMA oracle_ledger FROM PUBLIC, oracle_app;
GRANT USAGE ON SCHEMA oracle_ledger TO oracle_app;

ALTER TABLE oracle_ledger.official_predictions OWNER TO oracle_migrator;
ALTER TABLE oracle_ledger.prediction_events OWNER TO oracle_migrator;
ALTER TABLE oracle_ledger.publication_idempotency_keys OWNER TO oracle_migrator;

ALTER FUNCTION oracle_ledger.enforce_append_only_ledger_row() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_immutability() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete() OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.commit_official_publication(TEXT, CHAR(64), TEXT, CHAR(64), JSONB, CHAR(64), TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64)) OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.record_rejected_or_conflict_idempotency(TEXT, CHAR(64), JSONB, TIMESTAMPTZ) OWNER TO oracle_migrator;
ALTER FUNCTION oracle_ledger.append_terminal_prediction_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64), CHAR(64)) OWNER TO oracle_migrator;

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

GRANT EXECUTE ON FUNCTION
  oracle_ledger.commit_official_publication(TEXT, CHAR(64), TEXT, CHAR(64), JSONB, CHAR(64), TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64)),
  oracle_ledger.record_rejected_or_conflict_idempotency(TEXT, CHAR(64), JSONB, TIMESTAMPTZ),
  oracle_ledger.append_terminal_prediction_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, CHAR(64), CHAR(64))
TO oracle_app;
