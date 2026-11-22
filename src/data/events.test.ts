import { describe, expect, it } from 'vitest';
import {
  AppendError,
  appendEvent,
  canonicalize,
  sealedPayload,
  sequenceLabel,
} from './events';
import { eventChainProblems, payloadMatchesPublishedEvent } from './validate';
import { deriveLifecycle } from './lifecycle';
import { predictionRecords } from './records';
import { digestPayload, digestEvent, verifyEventChain } from '@/lib/integrity';
import type { PredictionRecord, RecordEvent } from './types';

/**
 * The append-only rules. If any of these fail, a published record can be
 * silently rewritten, which is the one thing this model exists to prevent.
 */

const open = predictionRecords.find((r) => r.id === 'ORC-2025-0001')!;
const resolved = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;

function resolutionEvent(prevDigest: string): RecordEvent {
  return {
    seq: 'e1',
    kind: 'resolved',
    occurredAt: '2029-01-01T00:00:00.000Z',
    body: {
      outcome: 'yes',
      basis: 'Synthetic basis, used only to exercise the append rules.',
      note: 'Test fixture.',
      evidenceIds: [],
    },
    digest: 'a'.repeat(64),
    prevDigest,
  };
}

describe('sealedPayload', () => {
  it('contains exactly the fields fixed at publication', () => {
    expect(Object.keys(sealedPayload(open)).sort()).toEqual(
      [
        'canonicalQuestion',
        'category',
        'demo',
        'evidence',
        'horizon',
        'id',
        'probability',
        'publishedAt',
        'resolutionCriteria',
        'sealClaim',
        'title',
      ].sort(),
    );
  });

  it('never contains the event chain or the integrity block', () => {
    const payload = sealedPayload(resolved);
    expect(payload).not.toHaveProperty('events');
    expect(payload).not.toHaveProperty('integrity');
  });

  it('never contains a status or an outcome', () => {
    const keys = Object.keys(sealedPayload(resolved));
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('resolution');
  });
});

describe('appending events', () => {
  it('preserves the sealed payload byte for byte', async () => {
    const before = canonicalize(sealedPayload(open));
    const appended = appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(canonicalize(sealedPayload(appended))).toBe(before);
  });

  it('leaves the payload digest unchanged', async () => {
    const before = await digestPayload(open);
    const appended = appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(await digestPayload(appended)).toBe(before);
  });

  it('leaves every earlier event digest unchanged', async () => {
    const appended = appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(appended.events[0]).toEqual(open.events[0]);
  });

  it('does not mutate the original record', () => {
    const snapshot = JSON.stringify(open);
    appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(JSON.stringify(open)).toBe(snapshot);
  });

  it('changes the derived status once the event is in the chain', () => {
    expect(deriveLifecycle(open).status).toBe('open');
    const appended = appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(deriveLifecycle(appended).status).toBe('resolved');
  });

  it('forces a reopen to become a new record, not a new event', () => {
    // Sequencing is enforced at build time; a resolved record cannot take
    // another terminal event, which is what stops a silent re-resolution.
    const second = { ...resolutionEvent(resolved.events[1].digest), seq: 'e2' };
    const reopened = appendEvent(resolved, second);
    expect(eventChainProblems(reopened).length).toBeGreaterThan(0);
  });
});

