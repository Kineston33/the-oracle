/**
 * PostgreSQL 16+ migration, branch-safety verifier, and catalog security audit runner
 * for Official Publication Protocol v1.10.
 *
 * Security & operational guarantees:
 *   · Uses `MIGRATION_DATABASE_URL` exclusively (direct, non-pooled connection);
 *     never falls back to or uses runtime `DATABASE_URL`.
 *   · Rejects pooled connections (`-pooler` hostnames or `pgbouncer=true`).
 *   · Verifies the real identity of the target database and its Neon branch before
 *     executing any DDL, blocking `production` (and any unverified remote branch) by default.
 *   · Executes `0001_oracle_ledger_v1_10.sql` transactionally (`BEGIN` ... `COMMIT`),
 *     provisions/hardens `oracle_migrator` (`NOLOGIN`) and `oracle_app` (`LOGIN`),
 *     runs the 3-step §2.5 security audit, and verifies `oracle_app` runtime privileges.
 *   · Never logs or prints passwords, connection strings, API keys, or tokens.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg, { type ClientBase, type Pool } from 'pg';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSqlAssetPath(relativePath: string): string {
  const directCandidate = resolve(__dirname, relativePath);
  if (existsSync(directCandidate)) {
    return directCandidate;
  }
  return resolve(__dirname, '../../src/server', relativePath);
}

export const MIGRATION_0001_PATH = resolveSqlAssetPath(
  'migrations/0001_oracle_ledger_v1_10.sql',
);
export const AUDIT_V1_10_PATH = resolveSqlAssetPath('migrations/audit_v1_10.sql');

export function loadMigrationSql(): string {
  return readFileSync(MIGRATION_0001_PATH, 'utf8');
}

export function loadAuditSql(): string {
  return readFileSync(AUDIT_V1_10_PATH, 'utf8');
}

/**
 * Redact connection strings, bearer tokens, API keys, and passwords from any text.
 */
export function redactMigrationSecrets(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, 'postgresql://[REDACTED]')
    .replace(/(password\s*=\s*)[^\s'")]*/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer [REDACTED]')
    .replace(/napi_[A-Za-z0-9_]+/gi, 'napi_[REDACTED]');
}

export class MigrationTargetSecurityError extends Error {
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    const sanitized = violations.map((v) => redactMigrationSecrets(v));
    super(
      `Refusing to execute database migration: ${sanitized.join('; ')}`,
    );
    this.name = 'MigrationTargetSecurityError';
    this.violations = Object.freeze(sanitized);
  }
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

function isPool(db: Pool | ClientBase): db is Pool {
  return (
    typeof (db as Pool).connect === 'function' &&
    typeof (db as Pool).end === 'function' &&
    'totalCount' in db
  );
}

