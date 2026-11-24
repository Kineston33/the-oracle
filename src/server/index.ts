/**
 * Server entrypoint and database pool factory for THE ORACLE (Phase 2A).
 *
 * Reads `DATABASE_URL` from `process.env` — credentials are never hardcoded in
 * source files or exposed to browser bundles.
 */

import type { Server } from 'node:http';
import pg from 'pg';
import { createOracleApiServer } from './api.ts';
import { PostgresPublicationRegistry } from './postgres-registry.ts';

export { createOracleApiServer, handleOracleApiRequest } from './api.ts';
export {
  AUDIT_V1_10_PATH,
  MIGRATION_0001_PATH,
  ROLE_MEMBERSHIP_AUDIT_SQL,
  loadAuditSql,
  loadMigrationSql,
  runLedgerMigrations,
  runLedgerSecurityAudit,
  type LedgerSecurityAuditReport,
  type MigrationOptions,
  type PrivilegeViolationRow,
  type RoleMembershipViolationRow,
} from './migrate.ts';
export {
  PostgresPublicationRegistry,
  type AppendResolutionEventInput,
  type PostgresPublicationRegistryOptions,
  type PredictionEventsVerification,
} from './postgres-registry.ts';

export interface StartOracleServerOptions {
  /**
   * PostgreSQL connection URI. Defaults to `process.env.DATABASE_URL`.
   * Must be supplied via environment variable or caller configuration; never hardcoded.
   */
  databaseUrl?: string;
  /** TCP port to listen on. Defaults to `Number(process.env.PORT ?? 3001)`. */
  port?: number;
  /** Host interface to bind. Defaults to `'0.0.0.0'`. */
  host?: string;
}

export interface RunningOracleServer {
  server: Server;
  pool: pg.Pool;
  registry: PostgresPublicationRegistry;
  port: number;
  close: () => Promise<void>;
}

export class RuntimeRoleSecurityError extends Error {
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(
      `Refusing to start Oracle server: DATABASE_URL role violates least-privilege runtime requirements (${violations.join('; ')})`,
    );
    this.name = 'RuntimeRoleSecurityError';
    this.violations = Object.freeze([...violations]);
  }
}

interface RuntimeRoleCheckRow {
  current_user: string;
  session_user: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
  rolreplication: boolean;
  has_role_memberships: boolean;
  owns_ledger_objects: boolean;
  has_schema_create: boolean;
  has_direct_table_dml: boolean;
}

/**
 * Verify that the database connection pool is authenticated as the restricted
 * `oracle_app` runtime role and holds no superuser, administrative, ownership,
 * role-membership, or direct table-write privileges.
 *
 * Never logs or includes `DATABASE_URL` or credentials in any error message.
 */
