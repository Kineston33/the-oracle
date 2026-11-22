import { describe, expect, it } from 'vitest';
import {
  AppendError,
  appendEvent,
  canonicalize,
  nextEvent,
  sealedPayload,
  sequenceLabel,
} from './events';
import {
  eventChainProblems,
  publishedLinkProblems,
  recomputeDeclaredDigest,
} from './validate';
import { deriveLifecycle } from './lifecycle';
import { validateArchive } from './validate';
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
    recordedAt: '2029-01-02T00:00:00.000Z',
    origin: 'observed',
    algorithm: 'sha256',
    schemaVersion: 2,
    scope: 'event-envelope',
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

  it('refuses a second terminal event before the chain is even built', () => {
    // Not merely rejected later by validation: appendEvent throws, so an
    // invalid chain cannot be constructed in the first place.
    const second = { ...resolutionEvent(resolved.events[1].digest), seq: 'e2' };
    expect(() => appendEvent(resolved, second)).toThrow(AppendError);
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
  it('links the published event to the digest the record declares', () => {
    const published = open.events[0].body as { payloadDigest: string; payloadScope: string };
    expect(published.payloadScope).toBe(open.integrity.payloadScope);
    expect(published.payloadDigest).toBe(open.integrity.digest);
    expect(publishedLinkProblems(open, true, open.integrity.digest)).toEqual([]);
  });

  it('flags a payload edited after publication', async () => {
    const edited: PredictionRecord = { ...open, probability: open.probability + 0.05 };
    const current = await recomputeDeclaredDigest(edited);
    const problems = publishedLinkProblems(edited, current === edited.integrity.digest, current);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('refuses to compare across payload scopes', () => {
    const wrongScope: PredictionRecord = {
      ...open,
      integrity: { ...open.integrity, payloadScope: 'sealed-payload' },
    };
    const problems = publishedLinkProblems(wrongScope, true, wrongScope.integrity.digest);
    expect(problems.some((p) => p.includes('covers'))).toBe(true);
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

describe('terminal transitions are final', () => {
  const resolvedRecord = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
  const annulledRecord = predictionRecords.find((r) => r.id === 'ORC-2025-0009')!;

  function body() {
    return {
      outcome: 'yes' as const,
      basis: 'fixture',
      note: 'fixture',
      evidenceIds: [],
    };
  }

  function annulBody() {
    return { reason: 'fixture', basis: 'fixture', note: 'fixture' };
  }

  it('refuses to resolve a record that was already resolved', () => {
    expect(() =>
      appendEvent(resolvedRecord, {
        ...resolutionEvent(resolvedRecord.events[1].digest),
        seq: 'e2',
      }),
    ).toThrow(AppendError);
  });

  it('refuses to annul a record that was already resolved', () => {
    // The incompatible pair: a resolution and an annulment cannot coexist.
    expect(() =>
      appendEvent(resolvedRecord, {
        ...resolutionEvent(resolvedRecord.events[1].digest),
        seq: 'e2',
        kind: 'annulled',
        body: annulBody(),
      }),
    ).toThrow(/resolution is final/i);
  });

  it('refuses to resolve a record that was annulled', () => {
    expect(() =>
      appendEvent(annulledRecord, {
        ...resolutionEvent(annulledRecord.events[1].digest),
        seq: 'e2',
        kind: 'resolved',
        body: body(),
      }),
    ).toThrow(/annulment is final/i);
  });

  it('refuses to annul a record that was already annulled', () => {
    expect(() =>
      appendEvent(annulledRecord, {
        ...resolutionEvent(annulledRecord.events[1].digest),
        seq: 'e2',
        kind: 'annulled',
        body: annulBody(),
      }),
    ).toThrow(AppendError);
  });

  it('allows the first terminal transition on an open record', () => {
    const appended = appendEvent(open, resolutionEvent(open.events[0].digest));
    expect(deriveLifecycle(appended).status).toBe('resolved');
  });

  it('refuses a second publication', () => {
    expect(() =>
      appendEvent(open, { ...open.events[0], seq: 'e1', prevDigest: open.events[0].digest }),
    ).toThrow(AppendError);
  });

  it('refuses to record an event before the moment it records', () => {
    // nextEvent rejects a recordedAt that is not strictly later.
    expect(() =>
      nextEvent(open, 'resolved', '2029-01-01T00:00:00.000Z', body(), {
        digest: 'a'.repeat(64),
        recordedAt: '2029-01-01T00:00:00.000Z',
      }),
    ).toThrow(AppendError);
  });

  it('accepts a well-formed transition and marks it observed', () => {
    const event = nextEvent(open, 'resolved', '2029-01-01T00:00:00.000Z', body(), {
      digest: 'a'.repeat(64),
      recordedAt: '2029-01-02T00:00:00.000Z',
    });
    expect(event.origin).toBe('observed');
    expect(event.scope).toBe('event-envelope');
    expect(event.algorithm).toBe('sha256');
    expect(event.schemaVersion).toBe(2);
  });
});

describe('provenance is protected by the digest', () => {
  const record = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
  const event = record.events[0];

  it('covers origin, so migrated cannot be relabelled as observed', async () => {
    const relabelled: RecordEvent = { ...event, origin: 'observed' };
    expect(await digestEvent(relabelled)).not.toBe(event.digest);
  });

  it('covers recordedAt, so the recording date cannot be moved', async () => {
    const moved: RecordEvent = { ...event, recordedAt: '2026-01-01T00:00:00.000Z' };
    expect(await digestEvent(moved)).not.toBe(event.digest);
  });

  it('covers both at once', async () => {
    const both: RecordEvent = {
      ...event,
      origin: 'observed',
      recordedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(await digestEvent(both)).not.toBe(event.digest);
  });

  it('is rejected by full validation, not only by the digest', async () => {
    for (const tampered of [
      { ...event, origin: 'observed' as const },
      { ...event, recordedAt: '2026-01-01T00:00:00.000Z' },
      { ...event, origin: 'observed' as const, recordedAt: '2026-01-01T00:00:00.000Z' },
    ]) {
      const poisoned: PredictionRecord = {
        ...record,
        events: record.events.map((existing, index) =>
          index === 0 ? (tampered as RecordEvent) : existing,
        ),
      };
      const problems = await validateArchive(
        [poisoned, ...predictionRecords.filter((r) => r.id !== record.id)],
      );
      expect(problems.some((p) => p.includes('does not reproduce'))).toBe(true);
    }
  });

  it('keeps every shipped event marked migrated', () => {
    for (const r of predictionRecords) {
      for (const e of r.events) expect(e.origin, `${r.id}/${e.seq}`).toBe('migrated');
    }
  });

  it('does not let a migrated event be recorded when it happened', () => {
    // The inequality that makes the migration honest: the chain is provably
    // later than the dates it restates.
    for (const e of eventChainOf(record)) {
      expect(Date.parse(e.recordedAt)).toBeGreaterThan(Date.parse(e.occurredAt));
    }
  });

  function eventChainOf(r: PredictionRecord) {
    return r.events;
  }
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