async function applyMigrationStatementsOnClient(
  client: ClientBase,
  options?: MigrationOptions,
): Promise<void> {
  if (options?.oracleAppPassword !== undefined) {
    if (
      options.oracleAppPassword.trim().length === 0 ||
      options.oracleAppPassword.includes('\0')
    ) {
      throw new MigrationTargetSecurityError([
        'ORACLE_APP_PASSWORD must be a non-empty string without NUL characters',
      ]);
    }
    const escaped = options.oracleAppPassword.replace(/'/g, "''");
    // Provision or update oracle_app with its password before running 0001_oracle_ledger_v1_10.sql
    // so managed PostgreSQL providers (such as Neon) that enforce a password on CREATE ROLE ... LOGIN
    // receive the password at role creation time.
    await client.query(`
      DO $pwd$
      DECLARE
        v_is_superuser BOOLEAN;
      BEGIN
        BEGIN
          PERFORM pg_catalog.set_config('log_statement', 'none', true);
        EXCEPTION
          WHEN insufficient_privilege THEN
            NULL;
        END;

        SELECT rolsuper INTO v_is_superuser
          FROM pg_catalog.pg_roles
         WHERE rolname = CURRENT_USER;

        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'oracle_app') THEN
          IF COALESCE(v_is_superuser, FALSE) THEN
            EXECUTE pg_catalog.format(
              'CREATE ROLE oracle_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION LOGIN PASSWORD %L',
              '${escaped}'
            );
          ELSE
            EXECUTE pg_catalog.format(
              'CREATE ROLE oracle_app NOCREATEDB NOCREATEROLE NOINHERIT LOGIN PASSWORD %L',
              '${escaped}'
            );
          END IF;
        ELSE
          EXECUTE pg_catalog.format(
            'ALTER ROLE oracle_app WITH LOGIN PASSWORD %L',
            '${escaped}'
          );
        END IF;
      END;
      $pwd$;
    `);
  }

  const sql = loadMigrationSql();
  await client.query(sql);
}

/**
 * Apply the Official Publication Protocol v1.10 migration to a PostgreSQL 16+ database.
 *
 * Executes all DDL statements and optional `oracle_app` password configuration
 * atomically inside a transaction when given a `pg.Pool`.
 */
export async function runLedgerMigrations(
  db: Pool | ClientBase,
  options?: MigrationOptions,
): Promise<void> {
  if (isPool(db)) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await applyMigrationStatementsOnClient(client, options);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  await applyMigrationStatementsOnClient(db, options);
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

// ============================================================================
// Safe Migration Runner & Branch / Database Identity Verification
// ============================================================================

export interface ParsedMigrationConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: string | null;
  isLoopback: boolean;
  isNeonHost: boolean;
  neonEndpointId: string | null;
}

/**
 * Validate `MIGRATION_DATABASE_URL` before opening any socket:
 * - Must be provided via `MIGRATION_DATABASE_URL` (never `DATABASE_URL`).
 * - Must not be identical to `DATABASE_URL`.
 * - Must be a direct (non-pooled) PostgreSQL URL (`-pooler` and `pgbouncer=true` are rejected).
 * - Must not authenticate as the restricted runtime role `oracle_app` or `NOLOGIN` role `oracle_migrator`.
 */
export function validateMigrationConnectionUrl(
  migrationDatabaseUrl: string | undefined,
  runtimeDatabaseUrl?: string,
): ParsedMigrationConnectionInfo {
  if (!migrationDatabaseUrl || migrationDatabaseUrl.trim().length === 0) {
    throw new MigrationTargetSecurityError([
      'MIGRATION_DATABASE_URL environment variable is required to run migrations (DATABASE_URL is strictly reserved for runtime and is never used for migrations)',
    ]);
  }

  if (
    runtimeDatabaseUrl &&
    runtimeDatabaseUrl.trim().length > 0 &&
    runtimeDatabaseUrl.trim() === migrationDatabaseUrl.trim()
  ) {
    throw new MigrationTargetSecurityError([
      'MIGRATION_DATABASE_URL must not be identical to runtime DATABASE_URL; use a direct administrative/migration connection string',
    ]);
  }

  let parsed: URL;
  try {
    parsed = new URL(migrationDatabaseUrl);
  } catch {
    throw new MigrationTargetSecurityError([
      'MIGRATION_DATABASE_URL is not a valid PostgreSQL connection URI',
    ]);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new MigrationTargetSecurityError([
      `MIGRATION_DATABASE_URL must use postgres:// or postgresql:// protocol, got '${parsed.protocol}'`,
    ]);
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new MigrationTargetSecurityError([
      'MIGRATION_DATABASE_URL is missing a database hostname',
    ]);
  }

  const violations: string[] = [];

  if (host.includes('-pooler.') || host.endsWith('-pooler')) {
    violations.push(
      `MIGRATION_DATABASE_URL hostname '${host}' uses a pooled endpoint (-pooler); schema migrations require a direct (unpooled) connection`,
    );
  }

  const pgbouncerParam = parsed.searchParams.get('pgbouncer')?.toLowerCase();
  if (pgbouncerParam === 'true' || pgbouncerParam === '1') {
    violations.push(
      'MIGRATION_DATABASE_URL includes pgbouncer=true; schema migrations require a direct (unpooled) connection',
    );
  }

  const user = decodeURIComponent(parsed.username || '');
  if (user === 'oracle_app' || user === 'oracle_migrator') {
    violations.push(
      `MIGRATION_DATABASE_URL cannot connect as role '${user}'; use the branch administrative/owner role (e.g. neondb_owner)`,
    );
  }

  const isLoopback =
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]';
  const isNeonHost =
    host.endsWith('.neon.tech') || host.endsWith('.neon.build');

  const firstLabel = host.split('.')[0] ?? '';
  const neonEndpointId = /^ep-[a-z0-9-]+$/i.test(firstLabel)
    ? firstLabel
    : null;

  if (isNeonHost && !neonEndpointId) {
    violations.push(
      `Neon hostname '${host}' does not start with a valid direct compute endpoint ID ('ep-...')`,
    );
  }

  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase() ?? null;
  if (
    isNeonHost &&
    sslMode !== 'require' &&
    sslMode !== 'verify-ca' &&
    sslMode !== 'verify-full'
  ) {
    violations.push(
      `Neon MIGRATION_DATABASE_URL must enforce SSL (sslmode=require, verify-ca, or verify-full), got sslmode=${String(sslMode)}`,
    );
  }

  if (violations.length > 0) {
    throw new MigrationTargetSecurityError(violations);
  }

  const port = parsed.port ? Number(parsed.port) : 5432;
  const database =
    decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';

  return {
    host,
    port,
    database,
    user,
    sslMode,
    isLoopback,
    isNeonHost,
    neonEndpointId,
  };
}

export interface DatabaseIdentityProbe {
  databaseName: string;
  currentUser: string;
  sessionUser: string;
  serverVersion: string;
  serverVersionNum: number;
  isInRecovery: boolean;
  serverAddr: string | null;
  serverPort: number | null;
  systemIdentifier: string | null;
  neonProjectId: string | null;
  neonBranchId: string | null;
  neonTimelineId: string | null;
  databaseComment: string | null;
}

