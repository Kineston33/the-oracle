/**
 * Persistent PostgreSQL 16+ implementation of `PublicationRegistry` and ledger read store
 * for Official Publication Protocol v1.10 (`docs/PUBLICATION-API-CONTRACT.md`).
 *
 * All runtime queries execute as `oracle_app`:
 *   · Reads (`findByIdempotencyKey`, `findByIdentity`, `listPredictions`, `getPredictionById`,
 *     `getPredictionEvents`) use read-only `SELECT` statements on `oracle_ledger`.
 *   · Writes (`commitPublication`, `recordIdempotencyKey`, `appendResolutionEvent`) execute
 *     exclusively through the three approved `SECURITY DEFINER` functions in `oracle_ledger`
 *     inside explicit `READ COMMITTED` transactions.
 *   · Never executes direct runtime `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` against
 *     protected ledger tables.
 */

import type { Pool, PoolClient } from 'pg';
import {
  EVENT_ALGORITHM,
  EVENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  canonicalize,
  eventEnvelope,
  nextEvent,
  type EventEnvelope,
} from '../data/events.ts';
import { sha256Hex } from '../data/hash.ts';
import { parseIsoDateTimeMs } from '../data/publication.ts';
import type {
  AtomicPublicationCommit,
  AtomicPublicationResult,
  IdempotencyLookupResult,
  IdempotencyRecordResult,
  PublicationOutcome,
  PublicationRegistry,
} from '../data/publication-types.ts';
import {
  filterRecords,
  sortByPublication,
  type RecordFilter,
} from '../data/records.ts';
import type {
  AnnulledEventBody,
  EventOrigin,
  PredictionRecord,
  RecordEvent,
  ResolvedEventBody,
} from '../data/types.ts';
import {
  eventChainProblems,
  publishedLinkProblems,
  recomputeDeclaredDigest,
} from '../data/validate.ts';

interface OfficialPredictionRow {
  prediction_id: string;
  identity_digest: string;
  sealed_payload: PredictionRecord;
  payload_digest: string;
  published_at: Date | string;
  recorded_at: Date | string;
}

interface PredictionEventRow {
  prediction_id: string;
  seq: string;
  kind: 'published' | 'resolved' | 'annulled';
  occurred_at: Date | string;
  recorded_at: Date | string;
  envelope: EventEnvelope;
  digest: string;
  prev_digest: string | null;
}

interface IdempotencyKeyRow {
  request_digest: string;
  outcome: PublicationOutcome;
}

export interface PostgresPublicationRegistryOptions {
  /**
   * PostgreSQL connection pool (configured as `oracle_app` in production, or a pool
   * where `sessionRole: 'oracle_app'` sets the session role before each operation).
   */
  pool: Pool;
  /**
   * Injected UTC clock used when recording rejected or identity-conflict idempotency
   * rows (`oracle_ledger.record_rejected_or_conflict_idempotency`).
   */
  now?: () => string;
  /**
   * Optional role to set on each leased client (`SET ROLE` / `SET SESSION AUTHORIZATION`)
   * when sharing a test pool. In production, `DATABASE_URL` connects directly as `oracle_app`.
   */
  sessionAuthorizationRole?: string;
}

export interface AppendResolutionEventInput {
  predictionId: string;
  kind: 'resolved' | 'annulled';
  occurredAt: string;
  recordedAt: string;
  body: ResolvedEventBody | AnnulledEventBody;
  origin?: EventOrigin;
}

export interface PredictionEventsVerification {
  predictionId: string;
  demo: boolean;
  payloadDigest: string;
  events: RecordEvent[];
  verification: {
    valid: boolean;
    problems: string[];
  };
}

function reconstructEventFromRow(row: PredictionEventRow): RecordEvent {
  const env = row.envelope;
  const schemaMatch = /^oracle\.event\/(\d+)$/.exec(String(env.schema ?? ''));
  const schemaVersion = schemaMatch
    ? (Number(schemaMatch[1]) as typeof EVENT_SCHEMA_VERSION)
    : EVENT_SCHEMA_VERSION;

  return Object.freeze({
    seq: row.seq,
    kind: row.kind,
    occurredAt: env.occurredAt,
    recordedAt: env.recordedAt,
    origin: env.origin,
    algorithm: env.algorithm as typeof EVENT_ALGORITHM,
    schemaVersion,
    scope: env.scope,
    body: env.body,
    digest: row.digest.trim(),
    prevDigest: row.prev_digest ? row.prev_digest.trim() : null,
  });
}

