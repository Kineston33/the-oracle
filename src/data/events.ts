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

/** The part of an event that its digest covers. */
export interface EventEnvelope {
  seq: string;
  kind: RecordEventKind;
  occurredAt: string;
  body: RecordEventBody;
  prevDigest: string | null;
}

export function eventEnvelope(event: RecordEvent): EventEnvelope {
  return {
    seq: event.seq,
    kind: event.kind,
    occurredAt: event.occurredAt,
    body: event.body,
    prevDigest: event.prevDigest,
  };
}

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
  /** SHA-256 of the event envelope. Injected so this module stays hash-free. */
  digest: string;
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
  { digest }: AppendOptions,
): RecordEvent {
  const events = record.events;

  if (kind === 'published') {
    if (events.length > 0) {
      throw new AppendError('A record can only be published once.');
    }
  } else {
    if (events.length === 0) {
      throw new AppendError('An event cannot precede publication.');
    }
    if (events.some((event) => event.kind !== 'published')) {
      throw new AppendError(
        'This record is already closed. A reopened question is a new revision, not a new event.',
      );
    }
  }

  const previous = events[events.length - 1];
  return {
    seq: sequenceLabel(events.length),
    kind,
    occurredAt,
    body,
    digest,
    prevDigest: previous ? previous.digest : null,
  };
}

/**
 * Append an event to a record, returning a new record.
 *
 * The sealed payload is preserved by construction: only `events` is replaced,
 * and it is replaced with a longer array. Nothing else is touched, so the
 * payload digest cannot move.
 */
export function appendEvent(record: PredictionRecord, event: RecordEvent): PredictionRecord {
  return { ...record, events: [...record.events, event] };
}