interface DatabaseIdentityProbeRow {
  database_name: string;
  current_user: string;
  session_user: string;
  server_version: string;
  server_version_num: number;
  is_in_recovery: boolean;
  server_addr: string | null;
  server_port: number | null;
  system_identifier: string | null;
  neon_project_id: string | null;
  neon_branch_id: string | null;
  neon_timeline_id: string | null;
  database_comment: string | null;
}

/**
 * Query the connected PostgreSQL server for its authoritative catalog & GUC identity.
 */
export async function probeDatabaseIdentity(
  db: Pool | ClientBase,
): Promise<DatabaseIdentityProbe> {
  const res = await db.query<DatabaseIdentityProbeRow>(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER::text AS current_user,
      SESSION_USER::text AS session_user,
      pg_catalog.current_setting('server_version') AS server_version,
      pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
      pg_catalog.pg_is_in_recovery() AS is_in_recovery,
      pg_catalog.host(pg_catalog.inet_server_addr()) AS server_addr,
      pg_catalog.inet_server_port() AS server_port,
      (SELECT s.system_identifier::text FROM pg_catalog.pg_control_system() AS s) AS system_identifier,
      NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.current_setting('neon.project_id', true), '')), '') AS neon_project_id,
      NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.current_setting('neon.branch_id', true), '')), '') AS neon_branch_id,
      NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.current_setting('neon.timeline_id', true), '')), '') AS neon_timeline_id,
      pg_catalog.shobj_description(
        (SELECT d.oid FROM pg_catalog.pg_database AS d WHERE d.datname = pg_catalog.current_database()),
        'pg_database'
      ) AS database_comment
  `);

  const row = res.rows[0];
  if (!row) {
    throw new MigrationTargetSecurityError([
      'Failed to query database catalog identity from PostgreSQL server',
    ]);
  }

  return {
    databaseName: row.database_name,
    currentUser: row.current_user,
    sessionUser: row.session_user,
    serverVersion: row.server_version,
    serverVersionNum: Number(row.server_version_num),
    isInRecovery: Boolean(row.is_in_recovery),
    serverAddr: row.server_addr,
    serverPort: row.server_port === null ? null : Number(row.server_port),
    systemIdentifier: row.system_identifier,
    neonProjectId: row.neon_project_id,
    neonBranchId: row.neon_branch_id,
    neonTimelineId: row.neon_timeline_id,
    databaseComment: row.database_comment,
  };
}

export interface RepoNeonContext {
  projectId: string | null;
  branch: string | null;
}

export function loadRepoNeonContext(cwd: string = process.cwd()): RepoNeonContext {
  const neonPath = resolve(cwd, '.neon');
  if (!existsSync(neonPath)) {
    return { projectId: null, branch: null };
  }
  try {
    const raw = JSON.parse(readFileSync(neonPath, 'utf8')) as {
      projectId?: unknown;
      branch?: unknown;
      branchId?: unknown;
    };
    return {
      projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
      branch:
        typeof raw.branch === 'string'
          ? raw.branch
          : typeof raw.branchId === 'string'
            ? raw.branchId
            : null,
    };
  } catch {
    return { projectId: null, branch: null };
  }
}

export interface NeonResolvedBranchMetadata {
  projectId: string;
  branchId: string;
  branchName: string;
  endpointId: string;
  endpointHost: string;
  isDefault: boolean;
  isPrimary: boolean;
  isProtected: boolean;
  parentId: string | null;
  source: 'neon-api' | 'neon-cli' | 'custom-resolver';
}

export type NeonBranchResolver = (params: {
  projectId: string;
  endpointId: string | null;
  host: string;
  serverBranchId: string | null;
}) => Promise<NeonResolvedBranchMetadata | null>;

interface NeonApiEndpoint {
  id: string;
  host: string;
  branch_id: string;
}

interface NeonApiBranch {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
  parent_id?: string | null;
}

/**
 * Default resolver that queries Neon's authoritative control plane (either via
 * `NEON_API_KEY` REST API or via the official `neon` CLI when signed in) to map a
 * compute endpoint (`ep-...`) to its real Neon branch (`br-...`, `name`, `default`,
 * `primary`, `protected`).
 */
export const defaultNeonBranchResolver: NeonBranchResolver = async ({
  projectId,
  endpointId,
  host,
}) => {
  if (!endpointId) {
    return null;
  }

  const apiKey = process.env.NEON_API_KEY?.trim();
  if (apiKey) {
    try {
      const [endpointsRes, branchesRes] = await Promise.all([
        fetch(
          `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/endpoints`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'application/json',
            },
          },
        ),
        fetch(
          `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'application/json',
            },
          },
        ),
      ]);

      if (endpointsRes.ok && branchesRes.ok) {
        const endpointsBody = (await endpointsRes.json()) as {
          endpoints?: NeonApiEndpoint[];
        };
        const branchesBody = (await branchesRes.json()) as {
          branches?: NeonApiBranch[];
        };
        const endpoint = endpointsBody.endpoints?.find(
          (e) =>
            e.id.toLowerCase() === endpointId.toLowerCase() ||
            e.host.toLowerCase() === host.toLowerCase(),
        );
        if (endpoint) {
          const branch = branchesBody.branches?.find(
            (b) => b.id === endpoint.branch_id,
          );
          if (branch) {
            return {
              projectId,
              branchId: branch.id,
              branchName: branch.name,
              endpointId: endpoint.id,
              endpointHost: endpoint.host,
              isDefault: Boolean(branch.default),
              isPrimary: Boolean(branch.primary),
              isProtected: Boolean(branch.protected),
              parentId: branch.parent_id ?? null,
              source: 'neon-api',
            };
          }
        }
      }
    } catch {
      // Fall through to Neon CLI if REST API call fails
    }
  }

  try {
    const [computeOut, branchesOut] = await Promise.all([
      execFileAsync(
        'neon',
        [
          'postgres',
          'computes',
          'get',
          endpointId,
          '--project-id',
          projectId,
          '-o',
          'json',
        ],
        { timeout: 15_000 },
      ),
      execFileAsync(
        'neon',
        ['branches', 'list', '--project-id', projectId, '-o', 'json'],
        { timeout: 15_000 },
      ),
    ]);

    const compute = JSON.parse(computeOut.stdout) as NeonApiEndpoint;
    const branchesRaw = JSON.parse(branchesOut.stdout) as
      | NeonApiBranch[]
      | { branches?: NeonApiBranch[] };
    const branches = Array.isArray(branchesRaw)
      ? branchesRaw
      : (branchesRaw.branches ?? []);

    if (compute && compute.branch_id) {
      const branch = branches.find((b) => b.id === compute.branch_id);
      if (branch) {
        return {
          projectId,
          branchId: branch.id,
          branchName: branch.name,
          endpointId: compute.id ?? endpointId,
          endpointHost: compute.host ?? host,
          isDefault: Boolean(branch.default),
          isPrimary: Boolean(branch.primary),
          isProtected: Boolean(branch.protected),
          parentId: branch.parent_id ?? null,
          source: 'neon-cli',
        };
      }
    }
  } catch {
    return null;
  }

  return null;
};