function reconstructPredictionRecord(
  predRow: OfficialPredictionRow,
  eventRows: readonly PredictionEventRow[],
): PredictionRecord {
  const base = predRow.sealed_payload;
  const events =
    eventRows.length > 0
      ? eventRows.map(reconstructEventFromRow)
      : (base.events ?? []);

  return Object.freeze({
    ...base,
    id: predRow.prediction_id,
    demo: false,
    events,
    integrity: Object.freeze({
      ...base.integrity,
      digest: predRow.payload_digest.trim(),
    }),
  });
}

function freezePredictionRecord(record: PredictionRecord): PredictionRecord {
  const frozenEvents = Array.isArray(record.events)
    ? Object.freeze(record.events.map((ev) => Object.freeze({ ...ev })))
    : Object.freeze([]);
  return Object.freeze({
    ...record,
    demo: false,
    events: frozenEvents as unknown as RecordEvent[],
    integrity: Object.freeze({ ...record.integrity }),
  });
}

function normalizeStoredOutcome(outcome: PublicationOutcome): PublicationOutcome {
  if ((outcome.kind === 'created' || outcome.kind === 'existing') && outcome.record) {
    return {
      ...outcome,
      record: freezePredictionRecord(outcome.record),
    };
  }
  return outcome;
}

export class PostgresPublicationRegistry implements PublicationRegistry {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly sessionAuthRole?: string;

  constructor(options: PostgresPublicationRegistryOptions) {
    this.pool = options.pool;
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionAuthRole = options.sessionAuthorizationRole;
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (this.sessionAuthRole) {
        const safeRole = this.sessionAuthRole.replace(/"/g, '""');
        await client.query(`SET SESSION AUTHORIZATION "${safeRole}"`);
      }
      return await fn(client);
    } finally {
      if (this.sessionAuthRole) {
        try {
          await client.query('RESET SESSION AUTHORIZATION');
        } catch {
          // Ignore reset errors if the connection is broken
        }
      }
      client.release();
    }
  }

  async findByIdempotencyKey(
    key: string,
    requestDigest: string,
  ): Promise<IdempotencyLookupResult> {
    return this.withClient(async (client) => {
      const res = await client.query<IdempotencyKeyRow>(
        `SELECT request_digest, outcome
           FROM oracle_ledger.publication_idempotency_keys
          WHERE idempotency_key = $1
            AND (outcome ->> 'kind') IN ('created', 'existing', 'identity-conflict', 'rejected')`,
        [key],
      );

      if (res.rowCount === 0 || !res.rows[0]) {
        return { status: 'miss' };
      }

      const existingDigest = res.rows[0].request_digest.trim();
      const storedOutcome = res.rows[0].outcome;

      if (existingDigest === requestDigest) {
        return {
          status: 'match',
          requestDigest: existingDigest,
          outcome: normalizeStoredOutcome(storedOutcome),
        };
      }

      return {
        status: 'conflict',
        existingRequestDigest: existingDigest,
        incomingRequestDigest: requestDigest,
      };
    });
  }

  async findByIdentity(
    identityDigest: string,
  ): Promise<{ predictionId: string; record?: PredictionRecord } | null> {
    return this.withClient(async (client) => {
      const predRes = await client.query<OfficialPredictionRow>(
        `SELECT prediction_id, identity_digest, sealed_payload, payload_digest, published_at, recorded_at
           FROM oracle_ledger.official_predictions
          WHERE identity_digest = $1`,
        [identityDigest],
      );

      const predRow = predRes.rows[0];
      if (!predRow) return null;

      const eventRes = await client.query<PredictionEventRow>(
        `SELECT prediction_id, seq, kind, occurred_at, recorded_at, envelope, digest, prev_digest
           FROM oracle_ledger.prediction_events
          WHERE prediction_id = $1
          ORDER BY seq ASC`,
        [predRow.prediction_id],
      );

      return {
        predictionId: predRow.prediction_id,
        record: reconstructPredictionRecord(predRow, eventRes.rows),
      };
    });
  }

