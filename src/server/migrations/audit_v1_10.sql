-- =============================================================================
-- THE ORACLE — Official Publication Protocol v1.10
-- Executable effective-privilege, PUBLIC catalog ACL (aclexplode / acldefault),
-- role-attribute, and required object-ownership audit query (§2.5 Step C).
-- A compliant deployment MUST return 0 violation rows from this query.
-- =============================================================================

WITH required_ledger_tables(schema_name, rel_name, qualified_name) AS (
  VALUES
    ('oracle_ledger', 'official_predictions', 'oracle_ledger.official_predictions'),
    ('oracle_ledger', 'prediction_events', 'oracle_ledger.prediction_events'),
    ('oracle_ledger', 'publication_idempotency_keys', 'oracle_ledger.publication_idempotency_keys')
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
expected_ledger_functions(fn_sig, fn_name, is_approved_for_app) AS (
  VALUES
    (
      'oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
      'commit_official_publication',
      TRUE
    ),
    (
      'oracle_ledger.record_rejected_or_conflict_idempotency(text,character,jsonb,timestamp with time zone)',
      'record_rejected_or_conflict_idempotency',
      TRUE
    ),
    (
      'oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)',
      'append_terminal_prediction_event',
      TRUE
    ),
    (
      'oracle_ledger.enforce_append_only_ledger_row()',
      'enforce_append_only_ledger_row',
      FALSE
    ),
    (
      'oracle_ledger.enforce_publication_idempotency_immutability()',
      'enforce_publication_idempotency_immutability',
      FALSE
    ),
    (
      'oracle_ledger.enforce_publication_idempotency_no_truncate()',
      'enforce_publication_idempotency_no_truncate',
      FALSE
    ),
    (
      'oracle_ledger.enforce_publication_idempotency_outcome_complete()',
      'enforce_publication_idempotency_outcome_complete',
      FALSE
    )
),
effective_privilege_violations AS (
  -- 1. Verify PostgreSQL 16+ minimum version inside the query result set
  SELECT
    'version_guard'::text AS check_category,
    'server_version_num'::text AS object_name,
    'PostgreSQL 16+ (server_version_num >= 160000) is required'::text AS violation_detail
  WHERE pg_catalog.current_setting('server_version_num')::integer < 160000

  UNION ALL

  -- 2a. Verify both oracle_app and oracle_migrator roles exist
  SELECT
    'missing_required_role',
    expected_role.rolname,
    'required role ' || expected_role.rolname || ' does not exist in pg_catalog.pg_roles'
  FROM (VALUES ('oracle_app'), ('oracle_migrator')) AS expected_role(rolname)
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS r
     WHERE r.rolname = expected_role.rolname
  )

  UNION ALL

  -- 2b. Verify oracle_app role attributes: NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION LOGIN
  SELECT
    'role_attributes',
    r.rolname,
    'oracle_app must be NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION LOGIN'
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'oracle_app'
    AND (
      r.rolsuper
      OR r.rolinherit
      OR r.rolcreatedb
      OR r.rolcreaterole
      OR r.rolbypassrls
      OR r.rolreplication
      OR NOT r.rolcanlogin
    )

  UNION ALL

  -- 2c. Verify oracle_migrator role attributes: NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOLOGIN
  SELECT
    'role_attributes',
    r.rolname,
    'oracle_migrator must be NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOLOGIN in steady state'
  FROM pg_catalog.pg_roles AS r
  WHERE r.rolname = 'oracle_migrator'
    AND (
      r.rolsuper
      OR r.rolinherit
      OR r.rolcreatedb
      OR r.rolcreaterole
      OR r.rolcanlogin
    )

  UNION ALL

  -- 3a. Verify oracle_app has NO forbidden write privileges on ANY table/view/relation in oracle_ledger
  SELECT
    'oracle_app_forbidden_table_priv',
    n.nspname || '.' || c.relname,
    'oracle_app has forbidden effective privilege ' || ftp.priv
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN forbidden_table_privs AS ftp
  WHERE n.nspname = 'oracle_ledger'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND pg_catalog.has_table_privilege('oracle_app', c.oid, ftp.priv)

  UNION ALL

  -- 3b. Verify oracle_app has NO privileges on any sequence in oracle_ledger
  SELECT
    'oracle_app_forbidden_sequence_priv',
    n.nspname || '.' || c.relname,
    'oracle_app has forbidden effective sequence privilege ' || sp.priv
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS sp(priv)
  WHERE n.nspname = 'oracle_ledger'
    AND c.relkind = 'S'
    AND pg_catalog.has_sequence_privilege('oracle_app', c.oid, sp.priv)

  UNION ALL

  -- 4. Verify oracle_app HAS effective SELECT privilege on all three required ledger tables
  SELECT
    'oracle_app_missing_select_priv',
    rt.qualified_name,
    'oracle_app is missing required SELECT privilege'
  FROM required_ledger_tables AS rt
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = rt.schema_name
       AND c.relname = rt.rel_name
       AND c.relkind = 'r'
       AND pg_catalog.has_table_privilege('oracle_app', c.oid, 'SELECT')
  )

  UNION ALL

  -- 5. Verify PUBLIC (grantee = 0::oid) has NO SELECT or write privileges on ANY relation in oracle_ledger
  --    via catalog ACL inspection (aclexplode + acldefault)
  SELECT
    'public_forbidden_table_acl',
    n.nspname || '.' || c.relname,
    'PUBLIC (grantee OID 0) has forbidden relation privilege ' || acl.privilege_type
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      c.relacl,
      pg_catalog.acldefault(
        CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
        c.relowner
      )
    )
  ) AS acl
  WHERE n.nspname = 'oracle_ledger'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND acl.grantee = 0::oid
    AND acl.privilege_type IN (
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'TRIGGER',
      'REFERENCES',
      'USAGE'
    )

  UNION ALL

  -- 6a. Verify oracle_app schema privileges via has_schema_privilege (no CREATE on oracle_ledger or public; USAGE on oracle_ledger)
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

  -- 6b. Verify PUBLIC (grantee = 0::oid) schema privileges on oracle_ledger (no CREATE/USAGE) and public (no CREATE)
  --     via catalog ACL inspection (aclexplode + acldefault('n', nspowner))
  SELECT
    'public_schema_acl',
    n.nspname,
    'PUBLIC (grantee OID 0) has forbidden ' || acl.privilege_type || ' privilege on schema ' || n.nspname
  FROM pg_catalog.pg_namespace AS n
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))
  ) AS acl
  WHERE acl.grantee = 0::oid
    AND (
      (n.nspname = 'oracle_ledger' AND acl.privilege_type IN ('CREATE', 'USAGE'))
      OR (n.nspname = 'public' AND acl.privilege_type = 'CREATE')
    )

  UNION ALL

  -- 7a. Verify oracle_migrator owns schema oracle_ledger
  SELECT
    'required_schema_ownership',
    'oracle_ledger',
    'schema oracle_ledger is missing or not owned by oracle_migrator'
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS n
      JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
     WHERE n.nspname = 'oracle_ledger'
       AND r.rolname = 'oracle_migrator'
  )

  UNION ALL

  -- 7b. Verify oracle_migrator owns all three required ledger tables
  SELECT
    'required_table_ownership',
    rt.qualified_name,
    'required ledger table ' || rt.qualified_name || ' is missing or not owned by oracle_migrator'
  FROM required_ledger_tables AS rt
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_roles AS r ON r.oid = c.relowner
     WHERE n.nspname = rt.schema_name
       AND c.relname = rt.rel_name
       AND c.relkind = 'r'
       AND r.rolname = 'oracle_migrator'
  )

  UNION ALL

  -- 7c. Verify oracle_migrator owns all seven expected functions in oracle_ledger by exact signature
  SELECT
    'required_function_ownership',
    ef.fn_sig,
    'required function ' || ef.fn_sig || ' is missing or not owned by oracle_migrator'
  FROM expected_ledger_functions AS ef
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
     WHERE p.oid = pg_catalog.to_regprocedure(ef.fn_sig)
       AND r.rolname = 'oracle_migrator'
  )

  UNION ALL

  -- 7d. Verify oracle_app owns zero schemas, relations, or functions
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
    p.oid::pg_catalog.regprocedure::text,
    'oracle_app must not own any function or procedure'
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE r.rolname = 'oracle_app'

  UNION ALL

  -- 8. Verify oracle_app has EXECUTE on all three approved SECURITY DEFINER functions by exact signature.
  --    Resolve each approved function once through pg_catalog.to_regprocedure(ef.fn_sig) via a LEFT JOIN
  --    to pg_catalog.pg_proc and call pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')
  --    with the resolved OID (never the potentially nonexistent signature string ef.fn_sig) so a missing
  --    function emits oracle_app_missing_approved_execute instead of raising a signature-lookup error.
  SELECT
    'oracle_app_missing_approved_execute',
    ef.fn_sig,
    'oracle_app is missing EXECUTE privilege on approved function ' || ef.fn_sig
  FROM expected_ledger_functions AS ef
  LEFT JOIN pg_catalog.pg_proc AS p
    ON p.oid = pg_catalog.to_regprocedure(ef.fn_sig)
  WHERE ef.is_approved_for_app
    AND (
      p.oid IS NULL
      OR NOT pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')
    )

  UNION ALL

  -- 9. Verify oracle_app CANNOT execute any unapproved or trigger function in oracle_ledger (by exact OID/signature)
  SELECT
    'oracle_app_unapproved_function_execute',
    p.oid::pg_catalog.regprocedure::text,
    'oracle_app has forbidden EXECUTE privilege on unapproved function ' || p.oid::pg_catalog.regprocedure::text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'oracle_ledger'
    AND NOT EXISTS (
      SELECT 1
        FROM expected_ledger_functions AS ef
       WHERE ef.is_approved_for_app
         AND p.oid = pg_catalog.to_regprocedure(ef.fn_sig)
    )
    AND pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')

  UNION ALL

  -- 10. Verify PUBLIC (grantee = 0::oid) CANNOT execute ANY function in oracle_ledger
  --     via catalog ACL inspection (aclexplode + acldefault('f', proowner))
  SELECT
    'public_function_acl',
    p.oid::pg_catalog.regprocedure::text,
    'PUBLIC (grantee OID 0) has forbidden EXECUTE privilege on function ' || p.oid::pg_catalog.regprocedure::text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) AS acl
  WHERE n.nspname = 'oracle_ledger'
    AND acl.grantee = 0::oid
    AND acl.privilege_type = 'EXECUTE'
)
SELECT
  check_category,
  object_name,
  violation_detail
FROM effective_privilege_violations;