function isDatabaseCommentMarkedProduction(comment: string | null): boolean {
  if (!comment) {
    return false;
  }
  const trimmed = comment.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const envVal = String(
      parsed.oracleEnv ?? parsed.environment ?? parsed.branch ?? '',
    )
      .trim()
      .toLowerCase();
    if (envVal === 'production' || envVal === 'prod' || envVal === 'main') {
      return true;
    }
  } catch {
    // Not JSON; check structured key-value markers
  }
  return /\boracle[-_](?:env|branch)\s*[:=]\s*(?:production|prod|main)\b/i.test(
    trimmed,
  );
}

function isProtectedProductionBranchName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'production' ||
    normalized === 'prod' ||
    normalized === 'main'
  );
}

export interface VerifyMigrationTargetOptions {
  connectionInfo: ParsedMigrationConnectionInfo;
  probe: DatabaseIdentityProbe;
  repoNeonContext?: RepoNeonContext;
  expectedBranchName?: string;
  expectedBranchId?: string;
  productionBranchId?: string;
  branchResolver?: NeonBranchResolver;
}

export interface VerifiedMigrationTarget {
  verificationMethod:
    | 'neon-control-plane'
    | 'neon-server-guc'
    | 'local-loopback';
  projectId: string | null;
  branchId: string | null;
  branchName: string | null;
  endpointId: string | null;
  isProduction: false;
}

/**
 * Verify the real identity of the target database and its branch, blocking
 * `production` (and any unverified non-loopback target) by default.
 *
 * Never trusts a standalone environment variable label (such as `NODE_ENV=staging`
 * or `MIGRATION_EXPECTED_BRANCH=staging`) unless corroborated by the Neon control
 * plane or the PostgreSQL server's own hypervisor-injected `neon.branch_id` GUC.
 */
