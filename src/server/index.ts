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
}
