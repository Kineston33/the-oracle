/**
 * Archive validation.
 *
 * This module deliberately imports no JSON and no browser APIs, so the exact
 * same rules run in three places:
 *
 *   1. the test suite,
 *   2. `scripts/validate-archive.mjs`, which `npm run build` and
 *      `npm run seal` both invoke, and
 *   3. any future publication pipeline.
 *
 * The rule this file exists to enforce: one canonical question maps to exactly
 * one official prediction.
 */

import type { EventDigestScope, PredictionRecord } from './types.ts';
import { deriveLifecycle } from './lifecycle.ts';
import {
  CHAINED_SCOPE,
  EVENT_ALGORITHM,
  PUBLISHED_SCOPE,
  SUPPORTED_SCHEMA_VERSIONS,
  canonicalize,
  eventEnvelope as eventEnvelopeOf,
  expectedScope,
  legacyPayloadShape,
  sealedPayload,
} from './events.ts';
import { sha256Hex } from './hash.ts';

/**
 * A comparison form for a canonical question: case, punctuation, quotes and
 * whitespace are folded so that two records asking the same thing with
 * different typography produce the same key.
 *
 * Unicode-aware on purpose. `\p{L}` keeps letters from every script and `\p{M}`
 * keeps combining marks, so accented Latin, Cyrillic, Greek, Arabic, Hebrew and
 * the Indic scripts all survive intact. An earlier ASCII-only pattern
 * (`[^a-z0-9]`) silently deleted every non-English word, which meant an Arabic
 * or Russian question reduced to its digits and collided with any other.
 *
 * NFKC runs first so compatibility equivalents fold together: ﬁ → fi, ① → 1,
 * full-width ＡＢＣ → ABC. Diacritics are *not* stripped — "baterias" and
 * "baterías" stay distinct, because in a forecasting archive they can be
 * different questions and a false merge is worse than a missed one. Falling
 * back to a diacritic-insensitive comparison is listed as a known limitation.
 *
 * This compares wording, not meaning. Two paraphrase-equivalent questions are
 * not detected; that is a stated limitation, not something this function
 * pretends to solve.
 */
export function canonicalKey(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, '"')
    // Keep letters, numbers and combining marks from any script. Everything
    // else (whitespace, punctuation, symbols) becomes a single separator.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QuestionCollision {
  key: string;
  ids: string[];
}

/**
 * Finds canonical questions that appear on more than one record.
 *
 * Revisions live *on* a record (`integrity.revision`), so a second record
 * carrying the same canonical question is never a legitimate revision — it is a
 * fork, and two true answers to the same question would then exist.
 */
export function findCanonicalCollisions(
  records: readonly PredictionRecord[],
): QuestionCollision[] {
  const byKey = new Map<string, string[]>();
  for (const record of records) {
    const key = canonicalKey(record.canonicalQuestion);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(record.id);
    else byKey.set(key, [record.id]);
  }

  const collisions: QuestionCollision[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length > 1) collisions.push({ key, ids });
  }
  return collisions;
}

/**
 * Structural checks over the archive. Returns human-readable problems; an empty
 * array means the archive is publishable.
 */