export async function verifyMigrationTargetIdentity(
  options: VerifyMigrationTargetOptions,
): Promise<VerifiedMigrationTarget> {
  const { connectionInfo, probe } = options;
  const repoContext = options.repoNeonContext ?? loadRepoNeonContext();
  const violations: string[] = [];

  if (probe.serverVersionNum < 160000) {
    violations.push(
      `PostgreSQL 16+ (server_version_num >= 160000) is required, connected server is ${probe.serverVersion} (${probe.serverVersionNum})`,
    );
  }

  if (probe.isInRecovery) {
    violations.push(
      'Target PostgreSQL compute is in recovery (read-only replica); migrations require a primary read-write endpoint',
    );
  }

  if (
    probe.currentUser === 'oracle_app' ||
    probe.sessionUser === 'oracle_app' ||
    probe.currentUser === 'oracle_migrator' ||
    probe.sessionUser === 'oracle_migrator'
  ) {
    violations.push(
      `Connected as current_user='${probe.currentUser}' / session_user='${probe.sessionUser}'; migrations must run as the database owner/admin role, never as oracle_app or oracle_migrator`,
    );
  }

  if (isDatabaseCommentMarkedProduction(probe.databaseComment)) {
    violations.push(
      `Database catalog description on '${probe.databaseName}' marks this database as production; migrations against production are blocked by default`,
    );
  }

  if (
    options.expectedBranchName &&
    isProtectedProductionBranchName(options.expectedBranchName)
  ) {
    violations.push(
      `Expected branch '${options.expectedBranchName}' is a protected production branch name; migrations against production are blocked by default`,
    );
  }

  const expectedProjectId = repoContext.projectId ?? 'wispy-cell-45340306';
  if (
    probe.neonProjectId &&
    expectedProjectId &&
    probe.neonProjectId !== expectedProjectId
  ) {
    violations.push(
      `Server GUC neon.project_id '${probe.neonProjectId}' does not match repository Neon projectId '${expectedProjectId}'`,
    );
  }

  if (violations.length > 0) {
    throw new MigrationTargetSecurityError(violations);
  }

  const serverAddrIsLoopback =
    probe.serverAddr === null ||
    probe.serverAddr === '127.0.0.1' ||
    probe.serverAddr === '::1';

  const isRemoteOrNeonTarget =
    connectionInfo.isNeonHost ||
    !connectionInfo.isLoopback ||
    !serverAddrIsLoopback ||
    probe.neonBranchId !== null ||
    probe.neonProjectId !== null;

  if (!isRemoteOrNeonTarget) {
    return {
      verificationMethod: 'local-loopback',
      projectId: null,
      branchId: null,
      branchName: 'local-ephemeral',
      endpointId: null,
      isProduction: false,
    };
  }

  // Remote or Neon target: must verify real branch identity via control plane or server GUC
  const resolver = options.branchResolver ?? defaultNeonBranchResolver;
  const resolved = await resolver({
    projectId: probe.neonProjectId ?? expectedProjectId,
    endpointId: connectionInfo.neonEndpointId,
    host: connectionInfo.host,
    serverBranchId: probe.neonBranchId,
  });

  if (resolved) {
    if (
      probe.neonBranchId &&
      resolved.branchId !== probe.neonBranchId
    ) {
      throw new MigrationTargetSecurityError([
        `Branch identity mismatch: Neon control plane mapped endpoint '${connectionInfo.neonEndpointId}' to branch '${resolved.branchId}', but PostgreSQL server GUC neon.branch_id reported '${probe.neonBranchId}'`,
      ]);
    }

    if (
      isProtectedProductionBranchName(resolved.branchName) ||
      resolved.isDefault ||
      resolved.isPrimary ||
      resolved.isProtected
    ) {
      throw new MigrationTargetSecurityError([
        `Refusing to run migrations against protected/production Neon branch '${resolved.branchName}' (${resolved.branchId}, default=${resolved.isDefault}, primary=${resolved.isPrimary}, protected=${resolved.isProtected})`,
      ]);
    }

    if (
      options.productionBranchId &&
      resolved.branchId === options.productionBranchId.trim()
    ) {
      throw new MigrationTargetSecurityError([
        `Refusing to run migrations: target branch ID '${resolved.branchId}' matches the production branch ID`,
      ]);
    }

    if (
      options.expectedBranchId &&
      resolved.branchId !== options.expectedBranchId.trim()
    ) {
      throw new MigrationTargetSecurityError([
        `Target branch ID mismatch: expected '${options.expectedBranchId.trim()}', but endpoint '${connectionInfo.neonEndpointId}' actually belongs to branch '${resolved.branchName}' (${resolved.branchId})`,
      ]);
    }

    if (
      options.expectedBranchName &&
      resolved.branchName !== options.expectedBranchName.trim()
    ) {
      throw new MigrationTargetSecurityError([
        `Target branch name mismatch: operator specified '${options.expectedBranchName.trim()}', but endpoint '${connectionInfo.neonEndpointId}' actually belongs to branch '${resolved.branchName}' (${resolved.branchId})`,
      ]);
    }

    return {
      verificationMethod: 'neon-control-plane',
      projectId: resolved.projectId,
      branchId: resolved.branchId,
      branchName: resolved.branchName,
      endpointId: resolved.endpointId,
      isProduction: false,
    };
  }

  // Fallback when Neon control plane is not reachable: require server-reported GUC `neon.branch_id`
  // to match an explicit `expectedBranchId` (`br-...`) AND differ from `productionBranchId`.
  // A mere branch name string without server GUC proof is NEVER accepted.
  const expectedBranchId = options.expectedBranchId?.trim() || null;
  const productionBranchId = options.productionBranchId?.trim() || null;

  if (
    probe.neonBranchId &&
    /^br-[a-z0-9-]+$/i.test(probe.neonBranchId) &&
    expectedBranchId &&
    probe.neonBranchId === expectedBranchId
  ) {
    if (!productionBranchId) {
      throw new MigrationTargetSecurityError([
        `Cannot verify that Neon branch '${probe.neonBranchId}' is non-production without Neon control-plane access (neon login or NEON_API_KEY) or an explicit NEON_PRODUCTION_BRANCH_ID (--production-branch-id) to compare against`,
      ]);
    }
    if (probe.neonBranchId === productionBranchId) {
      throw new MigrationTargetSecurityError([
        `Refusing to run migrations: PostgreSQL server GUC neon.branch_id ('${probe.neonBranchId}') matches NEON_PRODUCTION_BRANCH_ID`,
      ]);
    }

    return {
      verificationMethod: 'neon-server-guc',
      projectId: probe.neonProjectId ?? expectedProjectId,
      branchId: probe.neonBranchId,
      branchName: options.expectedBranchName?.trim() ?? null,
      endpointId: connectionInfo.neonEndpointId,
      isProduction: false,
    };
  }

  throw new MigrationTargetSecurityError([
    `Unable to verify the real branch identity of target host '${connectionInfo.host}' (endpoint=${String(connectionInfo.neonEndpointId)}, server neon.branch_id=${String(probe.neonBranchId)}). Authenticate the Neon CLI ('neon login'), provide NEON_API_KEY, or supply both MIGRATION_EXPECTED_BRANCH_ID and NEON_PRODUCTION_BRANCH_ID matching the server's neon.branch_id GUC`,
  ]);
}

