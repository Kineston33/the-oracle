/**
 * Real PostgreSQL 16+ integration tests for THE ORACLE (Phase 2A — Official Publication Protocol v1.10).
 *
 * These tests run against a REAL PostgreSQL 16 server (`postgres (PostgreSQL) 16.16`
 * managed via `initdb` and `pg_ctl` on an on-disk `PGDATA` directory, plus any
 * external `TEST_DATABASE_ADMIN_URL` when provided in CI). No mocks or in-memory
 * fakes are used.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AliasTable,
  identityDigest,
} from '../data/canonical-identity.ts';
import { canonicalize, sealedPayload } from '../data/events.ts';
import { sha256Hex } from '../data/hash.ts';
import { deriveLifecycle } from '../data/lifecycle.ts';
import {
  buildSealedPredictionRecord,
  candidateContentDigest,
  publishCandidate,
  qualifyCandidate,
  validateOfficialRecord,
} from '../data/publication.ts';
import type {
  CandidateProposition,
  PropositionIdentity,
  PublicationRequest,
} from '../data/publication-types.ts';
import {
  startEmbeddedPostgres16,
  type EmbeddedPostgresCluster,
} from './embedded-pg.ts';
import {
  MigrationTargetSecurityError,
  PRODUCTION_CONFIRMATION_PHRASE,
  PRODUCTION_MIGRATION_ROLE,
  PostgresPublicationRegistry,
  RuntimeRoleSecurityError,
  defaultNeonBranchResolver,
  executeSafeMigrationRun,
  formatSafeMigrationReport,
  isMainModule,
  isMigrateMainModule,
  parseMigrationCliArgs,
  probeDatabaseIdentity,
  provisionOracleAppPasswordSafely,
  redactSecrets,
  runLedgerMigrations,
  runLedgerSecurityAudit,
  runMigrationCli,
  runOracleServerCli,
  startOracleServer,
  validateMigrationConnectionUrl,
  verifyMigrationTargetIdentity,
  verifyRuntimeDatabaseRole,
} from './index.ts';

function buildBaseIdentity(overrides?: Partial<PropositionIdentity>): PropositionIdentity {
  return {
    subject: { namespace: 'entity', id: 'argentina-central-bank' },
    event: { namespace: 'macro', id: 'annual-cpi-inflation' },
    condition: { namespace: 'threshold', id: 'below-25-percent' },
    geographicScope: { namespace: 'country', id: 'ar' },
    horizon: { namespace: 'period', id: 'calendar-year-2027' },
    resolutionDate: '2028-01-15T00:00:00.000Z',
    decidingAuthority: { namespace: 'agency', id: 'indec-ar' },
    ...overrides,
  };
}

function buildDraftCandidate(
  idSuffix: string,
  identityOverrides?: Partial<PropositionIdentity>,
  candidateOverrides?: Partial<CandidateProposition>,
): CandidateProposition {
  const proposedIdentity = buildBaseIdentity(identityOverrides);
  return {
    candidateId: `cand-${idSuffix}`,
    submittedQuery:
      'Will Argentina annual CPI inflation fall below 25% in calendar year 2027?',
    proposedQuestion:
      'Will Argentina annual CPI inflation for calendar year 2027 be strictly below 25.0% according to INDEC?',
    proposedIdentity,
    category: 'economy',
    probability: 0.62,
    rationale:
      'Sustained fiscal surplus and monetary base stabilization support disinflation below the 25% annual threshold.',
    horizon: {
      startsAt: '2027-01-01T00:00:00.000Z',
      endsAt: '2027-12-31T23:59:59.000Z',
      label: 'Calendar Year 2027',
    },
    resolutionCriteria: {
      rule: 'Official INDEC IPC Nacional December 2027 report < 25.0%.',
      authority: 'INDEC (Instituto Nacional de Estadística y Censos)',
      resolveOn: proposedIdentity.resolutionDate,
      edgeCases: ['If INDEC delays publication past 2028-01-15, use the first official release.'],
    },
    evidence: [
      {
        id: `ev-${idSuffix}-1`,
        title: 'INDEC National Consumer Price Index Methodology',
        publisher: 'INDEC',
        publishedAt: '2026-06-01T00:00:00.000Z',
        kind: 'official-record',
        note: 'Baseline reference series for national CPI.',
      },
    ],
    disclosedLimitations: [
      'Subject to exchange-rate regime shifts or regulated tariff adjustments during 2027.',
    ],
    inferences: [
      {
        component: 'falsifiability-review',
        value: 'Verified quantitative threshold (< 25.0%) against official INDEC release.',
        rule: 'falsifiability-review',
      },
    ],
    stage: 'exploratory-query',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...candidateOverrides,
  };
}

describe('Real PostgreSQL 16+ Integration Suite — Official Publication Protocol v1.10', () => {
  let cluster: EmbeddedPostgresCluster;
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let registry: PostgresPublicationRegistry;

  let clockCounter = 0;
  const nextTimestamp = (): string => {
    clockCounter += 1;
    const baseMs = Date.UTC(2026, 10, 20, 12, 0, 0, 0) + clockCounter * 1000;
    return new Date(baseMs).toISOString();
  };

  let idCounter = 100;
  const nextPredictionId = (): string => {
    idCounter += 1;
    return `ORC-2026-${String(idCounter).padStart(4, '0')}`;
  };

  beforeAll(async () => {
    cluster = await startEmbeddedPostgres16();
    adminPool = new pg.Pool({
      connectionString: cluster.adminConnectionString,
      max: 10,
    });

    // Apply v1.10 migrations on the real PostgreSQL 16 server
    await runLedgerMigrations(adminPool);

    // Connect runtime pool directly as the restricted `oracle_app` role
    appPool = new pg.Pool({
      connectionString: cluster.appConnectionString,
      max: 10,
    });
    registry = new PostgresPublicationRegistry({
      pool: appPool,
      now: nextTimestamp,
    });
  }, 60_000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (cluster) await cluster.stop();
  }, 30_000);

  it('1. verifies real PostgreSQL 16+ server version, idempotent migrations, and catalog objects', async () => {
    // Re-running migrations must be completely idempotent
    await runLedgerMigrations(adminPool);

    const verRes = await adminPool.query<{
      version: string;
      server_version_num: string;
    }>(`
      SELECT
        pg_catalog.version() AS version,
        pg_catalog.current_setting('server_version_num') AS server_version_num
    `);
    const versionNum = Number(verRes.rows[0]!.server_version_num);
    expect(versionNum).toBeGreaterThanOrEqual(160000);
    expect(verRes.rows[0]!.version).toMatch(/PostgreSQL 16\./);

    // Verify all 3 ledger tables exist in oracle_ledger and are owned by oracle_migrator
    const tablesRes = await adminPool.query<{
      relname: string;
      owner: string;
    }>(`
      SELECT c.relname, r.rolname AS owner
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_roles AS r ON r.oid = c.relowner
       WHERE n.nspname = 'oracle_ledger'
         AND c.relkind = 'r'
       ORDER BY c.relname ASC
    `);
    expect(tablesRes.rows).toEqual([
      { relname: 'official_predictions', owner: 'oracle_migrator' },
      { relname: 'prediction_events', owner: 'oracle_migrator' },
      { relname: 'publication_idempotency_keys', owner: 'oracle_migrator' },
    ]);

    // Verify all 6 triggers exist on the ledger tables
    const triggersRes = await adminPool.query<{ tgname: string }>(`
      SELECT t.tgname
        FROM pg_catalog.pg_trigger AS t
        JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'oracle_ledger'
         AND NOT t.tgisinternal
       ORDER BY t.tgname ASC
    `);
    expect(triggersRes.rows.map((r) => r.tgname)).toEqual([
      'official_predictions_append_only_trg',
      'official_predictions_no_truncate_trg',
      'prediction_events_append_only_trg',
      'prediction_events_no_truncate_trg',
      'publication_idempotency_immutability_trg',
      'publication_idempotency_no_truncate_trg',
      'publication_idempotency_outcome_complete_trg',
    ]);
  });

  it('2. passes the live PostgreSQL 16+ §2.5 security & privilege audit (Steps A, B, and C) and enforces oracle_app runtime restrictions', async () => {
    const audit = await runLedgerSecurityAudit(adminPool);
    expect(audit.serverVersionNum).toBeGreaterThanOrEqual(160000);
    expect(audit.roleMembershipRows).toEqual([]);
    expect(audit.privilegeViolationRows).toEqual([]);
    expect(audit.compliant).toBe(true);

    // Verify appPool is connected as the restricted oracle_app role
    const whoRes = await appPool.query<{
      current_user: string;
      session_user: string;
    }>('SELECT current_user, session_user');
    expect(whoRes.rows[0]).toEqual({
      current_user: 'oracle_app',
      session_user: 'oracle_app',
    });

    // Verify oracle_app cannot execute direct INSERT, UPDATE, DELETE, TRUNCATE, or DDL on any ledger table
    await expect(
      appPool.query(
        `INSERT INTO oracle_ledger.official_predictions (
           prediction_id, identity_digest, sealed_payload, payload_digest, published_at, recorded_at
         ) VALUES ('ORC-2026-9999', repeat('a', 64), '{}'::jsonb, repeat('b', 64), now(), now() + interval '1 second')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(
        `INSERT INTO oracle_ledger.prediction_events (
           prediction_id, seq, kind, occurred_at, recorded_at, envelope, digest, prev_digest
         ) VALUES ('ORC-2026-9999', 'e0', 'published', now(), now() + interval '1 second', '{}'::jsonb, repeat('a', 64), NULL)`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(
        `INSERT INTO oracle_ledger.publication_idempotency_keys (
           idempotency_key, request_digest, outcome, recorded_at
         ) VALUES ('direct-insert', repeat('a', 64), '{"kind":"rejected"}'::jsonb, now())`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(`UPDATE oracle_ledger.official_predictions SET payload_digest = repeat('c', 64)`),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(`DELETE FROM oracle_ledger.official_predictions`),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(`TRUNCATE oracle_ledger.official_predictions`),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      appPool.query(
        `ALTER TABLE oracle_ledger.official_predictions DISABLE TRIGGER official_predictions_append_only_trg`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Verify live audit detects a privilege regression (e.g., granting SELECT to PUBLIC) and recovers once revoked
    await adminPool.query(
      `GRANT SELECT ON TABLE oracle_ledger.official_predictions TO PUBLIC`,
    );
    try {
      const regressedAudit = await runLedgerSecurityAudit(adminPool);
      expect(regressedAudit.compliant).toBe(false);
      expect(regressedAudit.privilegeViolationRows).toContainEqual({
        check_category: 'public_forbidden_table_acl',
        object_name: 'oracle_ledger.official_predictions',
        violation_detail:
          'PUBLIC (grantee OID 0) has forbidden relation privilege SELECT',
      });
    } finally {
      await adminPool.query(
        `REVOKE SELECT ON TABLE oracle_ledger.official_predictions FROM PUBLIC`,
      );
    }

    const restoredAudit = await runLedgerSecurityAudit(adminPool);
    expect(restoredAudit.compliant).toBe(true);
  });

  it('3. commits a new official prediction atomically via SECURITY DEFINER and validates its sealed record', async () => {
    const draft = buildDraftCandidate('pub-1');
    const qualified = qualifyCandidate(draft);
    const candDigest = await candidateContentDigest(qualified);

    const request: PublicationRequest = {
      candidateId: qualified.candidateId,
      idempotencyKey: 'idem-pub-1',
      identity: qualified.proposedIdentity,
      candidateDigest: candDigest,
      requestedAt: nextTimestamp(),
    };

    const outcome = await publishCandidate(qualified, request, {
      registry,
      now: nextTimestamp,
      newPredictionId: () => 'ORC-2026-0101',
    });

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('Expected created outcome');

    expect(outcome.predictionId).toBe('ORC-2026-0101');
    expect(outcome.record.demo).toBe(false);
    expect(outcome.record.events).toHaveLength(1);
    expect(outcome.record.events[0]!.seq).toBe('e0');
    expect(outcome.record.events[0]!.kind).toBe('published');

    const validationProblems = await validateOfficialRecord(outcome.record);
    expect(validationProblems).toEqual([]);

    // Verify database state via registry read
    const loaded = await registry.getPredictionById('ORC-2026-0101');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('ORC-2026-0101');
    expect(loaded!.integrity.digest).toBe(outcome.record.integrity.digest);
  });

  it('4. handles duplicate canonical identities (including via alias resolution) by returning existing', async () => {
    const aliases = new AliasTable([
      {
        namespace: 'entity',
        canonical: 'argentina-central-bank',
        aliases: ['argentina-central-bank', 'bcra', 'central-bank-of-argentina'],
      },
    ]);

    const aliasedDraft = buildDraftCandidate(
      'pub-alias',
      {
        subject: { namespace: 'entity', id: 'bcra' },
      },
      {
        proposedQuestion:
          'Will BCRA / INDEC report Argentina annual CPI below 25.0% in 2027?',
        probability: 0.71,
      },
    );
    const qualified = qualifyCandidate(aliasedDraft, aliases);
    const candDigest = await candidateContentDigest(qualified, aliases);

    const request: PublicationRequest = {
      candidateId: qualified.candidateId,
      idempotencyKey: 'idem-pub-alias',
      identity: qualified.proposedIdentity,
      candidateDigest: candDigest,
      requestedAt: nextTimestamp(),
    };

    const outcome = await publishCandidate(qualified, request, {
      registry,
      aliases,
      now: nextTimestamp,
      newPredictionId: nextPredictionId,
    });

    expect(outcome.kind).toBe('existing');
    if (outcome.kind !== 'existing') throw new Error('Expected existing outcome');
    expect(outcome.predictionId).toBe('ORC-2026-0101');
    expect(outcome.record?.id).toBe('ORC-2026-0101');
    // Original winner's probability (0.62) is preserved, never overwritten by the duplicate (0.71)
    expect(outcome.record?.probability).toBe(0.62);
  });

  it('5. replays the original outcome on idempotent retry and rejects idempotency key misuse with idempotency-conflict', async () => {
    const draft = buildDraftCandidate('pub-1');
    const qualified = qualifyCandidate(draft);
    const candDigest = await candidateContentDigest(qualified);

    const originalRequest: PublicationRequest = {
      candidateId: qualified.candidateId,
      idempotencyKey: 'idem-pub-1',
      identity: qualified.proposedIdentity,
      candidateDigest: candDigest,
      requestedAt: nextTimestamp(),
    };

    // Exact replay with same idempotencyKey and identical content
    const replayOutcome = await publishCandidate(qualified, originalRequest, {
      registry,
      now: nextTimestamp,
      newPredictionId: nextPredictionId,
    });
    expect(replayOutcome.kind).toBe('replayed');
    if (replayOutcome.kind !== 'replayed') throw new Error('Expected replayed');
    expect(replayOutcome.original.kind).toBe('created');

    // Misuse of the same idempotencyKey with different candidate content (different probability)
    const modifiedDraft = buildDraftCandidate(
      'pub-1',
      undefined,
      { probability: 0.45 },
    );
    const modifiedQualified = qualifyCandidate(modifiedDraft);
    const modifiedCandDigest = await candidateContentDigest(modifiedQualified);

    const conflictingRequest: PublicationRequest = {
      candidateId: modifiedQualified.candidateId,
      idempotencyKey: 'idem-pub-1',
      identity: modifiedQualified.proposedIdentity,
      candidateDigest: modifiedCandDigest,
      requestedAt: nextTimestamp(),
    };

    const conflictOutcome = await publishCandidate(
      modifiedQualified,
      conflictingRequest,
      {
        registry,
        now: nextTimestamp,
        newPredictionId: nextPredictionId,
      },
    );
    expect(conflictOutcome.kind).toBe('idempotency-conflict');

    // Also verify rejected candidate consumes idempotencyKey in PostgreSQL without claiming identity
    const expiredHorizonDraft = buildDraftCandidate('pub-expired', {
      event: { namespace: 'macro', id: 'expired-horizon-event' },
    });
    const qualifiedBeforeExpiry = qualifyCandidate(expiredHorizonDraft, undefined, {
      publishedAt: '2026-11-01T00:00:00.000Z',
    });
    const expiredCandDigest = await candidateContentDigest(qualifiedBeforeExpiry);
    const expiredRequest: PublicationRequest = {
      candidateId: qualifiedBeforeExpiry.candidateId,
      idempotencyKey: 'idem-rejected-1',
      identity: qualifiedBeforeExpiry.proposedIdentity,
      candidateDigest: expiredCandDigest,
      requestedAt: '2028-01-01T00:00:00.000Z',
    };

    let expiredClockStep = 0;
    const postHorizonClock = () => {
      expiredClockStep += 1;
      return new Date(Date.UTC(2028, 0, 1, 0, 0, expiredClockStep)).toISOString();
    };

    const rejectedOutcome = await publishCandidate(
      qualifiedBeforeExpiry,
      expiredRequest,
      {
        registry,
        now: postHorizonClock,
        newPredictionId: nextPredictionId,
      },
    );
    expect(rejectedOutcome.kind).toBe('rejected');

    // Identity was NOT claimed in official_predictions
    const expIdentityDigest = await identityDigest(
      qualifiedBeforeExpiry.proposedIdentity,
    );
    expect(await registry.findByIdentity(expIdentityDigest)).toBeNull();

    // Replaying the rejected request with the same key replays the rejection
    const replayedRejection = await publishCandidate(
      qualifiedBeforeExpiry,
      expiredRequest,
      {
        registry,
        now: postHorizonClock,
        newPredictionId: nextPredictionId,
      },
    );
    expect(replayedRejection).toEqual({
      kind: 'replayed',
      original: rejectedOutcome,
    });
  });

  it('6. serializes concurrent publications for the same canonical identity across parallel PostgreSQL connections so exactly one wins', async () => {
    const sharedIdentityOverrides: Partial<PropositionIdentity> = {
      subject: { namespace: 'entity', id: 'brazil-central-bank' },
      event: { namespace: 'macro', id: 'selic-rate-target' },
      condition: { namespace: 'threshold', id: 'at-or-below-9-percent' },
      geographicScope: { namespace: 'country', id: 'br' },
    };

    const competitors = await Promise.all(
      Array.from({ length: 5 }, async (_, idx) => {
        const draft = buildDraftCandidate(`race-${idx + 1}`, sharedIdentityOverrides, {
          probability: 0.5 + idx * 0.05,
        });
        const qualified = qualifyCandidate(draft);
        const candDigest = await candidateContentDigest(qualified);
        const request: PublicationRequest = {
          candidateId: qualified.candidateId,
          idempotencyKey: `idem-race-key-${idx + 1}`,
          identity: qualified.proposedIdentity,
          candidateDigest: candDigest,
          requestedAt: nextTimestamp(),
        };
        return {
          qualified,
          request,
          assignedId: `ORC-2026-020${idx + 1}`,
        };
      }),
    );

    const outcomes = await Promise.all(
      competitors.map((c) =>
        publishCandidate(c.qualified, c.request, {
          registry,
          now: nextTimestamp,
          newPredictionId: () => c.assignedId,
        }),
      ),
    );

    const createdOutcomes = outcomes.filter((o) => o.kind === 'created');
    const existingOutcomes = outcomes.filter((o) => o.kind === 'existing');

    expect(createdOutcomes).toHaveLength(1);
    expect(existingOutcomes).toHaveLength(4);

    const winningId =
      createdOutcomes[0]!.kind === 'created' ? createdOutcomes[0]!.predictionId : '';
    for (const ex of existingOutcomes) {
      if (ex.kind === 'existing') {
        expect(ex.predictionId).toBe(winningId);
      }
    }

    // Verify only 1 row was inserted in oracle_ledger.official_predictions for that identity
    const sharedDigest = await identityDigest(
      buildBaseIdentity(sharedIdentityOverrides),
    );
    const countRes = await appPool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM oracle_ledger.official_predictions
        WHERE identity_digest = $1`,
      [sharedDigest],
    );
    expect(countRes.rows[0]!.cnt).toBe('1');
  });

  it('7. rejects UPDATE, DELETE, and TRUNCATE (including CASCADE) even when executed as table owner oracle_migrator', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('SET SESSION AUTHORIZATION oracle_migrator');

      // 1. UPDATE and DELETE on official_predictions are rejected with 23514
      await expect(
        client.query(
          `UPDATE oracle_ledger.official_predictions
              SET payload_digest = repeat('f', 64)
            WHERE prediction_id = 'ORC-2026-0101'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        client.query(
          `DELETE FROM oracle_ledger.official_predictions
            WHERE prediction_id = 'ORC-2026-0101'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // 2. UPDATE and DELETE on prediction_events are rejected with 23514
      await expect(
        client.query(
          `UPDATE oracle_ledger.prediction_events
              SET digest = repeat('f', 64)
            WHERE prediction_id = 'ORC-2026-0101'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        client.query(
          `DELETE FROM oracle_ledger.prediction_events
            WHERE prediction_id = 'ORC-2026-0101'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // 3. UPDATE and DELETE on finalized publication_idempotency_keys rows are rejected with 23514
      await expect(
        client.query(
          `UPDATE oracle_ledger.publication_idempotency_keys
              SET outcome = '{"kind":"rejected"}'::jsonb
            WHERE idempotency_key = 'idem-pub-1'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        client.query(
          `DELETE FROM oracle_ledger.publication_idempotency_keys
            WHERE idempotency_key = 'idem-pub-1'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // 4. Direct INSERT of 'created' or 'existing' into publication_idempotency_keys is rejected with 23514
      await expect(
        client.query(
          `INSERT INTO oracle_ledger.publication_idempotency_keys (
             idempotency_key, request_digest, outcome, recorded_at
           ) VALUES (
             'forged-created',
             repeat('a', 64),
             '{"kind":"created","predictionId":"ORC-2026-0101"}'::jsonb,
             now()
           )`,
        ),
      ).rejects.toMatchObject({ code: '23514' });

      // 5. TRUNCATE (and TRUNCATE ... CASCADE) on all three ledger tables is rejected with 23514
      await expect(
        client.query(`TRUNCATE oracle_ledger.publication_idempotency_keys`),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        client.query(`TRUNCATE oracle_ledger.prediction_events`),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        client.query(`TRUNCATE oracle_ledger.official_predictions CASCADE`),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('RESET SESSION AUTHORIZATION');
      client.release();
    }
  });

  it('8. enforces SECURITY DEFINER isolation guards (rejecting REPEATABLE READ and SERIALIZABLE with 25001) and rolls back uncommitted __pending__ reservations at COMMIT (23514)', async () => {
    const appClient = await appPool.connect();
    try {
      // Calling commit_official_publication under REPEATABLE READ fails with SQLSTATE 25001
      await appClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(
        appClient.query(
          `SELECT oracle_ledger.commit_official_publication(
             'idem-iso-rr',
             repeat('a', 64),
             'ORC-2026-0901',
             repeat('b', 64),
             '{"id":"ORC-2026-0901","demo":false}'::jsonb,
             repeat('c', 64),
             '2026-11-20T12:00:00.000Z'::timestamptz,
             '2026-11-20T12:00:01.000Z'::timestamptz,
             '{}'::jsonb,
             repeat('d', 64)
           )`,
        ),
      ).rejects.toMatchObject({ code: '25001' });
      await appClient.query('ROLLBACK');

      // Calling record_rejected_or_conflict_idempotency under SERIALIZABLE fails with SQLSTATE 25001
      await appClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(
        appClient.query(
          `SELECT oracle_ledger.record_rejected_or_conflict_idempotency(
             'idem-iso-ser',
             repeat('a', 64),
             '{"kind":"rejected"}'::jsonb,
             '2026-11-20T12:00:01.000Z'::timestamptz
           )`,
        ),
      ).rejects.toMatchObject({ code: '25001' });
      await appClient.query('ROLLBACK');

      // Calling append_terminal_prediction_event under REPEATABLE READ fails with SQLSTATE 25001
      await appClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(
        appClient.query(
          `SELECT oracle_ledger.append_terminal_prediction_event(
             'ORC-2026-0101',
             'resolved',
             '2028-01-15T10:00:00.000Z'::timestamptz,
             '2028-01-15T10:00:05.000Z'::timestamptz,
             ('{"seq":"e1","kind":"resolved","prevDigest":"' || repeat('a', 64) || '"}')::jsonb,
             repeat('b', 64),
             repeat('a', 64)
           )`,
        ),
      ).rejects.toMatchObject({ code: '25001' });
      await appClient.query('ROLLBACK');

      // Calling append_terminal_prediction_event under SERIALIZABLE fails with SQLSTATE 25001
      await appClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(
        appClient.query(
          `SELECT oracle_ledger.append_terminal_prediction_event(
             'ORC-2026-0101',
             'resolved',
             '2028-01-15T10:00:00.000Z'::timestamptz,
             '2028-01-15T10:00:05.000Z'::timestamptz,
             ('{"seq":"e1","kind":"resolved","prevDigest":"' || repeat('a', 64) || '"}')::jsonb,
             repeat('b', 64),
             repeat('a', 64)
           )`,
        ),
      ).rejects.toMatchObject({ code: '25001' });
      await appClient.query('ROLLBACK');

      // Calling record_rejected_or_conflict_idempotency with a forged 'created' outcome fails with 23514
      await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await expect(
        appClient.query(
          `SELECT oracle_ledger.record_rejected_or_conflict_idempotency(
             'idem-forged-kind',
             repeat('a', 64),
             '{"kind":"created"}'::jsonb,
             '2026-11-20T12:00:01.000Z'::timestamptz
           )`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await appClient.query('ROLLBACK');
    } finally {
      appClient.release();
    }

    // Verify the DEFERRABLE INITIALLY DEFERRED constraint trigger aborts COMMIT if a row remains '__pending__'
    const migClient = await adminPool.connect();
    try {
      await migClient.query('SET SESSION AUTHORIZATION oracle_migrator');
      await migClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await migClient.query(
        `INSERT INTO oracle_ledger.publication_idempotency_keys (
           idempotency_key, request_digest, outcome, recorded_at
         ) VALUES (
           'idem-unfinalized-pending',
           repeat('e', 64),
           '{"kind":"__pending__"}'::jsonb,
           now()
         )`,
      );

      await expect(migClient.query('COMMIT')).rejects.toMatchObject({
        code: '23514',
      });
      await migClient.query('ROLLBACK');

      const checkPending = await migClient.query(
        `SELECT 1 FROM oracle_ledger.publication_idempotency_keys WHERE idempotency_key = 'idem-unfinalized-pending'`,
      );
      expect(checkPending.rowCount).toBe(0);
    } finally {
      await migClient.query('RESET SESSION AUTHORIZATION');
      migClient.release();
    }
  });

  it('9. appends a terminal resolution event (e1) while preserving sealed payload immutability and rejecting duplicate, unlinked, or malformed-envelope terminal events', async () => {
    const beforeResolution = await registry.getPredictionById('ORC-2026-0101');
    expect(beforeResolution).not.toBeNull();
    const originalPayloadHash = await sha256Hex(
      canonicalize(sealedPayload(beforeResolution!)),
    );
    expect(originalPayloadHash).toBe(beforeResolution!.integrity.digest);
    const e0Digest = beforeResolution!.events[0]!.digest;

    // Verify live function definition in pg_proc uses FOR UPDATE (not FOR KEY SHARE) and enforces READ COMMITTED
    const fnDefRes = await adminPool.query<{ fn_def: string }>(`
      SELECT pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)'
        )
      ) AS fn_def
    `);
    const fnDef = fnDefRes.rows[0]?.fn_def ?? '';
    expect(fnDef).toContain('FOR UPDATE');
    expect(fnDef).not.toContain('FOR KEY SHARE');
    expect(fnDef).toContain("v_isolation_level IS DISTINCT FROM 'read committed'");

    // 1. Reject envelope where (p_envelope ->> 'seq') <> 'e1' with SQLSTATE 23514
    await expect(
      appPool.query(
        `SELECT oracle_ledger.append_terminal_prediction_event(
           'ORC-2026-0101',
           'resolved',
           '2028-01-15T10:00:00.000Z'::timestamptz,
           '2028-01-15T10:00:05.000Z'::timestamptz,
           $1::jsonb,
           repeat('1', 64),
           $2
         )`,
        [
          JSON.stringify({ seq: 'e0', kind: 'resolved', prevDigest: e0Digest }),
          e0Digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // 2. Reject envelope where (p_envelope ->> 'kind') <> p_kind with SQLSTATE 23514
    await expect(
      appPool.query(
        `SELECT oracle_ledger.append_terminal_prediction_event(
           'ORC-2026-0101',
           'resolved',
           '2028-01-15T10:00:00.000Z'::timestamptz,
           '2028-01-15T10:00:05.000Z'::timestamptz,
           $1::jsonb,
           repeat('1', 64),
           $2
         )`,
        [
          JSON.stringify({ seq: 'e1', kind: 'annulled', prevDigest: e0Digest }),
          e0Digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // 3. Reject envelope where (p_envelope ->> 'prevDigest') <> p_prev_digest with SQLSTATE 23514
    await expect(
      appPool.query(
        `SELECT oracle_ledger.append_terminal_prediction_event(
           'ORC-2026-0101',
           'resolved',
           '2028-01-15T10:00:00.000Z'::timestamptz,
           '2028-01-15T10:00:05.000Z'::timestamptz,
           $1::jsonb,
           repeat('1', 64),
           $2
         )`,
        [
          JSON.stringify({
            seq: 'e1',
            kind: 'resolved',
            prevDigest: '9'.repeat(64),
          }),
          e0Digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // 4. Reject call where p_prev_digest does not match stored e0.digest with SQLSTATE 23514
    const fakePrev = '9'.repeat(64);
    await expect(
      appPool.query(
        `SELECT oracle_ledger.append_terminal_prediction_event(
           'ORC-2026-0101',
           'resolved',
           '2028-01-15T10:00:00.000Z'::timestamptz,
           '2028-01-15T10:00:05.000Z'::timestamptz,
           $1::jsonb,
           repeat('1', 64),
           $2
         )`,
        [
          JSON.stringify({ seq: 'e1', kind: 'resolved', prevDigest: fakePrev }),
          fakePrev,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // Append valid terminal resolution event (e1) via registry
    const resolvedRecord = await registry.appendResolutionEvent({
      predictionId: 'ORC-2026-0101',
      kind: 'resolved',
      occurredAt: '2028-01-15T10:00:00.000Z',
      recordedAt: '2028-01-15T10:00:05.000Z',
      body: {
        outcome: 'yes',
        basis: 'INDEC reported December 2027 12-month CPI inflation at 21.4% (< 25.0%).',
        note: '12-month variation: 21.4%.',
        evidenceIds: ['ev-pub-1-1'],
      },
    });

    expect(resolvedRecord.events).toHaveLength(2);
    expect(resolvedRecord.events[0]!.seq).toBe('e0');
    expect(resolvedRecord.events[1]!.seq).toBe('e1');
    expect(resolvedRecord.events[1]!.kind).toBe('resolved');
    expect(resolvedRecord.events[1]!.prevDigest).toBe(resolvedRecord.events[0]!.digest);

    // Verify lifecycle derived from events is now 'resolved' with outcome 'yes'
    const lifecycle = deriveLifecycle(resolvedRecord);
    expect(lifecycle.status).toBe('resolved');
    expect(lifecycle.resolution?.outcome).toBe('yes');

    // Verify sealed payload and probability are 100% unchanged after resolution
    expect(resolvedRecord.probability).toBe(0.62);
    const postResolutionPayloadHash = await sha256Hex(
      canonicalize(sealedPayload(resolvedRecord)),
    );
    expect(postResolutionPayloadHash).toBe(originalPayloadHash);
    expect(await validateOfficialRecord(resolvedRecord)).toEqual([]);

    // Attempting to resolve a second time via registry fails in domain guard (AppendError),
    // and attempting to bypass the domain guard by calling the SQL function directly fails in PostgreSQL with SQLSTATE 23505
    await expect(
      registry.appendResolutionEvent({
        predictionId: 'ORC-2026-0101',
        kind: 'annulled',
        occurredAt: '2028-01-16T10:00:00.000Z',
        recordedAt: '2028-01-16T10:00:05.000Z',
        body: {
          reason: 'Attempted second terminal event',
          basis: 'Duplicate resolution attempt check.',
          note: 'Must be rejected.',
        },
      }),
    ).rejects.toThrow(/This record was resolved\. A resolution is final/);

    await expect(
      appPool.query(
        `SELECT oracle_ledger.append_terminal_prediction_event(
           'ORC-2026-0101',
           'annulled',
           '2028-01-16T10:00:00.000Z'::timestamptz,
           '2028-01-16T10:00:05.000Z'::timestamptz,
           $1::jsonb,
           repeat('2', 64),
           $2
         )`,
        [
          JSON.stringify({ seq: 'e1', kind: 'annulled', prevDigest: e0Digest }),
          e0Digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('10. returns the complete [e0, e1] event chain on existing-identity submissions after resolution while keeping the sealed payload immutable and idempotent replay consistent', async () => {
    // ORC-2026-0101 was published in Test 3 and resolved with e1 in Test 9.
    // Submit a new publication request for the same canonical identity with a fresh idempotencyKey.
    const postResDraft = buildDraftCandidate('pub-post-resolution', undefined, {
      proposedQuestion:
        'Will INDEC report Argentina annual CPI inflation strictly below 25.0% for 2027?',
      probability: 0.55,
    });
    const postResQualified = qualifyCandidate(postResDraft);
    const postResCandDigest = await candidateContentDigest(postResQualified);

    const postResRequest: PublicationRequest = {
      candidateId: postResQualified.candidateId,
      idempotencyKey: 'idem-post-resolution-existing',
      identity: postResQualified.proposedIdentity,
      candidateDigest: postResCandDigest,
      requestedAt: nextTimestamp(),
    };

    const existingOutcome = await publishCandidate(
      postResQualified,
      postResRequest,
      {
        registry,
        now: nextTimestamp,
        newPredictionId: nextPredictionId,
      },
    );

    expect(existingOutcome.kind).toBe('existing');
    if (existingOutcome.kind !== 'existing') {
      throw new Error('Expected existing outcome after resolution');
    }

    expect(existingOutcome.predictionId).toBe('ORC-2026-0101');
    expect(existingOutcome.record).toBeDefined();
    const returnedRecord = existingOutcome.record!;

    // 1. The existing response reflects the full [e0, e1] event chain (not a stale [e0]-only chain)
    expect(returnedRecord.events.map((e) => `${e.seq}:${e.kind}`)).toEqual([
      'e0:published',
      'e1:resolved',
    ]);
    const derived = deriveLifecycle(returnedRecord);
    expect(derived.status).toBe('resolved');
    expect(derived.resolution?.outcome).toBe('yes');

    // 2. The original sealed payload and its SHA-256 digest remain completely intact and valid
    expect(returnedRecord.probability).toBe(0.62);
    const recomputedSealedHash = await sha256Hex(
      canonicalize(sealedPayload(returnedRecord)),
    );
    expect(recomputedSealedHash).toBe(returnedRecord.integrity.digest);
    expect(await validateOfficialRecord(returnedRecord)).toEqual([]);

    // Verify the underlying official_predictions.sealed_payload column in PostgreSQL was never mutated
    const rawTableRes = await appPool.query<{
      sealed_events_len: number;
      payload_digest: string;
    }>(
      `SELECT pg_catalog.jsonb_array_length(sealed_payload -> 'events') AS sealed_events_len,
              pg_catalog.btrim(payload_digest) AS payload_digest
         FROM oracle_ledger.official_predictions
        WHERE prediction_id = 'ORC-2026-0101'`,
    );
    expect(rawTableRes.rows[0]?.sealed_events_len).toBe(1);
    expect(rawTableRes.rows[0]?.payload_digest).toBe(
      returnedRecord.integrity.digest,
    );

    // 3. Replaying idem-post-resolution-existing returns 'replayed' with the [e0, e1] chain preserved
    const replayedPostRes = await publishCandidate(
      postResQualified,
      postResRequest,
      {
        registry,
        now: nextTimestamp,
        newPredictionId: nextPredictionId,
      },
    );
    expect(replayedPostRes.kind).toBe('replayed');
    if (replayedPostRes.kind !== 'replayed') {
      throw new Error('Expected replayed outcome');
    }
    expect(replayedPostRes.original.kind).toBe('existing');
    if (replayedPostRes.original.kind === 'existing') {
      expect(
        replayedPostRes.original.record?.events.map((e) => `${e.seq}:${e.kind}`),
      ).toEqual(['e0:published', 'e1:resolved']);
    }
  });

  it('11. serves the read-only HTTP API (GET /v1/predictions, GET /v1/predictions/:id, GET /v1/predictions/:id/events) and blocks public write endpoints', async () => {
    const running = await startOracleServer({
      databaseUrl: cluster.appConnectionString,
      port: 0,
      host: '127.0.0.1',
    });

    try {
      const baseUrl = `http://127.0.0.1:${running.port}`;

      // 1. GET /v1/predictions returns only official (demo: false) predictions by default
      const listRes = await fetch(`${baseUrl}/v1/predictions`);
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        predictions: Array<{ id: string; demo: boolean }>;
        count: number;
        officialCount: number;
        demoCount: number;
      };
      expect(listBody.officialCount).toBe(2);
      expect(listBody.demoCount).toBe(0);
      expect(listBody.predictions.every((p) => p.demo === false)).toBe(true);

      // 2. GET /v1/predictions?includeDemo=true includes illustrative records with demo: true preserved
      const withDemoRes = await fetch(`${baseUrl}/v1/predictions?includeDemo=true`);
      expect(withDemoRes.status).toBe(200);
      const withDemoBody = (await withDemoRes.json()) as {
        officialCount: number;
        demoCount: number;
        demoNotice: string;
      };
      expect(withDemoBody.officialCount).toBe(2);
      expect(withDemoBody.demoCount).toBe(10);
      expect(withDemoBody.demoNotice).toContain('Illustrative archive');

      // 3. GET /v1/predictions/:id returns the official prediction and derived lifecycle
      const detailRes = await fetch(`${baseUrl}/v1/predictions/ORC-2026-0101`);
      expect(detailRes.status).toBe(200);
      const detailBody = (await detailRes.json()) as {
        prediction: { id: string; demo: boolean; probability: number };
        lifecycle: { status: string; resolution?: { outcome: string } };
      };
      expect(detailBody.prediction.id).toBe('ORC-2026-0101');
      expect(detailBody.prediction.demo).toBe(false);
      expect(detailBody.lifecycle.status).toBe('resolved');
      expect(detailBody.lifecycle.resolution?.outcome).toBe('yes');

      // 4. GET /v1/predictions/:id/events returns the ordered event chain and cryptographic verification
      const eventsRes = await fetch(`${baseUrl}/v1/predictions/ORC-2026-0101/events`);
      expect(eventsRes.status).toBe(200);
      const eventsBody = (await eventsRes.json()) as {
        predictionId: string;
        demo: boolean;
        events: Array<{ seq: string; kind: string }>;
        verification: { valid: boolean; problems: string[] };
      };
      expect(eventsBody.predictionId).toBe('ORC-2026-0101');
      expect(eventsBody.demo).toBe(false);
      expect(eventsBody.events.map((e) => `${e.seq}:${e.kind}`)).toEqual([
        'e0:published',
        'e1:resolved',
      ]);
      expect(eventsBody.verification).toEqual({
        valid: true,
        problems: [],
      });

      // 5. Unknown prediction returns 404
      const notFoundRes = await fetch(`${baseUrl}/v1/predictions/ORC-2026-9999`);
      expect(notFoundRes.status).toBe(404);

      // 6. Public write attempts to /v1/publications or /v1/predictions/:id/events are rejected with 403
      const pubPostRes = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(pubPostRes.status).toBe(403);

      const eventPostRes = await fetch(
        `${baseUrl}/v1/predictions/ORC-2026-0101/events`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(eventPostRes.status).toBe(403);
    } finally {
      await running.close();
    }
  });

  it('12. enforces startup role security validation (including CURRENT_USER = oracle_app with SESSION_USER <> oracle_app) and graceful SIGTERM/SIGINT shutdown in the CLI entrypoint', async () => {
    // 1. Attempting to start the server with the superuser/admin DATABASE_URL is rejected with RuntimeRoleSecurityError
    let adminErr: unknown;
    try {
      await startOracleServer({
        databaseUrl: cluster.adminConnectionString,
        port: 0,
        host: '127.0.0.1',
      });
    } catch (err) {
      adminErr = err;
    }
    expect(adminErr).toBeInstanceOf(RuntimeRoleSecurityError);
    const secErr = adminErr as RuntimeRoleSecurityError;
    expect(secErr.violations).toContain(
      "connected as current_user='postgres' / session_user='postgres' instead of restricted runtime role 'oracle_app'",
    );
    expect(secErr.violations).toContain("role 'postgres' has SUPERUSER attribute");
    // Ensure connection string is never leaked in the error message
    expect(secErr.message).not.toContain(cluster.adminConnectionString);

    // 2. Specific check: CURRENT_USER = 'oracle_app' while SESSION_USER <> 'oracle_app' (via SET ROLE oracle_app on a superuser session)
    // Even though CURRENT_USER is 'oracle_app' (which has no superuser/DML attributes), SESSION_USER is still 'postgres'
    // (allowing RESET ROLE privilege escalation), so verifyRuntimeDatabaseRole and startOracleServer MUST reject it.
    const roleSwitchClient = await adminPool.connect();
    try {
      await roleSwitchClient.query('SET ROLE oracle_app');
      const whoRes = await roleSwitchClient.query<{
        current_user: string;
        session_user: string;
      }>(
        'SELECT CURRENT_USER::text AS current_user, SESSION_USER::text AS session_user',
      );
      expect(whoRes.rows[0]).toEqual({
        current_user: 'oracle_app',
        session_user: 'postgres',
      });

      let mismatchedSessionErr: unknown;
      try {
        await verifyRuntimeDatabaseRole(roleSwitchClient);
      } catch (err) {
        mismatchedSessionErr = err;
      }
      expect(mismatchedSessionErr).toBeInstanceOf(RuntimeRoleSecurityError);
      const mismatchedSecErr = mismatchedSessionErr as RuntimeRoleSecurityError;
      expect(mismatchedSecErr.violations).toEqual([
        "connected as current_user='oracle_app' / session_user='postgres' instead of restricted runtime role 'oracle_app'",
      ]);
    } finally {
      await roleSwitchClient.query('RESET ROLE').catch(() => {});
      roleSwitchClient.release();
    }

    // Verify startOracleServer also rejects a DATABASE_URL that sets role=oracle_app on a superuser session
    const disguisedAdminUrl = `${cluster.adminConnectionString}?options=-c%20role%3Doracle_app`;
    await expect(
      startOracleServer({
        databaseUrl: disguisedAdminUrl,
        port: 0,
        host: '127.0.0.1',
      }),
    ).rejects.toThrow(
      /connected as current_user='oracle_app' \/ session_user='postgres' instead of restricted runtime role 'oracle_app'/,
    );

    // 3. Granting CREATEDB to oracle_app causes startup validation to reject the connection
    await adminPool.query('ALTER ROLE oracle_app CREATEDB');
    try {
      await expect(
        startOracleServer({
          databaseUrl: cluster.appConnectionString,
          port: 0,
          host: '127.0.0.1',
        }),
      ).rejects.toThrow(/role 'oracle_app' has CREATEDB attribute/);
    } finally {
      await adminPool.query('ALTER ROLE oracle_app NOCREATEDB');
    }

    // 4. Granting direct INSERT on official_predictions to oracle_app causes startup validation to reject the connection
    await adminPool.query(
      'GRANT INSERT ON TABLE oracle_ledger.official_predictions TO oracle_app',
    );
    try {
      await expect(
        startOracleServer({
          databaseUrl: cluster.appConnectionString,
          port: 0,
          host: '127.0.0.1',
        }),
      ).rejects.toThrow(
        /role 'oracle_app' has forbidden direct DML\/DDL privileges on oracle_ledger tables/,
      );
    } finally {
      await adminPool.query(
        'REVOKE INSERT ON TABLE oracle_ledger.official_predictions FROM oracle_app',
      );
    }

    // 5. Once least-privilege state is restored, verifyRuntimeDatabaseRole passes cleanly
    await expect(verifyRuntimeDatabaseRole(appPool)).resolves.toBeUndefined();

    // 6. CLI runner rejects invalid roles with exit(1) and redacts any credentials/URIs from logs
    const failInfos: string[] = [];
    const failErrors: string[] = [];
    const failExitCodes: number[] = [];
    const failedCli = await runOracleServerCli({
      databaseUrl: cluster.adminConnectionString,
      port: 0,
      host: '127.0.0.1',
      logger: {
        info: (m) => failInfos.push(m),
        error: (m) => failErrors.push(m),
      },
      exit: (code) => failExitCodes.push(code),
    });
    expect(failedCli).toBeNull();
    expect(failExitCodes).toEqual([1]);
    expect(failErrors).toHaveLength(1);
    expect(failErrors[0]).not.toContain(cluster.adminConnectionString);
    expect(
      redactSecrets(
        'Error connecting to postgresql://oracle_app:supersecret@db.example.com:5432/oracle?sslmode=require password=supersecret',
      ),
    ).toBe('Error connecting to postgresql://[REDACTED] password=[REDACTED]');

    // 7. CLI runner starts with oracle_app, serves HTTP requests, and closes server + pool cleanly on SIGTERM and SIGINT
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const infoLogs: string[] = [];
      const errorLogs: string[] = [];
      const exitCodes: number[] = [];
      const fakeProcess = new EventEmitter();

      const cli = await runOracleServerCli({
        databaseUrl: cluster.appConnectionString,
        port: 0,
        host: '127.0.0.1',
        logger: {
          info: (m) => infoLogs.push(m),
          error: (m) => errorLogs.push(m),
        },
        exit: (code) => exitCodes.push(code),
        signalTarget: fakeProcess as unknown as Pick<
          NodeJS.Process,
          'once' | 'removeListener'
        >,
      });

      expect(cli).not.toBeNull();
      expect(errorLogs).toEqual([]);
      const boundPort = cli!.running.port;
      expect(boundPort).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${boundPort}/v1/predictions`);
      expect(res.status).toBe(200);

      // Emit signal and wait for shutdown to finish
      fakeProcess.emit(signal);
      await cli!.shutdown(signal);

      expect(exitCodes).toEqual([0]);
      expect(cli!.running.server.listening).toBe(false);
      expect(cli!.running.pool.ended).toBe(true);
      expect(infoLogs.join('\n')).not.toContain(cluster.appConnectionString);
    }

    // 8. Real OS child-process execution of src/server/index.ts verifies CLI entrypoint startup and SIGTERM shutdown
    const entrypointPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'index.ts',
    );
    const childStdout: string[] = [];
    const childStderr: string[] = [];
    const child = spawn(process.execPath, [entrypointPath], {
      env: {
        ...process.env,
        DATABASE_URL: cluster.appConnectionString,
        HOST: '127.0.0.1',
        PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const listeningLine = await new Promise<string>((resolveLine, rejectLine) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        rejectLine(
          new Error(
            `Timed out waiting for server CLI to listen. stderr: ${childStderr.join('')}`,
          ),
        );
      }, 10_000);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        childStdout.push(text);
        const combined = childStdout.join('');
        if (combined.includes('Read API server listening on http://')) {
          clearTimeout(timeout);
          resolveLine(combined);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        childStderr.push(chunk.toString('utf8'));
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        rejectLine(
          new Error(
            `Server CLI exited prematurely with code ${String(code)}. stderr: ${childStderr.join('')}`,
          ),
        );
      });
    });

    const portMatch = listeningLine.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    expect(portMatch).not.toBeNull();
    const childPort = Number(portMatch![1]);
    expect(childPort).toBeGreaterThan(0);

    const childRes = await fetch(`http://127.0.0.1:${childPort}/v1/predictions`);
    expect(childRes.status).toBe(200);

    const exitCode = await new Promise<number | null>((resolveExit) => {
      child.once('exit', (code) => resolveExit(code));
      child.kill('SIGTERM');
    });
    expect(exitCode).toBe(0);
    expect(childStdout.join('')).toContain(
      'Server and database pool closed cleanly.',
    );
    expect(childStdout.join('')).not.toContain(cluster.appConnectionString);
    expect(childStderr.join('')).toBe('');
  });

  it('13. persists official predictions, append-only event chains, and idempotency keys across a full PostgreSQL server stop and restart', async () => {
    // Close active client pools before stopping the PostgreSQL OS process
    await appPool.end();
    await adminPool.end();

    // Stop the real PostgreSQL 16 process and start a fresh PostgreSQL 16 process on the same PGDATA directory
    await cluster.restart();

    // Reconnect pools to the restarted PostgreSQL 16 server
    adminPool = new pg.Pool({
      connectionString: cluster.adminConnectionString,
      max: 10,
    });
    appPool = new pg.Pool({
      connectionString: cluster.appConnectionString,
      max: 10,
    });
    registry = new PostgresPublicationRegistry({
      pool: appPool,
      now: nextTimestamp,
    });

    // Verify the restarted server still passes the full §2.5 security & privilege audit
    const postRestartAudit = await runLedgerSecurityAudit(adminPool);
    expect(postRestartAudit.compliant).toBe(true);

    // Verify ORC-2026-0101 and its [e0, e1] event chain survived the PostgreSQL server restart intact
    const persisted = await registry.getPredictionById('ORC-2026-0101');
    expect(persisted).not.toBeNull();
    expect(persisted!.id).toBe('ORC-2026-0101');
    expect(persisted!.demo).toBe(false);
    expect(persisted!.events).toHaveLength(2);
    expect(await validateOfficialRecord(persisted!)).toEqual([]);

    // Verify idempotency keys also survived the restart (re-submitting idem-pub-1 replays the original outcome)
    const draft = buildDraftCandidate('pub-1');
    const qualified = qualifyCandidate(draft);
    const candDigest = await candidateContentDigest(qualified);
    const replayAfterRestart = await publishCandidate(
      qualified,
      {
        candidateId: qualified.candidateId,
        idempotencyKey: 'idem-pub-1',
        identity: qualified.proposedIdentity,
        candidateDigest: candDigest,
        requestedAt: nextTimestamp(),
      },
      {
        registry,
        now: nextTimestamp,
        newPredictionId: nextPredictionId,
      },
    );
    expect(replayAfterRestart.kind).toBe('replayed');

    // Verify buildSealedPredictionRecord + claimIdentity delegates through commitPublication cleanly
    const claimDraft = buildDraftCandidate('claim-test', {
      subject: { namespace: 'entity', id: 'chile-central-bank' },
      geographicScope: { namespace: 'country', id: 'cl' },
    });
    const claimQualified = qualifyCandidate(claimDraft);
    const claimIdentDigest = await identityDigest(claimQualified.proposedIdentity);
    const sealed = await buildSealedPredictionRecord(
      claimQualified,
      'ORC-2026-0301',
      nextTimestamp(),
      nextTimestamp(),
    );
    const firstClaim = await registry.claimIdentity(
      claimIdentDigest,
      'ORC-2026-0301',
      sealed,
    );
    expect(firstClaim).toEqual({ status: 'claimed' });
    const sealed2 = await buildSealedPredictionRecord(
      claimQualified,
      'ORC-2026-0302',
      nextTimestamp(),
      nextTimestamp(),
    );
    const secondClaim = await registry.claimIdentity(
      claimIdentDigest,
      'ORC-2026-0302',
      sealed2,
    );
    expect(secondClaim).toEqual({
      status: 'already-claimed',
      predictionId: 'ORC-2026-0301',
    });

    // If an external PostgreSQL 16 service container is configured in CI (TEST_DATABASE_ADMIN_URL),
    // also run migrations, security audit, and end-to-end publication against that container.
    const externalAdminUrl = process.env.TEST_DATABASE_ADMIN_URL;
    if (externalAdminUrl) {
      const extPool = new pg.Pool({ connectionString: externalAdminUrl, max: 5 });
      try {
        await runLedgerMigrations(extPool);
        const extAudit = await runLedgerSecurityAudit(extPool);
        expect(extAudit.serverVersionNum).toBeGreaterThanOrEqual(160000);
        expect(extAudit.roleMembershipRows).toEqual([]);
        expect(extAudit.privilegeViolationRows).toEqual([]);
        expect(extAudit.compliant).toBe(true);

        const extRegistry = new PostgresPublicationRegistry({
          pool: extPool,
          now: nextTimestamp,
          sessionAuthorizationRole: 'oracle_app',
        });
        const extDraft = buildDraftCandidate('ext-ci-1', {
          subject: { namespace: 'entity', id: 'uruguay-central-bank' },
          geographicScope: { namespace: 'country', id: 'uy' },
        });
        const extQualified = qualifyCandidate(extDraft);
        const extCandDigest = await candidateContentDigest(extQualified);
        const extOutcome = await publishCandidate(
          extQualified,
          {
            candidateId: extQualified.candidateId,
            idempotencyKey: 'idem-ext-ci-1',
            identity: extQualified.proposedIdentity,
            candidateDigest: extCandDigest,
            requestedAt: nextTimestamp(),
          },
          {
            registry: extRegistry,
            now: nextTimestamp,
            newPredictionId: () => 'ORC-2026-0401',
          },
        );
        expect(extOutcome.kind).toBe('created');
      } finally {
        await extPool.end();
      }
    }
  });

  it('14. enforces safe migration runner guards (MIGRATION_DATABASE_URL only, non-pooled, production blocked, anti-spoofing branch verification, and Neon neondb_owner role execution)', async () => {
    // 1. Rejects missing MIGRATION_DATABASE_URL even when DATABASE_URL is present
    expect(() =>
      validateMigrationConnectionUrl(undefined, cluster.appConnectionString),
    ).toThrow(MigrationTargetSecurityError);
    expect(() =>
      validateMigrationConnectionUrl('', cluster.appConnectionString),
    ).toThrow(/MIGRATION_DATABASE_URL environment variable is required/);

    // 2. Rejects when MIGRATION_DATABASE_URL is identical to runtime DATABASE_URL
    expect(() =>
      validateMigrationConnectionUrl(
        cluster.adminConnectionString,
        cluster.adminConnectionString,
      ),
    ).toThrow(/MIGRATION_DATABASE_URL must not be identical to runtime DATABASE_URL/);

    // 3. Rejects pooled endpoints (-pooler) and pgbouncer=true
    expect(() =>
      validateMigrationConnectionUrl(
        'postgresql://neondb_owner:secret@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toThrow(/uses a pooled endpoint \(-pooler\)/);
    expect(() =>
      validateMigrationConnectionUrl(
        'postgresql://neondb_owner:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true',
      ),
    ).toThrow(/pgbouncer=true/);

    // 4. Rejects connecting as oracle_app or oracle_migrator, or Neon host without SSL
    expect(() =>
      validateMigrationConnectionUrl(
        'postgresql://oracle_app:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toThrow(/cannot connect as role 'oracle_app'/);
    expect(() =>
      validateMigrationConnectionUrl(
        'postgresql://neondb_owner:secret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb',
      ),
    ).toThrow(/must enforce SSL/);

    // 4b. executeSafeMigrationRun aborts before connecting if ORACLE_APP_PASSWORD is missing or empty
    await expect(
      executeSafeMigrationRun({
        migrationDatabaseUrl: cluster.adminConnectionString,
        oracleAppPassword: '',
      }),
    ).rejects.toThrow(
      /ORACLE_APP_PASSWORD environment variable is required/,
    );

    // 5. Anti-spoofing & production protection: verifyMigrationTargetIdentity blocks production
    //    even when the operator passes expectedBranchName='staging-test'
    const baseProbe = await probeDatabaseIdentity(adminPool);
    const neonConnInfo = validateMigrationConnectionUrl(
      'postgresql://neondb_owner:secret@ep-prod-endpoint-111.us-east-2.aws.neon.tech/neondb?sslmode=require',
    );

    // 5a. Neon control plane resolves endpoint to 'production' (or default=true) -> BLOCKED even if operator claims 'staging'
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: neonConnInfo,
        probe: {
          ...baseProbe,
          neonProjectId: 'wispy-cell-45340306',
          neonBranchId: 'br-prod-001',
        },
        expectedBranchName: 'staging-test',
        branchResolver: async () => ({
          projectId: 'wispy-cell-45340306',
          branchId: 'br-prod-001',
          branchName: 'production',
          endpointId: 'ep-prod-endpoint-111',
          endpointHost: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          isDefault: true,
          isPrimary: true,
          isProtected: true,
          parentId: null,
          source: 'custom-resolver',
        }),
      }),
    ).rejects.toThrow(
      /Refusing to run migrations against protected\/production Neon branch 'production'/,
    );

    // 5b. Even if a branch is named 'staging-like', if Neon marks it isDefault=true or isProtected=true -> BLOCKED
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: neonConnInfo,
        probe: {
          ...baseProbe,
          neonProjectId: 'wispy-cell-45340306',
          neonBranchId: 'br-default-001',
        },
        branchResolver: async () => ({
          projectId: 'wispy-cell-45340306',
          branchId: 'br-default-001',
          branchName: 'custom-default-branch',
          endpointId: 'ep-prod-endpoint-111',
          endpointHost: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          isDefault: true,
          isPrimary: false,
          isProtected: false,
          parentId: null,
          source: 'custom-resolver',
        }),
      }),
    ).rejects.toThrow(/protected\/production Neon branch/);

    // 5c. Fail-closed when Neon control plane cannot resolve the branch and no server GUC proof is present
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: neonConnInfo,
        probe: baseProbe,
        expectedBranchName: 'staging-test',
        branchResolver: async () => null,
      }),
    ).rejects.toThrow(/Unable to verify the real branch identity/);

    // 5d. Blocks when database catalog comment marks the database as production (even on local loopback)
    const localConnInfo = validateMigrationConnectionUrl(
      cluster.adminConnectionString,
    );
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: localConnInfo,
        probe: {
          ...baseProbe,
          databaseComment: '{"oracleEnv":"production","branch":"production"}',
        },
        expectedBranchName: 'test-branch',
      }),
    ).rejects.toThrow(/marks this database as production/);

    // 5e. Accepts a verified non-production Neon test branch from control plane
    const verifiedTestTarget = await verifyMigrationTargetIdentity({
      connectionInfo: validateMigrationConnectionUrl(
        'postgresql://neondb_owner:secret@ep-test-branch-222.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
      probe: {
        ...baseProbe,
        neonProjectId: 'wispy-cell-45340306',
        neonBranchId: 'br-test-222',
      },
      expectedBranchName: 'preview/pr-5-test',
      expectedBranchId: 'br-test-222',
      branchResolver: async () => ({
        projectId: 'wispy-cell-45340306',
        branchId: 'br-test-222',
        branchName: 'preview/pr-5-test',
        endpointId: 'ep-test-branch-222',
        endpointHost: 'ep-test-branch-222.us-east-2.aws.neon.tech',
        isDefault: false,
        isPrimary: false,
        isProtected: false,
        parentId: 'br-prod-001',
        source: 'custom-resolver',
      }),
    });
    expect(verifiedTestTarget).toEqual({
      verificationMethod: 'neon-control-plane',
      projectId: 'wispy-cell-45340306',
      branchId: 'br-test-222',
      branchName: 'preview/pr-5-test',
      endpointId: 'ep-test-branch-222',
      isProduction: false,
    });

    // 6. Full end-to-end execution of executeSafeMigrationRun & runMigrationCli as a Neon-style
    //    non-superuser role (neondb_owner with CREATEDB CREATEROLE IN ROLE neon_superuser)
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser') THEN
          CREATE ROLE neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner') THEN
          CREATE ROLE neondb_owner LOGIN PASSWORD 'neondb_owner_secret_pw' CREATEDB CREATEROLE IN ROLE neon_superuser;
        END IF;
        -- Because oracle_migrator and oracle_app were already created by postgres in beforeAll
        -- on this shared cluster, grant neondb_owner ADMIN OPTION on them to match the exact
        -- PostgreSQL 16 pg_auth_members state when neondb_owner creates them on a Neon branch.
        GRANT oracle_migrator TO neondb_owner WITH ADMIN TRUE, INHERIT TRUE, SET TRUE;
        GRANT oracle_app TO neondb_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
      END;
      $$;
    `);
    await adminPool.query('CREATE DATABASE oracle_neon_branch_test OWNER neondb_owner');

    const neonBranchTestUrl = new URL(cluster.adminConnectionString);
    neonBranchTestUrl.username = 'neondb_owner';
    neonBranchTestUrl.password = 'neondb_owner_secret_pw';
    neonBranchTestUrl.pathname = '/oracle_neon_branch_test';

    const appTestPassword = 'oracle_app_branch_test_pw_99';

    // First run via executeSafeMigrationRun
    const migrationReport = await executeSafeMigrationRun({
      migrationDatabaseUrl: neonBranchTestUrl.toString(),
      oracleAppPassword: appTestPassword,
    });
    expect(migrationReport.connection.database).toBe('oracle_neon_branch_test');
    expect(migrationReport.connection.migrationUser).toBe('neondb_owner');
    expect(migrationReport.audit.compliant).toBe(true);
    expect(migrationReport.oracleApp.liveLoginVerified).toBe(true);

    const formatted = formatSafeMigrationReport(migrationReport);
    expect(formatted).toContain('§2.5 Audit Compliant  : PASS (0 violations)');
    expect(formatted).toContain('Live Login Verified   : YES (authenticated as oracle_app)');
    expect(formatted).not.toContain('neondb_owner_secret_pw');
    expect(formatted).not.toContain(appTestPassword);
    expect(formatted).not.toContain(neonBranchTestUrl.toString());

    // Second (idempotent) run via runMigrationCli
    const cliLogs: string[] = [];
    const cliErrors: string[] = [];
    const cliExits: number[] = [];
    const cliResult = await runMigrationCli({
      migrationDatabaseUrl: neonBranchTestUrl.toString(),
      oracleAppPassword: appTestPassword,
      argv: [],
      logger: {
        info: (m) => cliLogs.push(m),
        error: (m) => cliErrors.push(m),
      },
      exit: (code) => cliExits.push(code),
    });
    expect(cliResult).not.toBeNull();
    expect(cliErrors).toEqual([]);
    expect(cliExits).toEqual([0]);
    expect(cliLogs.join('\n')).not.toContain(appTestPassword);

    // Verify startOracleServer starts cleanly against the newly migrated database using oracle_app
    const runtimeBranchUrl = new URL(neonBranchTestUrl.toString());
    runtimeBranchUrl.username = 'oracle_app';
    runtimeBranchUrl.password = appTestPassword;
    const runningOnBranch = await startOracleServer({
      databaseUrl: runtimeBranchUrl.toString(),
      port: 0,
      host: '127.0.0.1',
    });
    try {
      const res = await fetch(
        `http://127.0.0.1:${runningOnBranch.port}/v1/predictions`,
      );
      expect(res.status).toBe(200);
    } finally {
      await runningOnBranch.close();
    }
  });

  it('15. never interpolates ORACLE_APP_PASSWORD into SQL statement text, enforces preflight logging safety before sending $1, and aborts fail-closed when logging or role permissions are unsafe', async () => {
    // Spin up a dedicated fresh PostgreSQL 16 cluster so we test both:
    // (a) initial creation of oracle_app from scratch as non-superuser neondb_owner, and
    // (b) idempotent re-execution (password rotation) on existing oracle_app.
    const isolatedCluster = await startEmbeddedPostgres16();
    try {
      const superClient = new pg.Client({
        connectionString: isolatedCluster.adminConnectionString,
      });
      await superClient.connect();
      try {
        // Enable server-level DDL logging to prove the password never lands in postgres.log
        await superClient.query("ALTER SYSTEM SET log_statement = 'ddl'");
        await superClient.query('SELECT pg_reload_conf()');

        await superClient.query(
          'CREATE ROLE neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS',
        );
        await superClient.query(
          "CREATE ROLE neondb_owner LOGIN PASSWORD 'neondb_owner_iso_pw' CREATEDB CREATEROLE IN ROLE neon_superuser",
        );
        await superClient.query(
          "CREATE ROLE unprivileged_migrator LOGIN PASSWORD 'unpriv_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE",
        );
        await superClient.query(
          "CREATE ROLE peer_createrole LOGIN PASSWORD 'peer_pw' NOSUPERUSER NOCREATEDB CREATEROLE",
        );
        await superClient.query(
          'CREATE DATABASE neondb OWNER neondb_owner',
        );
      } finally {
        await superClient.end();
      }

      const neondbOwnerUrl = new URL(isolatedCluster.adminConnectionString);
      neondbOwnerUrl.username = 'neondb_owner';
      neondbOwnerUrl.password = 'neondb_owner_iso_pw';
      neondbOwnerUrl.pathname = '/neondb';

      const initialCanaryPw = 'InitCanary_NoSqlLiteral_2026!#A';
      const rotatedCanaryPw = 'RotateCanary_NoSqlLiteral_2026!#B';
      const blockedCanaryPw = 'BlockedCanary_NeverSent_2026!#C';

      // Intercept every SQL text and parameter array sent through pg.Client.prototype.query
      const capturedQueries: Array<{ sql: string; values: unknown[] }> = [];
      const originalQuery = pg.Client.prototype.query;
      pg.Client.prototype.query = function patchedQuery(
        this: pg.Client,
        ...args: unknown[]
      ) {
        const first = args[0];
        const second = args[1];
        const sqlText =
          typeof first === 'string'
            ? first
            : first &&
                typeof first === 'object' &&
                'text' in first &&
                typeof (first as { text?: unknown }).text === 'string'
              ? ((first as { text: string }).text ?? '')
              : '';
        const values = Array.isArray(second)
          ? second
          : first &&
              typeof first === 'object' &&
              'values' in first &&
              Array.isArray((first as { values?: unknown }).values)
            ? (first as { values: unknown[] }).values
            : [];
        capturedQueries.push({ sql: sqlText, values });
        return (originalQuery as (...a: unknown[]) => unknown).apply(
          this,
          args,
        );
      } as typeof pg.Client.prototype.query;

      try {
        // 1. Initial creation of oracle_app (role does not exist yet on isolatedCluster)
        const firstReport = await executeSafeMigrationRun({
          migrationDatabaseUrl: neondbOwnerUrl.toString(),
          oracleAppPassword: initialCanaryPw,
        });
        expect(firstReport.audit.compliant).toBe(true);
        expect(firstReport.oracleApp.liveLoginVerified).toBe(true);

        // Verify NO SQL statement text ever contained initialCanaryPw
        for (const q of capturedQueries) {
          expect(q.sql).not.toContain(initialCanaryPw);
        }
        // Verify initialCanaryPw was passed ONLY as a $1 bind parameter to pg_temp.oracle_provision_app_role
        const paramQueries1 = capturedQueries.filter((q) =>
          q.values.includes(initialCanaryPw),
        );
        expect(paramQueries1).toHaveLength(1);
        expect(paramQueries1[0]!.sql).toBe(
          'SELECT pg_temp.oracle_provision_app_role($1::text)',
        );

        // Verify the logging guard ran BEFORE the $1 parameter query was sent
        const setConfigIdx = capturedQueries.findIndex((q) =>
          q.sql.includes("set_config('log_parameter_max_length_on_error', '0', true)"),
        );
        const paramSendIdx = capturedQueries.findIndex((q) =>
          q.values.includes(initialCanaryPw),
        );
        expect(setConfigIdx).toBeGreaterThanOrEqual(0);
        expect(setConfigIdx).toBeLessThan(paramSendIdx);

        // 2. Idempotent re-execution with rotated password
        capturedQueries.length = 0;
        const secondReport = await executeSafeMigrationRun({
          migrationDatabaseUrl: neondbOwnerUrl.toString(),
          oracleAppPassword: rotatedCanaryPw,
        });
        expect(secondReport.audit.compliant).toBe(true);
        expect(secondReport.oracleApp.liveLoginVerified).toBe(true);

        for (const q of capturedQueries) {
          expect(q.sql).not.toContain(rotatedCanaryPw);
        }
        const paramQueries2 = capturedQueries.filter((q) =>
          q.values.includes(rotatedCanaryPw),
        );
        expect(paramQueries2).toHaveLength(1);
        expect(paramQueries2[0]!.sql).toBe(
          'SELECT pg_temp.oracle_provision_app_role($1::text)',
        );

        // 3. Fail-closed BEFORE sending password when role lacks CREATEROLE
        capturedQueries.length = 0;
        const unprivUrl = new URL(neondbOwnerUrl.toString());
        unprivUrl.username = 'unprivileged_migrator';
        unprivUrl.password = 'unpriv_pw';
        await expect(
          executeSafeMigrationRun({
            migrationDatabaseUrl: unprivUrl.toString(),
            oracleAppPassword: blockedCanaryPw,
          }),
        ).rejects.toThrow(
          /lacks SUPERUSER and CREATEROLE privileges required to provision oracle_app; aborting before sending password/,
        );
        expect(
          capturedQueries.some(
            (q) =>
              q.sql.includes(blockedCanaryPw) ||
              q.values.includes(blockedCanaryPw),
          ),
        ).toBe(false);

        // 4. Fail-closed BEFORE sending password when role has CREATEROLE but lacks ADMIN OPTION on existing oracle_app
        capturedQueries.length = 0;
        const peerUrl = new URL(neondbOwnerUrl.toString());
        peerUrl.username = 'peer_createrole';
        peerUrl.password = 'peer_pw';
        await expect(
          executeSafeMigrationRun({
            migrationDatabaseUrl: peerUrl.toString(),
            oracleAppPassword: blockedCanaryPw,
          }),
        ).rejects.toThrow(
          /lacks ADMIN OPTION on existing role 'oracle_app'; aborting before sending password/,
        );
        expect(
          capturedQueries.some(
            (q) =>
              q.sql.includes(blockedCanaryPw) ||
              q.values.includes(blockedCanaryPw),
          ),
        ).toBe(false);

        // 5. Fail-closed BEFORE sending password when server has log_statement = 'all'
        //    and connected role is a non-superuser (cannot disable log_statement)
        const superToggle = new pg.Client({
          connectionString: isolatedCluster.adminConnectionString,
        });
        await superToggle.connect();
        try {
          await superToggle.query("ALTER SYSTEM SET log_statement = 'all'");
          await superToggle.query('SELECT pg_reload_conf()');
        } finally {
          await superToggle.end();
        }

        capturedQueries.length = 0;
        await expect(
          executeSafeMigrationRun({
            migrationDatabaseUrl: neondbOwnerUrl.toString(),
            oracleAppPassword: blockedCanaryPw,
          }),
        ).rejects.toThrow(
          /Cannot guarantee password-safe logging for non-superuser role 'neondb_owner'/,
        );
        // Verify blockedCanaryPw was NEVER sent over the wire (neither in SQL nor in bind values)
        expect(
          capturedQueries.some(
            (q) =>
              q.sql.includes(blockedCanaryPw) ||
              q.values.includes(blockedCanaryPw),
          ),
        ).toBe(false);

        // 6. When connected as superuser even with server log_statement = 'all',
        //    provisionOracleAppPasswordSafely disables log_statement in a standalone query
        //    BEFORE sending $1, so the password never appears in SQL text or postgres.log
        capturedQueries.length = 0;
        const superMigrateUrl = new URL(isolatedCluster.adminConnectionString);
        superMigrateUrl.pathname = '/neondb';
        const superCanaryPw = 'SuperCanary_SafeEvenWithAll_2026!#D';
        const superReport = await executeSafeMigrationRun({
          migrationDatabaseUrl: superMigrateUrl.toString(),
          oracleAppPassword: superCanaryPw,
        });
        expect(superReport.audit.compliant).toBe(true);
        expect(superReport.oracleApp.liveLoginVerified).toBe(true);
        for (const q of capturedQueries) {
          expect(q.sql).not.toContain(superCanaryPw);
        }

        // 7. Inspect the real PostgreSQL 16 server log file on disk and verify ZERO canary passwords leaked
        const pgServerLog = readFileSync(
          join(dirname(isolatedCluster.dataDir), 'postgres.log'),
          'utf8',
        );
        expect(pgServerLog).toContain(
          'CREATE OR REPLACE FUNCTION pg_temp.oracle_provision_app_role',
        );
        expect(pgServerLog).not.toContain(initialCanaryPw);
        expect(pgServerLog).not.toContain(rotatedCanaryPw);
        expect(pgServerLog).not.toContain(blockedCanaryPw);
        expect(pgServerLog).not.toContain(superCanaryPw);
      } finally {
        pg.Client.prototype.query = originalQuery;
      }
    } finally {
      await isolatedCluster.stop();
    }
  });

  it('16. starts the compiled production bundle (build/server/index.js via npm start) with DATABASE_URL and without MIGRATION_DATABASE_URL, never invokes migration functions on HTTP startup, keeps db:migrate requiring MIGRATION_DATABASE_URL, and rejects non-oracle_app roles', async () => {
    const serverDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(serverDir, '../..');
    const builtBundlePath = resolve(repoRoot, 'build/server/index.js');
    const migrateScriptPath = resolve(serverDir, 'migrate.ts');
    const indexScriptPath = resolve(serverDir, 'index.ts');

    // 1. Unit verification of entrypoint guards across source and compiled SSR bundle paths
    expect(
      isMigrateMainModule(
        pathToFileURL(builtBundlePath).href,
        builtBundlePath,
      ),
    ).toBe(false);
    expect(
      isMigrateMainModule(
        pathToFileURL(indexScriptPath).href,
        indexScriptPath,
      ),
    ).toBe(false);
    expect(
      isMigrateMainModule(
        pathToFileURL(migrateScriptPath).href,
        migrateScriptPath,
      ),
    ).toBe(true);

    expect(
      isMainModule(pathToFileURL(builtBundlePath).href, builtBundlePath),
    ).toBe(true);
    expect(
      isMainModule(pathToFileURL(indexScriptPath).href, indexScriptPath),
    ).toBe(true);
    expect(
      isMainModule(pathToFileURL(migrateScriptPath).href, migrateScriptPath),
    ).toBe(false);

    // 2. Compile the real SSR server bundle (npm run build:server -> build/server/index.js)
    const buildExitCode = await new Promise<number | null>((resolveExit) => {
      const builder = spawn('npm', ['run', 'build:server'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      builder.once('exit', (code) => resolveExit(code));
    });
    expect(buildExitCode).toBe(0);

    // 3. Confirm that starting the HTTP server in-process never touches MIGRATION_DATABASE_URL
    //    and never executes any migration SQL or pg_temp.oracle_provision_app_role
    const queriesDuringHttpStart: string[] = [];
    const origPoolQuery = pg.Pool.prototype.query;
    pg.Pool.prototype.query = function spyPoolQuery(
      this: pg.Pool,
      ...args: unknown[]
    ) {
      const first = args[0];
      const text =
        typeof first === 'string'
          ? first
          : first &&
              typeof first === 'object' &&
              'text' in first &&
              typeof (first as { text?: unknown }).text === 'string'
            ? (first as { text: string }).text
            : '';
      queriesDuringHttpStart.push(text);
      return (origPoolQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof pg.Pool.prototype.query;

    const savedMigrationEnv = process.env.MIGRATION_DATABASE_URL;
    delete process.env.MIGRATION_DATABASE_URL;
    try {
      const inProcServer = await startOracleServer({
        databaseUrl: cluster.appConnectionString,
        port: 0,
        host: '127.0.0.1',
      });
      try {
        const res = await fetch(
          `http://127.0.0.1:${inProcServer.port}/v1/predictions`,
        );
        expect(res.status).toBe(200);
      } finally {
        await inProcServer.close();
      }

      for (const sql of queriesDuringHttpStart) {
        expect(sql).not.toContain('oracle_provision_app_role');
        expect(sql).not.toContain('CREATE SCHEMA');
        expect(sql).not.toContain('CREATE ROLE');
        expect(sql).not.toContain('ALTER ROLE');
      }
      expect(typeof provisionOracleAppPasswordSafely).toBe('function');
      expect(typeof executeSafeMigrationRun).toBe('function');
    } finally {
      pg.Pool.prototype.query = origPoolQuery;
      if (savedMigrationEnv !== undefined) {
        process.env.MIGRATION_DATABASE_URL = savedMigrationEnv;
      }
    }

    // 4. Spawn the compiled production bundle (node build/server/index.js — exact `npm start` command)
    //    with DATABASE_URL set and WITHOUT MIGRATION_DATABASE_URL
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: cluster.appConnectionString,
      HOST: '127.0.0.1',
      PORT: '0',
    };
    delete childEnv.MIGRATION_DATABASE_URL;
    delete childEnv.ORACLE_APP_PASSWORD;

    const prodStdout: string[] = [];
    const prodStderr: string[] = [];
    const prodChild = spawn(process.execPath, [builtBundlePath], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const prodListeningOut = await new Promise<string>((resolveOut, rejectOut) => {
      const timer = setTimeout(() => {
        prodChild.kill('SIGKILL');
        rejectOut(
          new Error(
            `Timed out waiting for compiled build/server/index.js to listen. stdout=${prodStdout.join('')} stderr=${prodStderr.join('')}`,
          ),
        );
      }, 10_000);

      prodChild.stdout.on('data', (chunk: Buffer) => {
        prodStdout.push(chunk.toString('utf8'));
        const combined = prodStdout.join('');
        if (combined.includes('Read API server listening on http://')) {
          clearTimeout(timer);
          resolveOut(combined);
        }
      });
      prodChild.stderr.on('data', (chunk: Buffer) => {
        prodStderr.push(chunk.toString('utf8'));
      });
      prodChild.once('exit', (code) => {
        clearTimeout(timer);
        rejectOut(
          new Error(
            `Compiled build/server/index.js exited prematurely with code ${String(code)}. stderr=${prodStderr.join('')}`,
          ),
        );
      });
    });

    const prodPortMatch = prodListeningOut.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    expect(prodPortMatch).not.toBeNull();
    const prodPort = Number(prodPortMatch![1]);

    const prodHttpRes = await fetch(
      `http://127.0.0.1:${prodPort}/v1/predictions`,
    );
    expect(prodHttpRes.status).toBe(200);

    const prodExitCode = await new Promise<number | null>((resolveExit) => {
      prodChild.once('exit', (code) => resolveExit(code));
      prodChild.kill('SIGTERM');
    });
    expect(prodExitCode).toBe(0);
    expect(prodStderr.join('')).toBe('');
    expect(prodStdout.join('')).not.toContain('[the-oracle:migrate]');
    expect(prodStderr.join('')).not.toContain('[the-oracle:migrate]');

    // 5. Confirm compiled build/server/index.js STILL rejects non-oracle_app roles at startup
    const badRoleEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: cluster.adminConnectionString,
      HOST: '127.0.0.1',
      PORT: '0',
    };
    delete badRoleEnv.MIGRATION_DATABASE_URL;

    const badRoleStderr: string[] = [];
    const badRoleChild = spawn(process.execPath, [builtBundlePath], {
      cwd: repoRoot,
      env: badRoleEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    badRoleChild.stderr.on('data', (chunk: Buffer) => {
      badRoleStderr.push(chunk.toString('utf8'));
    });
    const badRoleExit = await new Promise<number | null>((resolveExit) => {
      badRoleChild.once('exit', (code) => resolveExit(code));
    });
    expect(badRoleExit).toBe(1);
    expect(badRoleStderr.join('')).toContain(
      "Refusing to start Oracle server: DATABASE_URL role violates least-privilege runtime requirements (connected as current_user='postgres' / session_user='postgres' instead of restricted runtime role 'oracle_app'",
    );
    expect(badRoleStderr.join('')).not.toContain('[the-oracle:migrate]');

    // 6. Confirm `node src/server/migrate.ts` (npm run db:migrate) STILL requires MIGRATION_DATABASE_URL
    //    even when DATABASE_URL is present
    const migrateEnvNoUrl: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: cluster.appConnectionString,
    };
    delete migrateEnvNoUrl.MIGRATION_DATABASE_URL;

    const migrateStderr: string[] = [];
    const migrateChild = spawn(process.execPath, [migrateScriptPath], {
      cwd: repoRoot,
      env: migrateEnvNoUrl,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    migrateChild.stderr.on('data', (chunk: Buffer) => {
      migrateStderr.push(chunk.toString('utf8'));
    });
    const migrateExit = await new Promise<number | null>((resolveExit) => {
      migrateChild.once('exit', (code) => resolveExit(code));
    });
    expect(migrateExit).toBe(1);
    expect(migrateStderr.join('')).toContain(
      '[the-oracle:migrate] Refusing to execute database migration: MIGRATION_DATABASE_URL environment variable is required',
    );
  });

  it('17. enforces Official Production Migration Protocol v1.0 (rejecting production without explicit CLI authorization, wrong confirmation phrase, wrong branch/project ID, missing/failed API verification, GUC-only fallback, or pooled URLs, and accepting only when all exact checks pass)', async () => {
    const baseProbe = await probeDatabaseIdentity(adminPool);
    const directProdConnInfo = validateMigrationConnectionUrl(
      'postgresql://neondb_owner:secret@ep-prod-endpoint-111.us-east-2.aws.neon.tech/neondb?sslmode=require',
    );
    const prodProbe = {
      ...baseProbe,
      currentUser: 'neondb_owner',
      sessionUser: 'neondb_owner',
      neonProjectId: 'wispy-cell-45340306',
      neonBranchId: 'br-prod-001',
    };
    const validProdResolved = {
      projectId: 'wispy-cell-45340306',
      branchId: 'br-prod-001',
      branchName: 'production',
      endpointId: 'ep-prod-endpoint-111',
      endpointHost: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
      isDefault: true,
      isPrimary: true,
      isProtected: true,
      parentId: null,
      source: 'neon-api' as const,
    };

    // 1. CLI argument parser verifies dedicated flags
    const parsedDefault = parseMigrationCliArgs([
      '--expected-branch',
      'preview/pr-6-test',
      '--expected-branch-id',
      'br-test-123',
    ]);
    expect(parsedDefault.allowProductionMigration).toBe(false);
    expect(parsedDefault.confirmProductionPhrase).toBeUndefined();

    const parsedProdCli = parseMigrationCliArgs([
      '--allow-production-migration',
      '--confirm-production',
      PRODUCTION_CONFIRMATION_PHRASE,
      '--expected-project-id',
      'wispy-cell-45340306',
      '--expected-branch',
      'production',
      '--expected-branch-id',
      'br-prod-001',
      '--production-branch-id',
      'br-prod-001',
    ]);
    expect(parsedProdCli).toEqual({
      allowProductionMigration: true,
      confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
      expectedProjectId: 'wispy-cell-45340306',
      expectedBranchName: 'production',
      expectedBranchId: 'br-prod-001',
      productionBranchId: 'br-prod-001',
      json: false,
    });

    // 2. Production rejected without explicit authorization (even if environment variables try to spoof it)
    const savedAllowEnv = process.env.ALLOW_PRODUCTION_MIGRATION;
    const savedConfirmEnv = process.env.CONFIRM_PRODUCTION;
    process.env.ALLOW_PRODUCTION_MIGRATION = 'true';
    process.env.CONFIRM_PRODUCTION = 'APPLY_PRODUCTION_MIGRATION';
    try {
      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: prodProbe,
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          neonApiKey: 'napi_test_key',
          branchResolver: async () => validProdResolved,
        }),
      ).rejects.toThrow(
        /Expected branch 'production' is a protected production branch name; migrations against production are blocked by default/,
      );
    } finally {
      if (savedAllowEnv === undefined) {
        delete process.env.ALLOW_PRODUCTION_MIGRATION;
      } else {
        process.env.ALLOW_PRODUCTION_MIGRATION = savedAllowEnv;
      }
      if (savedConfirmEnv === undefined) {
        delete process.env.CONFIRM_PRODUCTION;
      } else {
        process.env.CONFIRM_PRODUCTION = savedConfirmEnv;
      }
    }

    // 3. Production rejected if typed confirmation phrase is missing or incorrect
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'apply_production_migration', // wrong case
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(
      /Production migration requires explicit confirmation phrase 'APPLY_PRODUCTION_MIGRATION'/,
    );

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: false,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(
      /Production migration requires the explicit --allow-production-migration CLI flag/,
    );

    // 4. Production rejected with wrong branch ID (expectedBranchId !== productionBranchId or API mismatch)
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-wrong-999',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(/Production migration branch ID mismatch/);

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-wrong-999',
        productionBranchId: 'br-wrong-999',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(
      /does not match expected production branch ID 'br-wrong-999'/,
    );

    // 5. Production rejected with wrong project ID (caller vs .neon or server GUC vs .neon)
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wrong-project-id-000',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(/Production migration project ID mismatch/);

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: {
          ...prodProbe,
          neonProjectId: 'other-project-999',
        },
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(/Server GUC neon\.project_id \('other-project-999'\) does not match/);

    // 6. Production rejected if API verification fails, is unavailable, or falls back to GUC/CLI
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: '',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(/Production migration requires NEON_API_KEY/);

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => null, // Simulate API failure even though prodProbe.neonBranchId === 'br-prod-001'
      }),
    ).rejects.toThrow(
      /authoritative Neon API verification failed or was unavailable .* \(GUC-only and CLI fallbacks are forbidden for production\)/,
    );

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => ({
          ...validProdResolved,
          source: 'neon-cli',
        }),
      }),
    ).rejects.toThrow(/GUC-only and CLI fallbacks are forbidden for production/);

    // 7. Production rejected if endpoint does not map to expected branch or branch is not default/primary
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => ({
          ...validProdResolved,
          endpointId: 'ep-different-endpoint-999',
        }),
      }),
    ).rejects.toThrow(/does not match connected endpoint/);

    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => ({
          ...validProdResolved,
          isDefault: false,
          isPrimary: false,
        }),
      }),
    ).rejects.toThrow(/is neither the default nor primary production branch/);

    // 8. Production rejected if pooled connection is used or connected role is not exactly neondb_owner
    expect(PRODUCTION_MIGRATION_ROLE).toBe('neondb_owner');
    expect(() =>
      validateMigrationConnectionUrl(
        'postgresql://neondb_owner:secret@ep-prod-endpoint-111-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toThrow(/uses a pooled endpoint \(-pooler\)/);

    // 8a. oracle_app and oracle_migrator remain rejected
    for (const forbiddenRole of ['oracle_app', 'oracle_migrator'] as const) {
      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: {
            ...prodProbe,
            currentUser: forbiddenRole,
            sessionUser: forbiddenRole,
          },
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          neonApiKey: 'napi_test_key',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
          branchResolver: async () => validProdResolved,
        }),
      ).rejects.toThrow(/never as oracle_app or oracle_migrator/);
    }

    // 8b. Any other administrative role (e.g. postgres, custom_admin, neon_superuser, or SET ROLE mismatch) is rejected
    for (const nonOwnerProbe of [
      { currentUser: 'postgres', sessionUser: 'postgres' },
      { currentUser: 'custom_admin', sessionUser: 'custom_admin' },
      { currentUser: 'neon_superuser', sessionUser: 'neon_superuser' },
      { currentUser: 'neondb_owner', sessionUser: 'postgres' },
      { currentUser: 'postgres', sessionUser: 'neondb_owner' },
    ]) {
      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: {
            ...prodProbe,
            ...nonOwnerProbe,
          },
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          neonApiKey: 'napi_test_key',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
          branchResolver: async () => validProdResolved,
        }),
      ).rejects.toThrow(
        /Production migration requires connected role current_user='neondb_owner' and session_user='neondb_owner'/,
      );
    }

    // 8c. Connection URI user other than neondb_owner is also rejected
    const nonOwnerConnInfo = validateMigrationConnectionUrl(
      'postgresql://postgres:secret@ep-prod-endpoint-111.us-east-2.aws.neon.tech/neondb?sslmode=require',
    );
    await expect(
      verifyMigrationTargetIdentity({
        connectionInfo: nonOwnerConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        neonApiKey: 'napi_test_key',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
        branchResolver: async () => validProdResolved,
      }),
    ).rejects.toThrow(
      /Production migration requires MIGRATION_DATABASE_URL user to be 'neondb_owner', got 'postgres'/,
    );

    // 8d. Live PostgreSQL 16 verification: executeSafeMigrationRun connected as administrative role 'postgres'
    //     (not 'neondb_owner') aborts during verifyMigrationTargetIdentity BEFORE any DDL or ORACLE_APP_PASSWORD transmission
    const untrasmittedCanaryPw = 'NeverSentAdminRoleCanary_2026!#Z';
    const capturedQueriesOnReject: Array<{ sql: string; values: unknown[] }> = [];
    const origClientQuery = pg.Client.prototype.query;
    pg.Client.prototype.query = function patchedQuery(
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0];
      const second = args[1];
      const sqlText =
        typeof first === 'string'
          ? first
          : first &&
              typeof first === 'object' &&
              'text' in first &&
              typeof (first as { text: unknown }).text === 'string'
            ? (first as { text: string }).text
            : '';
      const paramValues = Array.isArray(second)
        ? second
        : first &&
            typeof first === 'object' &&
            'values' in first &&
            Array.isArray((first as { values: unknown }).values)
          ? (first as { values: unknown[] }).values
          : [];
      capturedQueriesOnReject.push({ sql: sqlText, values: paramValues });
      return (origClientQuery as (...a: unknown[]) => unknown).apply(
        this,
        args,
      );
    } as typeof pg.Client.prototype.query;

    try {
      await expect(
        executeSafeMigrationRun({
          migrationDatabaseUrl: cluster.adminConnectionString,
          oracleAppPassword: untrasmittedCanaryPw,
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          neonApiKey: 'napi_test_key',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
          branchResolver: async () => validProdResolved,
        }),
      ).rejects.toThrow(
        /Production migration requires connected role current_user='neondb_owner' and session_user='neondb_owner', got current_user='postgres' \/ session_user='postgres'/,
      );
    } finally {
      pg.Client.prototype.query = origClientQuery;
    }

    // Prove only the read-only identity probe ran — zero BEGIN/DDL statements and zero password parameters were sent
    expect(capturedQueriesOnReject.length).toBe(1);
    for (const q of capturedQueriesOnReject) {
      expect(q.sql).not.toMatch(/\bBEGIN\b|\bCREATE\b|\bALTER\b/i);
      expect(q.sql).not.toContain(untrasmittedCanaryPw);
      expect(JSON.stringify(q.values)).not.toContain(untrasmittedCanaryPw);
    }

    // 9. Production ACCEPTED only when ALL exact checks pass (including current_user='neondb_owner' and session_user='neondb_owner')
    const authorizedProdTarget = await verifyMigrationTargetIdentity({
      connectionInfo: directProdConnInfo,
      probe: prodProbe,
      expectedProjectId: 'wispy-cell-45340306',
      expectedBranchName: 'production',
      expectedBranchId: 'br-prod-001',
      productionBranchId: 'br-prod-001',
      neonApiKey: 'napi_test_key',
      productionAuthorization: {
        allowProductionMigration: true,
        confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
      },
      branchResolver: async () => validProdResolved,
    });
    expect(authorizedProdTarget).toEqual({
      verificationMethod: 'neon-control-plane',
      projectId: 'wispy-cell-45340306',
      branchId: 'br-prod-001',
      branchName: 'production',
      endpointId: 'ep-prod-endpoint-111',
      isProduction: true,
    });
  });

  it('18. exercises defaultNeonBranchResolver() and verifyMigrationTargetIdentity() against mocked Neon API HTTP responses (success, auth failures, HTTP errors, missing endpoint/branch, hostname mismatch, project/branch mismatch, malformed responses, and CLI/GUC fallback rejection)', async () => {
    const baseProbe = await probeDatabaseIdentity(adminPool);
    const directProdConnInfo = validateMigrationConnectionUrl(
      'postgresql://neondb_owner:secret@ep-prod-endpoint-111.us-east-2.aws.neon.tech/neondb?sslmode=require',
    );
    const prodProbe = {
      ...baseProbe,
      currentUser: 'neondb_owner',
      sessionUser: 'neondb_owner',
      neonProjectId: 'wispy-cell-45340306',
      neonBranchId: 'br-prod-001',
    };

    const validEndpointsPayload = {
      endpoints: [
        {
          id: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          branch_id: 'br-prod-001',
          project_id: 'wispy-cell-45340306',
        },
      ],
    };
    const validBranchesPayload = {
      branches: [
        {
          id: 'br-prod-001',
          name: 'production',
          project_id: 'wispy-cell-45340306',
          default: true,
          primary: true,
          protected: true,
          parent_id: null,
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    const savedApiKey = process.env.NEON_API_KEY;
    process.env.NEON_API_KEY = 'napi_mock_unit_test_key';

    const mockNeonFetch = (
      handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
    ) => {
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return handler(url, init);
      }) as typeof fetch;
    };

    try {
      // 1. Successful endpoint-to-branch resolution using the actual defaultNeonBranchResolver and Neon API
      const requestedUrls: string[] = [];
      const requestedAuthHeaders: string[] = [];
      mockNeonFetch((url, init) => {
        requestedUrls.push(url);
        const headers = new Headers(init?.headers);
        requestedAuthHeaders.push(headers.get('Authorization') ?? '');
        if (url.endsWith('/projects/wispy-cell-45340306/endpoints')) {
          return new Response(JSON.stringify(validEndpointsPayload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/projects/wispy-cell-45340306/branches')) {
          return new Response(JSON.stringify(validBranchesPayload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not Found', { status: 404 });
      });

      const resolvedDirect = await defaultNeonBranchResolver({
        projectId: 'wispy-cell-45340306',
        endpointId: 'ep-prod-endpoint-111',
        host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
        serverBranchId: 'br-prod-001',
      });
      expect(resolvedDirect).toEqual({
        projectId: 'wispy-cell-45340306',
        branchId: 'br-prod-001',
        branchName: 'production',
        endpointId: 'ep-prod-endpoint-111',
        endpointHost: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
        isDefault: true,
        isPrimary: true,
        isProtected: true,
        parentId: null,
        source: 'neon-api',
      });
      expect(requestedUrls).toEqual([
        'https://console.neon.tech/api/v2/projects/wispy-cell-45340306/endpoints',
        'https://console.neon.tech/api/v2/projects/wispy-cell-45340306/branches',
      ]);
      expect(requestedAuthHeaders).toEqual([
        'Bearer napi_mock_unit_test_key',
        'Bearer napi_mock_unit_test_key',
      ]);

      // Also verify verifyMigrationTargetIdentity succeeds when using the default resolver (no custom branchResolver injected)
      const verifiedViaDefaultResolver = await verifyMigrationTargetIdentity({
        connectionInfo: directProdConnInfo,
        probe: prodProbe,
        expectedProjectId: 'wispy-cell-45340306',
        expectedBranchName: 'production',
        expectedBranchId: 'br-prod-001',
        productionBranchId: 'br-prod-001',
        productionAuthorization: {
          allowProductionMigration: true,
          confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
        },
      });
      expect(verifiedViaDefaultResolver).toEqual({
        verificationMethod: 'neon-control-plane',
        projectId: 'wispy-cell-45340306',
        branchId: 'br-prod-001',
        branchName: 'production',
        endpointId: 'ep-prod-endpoint-111',
        isProduction: true,
      });

      // 2. API authentication failure (401 Unauthorized and 403 Forbidden)
      for (const authStatus of [401, 403]) {
        mockNeonFetch(
          () =>
            new Response(JSON.stringify({ message: 'Unauthorized' }), {
              status: authStatus,
            }),
        );
        const authFailResult = await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        });
        expect(authFailResult).toBeNull();

        await expect(
          verifyMigrationTargetIdentity({
            connectionInfo: directProdConnInfo,
            probe: prodProbe,
            expectedProjectId: 'wispy-cell-45340306',
            expectedBranchName: 'production',
            expectedBranchId: 'br-prod-001',
            productionBranchId: 'br-prod-001',
            productionAuthorization: {
              allowProductionMigration: true,
              confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
            },
          }),
        ).rejects.toThrow(
          /authoritative Neon API verification failed or was unavailable/,
        );
      }

      // 3. HTTP errors (500, 502, partial 404 on branches, and network rejection)
      mockNeonFetch(
        () => new Response('Internal Server Error', { status: 500 }),
      );
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(JSON.stringify(validEndpointsPayload), {
            status: 200,
          });
        }
        return new Response('Bad Gateway', { status: 502 });
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      mockNeonFetch(() => {
        throw new TypeError('fetch failed: network unreachable');
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      // 4. Missing endpoint
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(
            JSON.stringify({
              endpoints: [
                {
                  id: 'ep-unrelated-999',
                  host: 'ep-unrelated-999.us-east-2.aws.neon.tech',
                  branch_id: 'br-prod-001',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(validBranchesPayload), {
          status: 200,
        });
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: prodProbe,
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
        }),
      ).rejects.toThrow(
        /authoritative Neon API verification failed or was unavailable/,
      );

      // 5. Missing branch
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(JSON.stringify(validEndpointsPayload), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: 'br-other-branch-999',
                name: 'preview/pr-99',
                default: false,
                primary: false,
              },
            ],
          }),
          { status: 200 },
        );
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      // 6. Endpoint ID match with a mismatched hostname (and vice versa)
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(
            JSON.stringify({
              endpoints: [
                {
                  id: 'ep-prod-endpoint-111',
                  host: 'ep-mismatched-host-999.us-east-2.aws.neon.tech',
                  branch_id: 'br-prod-001',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(validBranchesPayload), {
          status: 200,
        });
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: prodProbe,
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
        }),
      ).rejects.toThrow(
        /authoritative Neon API verification failed or was unavailable/,
      );

      // 7. Incorrect project or branch identity in API response
      // 7a. Endpoint belongs to a different project_id
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(
            JSON.stringify({
              endpoints: [
                {
                  id: 'ep-prod-endpoint-111',
                  host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
                  branch_id: 'br-prod-001',
                  project_id: 'wrong-project-999',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(validBranchesPayload), {
          status: 200,
        });
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      // 7b. Branch belongs to a different project_id
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(JSON.stringify(validEndpointsPayload), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: 'br-prod-001',
                name: 'production',
                project_id: 'wrong-project-999',
                default: true,
                primary: true,
              },
            ],
          }),
          { status: 200 },
        );
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      // 7c. Branch ID resolved by API disagrees with serverBranchId (GUC neon.branch_id)
      mockNeonFetch((url) => {
        if (url.endsWith('/endpoints')) {
          return new Response(
            JSON.stringify({
              endpoints: [
                {
                  id: 'ep-prod-endpoint-111',
                  host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
                  branch_id: 'br-unexpected-branch-999',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: 'br-unexpected-branch-999',
                name: 'production',
                default: true,
                primary: true,
              },
            ],
          }),
          { status: 200 },
        );
      });
      expect(
        await defaultNeonBranchResolver({
          projectId: 'wispy-cell-45340306',
          endpointId: 'ep-prod-endpoint-111',
          host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
          serverBranchId: 'br-prod-001',
        }),
      ).toBeNull();

      // And even when serverBranchId GUC is null, verifyMigrationTargetIdentity rejects the wrong branch ID resolved via defaultNeonBranchResolver
      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: {
            ...prodProbe,
            neonBranchId: null,
          },
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
        }),
      ).rejects.toThrow(
        /does not match expected production branch ID 'br-prod-001'/,
      );

      // 8. Incomplete or malformed API responses
      const malformedPayloads: Array<{
        endpointsBody: string;
        branchesBody: string;
      }> = [
        { endpointsBody: 'not-valid-json{{{', branchesBody: '{}' },
        { endpointsBody: 'null', branchesBody: 'null' },
        { endpointsBody: '{}', branchesBody: '{}' },
        {
          endpointsBody: JSON.stringify({ endpoints: 'not-an-array' }),
          branchesBody: JSON.stringify(validBranchesPayload),
        },
        {
          endpointsBody: JSON.stringify({
            endpoints: [{ id: 'ep-prod-endpoint-111' }], // missing host & branch_id
          }),
          branchesBody: JSON.stringify(validBranchesPayload),
        },
        {
          endpointsBody: JSON.stringify(validEndpointsPayload),
          branchesBody: JSON.stringify({
            branches: [{ id: 'br-prod-001', name: '' }], // empty branch name
          }),
        },
      ];

      for (const malformed of malformedPayloads) {
        mockNeonFetch((url) => {
          if (url.endsWith('/endpoints')) {
            return new Response(malformed.endpointsBody, { status: 200 });
          }
          return new Response(malformed.branchesBody, { status: 200 });
        });
        expect(
          await defaultNeonBranchResolver({
            projectId: 'wispy-cell-45340306',
            endpointId: 'ep-prod-endpoint-111',
            host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
            serverBranchId: 'br-prod-001',
          }),
        ).toBeNull();
      }

      // 9. Production authorization path never accepts CLI or GUC-only fallback after API verification fails
      let cliFallbackInvocations = 0;
      mockNeonFetch(
        () => new Response('Service Unavailable', { status: 503 }),
      );

      // Confirm that defaultNeonBranchResolver with allowCliFallback: false (as used in production path)
      // never calls cliFallbackRunner after API failure
      const prodResolverResult = await defaultNeonBranchResolver({
        projectId: 'wispy-cell-45340306',
        endpointId: 'ep-prod-endpoint-111',
        host: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
        serverBranchId: 'br-prod-001',
        allowCliFallback: false,
        cliFallbackRunner: async () => {
          cliFallbackInvocations += 1;
          return {
            projectId: 'wispy-cell-45340306',
            branchId: 'br-prod-001',
            branchName: 'production',
            endpointId: 'ep-prod-endpoint-111',
            endpointHost: 'ep-prod-endpoint-111.us-east-2.aws.neon.tech',
            isDefault: true,
            isPrimary: true,
            isProtected: true,
            parentId: null,
            source: 'neon-cli',
          };
        },
      });
      expect(prodResolverResult).toBeNull();
      expect(cliFallbackInvocations).toBe(0);

      // And when verifyMigrationTargetIdentity runs on the production path with the real defaultNeonBranchResolver
      // while Neon API fails (503) and prodProbe.neonBranchId === 'br-prod-001' (matching expectedBranchId),
      // it rejects and never falls back to GUC-only verification
      await expect(
        verifyMigrationTargetIdentity({
          connectionInfo: directProdConnInfo,
          probe: prodProbe,
          expectedProjectId: 'wispy-cell-45340306',
          expectedBranchName: 'production',
          expectedBranchId: 'br-prod-001',
          productionBranchId: 'br-prod-001',
          productionAuthorization: {
            allowProductionMigration: true,
            confirmProductionPhrase: 'APPLY_PRODUCTION_MIGRATION',
          },
        }),
      ).rejects.toThrow(
        /Production migration aborted: authoritative Neon API verification failed or was unavailable for endpoint 'ep-prod-endpoint-111' \(GUC-only and CLI fallbacks are forbidden for production\)/,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (savedApiKey === undefined) {
        delete process.env.NEON_API_KEY;
      } else {
        process.env.NEON_API_KEY = savedApiKey;
      }
    }
  });

  it('19. serves unified SPA + /v1 API, resolves canonical questions with abstention and deduplication, and supports token-authenticated official publication and append-only resolution events', async () => {
    const pubToken = 'OracleTrustedPubToken_2026_HighEntropy_99!';
    const distDir = resolve(process.cwd(), 'dist');

    const running = await startOracleServer({
      databaseUrl: cluster.appConnectionString,
      port: 0,
      host: '127.0.0.1',
      publicationToken: pubToken,
      staticDir: existsSync(resolve(distDir, 'index.html')) ? distDir : null,
    });

    const baseUrl = `http://127.0.0.1:${running.port}`;

    try {
      // 1. GET /v1/health
      const healthRes = await fetch(`${baseUrl}/v1/health`);
      expect(healthRes.status).toBe(200);
      expect(healthRes.headers.get('access-control-allow-origin')).toBe('*');
      const healthBody = (await healthRes.json()) as {
        status: string;
        service: string;
        protocolVersion: string;
        runtimeRole: string;
      };
      expect(healthBody.status).toBe('ok');
      expect(healthBody.service).toBe('the-oracle');
      expect(healthBody.protocolVersion).toBe('1.10');
      expect(healthBody.runtimeRole).toBe('oracle_app');

      // 2. Centralized canonical question resolution & abstention on vague or uncalibrated questions
      const vagueRes = await fetch(
        `${baseUrl}/v1/questions/resolve?q=${encodeURIComponent('Will AI change the economy soon?')}`,
      );
      expect(vagueRes.status).toBe(200);
      const vagueBody = (await vagueRes.json()) as {
        identityComplete: boolean;
        autonomousDecision: string;
        unresolvedComponents: string[];
        abstentionReasons: string[];
      };
      expect(vagueBody.identityComplete).toBe(false);
      expect(vagueBody.autonomousDecision).toBe('abstain');
      expect(vagueBody.unresolvedComponents.length).toBeGreaterThan(0);

      // Equivalent phrasings resolve to the exact same canonical identityDigest
      const eq1Res = await fetch(
        `${baseUrl}/v1/questions/resolve?q=${encodeURIComponent('Will global battery storage exceed 1,200 GW in 2028 according to the IEA?')}`,
      );
      const eq2Res = await fetch(`${baseUrl}/v1/questions/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:
            'According to the International Energy Agency, will worldwide grid battery storage pass 1200 gigawatts by 2028?',
        }),
      });
      expect(eq1Res.status).toBe(200);
      expect(eq2Res.status).toBe(200);
      const eq1Body = (await eq1Res.json()) as {
        identityComplete: boolean;
        identityDigest: string;
        identity: unknown;
      };
      const eq2Body = (await eq2Res.json()) as {
        identityComplete: boolean;
        identityDigest: string;
        identity: unknown;
      };
      expect(eq1Body.identityComplete).toBe(true);
      expect(eq2Body.identityComplete).toBe(true);
      expect(eq1Body.identityDigest).toBe(eq2Body.identityDigest);
      expect(eq1Body.identity).toEqual(eq2Body.identity);

      // 3. Unauthenticated or wrong-token write attempts still fail closed with 403 trusted_server_only
      const unauthPub = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(unauthPub.status).toBe(403);

      const wrongTokenPub = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token-value-1234567890',
        },
        body: JSON.stringify({}),
      });
      expect(wrongTokenPub.status).toBe(403);

      // 4. Authenticated POST /v1/publications abstains (422) when candidate is missing evidence or probability
      const baseCandidate = buildDraftCandidate('api-e2e-1', {
        condition: { namespace: 'threshold', id: 'below-18-percent-api-test' },
      });
      const incompleteCandidate = {
        ...baseCandidate,
        probability: null,
        evidence: [],
      };
      const abstainedPub = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pubToken}`,
        },
        body: JSON.stringify({
          candidate: incompleteCandidate,
          idempotencyKey: 'idem-abstain-api-001',
          publishedAt: '2026-05-01T10:00:00.000Z',
          recordedAt: '2026-05-01T10:00:01.000Z',
        }),
      });
      expect(abstainedPub.status).toBe(422);
      const abstainedBody = (await abstainedPub.json()) as {
        status: string;
        error: string;
        abstentionReasons: string[];
      };
      expect(abstainedBody.status).toBe('abstained');
      expect(abstainedBody.error).toBe('publication_abstained');
      expect(abstainedBody.abstentionReasons.join(' ')).toMatch(
        /probability-in-range|recorded-evidence/,
      );

      // 5. Authenticated POST /v1/publications commits a valid official prediction (201 Created)
      const validPubRes = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pubToken}`,
        },
        body: JSON.stringify({
          candidate: baseCandidate,
          idempotencyKey: 'idem-valid-api-001',
          publishedAt: '2026-11-10T10:00:00.000Z',
          recordedAt: '2026-11-10T10:00:01.000Z',
        }),
      });
      expect(validPubRes.status).toBe(201);
      const validPubBody = (await validPubRes.json()) as {
        status: string;
        outcome: {
          kind: string;
          predictionId: string;
          identityDigest: string;
          record: { id: string; demo: boolean; probability: number };
        };
      };
      expect(validPubBody.status).toBe('created');
      expect(validPubBody.outcome.record.demo).toBe(false);
      const createdId = validPubBody.outcome.predictionId;
      const originalProbability = validPubBody.outcome.record.probability;

      // 6. Submitting another candidate with the same canonical proposition identity deduplicates to 'existing' (200 OK)
      const duplicateCandidate = {
        ...baseCandidate,
        candidateId: 'cand-api-e2e-duplicate',
      };
      const dupPubRes = await fetch(`${baseUrl}/v1/publications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pubToken}`,
        },
        body: JSON.stringify({
          candidate: duplicateCandidate,
          idempotencyKey: 'idem-dup-api-002',
          publishedAt: '2026-11-11T10:00:00.000Z',
          recordedAt: '2026-11-11T10:00:01.000Z',
        }),
      });
      expect(dupPubRes.status).toBe(200);
      const dupPubBody = (await dupPubRes.json()) as {
        status: string;
        outcome: { kind: string; predictionId: string };
      };
      expect(dupPubBody.status).toBe('existing');
      expect(dupPubBody.outcome.predictionId).toBe(createdId);

      // 7. Authenticated POST /v1/predictions/:id/events appends a separate terminal resolution event
      //    while keeping the published prediction and its original probability immutable
      const resolveEventRes = await fetch(
        `${baseUrl}/v1/predictions/${encodeURIComponent(createdId)}/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pubToken}`,
          },
          body: JSON.stringify({
            eventId: `ev-${createdId.toLowerCase()}-002`,
            type: 'resolved',
            occurredAt: '2029-01-15T12:00:00.000Z',
            recordedAt: '2029-01-15T12:00:05.000Z',
            outcome: 'yes',
            basis: 'IEA Electricity Market Report 2029 confirmed cumulative grid storage exceeded 1,800 GW.',
            note: 'Verified against primary IEA table 4.2.',
            sourceUrls: ['https://example.org/iea-2029-storage'],
          }),
        },
      );
      expect(resolveEventRes.status).toBe(201);
      const resolveEventBody = (await resolveEventRes.json()) as {
        predictionId: string;
        event: { seq: string; kind: string };
        prediction: { probability: number; demo: boolean };
        lifecycle: { status: string; resolution?: { outcome: string } };
      };
      expect(resolveEventBody.event.seq).toBe('e1');
      expect(resolveEventBody.event.kind).toBe('resolved');
      expect(resolveEventBody.prediction.probability).toBe(originalProbability);
      expect(resolveEventBody.lifecycle.status).toBe('resolved');
      expect(resolveEventBody.lifecycle.resolution?.outcome).toBe('yes');

      // Second terminal event on the same prediction is rejected with 409
      const secondResolveRes = await fetch(
        `${baseUrl}/v1/predictions/${encodeURIComponent(createdId)}/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pubToken}`,
          },
          body: JSON.stringify({
            eventId: `ev-${createdId.toLowerCase()}-003`,
            type: 'resolved',
            occurredAt: '2029-02-01T12:00:00.000Z',
            recordedAt: '2029-02-01T12:00:05.000Z',
            outcome: 'no',
            basis: 'Attempted second resolution.',
            note: 'Should fail.',
          }),
        },
      );
      expect(secondResolveRes.status).toBe(409);

      // 8. If dist/index.html is built, verify unified static SPA serving on /, /predictions, /explore
      if (existsSync(resolve(distDir, 'index.html'))) {
        for (const spaRoute of ['/', '/predictions', '/explore', '/trends', '/about']) {
          const spaRes = await fetch(`${baseUrl}${spaRoute}`);
          expect(spaRes.status).toBe(200);
          expect(spaRes.headers.get('content-type')).toContain('text/html');
          const html = await spaRes.text();
          expect(html).toContain('<div id="root">');
        }
      }
    } finally {
      await running.close();
    }
  });
});