export function assertArchiveShape(records: readonly PredictionRecord[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) problems.push(`Duplicate record id: ${record.id}`);
    ids.add(record.id);

    if (!/^ORC-\d{4}-\d{4}$/.test(record.id)) {
      problems.push(`Malformed record id: ${record.id}`);
    }
    if (!record.demo) problems.push(`Record ${record.id} is missing the demo flag`);
    if (record.evidence.length === 0) problems.push(`Record ${record.id} has no evidence`);
    if (record.probability <= 0 || record.probability >= 1) {
      problems.push(`Record ${record.id} has an out-of-range probability`);
    }
    if (!/^[0-9a-f]{64}$/.test(record.integrity.digest)) {
      problems.push(`Record ${record.id} has no valid SHA-256 digest`);
    }
    if (Date.parse(record.horizon.endsAt) <= Date.parse(record.publishedAt)) {
      problems.push(`Record ${record.id} ends before it was published`);
    }
    if (Date.parse(record.resolutionCriteria.resolveOn) < Date.parse(record.horizon.endsAt)) {
      problems.push(`Record ${record.id} resolves before its horizon ends`);
    }
    const lifecycle = deriveLifecycle(record);
    if (lifecycle.status === 'resolved' && lifecycle.resolution?.outcome === 'indeterminate') {
      problems.push(`Record ${record.id} is resolved with an indeterminate outcome`);
    }
    if (!canonicalKey(record.canonicalQuestion)) {
      problems.push(`Record ${record.id} has an empty canonical question`);
    }
    if (!record.integrity.payloadScope) {
      problems.push(`Record ${record.id} does not declare which payload its digest covers`);
    }
    if (!record.sealClaim) {
      problems.push(`Record ${record.id} does not declare what its seal demonstrates`);
    }
    problems.push(...eventChainProblems(record));
  }

  // One canonical question, one official prediction.
  for (const collision of findCanonicalCollisions(records)) {
    problems.push(
      `Canonical question claimed by more than one record without supersession: ${collision.ids.join(', ')}`,
    );
  }

  return problems;
}

/**
 * Full validation: structural checks plus the cryptographic ones.
 *
 * Structural checks alone cannot prove that `integrity.digest` is the digest of
 * the shipped payload, because they never hash anything. This is the entry point
 * the build gate uses, and it is the one that closes that gap: a payload edited
 * together with its recorded digest still fails, because the publication event
 * names the digest it was issued with and that event is inside the chain.
 */
export async function validateArchive(
  records: readonly PredictionRecord[],
): Promise<string[]> {
  const problems = assertArchiveShape(records);

  for (const record of records) {
    let recomputed: string | null = null;
    try {
      recomputed = await recomputeDeclaredDigest(record);
    } catch (error) {
      problems.push(
        `Record ${record.id} digest could not be recomputed: ${(error as Error).message}`,
      );
    }
    const matches = recomputed !== null && recomputed === record.integrity.digest;
    problems.push(...publishedLinkProblems(record, matches, recomputed));

    // Every event digest must reproduce, under the algorithm it declares.
    for (const event of record.events) {
      if (
        event.algorithm !== EVENT_ALGORITHM ||
        !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)
      ) {
        // Already reported structurally. An unimplemented version is a failure,
        // never a skip: skipping would let a forger downgrade an event's
        // declared scheme to escape verification.
        continue;
      }
      const recomputedEvent = await sha256Hex(canonicalize(eventEnvelopeOf(event)));
      if (recomputedEvent !== event.digest) {
        problems.push(
          `Record ${record.id} event ${event.seq} digest does not reproduce from its contents`,
        );
      }
    }
  }

  return problems;
}

/**
 * Structural checks on a record's append-only event chain.
 *
 * These are the rules that make the chain meaningful, and they are checked
 * without hashing (which is async and lives in `lib/integrity.ts`):
 * the chain starts with exactly one publication, positions are consecutive,
 * links point backwards correctly, and at most one terminal event exists.
 */