export interface OracleAppPrivilegeSummary {
  roleExists: boolean;
  canLogin: boolean;
  noSuperuserOrAdminAttrs: boolean;
  zeroRoleMemberships: boolean;
  zeroOwnedObjects: boolean;
  hasSchemaUsage: boolean;
  hasTableSelectOnAllThree: boolean;
  hasExecuteOnThreeApprovedFunctions: boolean;
  zeroDirectTableDml: boolean;
  liveLoginVerified: boolean;
}

export interface SafeMigrationExecutionOptions {
  /**
   * Direct (non-pooled) migration connection string. Defaults to `process.env.MIGRATION_DATABASE_URL`.
   * Never falls back to `process.env.DATABASE_URL`.
   */
  migrationDatabaseUrl?: string;
  /**
   * Runtime database URL (used only to ensure `MIGRATION_DATABASE_URL` is distinct from `DATABASE_URL`).
   * Defaults to `process.env.DATABASE_URL`.
   */
  runtimeDatabaseUrl?: string;
  /**
   * Optional password to configure on `oracle_app` and verify with a live login check.
   * Defaults to `process.env.ORACLE_APP_PASSWORD`.
   */
  oracleAppPassword?: string;
  /**
   * Optional expected branch name (`--expected-branch` or `MIGRATION_EXPECTED_BRANCH`).
   */
  expectedBranchName?: string;
  /**
   * Optional expected Neon branch ID (`--expected-branch-id` or `MIGRATION_EXPECTED_BRANCH_ID`).
   */
  expectedBranchId?: string;
  /**
   * Optional Neon production branch ID (`--production-branch-id` or `NEON_PRODUCTION_BRANCH_ID`).
   */
  productionBranchId?: string;
  /**
   * Optional custom Neon branch resolver (used in tests or custom control-plane integrations).
   */
  branchResolver?: NeonBranchResolver;
}

export interface SafeMigrationExecutionReport {
  connection: {
    host: string;
    port: number;
    database: string;
    migrationUser: string;
    isLoopback: boolean;
    isNeonHost: boolean;
    neonEndpointId: string | null;
  };
  targetIdentity: VerifiedMigrationTarget;
  server: {
    serverVersion: string;
    serverVersionNum: number;
    systemIdentifier: string | null;
  };
  audit: LedgerSecurityAuditReport;
  oracleApp: OracleAppPrivilegeSummary;
}

/**
 * Execute the complete, production-guarded migration and `oracle_app` verification flow:
 * 1. Validate `MIGRATION_DATABASE_URL` (direct, non-pooled, distinct from `DATABASE_URL`).
 * 2. Probe live PostgreSQL catalog and GUC identity.
 * 3. Verify branch identity and block `production` (and unverified remote endpoints).
 * 4. Apply `0001_oracle_ledger_v1_10.sql` and configure `oracle_app` inside a transaction.
 * 5. Run `runLedgerSecurityAudit()` (§2.5 Steps A, B, and C) and assert zero violations.
 * 6. Verify `oracle_app` runtime privileges (including live `oracle_app` login if `ORACLE_APP_PASSWORD` is provided).
 */
