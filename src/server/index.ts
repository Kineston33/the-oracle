/**
 * Server entrypoint and database pool factory for THE ORACLE (Phase 2A).
 *
 * Reads `DATABASE_URL` from `process.env` — credentials are never hardcoded in
 * source files or exposed to browser bundles.
 */

import { existsSync, realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createOracleApiServer } from './api.ts';
import { PostgresPublicationRegistry } from './postgres-registry.ts';

export {
  createOracleApiServer,
  handleOracleApiRequest,
  type OracleApiServerDeps,
} from './api.ts';
export {
  DEFAULT_ALIAS_ENTRIES,
  DEFAULT_ALIAS_TABLE,
  resolveCanonicalQuestion,
  type CanonicalQuestionResolution,
  type ResolveCanonicalQuestionOptions,
} from '../data/question-resolver.ts';
export {
  AUDIT_V1_10_PATH,
  MIGRATION_0001_PATH,
  MigrationTargetSecurityError,
  PRODUCTION_CONFIRMATION_PHRASE,
  PRODUCTION_MIGRATION_ROLE,
  ROLE_MEMBERSHIP_AUDIT_SQL,
  defaultNeonBranchResolver,
  executeSafeMigrationRun,
  formatSafeMigrationReport,
  isMigrateMainModule,
  loadAuditSql,
  loadMigrationSql,
  loadRepoNeonContext,
  parseMigrationCliArgs,
  probeDatabaseIdentity,
  provisionOracleAppPasswordSafely,
  redactMigrationSecrets,
  runLedgerMigrations,
  runLedgerSecurityAudit,
  runMigrationCli,
  validateMigrationConnectionUrl,
  verifyMigrationTargetIdentity,
  type DatabaseIdentityProbe,
  type LedgerSecurityAuditReport,
  type MigrationOptions,
  type NeonBranchResolver,
  type NeonResolvedBranchMetadata,
  type OracleAppPrivilegeSummary,
  type ParsedMigrationConnectionInfo,
  type PrivilegeViolationRow,
  type ProductionMigrationAuthorization,
  type RepoNeonContext,
  type RoleMembershipViolationRow,
  type RunMigrationCliOptions,
  type SafeMigrationExecutionOptions,
  type SafeMigrationExecutionReport,
  type VerifiedMigrationTarget,
  type VerifyMigrationTargetOptions,
} from './migrate.ts';
export {
  PostgresPublicationRegistry,
  type AppendResolutionEventInput,
  type PostgresPublicationRegistryOptions,
  type PredictionEventsVerification,
} from './postgres-registry.ts';
export {
  DEFAULT_CREDIBLE_INTERVAL_LEVEL,
  EXECUTABLE_SCIENTIFIC_METHOD_IDS,
  MAX_CERTIFIED_SHAPE_PARAMETER,
  METHOD_EXECUTION_VERSION,
  MIN_CERTIFIED_SHAPE_PARAMETER,
  UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS,
  UnimplementedScientificMethodError,
  executeBetaBinomialConjugate,
  executeDirichletMultinomialSymmetry,
  executePoissonGammaHazard,
  executeScientificMethod,
  executeStructuralUniformBaseline,
  executeWeightedKishEffectiveBinomial,
  type BetaBinomialExecutionInput,
  type DirichletMultinomialExecutionInput,
  type ExecutableScientificMethodId,
  type PoissonGammaExecutionInput,
  type ScientificMethodExecutionInput,
  type StructuralUniformExecutionInput,
  type UnimplementedMethodExecutionInput,
  type UnimplementedScientificMethodId,
  type WeightedKishExecutionInput,
} from './method-execution.ts';
export {
  EVIDENCE_DRIVEN_FOOTING_TIERS,
  FORECAST_SYNTHESIS_VERSION,
  INDEPENDENCE_CERTIFICATION_VERIFICATION_STATUSES,
  assertCanonicalOutcomeSpaceEquality,
  computeDependenceAwareMethodWeights,
  synthesizeForecastDistribution,
  validateStatisticalIndependenceCertification,
  type CertifiedIndependenceRelationship,
  type CertifiedIndependentMethodGroup,
  type ForecastSynthesisInput,
  type IndependenceCertificationValidationContext,
  type IndependenceCertificationVerificationStatus,
  type StatisticalIndependenceCertification,
} from './forecast-synthesis.ts';

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
  /**
   * Optional high-entropy bearer token (`ORACLE_PUBLICATION_TOKEN`) authorizing
   * trusted server-side calls to `POST /v1/publications` and
   * `POST /v1/predictions/:id/events`.
   */
  publicationToken?: string;
  /**
   * Directory containing compiled frontend assets (`dist/`). Defaults to
   * `resolve(process.cwd(), 'dist')` if `dist/index.html` exists. Pass `null`
   * to disable static SPA serving.
   */
  staticDir?: string | null;
  /**
   * Optional explicit CORS origin (defaults to same-origin only; no
   * `Access-Control-Allow-Origin` header is emitted unless a specific
   * non-wildcard origin is configured via `corsOrigin` or `ORACLE_CORS_ORIGIN`).
   */
  corsOrigin?: string;
  /**
   * Optional trusted server-side clock provider returning UTC ISO-8601 timestamps.
   * Defaults to the monotonic system wall clock on the server.
   */
  now?: () => string;
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

    const defaultDistDir = resolve(process.cwd(), 'dist');
    const resolvedStaticDir =
      options?.staticDir !== undefined
        ? options.staticDir
        : existsSync(resolve(defaultDistDir, 'index.html'))
          ? defaultDistDir
          : null;

    const registry = new PostgresPublicationRegistry({ pool });
    const server = createOracleApiServer({
      registry,
      publicationToken: options?.publicationToken,
      staticDir: resolvedStaticDir,
      corsOrigin: options?.corsOrigin,
      now: options?.now,
    });
    const host = options?.host ?? process.env.HOST ?? '0.0.0.0';
    const requestedPort = options?.port ?? Number(process.env.PORT ?? 3001);
    if (
      !Number.isInteger(requestedPort) ||
      requestedPort < 0 ||
      requestedPort > 65535
    ) {
      throw new Error(
        `Invalid server port: expected an integer between 0 and 65535, got ${String(options?.port ?? process.env.PORT)}`,
      );
    }

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

    let closePromise: Promise<void> | null = null;
    const close = (): Promise<void> => {
      if (!closePromise) {
        closePromise = (async () => {
          await new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
          await pool.end();
        })();
      }
      return closePromise;
    };

    return {
      server,
      pool,
      registry,
      port: boundPort,
      close,
    };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}

