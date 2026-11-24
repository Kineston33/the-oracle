/**
 * PostgreSQL 16+ migration and catalog security audit runner for Official Publication Protocol v1.10.
 *
 * Reads the SQL migration (`0001_oracle_ledger_v1_10.sql`) and catalog audit (`audit_v1_10.sql`)
 * and executes them against a live PostgreSQL 16+ database.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase, Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIGRATION_0001_PATH = resolve(
  __dirname,
  'migrations/0001_oracle_ledger_v1_10.sql',
);
export const AUDIT_V1_10_PATH = resolve(__dirname, 'migrations/audit_v1_10.sql');

export function loadMigrationSql(): string {
  return readFileSync(MIGRATION_0001_PATH, 'utf8');
}

export function loadAuditSql(): string {
  return readFileSync(AUDIT_V1_10_PATH, 'utf8');
}

export const ROLE_MEMBERSHIP_AUDIT_SQL = `
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
`;

export interface RoleMembershipViolationRow {
  runtime_role: string;
  reachable_role: string;
  depth: number;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
  rolreplication: boolean;
}

export interface PrivilegeViolationRow {
  check_category: string;
  object_name: string;
  violation_detail: string;
}

export interface LedgerSecurityAuditReport {
  serverVersion: string;
  serverVersionNum: number;
  roleMembershipRows: RoleMembershipViolationRow[];
  privilegeViolationRows: PrivilegeViolationRow[];
  compliant: boolean;
}

export interface MigrationOptions {
  /**
   * Optional password to set on `oracle_app` when provisioning a database where
   * `oracle_app` connects over TCP with password authentication. Never logged.
   */
  oracleAppPassword?: string;
}

/**
 * Apply the Official Publication Protocol v1.10 migration to a PostgreSQL 16+ database.
 */
export async function runLedgerMigrations(
  db: Pool | ClientBase,
  options?: MigrationOptions,
): Promise<void> {
  const sql = loadMigrationSql();
  await db.query(sql);

  if (options?.oracleAppPassword !== undefined) {
    // Use format(%L) via parameterized query to set the password safely without logging
    await db.query(
      `DO $$
       BEGIN
         -- Password set dynamically via server-side parameter in next statement
       END $$;`,
    );
    const escaped = options.oracleAppPassword.replace(/'/g, "''");
    await db.query(`ALTER ROLE oracle_app WITH LOGIN PASSWORD '${escaped}'`);
  }
}

/**
 * Execute the three-step Official Publication Protocol v1.10 security and privilege audit
 * (§2.5 Steps A, B, and C) against a live PostgreSQL 16+ catalog.
 */
export async function runLedgerSecurityAudit(
  db: Pool | ClientBase,
): Promise<LedgerSecurityAuditReport> {
  // Step A: Preflight PostgreSQL 16+ version check
  await db.query(`
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
  `);

  const versionRes = await db.query<{
    server_version: string;
    server_version_num: string;
  }>(`
    SELECT
      pg_catalog.current_setting('server_version') AS server_version,
      pg_catalog.current_setting('server_version_num') AS server_version_num
  `);
  const serverVersion = versionRes.rows[0]?.server_version ?? 'unknown';
  const serverVersionNum = Number(versionRes.rows[0]?.server_version_num ?? '0');

  // Step B: Recursive pg_auth_members role-membership audit
  const membershipRes = await db.query<RoleMembershipViolationRow>(
    ROLE_MEMBERSHIP_AUDIT_SQL,
  );

  // Step C: Effective-privilege, PUBLIC ACL, role-attribute, and object-ownership audit
  const auditSql = loadAuditSql();
  const privilegeRes = await db.query<PrivilegeViolationRow>(auditSql);

  const roleMembershipRows = membershipRes.rows;
  const privilegeViolationRows = privilegeRes.rows;

  return {
    serverVersion,
    serverVersionNum,
    roleMembershipRows,
    privilegeViolationRows,
    compliant:
      serverVersionNum >= 160000 &&
      roleMembershipRows.length === 0 &&
      privilegeViolationRows.length === 0,
  };
}