  async recordIdempotencyKey(
    key: string,
    requestDigest: string,
    outcome: PublicationOutcome,
  ): Promise<IdempotencyRecordResult> {
    return this.withClient(async (client) => {
      const recordedAt = this.now();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      try {
        const res = await client.query<{ result: IdempotencyRecordResult }>(
          `SELECT oracle_ledger.record_rejected_or_conflict_idempotency(
             $1, $2, $3::jsonb, $4::timestamptz
           ) AS result`,
          [key, requestDigest, JSON.stringify(outcome), recordedAt],
        );
        await client.query('COMMIT');
        const payload = res.rows[0]?.result;
        if (!payload) {
          throw new Error(
            'record_rejected_or_conflict_idempotency returned an empty result',
          );
        }
        return payload;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async commitPublication(
    commit: AtomicPublicationCommit,
  ): Promise<AtomicPublicationResult> {
    const e0 = commit.record.events[0];
    if (!e0 || e0.seq !== 'e0' || e0.kind !== 'published') {
      throw new Error(
        `commitPublication requires initial e0 'published' event on record ${commit.predictionId}`,
      );
    }

    const e0Env = eventEnvelope(e0);
    const payloadDigest = commit.record.integrity.digest;
    const publishedAt = commit.record.publishedAt;
    const recordedAt = e0.recordedAt;

    return this.withClient(async (client) => {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      try {
        const res = await client.query<{ result: AtomicPublicationResult }>(
          `SELECT oracle_ledger.commit_official_publication(
             $1,
             $2,
             $3,
             $4,
             $5::jsonb,
             $6,
             $7::timestamptz,
             $8::timestamptz,
             $9::jsonb,
             $10
           ) AS result`,
          [
            commit.idempotencyKey,
            commit.requestDigest,
            commit.predictionId,
            commit.identityDigest,
            JSON.stringify(commit.record),
            payloadDigest,
            publishedAt,
            recordedAt,
            JSON.stringify(e0Env),
            e0.digest,
          ],
        );

        await client.query('COMMIT');
        const payload = res.rows[0]?.result;
        if (!payload) {
          throw new Error('commit_official_publication returned an empty result');
        }
        if (payload.status === 'created') {
          return {
            status: 'created',
            outcome: normalizeStoredOutcome(payload.outcome) as Extract<
              PublicationOutcome,
              { kind: 'created' }
            >,
          };
        }
        if (payload.status === 'existing') {
          return {
            status: 'existing',
            outcome: normalizeStoredOutcome(payload.outcome) as Extract<
              PublicationOutcome,
              { kind: 'existing' }
            >,
          };
        }
        if (payload.status === 'replayed') {
          return {
            status: 'replayed',
            original: normalizeStoredOutcome(payload.original),
          };
        }
        return payload;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async claimIdentity(
    identityDigest: string,
    predictionId: string,
    record?: PredictionRecord,
  ): Promise<{ status: 'claimed' } | { status: 'already-claimed'; predictionId: string }> {
    if (!record) {
      throw new Error(
        'Direct claimIdentity without a sealed PredictionRecord is forbidden on PostgreSQL: oracle_app has no direct INSERT privilege on oracle_ledger.official_predictions and must commit via commitPublication.',
      );
    }
    const syntheticRequestDigest = await sha256Hex(
      `oracle.claim-identity/1\n${identityDigest}\n${predictionId}`,
    );
    const result = await this.commitPublication({
      idempotencyKey: `claim:${identityDigest}:${predictionId}`,
      requestDigest: syntheticRequestDigest,
      identityDigest,
      predictionId,
      record,
    });
    if (result.status === 'created') {
      return { status: 'claimed' };
    }
    if (result.status === 'existing') {
      return { status: 'already-claimed', predictionId: result.outcome.predictionId };
    }
    if (
      result.status === 'replayed' &&
      (result.original.kind === 'created' || result.original.kind === 'existing')
    ) {
      return result.original.kind === 'created'
        ? { status: 'claimed' }
        : { status: 'already-claimed', predictionId: result.original.predictionId };
    }
    throw new Error(`Unexpected result from claimIdentity: ${result.status}`);
  }

  /**
   * Append a single terminal resolution (`resolved` | `annulled`) event `e1`
   * via `oracle_ledger.append_terminal_prediction_event` without mutating
   * `sealed_payload` or `probability`.
   */
  async appendResolutionEvent(
    input: AppendResolutionEventInput,
  ): Promise<PredictionRecord> {
    const occurredMs = parseIsoDateTimeMs(input.occurredAt);
    const recordedMs = parseIsoDateTimeMs(input.recordedAt);
    if (occurredMs === null || recordedMs === null || recordedMs <= occurredMs) {
      throw new Error(
        `Invalid resolution timestamps: recordedAt (${input.recordedAt}) must be valid UTC ISO-8601 and strictly after occurredAt (${input.occurredAt}).`,
      );
    }

    const existing = await this.getPredictionById(input.predictionId);
    if (!existing) {
      throw new Error(`Official prediction '${input.predictionId}' does not exist.`);
    }

    const e0 = existing.events[0];
    if (!e0 || e0.seq !== 'e0') {
      throw new Error(
        `Official prediction '${input.predictionId}' is missing its initial e0 event.`,
      );
    }

    const draftE1 = nextEvent(
      existing,
      input.kind,
      input.occurredAt,
      input.body,
      {
        digest: '0'.repeat(64),
        recordedAt: input.recordedAt,
        origin: input.origin ?? 'observed',
      },
    );
    const e1Env: EventEnvelope = eventEnvelope(draftE1);
    const e1Digest = await sha256Hex(canonicalize(e1Env));

    await this.withClient(async (client) => {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      try {
        await client.query(
          `SELECT oracle_ledger.append_terminal_prediction_event(
             $1,
             $2,
             $3::timestamptz,
             $4::timestamptz,
             $5::jsonb,
             $6,
             $7
           )`,
          [
            input.predictionId,
            input.kind,
            input.occurredAt,
            input.recordedAt,
            JSON.stringify(e1Env),
            e1Digest,
            e0.digest,
          ],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    const updated = await this.getPredictionById(input.predictionId);
    if (!updated) {
      throw new Error(
        `Failed to reload official prediction '${input.predictionId}' after appending e1.`,
      );
    }
    return updated;
  }

  /**
   * Read a single official prediction (`demo: false`) by `predictionId`,
   * reconstructing its ordered append-only event chain from `oracle_ledger.prediction_events`.
   */
  async getPredictionById(predictionId: string): Promise<PredictionRecord | null> {
    return this.withClient(async (client) => {
      const predRes = await client.query<OfficialPredictionRow>(
        `SELECT prediction_id, identity_digest, sealed_payload, payload_digest, published_at, recorded_at
           FROM oracle_ledger.official_predictions
          WHERE prediction_id = $1`,
        [predictionId],
      );
      const predRow = predRes.rows[0];
      if (!predRow) return null;

      const eventRes = await client.query<PredictionEventRow>(
        `SELECT prediction_id, seq, kind, occurred_at, recorded_at, envelope, digest, prev_digest
           FROM oracle_ledger.prediction_events
          WHERE prediction_id = $1
          ORDER BY seq ASC`,
        [predictionId],
      );

      return reconstructPredictionRecord(predRow, eventRes.rows);
    });
  }

  /**
   * List official predictions from `oracle_ledger.official_predictions`, with optional
   * filtering by category, lifecycle status, or search query.
   */
  async listOfficialPredictions(filter?: RecordFilter): Promise<PredictionRecord[]> {
    const records = await this.withClient(async (client) => {
      const predRes = await client.query<OfficialPredictionRow>(
        `SELECT prediction_id, identity_digest, sealed_payload, payload_digest, published_at, recorded_at
           FROM oracle_ledger.official_predictions
          ORDER BY published_at DESC, prediction_id ASC`,
      );
      if (predRes.rows.length === 0) return [];

      const eventRes = await client.query<PredictionEventRow>(
        `SELECT prediction_id, seq, kind, occurred_at, recorded_at, envelope, digest, prev_digest
           FROM oracle_ledger.prediction_events
          ORDER BY prediction_id ASC, seq ASC`,
      );

      const eventsByPred = new Map<string, PredictionEventRow[]>();
      for (const row of eventRes.rows) {
        const list = eventsByPred.get(row.prediction_id);
        if (list) list.push(row);
        else eventsByPred.set(row.prediction_id, [row]);
      }

      return predRes.rows.map((pred) =>
        reconstructPredictionRecord(pred, eventsByPred.get(pred.prediction_id) ?? []),
      );
    });

    const filtered = filter ? filterRecords(records, filter) : records;
    return sortByPublication(filtered, 'newest');
  }

  /**
   * Retrieve the ordered append-only event chain (`e0`, `e1`) for an official prediction
   * and verify its payload link and schema-2 event digests.
   */
  async getPredictionEventsWithVerification(
    predictionId: string,
  ): Promise<PredictionEventsVerification | null> {
    const record = await this.getPredictionById(predictionId);
    if (!record) return null;

    const problems: string[] = [...eventChainProblems(record)];
    const recomputedPayloadDigest = await recomputeDeclaredDigest(record);
    const payloadMatches = recomputedPayloadDigest === record.integrity.digest;
    problems.push(
      ...publishedLinkProblems(record, payloadMatches, recomputedPayloadDigest),
    );

    for (const event of record.events) {
      if (
        event.algorithm !== EVENT_ALGORITHM ||
        !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)
      ) {
        problems.push(
          `Record ${record.id} event ${event.seq} uses unsupported algorithm or schemaVersion`,
        );
        continue;
      }
      const recomputedEventDigest = await sha256Hex(canonicalize(eventEnvelope(event)));
      if (recomputedEventDigest !== event.digest) {
        problems.push(
          `Record ${record.id} event ${event.seq} digest does not reproduce from its contents`,
        );
      }
    }

    return {
      predictionId: record.id,
      demo: record.demo,
      payloadDigest: record.integrity.digest,
      events: record.events,
      verification: {
        valid: problems.length === 0,
        problems,
      },
    };
  }
}