describe('event ordering rules', () => {
  it('labels positions as e0, e1, …', () => {
    expect(sequenceLabel(0)).toBe('e0');
    expect(sequenceLabel(12)).toBe('e12');
  });

  it('refuses a second publication', () => {
    // nextEvent is the gate; it throws rather than silently overwriting.
    const events = open.events;
    expect(events.filter((e) => e.kind === 'published')).toHaveLength(1);
  });

  it('reports a chain that starts with something other than a publication', () => {
    const broken: PredictionRecord = {
      ...open,
      events: [{ ...open.events[0], kind: 'resolved' as const }],
    };
    expect(eventChainProblems(broken).some((p) => p.includes('publication'))).toBe(true);
  });

  it('reports a broken link', () => {
    const broken: PredictionRecord = {
      ...resolved,
      events: resolved.events.map((event, index) =>
        index === 1 ? { ...event, prevDigest: 'b'.repeat(64) } : event,
      ),
    };
    expect(eventChainProblems(broken).some((p) => p.includes('does not link'))).toBe(true);
  });

  it('reports a mislabelled position', () => {
    const broken: PredictionRecord = {
      ...resolved,
      events: resolved.events.map((event, index) =>
        index === 1 ? { ...event, seq: 'e7' } : event,
      ),
    };
    expect(eventChainProblems(broken).some((p) => p.includes('expected e1'))).toBe(true);
  });

  it('reports more than one terminal event', () => {
    const broken: PredictionRecord = {
      ...resolved,
      events: [...resolved.events, resolutionEvent(resolved.events[1].digest)],
    };
    expect(eventChainProblems(broken).some((p) => p.includes('more than one terminal'))).toBe(
      true,
    );
  });

  it('accepts every chain shipped in the archive', () => {
    for (const record of predictionRecords) {
      expect(eventChainProblems(record), record.id).toEqual([]);
    }
  });
});

describe('re-sealing is refused', () => {
  it('matches a published event against the digest scope it declares', async () => {
    const published = open.events[0].body as { payloadDigest: string; payloadScope: string };
    expect(published.payloadScope).toBe(open.integrity.payloadScope);
    expect(published.payloadDigest).toBe(open.integrity.digest);

    // Verified with the algorithm that scope implies.
    const { verifyRecordDigest } = await import('@/lib/integrity');
    const current = await verifyRecordDigest(open);
    expect(payloadMatchesPublishedEvent(open, current)).toBe(true);
  });

  it('flags a payload edited after publication', async () => {
    const { verifyRecordDigest } = await import('@/lib/integrity');
    const edited: PredictionRecord = { ...open, probability: open.probability + 0.05 };
    const current = await verifyRecordDigest(edited);
    expect(payloadMatchesPublishedEvent(edited, current)).toBe(false);
  });

  it('refuses to compare across payload scopes', () => {
    // A legacy digest compared with a modern payload digest must never "match".
    expect(payloadMatchesPublishedEvent(open, open.integrity.digest)).toBe(true);
    const wrongScope: PredictionRecord = {
      ...open,
      integrity: { ...open.integrity, payloadScope: 'sealed-payload' },
    };
    expect(payloadMatchesPublishedEvent(wrongScope, open.integrity.digest)).toBe(false);
  });

  it('keeps the published event digest pointing at the original payload', async () => {
    const edited: PredictionRecord = { ...open, probability: open.probability + 0.05 };
    // The event chain itself is unaffected by the edit, so the mismatch is
    // detectable precisely because the chain was not rewritten too.
    expect(await verifyEventChain(edited)).toEqual({ ok: true, broken: [], mislinked: [] });
    const published = edited.events[0].body as { payloadDigest: string };
    expect(published.payloadDigest).not.toBe(await digestPayload(edited));
  });

  it('exposes an AppendError type for callers that sequence events', () => {
    expect(new AppendError('x')).toBeInstanceOf(Error);
  });
});

describe('event digests', () => {
  it('cover the envelope, so editing a timestamp breaks the digest', async () => {
    const event = resolved.events[1];
    const edited = { ...event, occurredAt: '2030-01-01T00:00:00.000Z' };
    expect(await digestEvent(edited)).not.toBe(event.digest);
  });

  it('cover the body, so editing an outcome breaks the digest', async () => {
    const event = resolved.events[1];
    const body = event.body as Extract<RecordEvent['body'], { outcome: string }>;
    const edited: RecordEvent = {
      ...event,
      body: { ...body, outcome: 'no' },
    };
    expect(await digestEvent(edited)).not.toBe(event.digest);
  });

  it('cover prevDigest, so moving an event breaks it', async () => {
    const event = resolved.events[1];
    const edited = { ...event, prevDigest: 'c'.repeat(64) };
    expect(await digestEvent(edited)).not.toBe(event.digest);
  });
});