export function eventChainProblems(record: PredictionRecord): string[] {
  const problems: string[] = [];
  const { events } = record;
  const id = record.id;

  if (events.length === 0) {
    return [`Record ${id} has no events; every record must begin with a publication`];
  }

  if (events[0].kind !== 'published') {
    problems.push(`Record ${id} does not begin with a publication event`);
  }
  if (events[0].prevDigest !== null) {
    problems.push(`Record ${id} has a publication event that points at a predecessor`);
  }
  if (events.filter((event) => event.kind === 'published').length > 1) {
    problems.push(`Record ${id} is published more than once`);
  }

  const terminal = events.filter(
    (event) => event.kind === 'resolved' || event.kind === 'annulled',
  );
  if (terminal.length > 1) {
    problems.push(`Record ${id} has more than one terminal event`);
  }

  // Every event must declare how it was hashed. An unknown algorithm or schema
  // is a hard failure: a verifier that silently accepts an unrecognised scheme
  // is not verifying anything.
  events.forEach((event) => {
    if (event.algorithm !== EVENT_ALGORITHM) {
      problems.push(
        `Record ${id} event ${event.seq} declares unknown algorithm '${String(event.algorithm)}'`,
      );
    }
    if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)) {
      problems.push(
        `Record ${id} event ${event.seq} declares schema version '${String(event.schemaVersion)}', which this build cannot verify`,
      );
    }
    const scope = event.scope as EventDigestScope | undefined;
    if (scope !== CHAINED_SCOPE && scope !== PUBLISHED_SCOPE) {
      problems.push(`Record ${id} event ${event.seq} declares unknown digest scope '${String(scope)}'`);
    } else if (scope !== expectedScope(event.kind)) {
      problems.push(
        `Record ${id} event ${event.seq} declares scope '${scope}' but a '${event.kind}' event must use '${expectedScope(event.kind)}'`,
      );
    }
    const origin = (event as { origin?: unknown }).origin;
    if (origin !== undefined && origin !== 'migrated' && origin !== 'observed') {
      problems.push(`Record ${id} event ${event.seq} declares unknown origin '${String(origin)}'`);
    }
    if (typeof event.recordedAt !== 'string' || Number.isNaN(Date.parse(event.recordedAt))) {
      problems.push(`Record ${id} event ${event.seq} has no usable recordedAt`);
    }
  });

  problems.push(...temporalProblems(record));

  events.forEach((event, index) => {
    if (event.seq !== `e${index}`) {
      problems.push(
        `Record ${id} event ${index} is labelled ${event.seq}, expected e${index}`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(event.digest)) {
      problems.push(`Record ${id} event ${event.seq} has no valid digest`);
    }
    const previous = events[index - 1];
    const expectedPrev = previous ? previous.digest : null;
    if (event.prevDigest !== expectedPrev) {
      problems.push(`Record ${id} event ${event.seq} does not link to its predecessor`);
    }
    if (index > 0 && event.kind === 'published') {
      problems.push(`Record ${id} has a publication after ${events[index - 1].seq}`);
    }
    if (index > 0 && events[index - 1].kind !== 'published') {
      problems.push(`Record ${id} appends ${event.seq} after the record was already closed`);
    }
  });

  return problems;
}

/**
 * Temporal sanity, checked without inventing anything.
 *
 * A migrated chain is built from dates the record already carried, so the only
 * thing that can be asserted is an inequality: the event was written into the
 * archive later than the moment it records. That is true of every migrated event
 * by construction - the model that defines events did not exist before them - so
 * requiring it detects a fabricated `recordedAt` without pretending to know the
 * exact hour anything was written.
 */
export function temporalProblems(record: PredictionRecord): string[] {
  const problems: string[] = [];
  const { id, events } = record;
  if (events.length === 0) return problems;

  const recordedTimes = events
    .map((event) => Date.parse(event.recordedAt))
    .filter((time) => !Number.isNaN(time));
  if (recordedTimes.length !== events.length) return problems;

  // The per-event rule below already forces recordedAt > occurredAt for every
  // event. A record-wide version of the same inequality would wrongly reject a
  // legitimate mixed chain, where a migrated event dated in the past sits next
  // to an observed event recorded today.
  const latestOccurrence = Math.max(...events.map((event) => Date.parse(event.occurredAt)));
  const latestRecording = Math.max(...recordedTimes);
  if (latestRecording <= latestOccurrence) {
    problems.push(
      `Record ${id} claims its chain was recorded at or before the latest moment it records`,
    );
  }

  for (const event of events) {
    if (Date.parse(event.recordedAt) <= Date.parse(event.occurredAt)) {
      problems.push(
        `Record ${id} event ${event.seq} is recorded at or before the moment it records`,
      );
    }
    if (Date.parse(event.occurredAt) < Date.parse(record.publishedAt)) {
      problems.push(`Record ${id} event ${event.seq} predates the publication date`);
    }
  }

  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].recordedAt) < Date.parse(events[index - 1].recordedAt)) {
      problems.push(`Record ${id} event ${events[index].seq} is recorded before its predecessor`);
    }
  }

  // Mixed chains are allowed on purpose. A migrated record that is genuinely
  // resolved later must be able to record that resolution as `observed`; forcing
  // it to stay `migrated` would require mislabelling a contemporaneous event,
  // which is the dishonesty this field exists to prevent. Each event declares its
  // own origin, and each declaration is covered by that event's digest.

  return problems;
}


