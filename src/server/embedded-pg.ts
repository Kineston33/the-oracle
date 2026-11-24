/**
 * Real PostgreSQL 16 server harness for integration tests.
 *
 * Uses the native Linux x64 PostgreSQL 16 binaries (`initdb`, `pg_ctl`, `postgres`)
 * from `@embedded-postgres/linux-x64` (or system `initdb`/`pg_ctl` when present)
 * to initialize a real on-disk `PGDATA` cluster, start a real `postgres` server
 * process, restart the server process across the same `PGDATA` directory to test
 * crash/restart durability, and tear down cleanly.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface EmbeddedPostgresCluster {
  readonly port: number;
  readonly workDir: string;
  readonly dataDir: string;
  readonly adminConnectionString: string;
  readonly appConnectionString: string;
  /** Stop and restart the real `postgres` OS process against the same `PGDATA` directory. */
  restart: () => Promise<void>;
  /** Stop the `postgres` server and delete the temporary `PGDATA` directory. */
  stop: () => Promise<void>;
}

async function allocateFreeTcpPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function resolvePostgresBinaries(): Promise<{
  initdb: string;
  pg_ctl: string;
}> {
  try {
    const mod = (await import('@embedded-postgres/linux-x64')) as {
      initdb: string;
      pg_ctl: string;
    };
    return { initdb: mod.initdb, pg_ctl: mod.pg_ctl };
  } catch {
    return { initdb: 'initdb', pg_ctl: 'pg_ctl' };
  }
}

export async function startEmbeddedPostgres16(): Promise<EmbeddedPostgresCluster> {
  const { initdb, pg_ctl } = await resolvePostgresBinaries();
  const port = await allocateFreeTcpPort();
  const workDir = mkdtempSync(join(tmpdir(), 'oracle-pg16-'));
  const dataDir = join(workDir, 'data');
  const logFile = join(workDir, 'postgres.log');
  const pgOptions = `-p ${port} -k ${workDir} -h 127.0.0.1`;

  execFileSync(
    initdb,
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
    { stdio: 'pipe' },
  );

  execFileSync(
    pg_ctl,
    ['-D', dataDir, '-l', logFile, '-o', pgOptions, '-w', 'start'],
    { stdio: 'pipe' },
  );

  let stopped = false;

  return {
    port,
    workDir,
    dataDir,
    adminConnectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    appConnectionString: `postgresql://oracle_app@127.0.0.1:${port}/postgres`,
    restart: async () => {
      execFileSync(pg_ctl, ['-D', dataDir, '-m', 'fast', '-w', 'stop'], {
        stdio: 'pipe',
      });
      execFileSync(
        pg_ctl,
        ['-D', dataDir, '-l', logFile, '-o', pgOptions, '-w', 'start'],
        { stdio: 'pipe' },
      );
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        execFileSync(pg_ctl, ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], {
          stdio: 'pipe',
        });
      } catch {
        // Ignore if already stopped
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
}
