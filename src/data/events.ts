/**
 * Append-only event model.
 *
 * Everything that happens to a record after publication is an event. Events are
 * never edited or removed; a correction appends. Each event carries a digest
 * over its own envelope plus the previous event's digest, so the chain is both
 * ordered and tamper-evident.
 *
 * Like `validate.ts`, this module imports no JSON and no DOM, so the same rules
 * run in the app, in tests, and in `scripts/validate-archive.mjs` under Node.
 */

import type {
  EventDigestScope,
  EventOrigin,
  PredictionRecord,
  RecordEvent,
  RecordEventBody,
  RecordEventKind,
  SealedPayload,
} from './types.ts';

/* -------------------------------------------------------------------------
   Canonical serialisation
   ------------------------------------------------------------------------- */

/**
 * Deterministically serialise a value: keys sorted recursively, `undefined`
 * members dropped. The same logical value always produces the same bytes,
 * regardless of property insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const next = source[key];
      if (next === undefined) continue;
      out[key] = sortValue(next);
    }
    return out;
  }
  return value;
}

/* -------------------------------------------------------------------------
   Sealed payload
   ------------------------------------------------------------------------- */

/**
 * Extract exactly the fields that were fixed at publication.
 *
 * Written as an explicit pick rather than an object rest, because a rest
 * (`const { integrity, events, ...payload }`) would silently pull any future
 * field into the sealed payload the moment someone adds it. A new field must be
 * a deliberate decision here.
 */
export function sealedPayload(record: PredictionRecord): SealedPayload {
  return {
    id: record.id,
    canonicalQuestion: record.canonicalQuestion,
    title: record.title,
    category: record.category,
    publishedAt: record.publishedAt,
    probability: record.probability,
    horizon: record.horizon,
    resolutionCriteria: record.resolutionCriteria,
    evidence: record.evidence,
    demo: record.demo,
    sealClaim: record.sealClaim,
  };
}

/** UTF-8 bytes of the canonical sealed payload. */
export function payloadBytes(record: PredictionRecord): Uint8Array {
  return new TextEncoder().encode(canonicalize(sealedPayload(record)));
}

/**
 * The pre-split record shape, used only to verify digests that were issued
 * before the payload/event separation existed.
 *
 * This is deliberately kept as its own function and never merged into
 * `sealedPayload`. A legacy digest covered status and resolution, so verifying
 * it requires reconstructing that exact shape — including the outcome that was
 * present when it was sealed.
 */
export function legacyPayloadBytes(record: PredictionRecord): Uint8Array {
  return new TextEncoder().encode(canonicalize(legacyPayloadShape(record)));
}

/**
 * Reconstruct the exact object a legacy digest was computed over.
 *
 * Excludes every field that did not exist when legacy seals were issued —
 * `events` (the chain) and `sealClaim` (the provenance declaration) — and
 * re-adds `status` / `resolution` in the position and shape they then had.
 *
 * Exported so the sealing script verifies legacy records with the same function
 * the browser uses. A second implementation would drift.
 */
export function legacyPayloadShape(record: PredictionRecord): Record<string, unknown> {
  const { events: _events, sealClaim: _sealClaim, integrity: _integrity, ...rest } = record;
  const lifecycle = legacyLifecycle(record);

  return {
    ...rest,
    status: lifecycle.status,
    ...(lifecycle.resolution ? { resolution: lifecycle.resolution } : {}),
  };
}

/** Lifecycle used for legacy verification — derived, never stored. */
function legacyLifecycle(record: PredictionRecord): {
  status: string;
  resolution?: unknown;
} {
  const terminal = record.events.find(
    (event) => event.kind === 'resolved' || event.kind === 'annulled',
  );
  if (!terminal) return { status: 'open' };
  const body = terminal.body as unknown as Record<string, unknown>;
  const outcome =
    terminal.kind === 'annulled' ? 'indeterminate' : (body.outcome as string);
  return {
    status: terminal.kind === 'annulled' ? 'annulled' : 'resolved',
    resolution: {
      resolvedAt: terminal.occurredAt,
      outcome,
      basis: body.basis,
      note: body.note,
    },
  };
}

/* -------------------------------------------------------------------------
   Event envelope and chain
   ------------------------------------------------------------------------- */

/**
 * The scheme version this build writes and accepts.
 *
 * v2 moved `recordedAt` and `origin` *inside* the hashed envelope. Under v1 they
 * sat outside it, which meant an event could be relabelled from `migrated` to
 * `observed` — or given a different recording date — without changing its
 * digest. That is a provenance claim, and an unprotected provenance claim is
 * worse than none: it looks like evidence.
 *
 * Bumping the version was the only honest way to close this. v1 digests are not
 * silently reinterpreted as v2: the version is part of the hashed envelope, so a
 * v1 event verifies under v1 rules and a v2 event under v2 rules, and the
 * validator rejects any version it does not implement.
 */
export const EVENT_SCHEMA_VERSION = 2 as const;

/** Every schema version this build can verify. */
export const SUPPORTED_SCHEMA_VERSIONS = [2] as const;

/** The only digest algorithm this build writes and accepts. */
export const EVENT_ALGORITHM = 'sha256' as const;

/**
 * The part of an event that its digest covers.
 *
 * Everything that is a *claim* is inside the hash, including the two fields that
 * describe how the event came to be here:
 *
 * - `recordedAt` — when this event was written into the archive;
 * - `origin`    — whether it was observed while it happened or migrated later.
 *
 * They were outside the envelope in schema 1, on the argument that they describe
 * the archive's handling of an event rather than the occurrence. That argument
 * was wrong: `origin: 'observed'` is precisely a claim that the hash existed
 * while the thing happened, so leaving it editable let an attacker convert a
 * migrated chain into an apparently contemporaneous one without changing a
 * single digest.
 *
 * `schema` and `algorithm` are inside for a related reason: a verifier must not
 * have to guess which rules produced a digest, and cannot reinterpret one scheme
 * as another.
 */