/**
 * The publication event must be the single authority over the payload digest.
 *
 * This is the rule that stops a rewrite. Editing the sealed content changes its
 * digest; updating `integrity.digest` to match is a one-line edit. What a forger
 * cannot do cheaply is make the *published event* agree, because that event's
 * own digest covers its body and is in turn covered by every later link — and
 * rebuilding all of that still leaves nothing anchored outside the repository.
 *
 * Enforced structurally (exactly one `published`, first, naming one digest, only
 * that digest) and cryptographically (the named digest must equal
 * `integrity.digest` *and* the digest recomputed from the shipped bytes).
 */
export function publishedLinkProblems(
  record: PredictionRecord,
  digestMatches: boolean,
  recomputedDigest: string | null,
): string[] {
  const problems: string[] = [];
  const { id, events } = record;

  const publishedEvents = events.filter((event) => event.kind === 'published');

  if (publishedEvents.length === 0) {
    return [`Record ${id} has no publication event, so its payload is unanchored`];
  }
  if (publishedEvents.length > 1) {
    problems.push(`Record ${id} has ${publishedEvents.length} publication events; exactly one is allowed`);
  }
  if (events[0]?.kind !== 'published') {
    problems.push(`Record ${id} does not begin with its publication event`);
  }

  const published = publishedEvents[0];
  const body = published.body as {
    payloadDigest?: unknown;
    payloadScope?: unknown;
    sealClaim?: unknown;
  };

  if (typeof body.payloadDigest !== 'string') {
    problems.push(`Record ${id} publication event names no payload digest`);
    return problems;
  }
  if (!/^[0-9a-f]{64}$/.test(body.payloadDigest)) {
    problems.push(`Record ${id} publication event names a malformed payload digest`);
  }

  // The event must declare the same payload definition the record does.
  if (body.payloadScope !== record.integrity.payloadScope) {
    problems.push(
      `Record ${id} publication event covers '${String(body.payloadScope)}' but the record declares '${record.integrity.payloadScope}'`,
    );
  }
  if (body.sealClaim !== record.sealClaim) {
    problems.push(`Record ${id} publication event disagrees with the record about its seal claim`);
  }

  // The named digest must be the record's digest, and must reproduce.
  if (body.payloadDigest !== record.integrity.digest) {
    problems.push(
      `Record ${id} publication event names a different payload digest than integrity.digest`,
    );
  }
  if (!digestMatches) {
    problems.push(
      `Record ${id} payload does not reproduce its declared digest; the publication event cannot be honoured`,
    );
  }
  if (recomputedDigest !== null && body.payloadDigest !== recomputedDigest) {
    problems.push(
      `Record ${id} publication event does not name the digest of the shipped payload`,
    );
  }

  // No other event may carry a payload digest: only the publication names one.
  for (const event of events) {
    if (event.kind === 'published') continue;
    const other = event.body as { payloadDigest?: unknown };
    if (other.payloadDigest !== undefined) {
      problems.push(
        `Record ${id} event ${event.seq} names a payload digest; only the publication may`,
      );
    }
  }

  return problems;
}

/**
 * Recompute the digest a record declares, under the scope it declares.
 *
 * Duplicated here rather than imported from `lib/integrity.ts` because that
 * module is browser-oriented and this one must run under plain Node with no
 * bundler. Both delegate to `hash.ts` and `events.ts`, so the bytes hashed are
 * identical by construction.
 */
export async function recomputeDeclaredDigest(record: PredictionRecord): Promise<string> {
  const bytes =
    record.integrity.payloadScope === 'legacy-record'
      ? canonicalize(legacyPayloadShape(record))
      : canonicalize(sealedPayload(record));
  return sha256Hex(bytes);
}