export async function verifyRuntimeDatabaseRole(
  db: pg.Pool | pg.ClientBase,
): Promise<void> {
  const res = await db.query<RuntimeRoleCheckRow>(`
    SELECT
      CURRENT_USER::text AS current_user,
      SESSION_USER::text AS session_user,
      r.rolsuper AS rolsuper,
      r.rolinherit AS rolinherit,
      r.rolcreatedb AS rolcreatedb,
      r.rolcreaterole AS rolcreaterole,
      r.rolbypassrls AS rolbypassrls,
      r.rolreplication AS rolreplication,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members AS m
         WHERE m.member = r.oid
      ) AS has_role_memberships,
      (
        EXISTS (
          SELECT 1
            FROM pg_catalog.pg_namespace AS n
           WHERE n.nspname = 'oracle_ledger'
             AND n.nspowner = r.oid
        )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.pg_class AS c
            JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
           WHERE n.nspname = 'oracle_ledger'
             AND c.relowner = r.oid
        )
      ) AS owns_ledger_objects,
      (
        pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')
        OR (
          pg_catalog.to_regnamespace('oracle_ledger') IS NOT NULL
          AND pg_catalog.has_schema_privilege(r.oid, 'oracle_ledger', 'CREATE')
        )
      ) AS has_schema_create,
      (
        pg_catalog.to_regclass('oracle_ledger.official_predictions') IS NOT NULL
        AND (
          pg_catalog.has_table_privilege(
            r.oid,
            'oracle_ledger.official_predictions',
            'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
          )
          OR pg_catalog.has_table_privilege(
            r.oid,
            'oracle_ledger.prediction_events',
            'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
          )
          OR pg_catalog.has_table_privilege(
            r.oid,
            'oracle_ledger.publication_idempotency_keys',
            'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
          )
        )
      ) AS has_direct_table_dml
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = CURRENT_USER
  `);

  const row = res.rows[0];
  if (!row) {
    throw new RuntimeRoleSecurityError([
      'unable to resolve current_user in pg_catalog.pg_roles',
    ]);
  }

  const violations: string[] = [];

  if (row.current_user !== 'oracle_app' || row.session_user !== 'oracle_app') {
    violations.push(
      `connected as current_user='${row.current_user}' / session_user='${row.session_user}' instead of restricted runtime role 'oracle_app'`,
    );
  }
  if (row.rolsuper) {
    violations.push(`role '${row.current_user}' has SUPERUSER attribute`);
  }
  if (row.rolinherit) {
    violations.push(`role '${row.current_user}' has INHERIT attribute`);
  }
  if (row.rolcreatedb) {
    violations.push(`role '${row.current_user}' has CREATEDB attribute`);
  }
  if (row.rolcreaterole) {
    violations.push(`role '${row.current_user}' has CREATEROLE attribute`);
  }
  if (row.rolbypassrls) {
    violations.push(`role '${row.current_user}' has BYPASSRLS attribute`);
  }
  if (row.rolreplication) {
    violations.push(`role '${row.current_user}' has REPLICATION attribute`);
  }
  if (row.has_role_memberships) {
    violations.push(
      `role '${row.current_user}' holds forbidden role memberships in pg_auth_members`,
    );
  }
  if (row.owns_ledger_objects) {
    violations.push(
      `role '${row.current_user}' owns oracle_ledger schema or objects`,
    );
  }
  if (row.has_schema_create) {
    violations.push(
      `role '${row.current_user}' has forbidden CREATE privilege on public or oracle_ledger schema`,
    );
  }
  if (row.has_direct_table_dml) {
    violations.push(
      `role '${row.current_user}' has forbidden direct DML/DDL privileges on oracle_ledger tables`,
    );
  }

  if (violations.length > 0) {
    throw new RuntimeRoleSecurityError(violations);
  }
}

export function createDatabasePoolFromEnv(databaseUrl?: string): pg.Pool {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim().length === 0) {
    throw new Error(
      'DATABASE_URL environment variable is required to connect to PostgreSQL.',
    );
  }
  return new pg.Pool({
    connectionString,
    max: 10,
  });
}

export async function startOracleServer(
  options?: StartOracleServerOptions,
): Promise<RunningOracleServer> {
  const pool = createDatabasePoolFromEnv(options?.databaseUrl);
  try {
    await verifyRuntimeDatabaseRole(pool);

    const registry = new PostgresPublicationRegistry({ pool });
    const server = createOracleApiServer({ registry });
    const host = options?.host ?? '0.0.0.0';
    const requestedPort = options?.port ?? Number(process.env.PORT ?? 3001);

    const boundPort = await new Promise<number>((resolvePort, rejectPort) => {
      server.once('error', rejectPort);
      server.listen(requestedPort, host, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolvePort(addr.port);
        } else {
          resolvePort(requestedPort);
        }
      });
    });

    return {
      server,
      pool,
      registry,
      port: boundPort,
      close: async () => {
        await new Promise<void>((res, rej) => {
          server.close((err) => (err ? rej(err) : res()));
        });
        await pool.end();
      },
    };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}
