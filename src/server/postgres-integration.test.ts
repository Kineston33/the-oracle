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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  PostgresPublicationRegistry,
  RuntimeRoleSecurityError,
  executeSafeMigrationRun,
  formatSafeMigrationReport,
  probeDatabaseIdentity,
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
});
