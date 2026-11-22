/**
 * Record lifecycle, derived from the event chain.
 *
 * A record's status is never stored on the sealed payload. It is computed by
 * folding the append-only events, so a record cannot be "marked resolved" by
 * editing anything: the only way to change a status is to append an event.
 */

import type {
  AnnulledEventBody,
  PredictionRecord,
  PredictionStatus,
  RecordEvent,
  Resolution,
  ResolvedEventBody,
} from './types.ts';

/** The lifecycle of a record, derived from its events. */
export interface RecordLifecycle {
  status: PredictionStatus;
  /** Present only when the last terminal event recorded an outcome. */
  resolution?: Resolution;
  /** When the record left the open state, if it has. */
  closedAt?: string;
}

function isResolved(body: RecordEvent['body']): body is ResolvedEventBody {
  return 'outcome' in body;
}

function isAnnulled(body: RecordEvent['body']): body is AnnulledEventBody {
  return 'reason' in body;
}

/**
 * Fold a record's events into its current state.
 *
 * The first terminal event wins. A later event cannot overwrite an earlier
 * outcome — appending a second resolution is a validation error, not a
 * last-write-wins situation.
 */
export function deriveLifecycle(record: PredictionRecord): RecordLifecycle {
  const terminal = record.events.find(
    (event) => event.kind === 'resolved' || event.kind === 'annulled',
  );

  if (!terminal) return { status: 'open' };

  if (isAnnulled(terminal.body)) {
    return {
      status: 'annulled',
      closedAt: terminal.occurredAt,
      resolution: {
        resolvedAt: terminal.occurredAt,
        outcome: 'indeterminate',
        basis: terminal.body.basis,
        note: terminal.body.note,
      },
    };
  }

  if (isResolved(terminal.body)) {
    return {
      status: 'resolved',
      closedAt: terminal.occurredAt,
      resolution: {
        resolvedAt: terminal.occurredAt,
        outcome: terminal.body.outcome,
        basis: terminal.body.basis,
        note: terminal.body.note,
      },
    };
  }

  return { status: 'open' };
}

/** Convenience: just the status, for filters and badges. */
export function statusOf(record: PredictionRecord): PredictionStatus {
  return deriveLifecycle(record).status;
}