/**
 * Redact connection strings and password tokens from any log or error text so
 * credentials can never leak to stdout/stderr.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, 'postgresql://[REDACTED]')
    .replace(/(password\s*=\s*)[^\s'")]*/gi, '$1[REDACTED]');
}

export interface RunOracleServerCliOptions extends StartOracleServerOptions {
  logger?: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  exit?: (code: number) => void;
  signalTarget?: Pick<NodeJS.Process, 'once' | 'removeListener'>;
}

export interface RunningOracleServerCli {
  running: RunningOracleServer;
  shutdown: (signal?: NodeJS.Signals) => Promise<void>;
}

/**
 * Production CLI runner for the Node.js read API server.
 *
 * - Connects using `DATABASE_URL`
 * - Enforces `verifyRuntimeDatabaseRole()` before listening (via `startOracleServer()`)
 * - Never executes administrative migrations at runtime
 * - Registers graceful `SIGTERM` and `SIGINT` handlers that close the HTTP server and pool
 * - Redacts any connection string or credential from startup/shutdown logs
 */
export async function runOracleServerCli(
  options?: RunOracleServerCliOptions,
): Promise<RunningOracleServerCli | null> {
  const logger = options?.logger ?? {
    info: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
  };
  const exit = options?.exit ?? ((code: number) => process.exit(code));
  const signalTarget = options?.signalTarget ?? process;
  const host = options?.host ?? process.env.HOST ?? '0.0.0.0';

  try {
    const running = await startOracleServer(options);
    logger.info(
      `[the-oracle] Read API server listening on http://${host}:${running.port} (runtime role: oracle_app)`,
    );

    let shuttingDown: Promise<void> | null = null;

    const onSigTerm = () => {
      void shutdown('SIGTERM');
    };
    const onSigInt = () => {
      void shutdown('SIGINT');
    };

    const removeSignalHandlers = () => {
      signalTarget.removeListener('SIGTERM', onSigTerm);
      signalTarget.removeListener('SIGINT', onSigInt);
    };

    const shutdown = (signal?: NodeJS.Signals): Promise<void> => {
      if (!shuttingDown) {
        shuttingDown = (async () => {
          removeSignalHandlers();
          if (signal) {
            logger.info(
              `[the-oracle] Received ${signal}, closing HTTP server and PostgreSQL pool...`,
            );
          }
          try {
            await running.close();
            logger.info('[the-oracle] Server and database pool closed cleanly.');
            exit(0);
          } catch (closeErr) {
            const rawMsg =
              closeErr instanceof Error ? closeErr.message : String(closeErr);
            logger.error(
              `[the-oracle] Error while closing server: ${redactSecrets(rawMsg)}`,
            );
            exit(1);
          }
        })();
      }
      return shuttingDown;
    };

    signalTarget.once('SIGTERM', onSigTerm);
    signalTarget.once('SIGINT', onSigInt);

    return {
      running,
      shutdown,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[the-oracle] Failed to start server: ${redactSecrets(rawMsg)}`,
    );
    exit(1);
    return null;
  }
}

export function isMainModule(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) {
    return false;
  }
  const resolvedArgv = resolve(argv1);
  if (/^migrate\.[cm]?[jt]s$/i.test(basename(resolvedArgv))) {
    return false;
  }
  const metaPath = fileURLToPath(metaUrl);
  try {
    return realpathSync(metaPath) === realpathSync(resolvedArgv);
  } catch {
    return metaPath === resolvedArgv;
  }
}

if (isMainModule(import.meta.url)) {
  void runOracleServerCli();
}