export interface EventEnvelope {
  schema: string;
  algorithm: string;
  scope: EventDigestScope;
  seq: string;
  kind: RecordEventKind;
  occurredAt: string;
  recordedAt: string;
  origin: EventOrigin;
  body: RecordEventBody;
  prevDigest: string | null;
}

export function eventEnvelope(event: RecordEvent): EventEnvelope {
  return {
    schema: `oracle.event/${event.schemaVersion}`,
    algorithm: event.algorithm,
    scope: event.scope,
    seq: event.seq,
    kind: event.kind,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    origin: event.origin,
    body: event.body,
    prevDigest: event.prevDigest,
  };
}

/**
 * Bytes the event digest covers.
 *
 * The envelope contains `body.payloadDigest`, so the `published`
 * event's digest commits to the payload transitively: altering the payload
 * alters the digest the event names, which is inside a hash that cannot change
 * without rebuilding the whole chain. That is why its declared scope is
 * `event-envelope+published-payload` while a resolution event, which commits to
 * nothing outside itself, is `event-envelope`.
 *
 * Declaring the scope rather than implying it is what stops the two being
 * confused by a later verifier.
 */
export function eventBytes(event: RecordEvent): Uint8Array {
  return new TextEncoder().encode(canonicalize(eventEnvelope(event)));
}

/** Position label for an event at a given index. */
export function sequenceLabel(index: number): string {
  return `e${index}`;
}

/* -------------------------------------------------------------------------
   Appending
   ------------------------------------------------------------------------- */

export interface AppendOptions {
  /** SHA-256 of the event envelope, computed over `eventBytes`. */
  digest: string;
  /** When the event is being written. Must be later than every `occurredAt`. */
  recordedAt: string;
  /** Defaults to `observed`: events written by this build are contemporaneous. */
  origin?: EventOrigin;
}

/** Digest scope the `published` event must declare. */
export const PUBLISHED_SCOPE = 'event-envelope+published-payload' as const;
/** Digest scope every other event must declare. */
export const CHAINED_SCOPE = 'event-envelope' as const;

/** Scopes permitted for a given event kind. */
export function expectedScope(kind: RecordEventKind): EventDigestScope {
  return kind === 'published' ? PUBLISHED_SCOPE : CHAINED_SCOPE;
}

export class AppendError extends Error {}

/**
 * Build the next event in a record's chain.
 *
 * Refuses to append a second publication, a second terminal event, or an event
 * out of sequence. The digest is supplied by the caller because hashing is
 * async in the browser; this function decides *what* is hashed and *where* it
 * goes in the chain.
 */
export function nextEvent(
  record: PredictionRecord,
  kind: RecordEventKind,
  occurredAt: string,
  body: RecordEventBody,
  { digest, recordedAt, origin = 'observed' }: AppendOptions,
): RecordEvent {
  const events = record.events;

  assertTransitionAllowed(events, kind);

  const previousEvent = events[events.length - 1];
  if (Date.parse(recordedAt) <= Date.parse(occurredAt)) {
    throw new AppendError(
      'An event cannot be recorded at or before the moment it records.',
    );
  }
  // recordedAt must not go backwards along the chain, or the archive would
  // claim to have written a later event before an earlier one.
  if (previousEvent && Date.parse(recordedAt) < Date.parse(previousEvent.recordedAt)) {
    throw new AppendError(
      'An event cannot be recorded before the event that precedes it.',
    );
  }
  if (Date.parse(occurredAt) < Date.parse(record.publishedAt)) {
    throw new AppendError('An event cannot precede its own publication date.');
  }

  const previous = events[events.length - 1];
  return {
    seq: sequenceLabel(events.length),
    kind,
    occurredAt,
    body,
    recordedAt,
    origin,
    algorithm: EVENT_ALGORITHM,
    schemaVersion: EVENT_SCHEMA_VERSION,
    scope: expectedScope(kind),
    digest,
    prevDigest: previous ? previous.digest : null,
  };
}

/**
 * Transition rules, enforced before an event is built.
 *
 * These live here rather than only in `validate.ts` so an invalid chain cannot
 * be constructed in the first place. Validation then acts as a second line of
 * defence against hand-edited JSON, not the only one.
 */
export function assertTransitionAllowed(
  events: readonly RecordEvent[],
  kind: RecordEventKind,
): void {
  if (kind === 'published') {
    if (events.length > 0) {
      throw new AppendError('A record can only be published once.');
    }
    return;
  }

  if (events.length === 0) {
    throw new AppendError('An event cannot precede publication.');
  }

  const terminal = events.find(
    (event) => event.kind === 'resolved' || event.kind === 'annulled',
  );
  if (terminal) {
    throw new AppendError(
      terminal.kind === 'annulled'
        ? 'This record was annulled. An annulment is final: it cannot be resolved afterwards.'
        : 'This record was resolved. A resolution is final: it cannot be annulled afterwards.',
    );
  }

  if (events[0].kind !== 'published') {
    throw new AppendError('The chain does not begin with a publication.');
  }
}

/**
 * Append an event to a record, returning a new record.
 *
 * Refuses the append outright if the transition is not allowed, so callers
 * cannot assemble a chain the validator would later reject.
 */
export function appendEvent(record: PredictionRecord, event: RecordEvent): PredictionRecord {
  assertTransitionAllowed(record.events, event.kind);
  return { ...record, events: [...record.events, event] };
}