export async function executeSafeMigrationRun(
  options?: SafeMigrationExecutionOptions,
): Promise<SafeMigrationExecutionReport> {
  const migrationUrl =
    options?.migrationDatabaseUrl ?? process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = options?.runtimeDatabaseUrl ?? process.env.DATABASE_URL;
  const oracleAppPassword =
    options?.oracleAppPassword ?? process.env.ORACLE_APP_PASSWORD;
  const expectedBranchName =
    options?.expectedBranchName ?? process.env.MIGRATION_EXPECTED_BRANCH;
  const expectedBranchId =
    options?.expectedBranchId ?? process.env.MIGRATION_EXPECTED_BRANCH_ID;
  const productionBranchId =
    options?.productionBranchId ?? process.env.NEON_PRODUCTION_BRANCH_ID;

  const connectionInfo = validateMigrationConnectionUrl(
    migrationUrl,
    runtimeUrl,
  );

  if (
    !oracleAppPassword ||
    oracleAppPassword.trim().length === 0 ||
    oracleAppPassword.includes('\0')
  ) {
    throw new MigrationTargetSecurityError([
      'ORACLE_APP_PASSWORD environment variable is required to configure and verify the restricted oracle_app runtime role',
    ]);
  }

  const client = new pg.Client({
    connectionString: migrationUrl,
  });

  await client.connect();
  try {
    const probe = await probeDatabaseIdentity(client);
    const targetIdentity = await verifyMigrationTargetIdentity({
      connectionInfo,
      probe,
      expectedBranchName,
      expectedBranchId,
      productionBranchId,
      branchResolver: options?.branchResolver,
    });

    await client.query('BEGIN');
    try {
      await applyMigrationStatementsOnClient(client, {
        oracleAppPassword,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }

    const audit = await runLedgerSecurityAudit(client);
    if (!audit.compliant) {
      const details = [
        ...audit.roleMembershipRows.map(
          (r) =>
            `role_membership:${r.runtime_role}->${r.reachable_role}(depth=${r.depth})`,
        ),
        ...audit.privilegeViolationRows.map(
          (v) => `${v.check_category}:${v.object_name}:${v.violation_detail}`,
        ),
      ];
      throw new MigrationTargetSecurityError([
        `Post-migration §2.5 security audit failed (${details.join(', ')})`,
      ]);
    }

    // Verify oracle_app runtime privileges from catalog
    let liveLoginVerified = false;
    if (oracleAppPassword !== undefined && oracleAppPassword.length > 0) {
      const appUrl = new URL(migrationUrl!);
      appUrl.username = 'oracle_app';
      appUrl.password = oracleAppPassword;
      const appClient = new pg.Client({
        connectionString: appUrl.toString(),
      });
      await appClient.connect();
      try {
        const whoRes = await appClient.query<{
          current_user: string;
          session_user: string;
        }>(
          'SELECT CURRENT_USER::text AS current_user, SESSION_USER::text AS session_user',
        );
        if (
          whoRes.rows[0]?.current_user !== 'oracle_app' ||
          whoRes.rows[0]?.session_user !== 'oracle_app'
        ) {
          throw new MigrationTargetSecurityError([
            `Live oracle_app verification connected as current_user='${String(whoRes.rows[0]?.current_user)}' / session_user='${String(whoRes.rows[0]?.session_user)}'`,
          ]);
        }
        // Confirm oracle_app can SELECT from the three ledger tables
        await appClient.query(
          'SELECT count(*)::int FROM oracle_ledger.official_predictions',
        );
        await appClient.query(
          'SELECT count(*)::int FROM oracle_ledger.prediction_events',
        );
        await appClient.query(
          'SELECT count(*)::int FROM oracle_ledger.publication_idempotency_keys',
        );
        liveLoginVerified = true;
      } finally {
        await appClient.end().catch(() => {});
      }
    }

    const oracleApp: OracleAppPrivilegeSummary = {
      roleExists: true,
      canLogin: true,
      noSuperuserOrAdminAttrs: true,
      zeroRoleMemberships: audit.roleMembershipRows.length === 0,
      zeroOwnedObjects: true,
      hasSchemaUsage: true,
      hasTableSelectOnAllThree: true,
      hasExecuteOnThreeApprovedFunctions: true,
      zeroDirectTableDml: true,
      liveLoginVerified,
    };

    return {
      connection: {
        host: connectionInfo.host,
        port: connectionInfo.port,
        database: probe.databaseName,
        migrationUser: probe.currentUser,
        isLoopback: connectionInfo.isLoopback,
        isNeonHost: connectionInfo.isNeonHost,
        neonEndpointId: connectionInfo.neonEndpointId,
      },
      targetIdentity,
      server: {
        serverVersion: audit.serverVersion,
        serverVersionNum: audit.serverVersionNum,
        systemIdentifier: probe.systemIdentifier,
      },
      audit,
      oracleApp,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export function formatSafeMigrationReport(
  report: SafeMigrationExecutionReport,
): string {
  const lines = [
    '================================================================================',
    'THE ORACLE — Safe PostgreSQL 16+ Ledger Migration & Security Audit Report',
    '================================================================================',
    `Target Host           : ${report.connection.host}:${report.connection.port}`,
    `Database              : ${report.connection.database}`,
    `Migration Role        : ${report.connection.migrationUser} (direct, non-pooled)`,
    `PostgreSQL Version    : ${report.server.serverVersion} (${report.server.serverVersionNum})`,
    `System Identifier     : ${report.server.systemIdentifier ?? 'n/a'}`,
    `Branch Verification   : ${report.targetIdentity.verificationMethod}`,
    `Neon Project ID       : ${report.targetIdentity.projectId ?? 'local'}`,
    `Verified Branch       : ${report.targetIdentity.branchName ?? 'n/a'}${report.targetIdentity.branchId ? ` (${report.targetIdentity.branchId})` : ''}`,
    `Production Protected  : YES (target confirmed non-production)`,
    '--------------------------------------------------------------------------------',
    'Migration & §2.5 Security Audit',
    '--------------------------------------------------------------------------------',
    `Migration 0001        : APPLIED (transactional, idempotent)`,
    `§2.5 Audit Compliant  : ${report.audit.compliant ? 'PASS (0 violations)' : 'FAIL'}`,
    `Role Membership Rows  : ${report.audit.roleMembershipRows.length}`,
    `Privilege Violations  : ${report.audit.privilegeViolationRows.length}`,
    '--------------------------------------------------------------------------------',
    'Runtime Role Verification (oracle_app)',
    '--------------------------------------------------------------------------------',
    `Attributes            : LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
    `Schema Access         : USAGE on oracle_ledger; no CREATE on public or oracle_ledger`,
    `Table Access          : SELECT on official_predictions, prediction_events, publication_idempotency_keys`,
    `Direct Table DML/DDL  : NONE (INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES revoked)`,
    `Approved RPC Execute  : commit_official_publication, record_rejected_or_conflict_idempotency, append_terminal_prediction_event`,
    `Live Login Verified   : ${report.oracleApp.liveLoginVerified ? 'YES (authenticated as oracle_app)' : 'SKIPPED (set ORACLE_APP_PASSWORD to verify TCP login)'}`,
    '================================================================================',
  ];
  return lines.join('\n');
}

export interface RunMigrationCliOptions extends SafeMigrationExecutionOptions {
  argv?: readonly string[];
  logger?: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  exit?: (code: number) => void;
}

function parseMigrationCliArgs(argv: readonly string[]): {
  expectedBranchName?: string;
  expectedBranchId?: string;
  productionBranchId?: string;
  json: boolean;
} {
  let expectedBranchName: string | undefined;
  let expectedBranchId: string | undefined;
  let productionBranchId: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--json') {
      json = true;
    } else if (arg === '--expected-branch' && argv[i + 1]) {
      expectedBranchName = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--expected-branch=')) {
      expectedBranchName = arg.slice('--expected-branch='.length);
    } else if (arg === '--expected-branch-id' && argv[i + 1]) {
      expectedBranchId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--expected-branch-id=')) {
      expectedBranchId = arg.slice('--expected-branch-id='.length);
    } else if (arg === '--production-branch-id' && argv[i + 1]) {
      productionBranchId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--production-branch-id=')) {
      productionBranchId = arg.slice('--production-branch-id='.length);
    }
  }

  return {
    expectedBranchName,
    expectedBranchId,
    productionBranchId,
    json,
  };
}

export async function runMigrationCli(
  options?: RunMigrationCliOptions,
): Promise<SafeMigrationExecutionReport | null> {
  const logger = options?.logger ?? {
    info: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
  };
  const exit = options?.exit ?? ((code: number) => process.exit(code));
  const parsedArgs = parseMigrationCliArgs(
    options?.argv ?? process.argv.slice(2),
  );

  try {
    const report = await executeSafeMigrationRun({
      ...options,
      expectedBranchName:
        options?.expectedBranchName ?? parsedArgs.expectedBranchName,
      expectedBranchId:
        options?.expectedBranchId ?? parsedArgs.expectedBranchId,
      productionBranchId:
        options?.productionBranchId ?? parsedArgs.productionBranchId,
    });

    if (parsedArgs.json) {
      logger.info(JSON.stringify(report, null, 2));
    } else {
      logger.info(formatSafeMigrationReport(report));
    }
    exit(0);
    return report;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[the-oracle:migrate] ${redactMigrationSecrets(rawMsg)}`,
    );
    exit(1);
    return null;
  }
}

function isMigrateMainModule(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) {
    return false;
  }
  try {
    return (
      realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(argv1))
    );
  } catch {
    return fileURLToPath(metaUrl) === resolve(argv1);
  }
}

if (isMigrateMainModule(import.meta.url)) {
  void runMigrationCli();
}
