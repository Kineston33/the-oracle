import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  digestEvent,
  digestLegacyRecord,
  digestPayload,
  sealedPayload,
  shortDigest,
  verifyEventChain,
  verifyRecordDigest,
} from './integrity';
import { assertArchiveShape, predictionRecords, summarizeArchive } from '@/data/records';
import type { PredictionRecord } from '@/data/types';

describe('canonicalize', () => {
  it('sorts object keys so insertion order cannot change the digest', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('sorts nested keys recursively', () => {
    expect(canonicalize({ x: { z: 1, a: 2 } })).toBe('{"x":{"a":2,"z":1}}');
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it('drops undefined members so they cannot affect the hash', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('sealedPayload', () => {
  it('excludes the integrity field itself', () => {
    const record = predictionRecords[0];
    expect(Object.keys(sealedPayload(record))).not.toContain('integrity');
  });

  it('does not mutate the source record', () => {
    const record = predictionRecords[0];
    const before = JSON.stringify(record);
    sealedPayload(record);
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe('shortDigest', () => {
  it('elides the middle of a long digest', () => {
    const digest = 'a'.repeat(64);
    expect(shortDigest(digest)).toContain('…');
    expect(shortDigest(digest).length).toBeLessThan(digest.length);
  });

  it('returns short values untouched', () => {
    expect(shortDigest('abc', 10, 6)).toBe('abc');
  });
});

describe('verifyRecordDigest', () => {
  it('reproduces the digest sealed into each shipped record, under its declared scope', async () => {
    // The core integrity guarantee: a record's stored digest must match a fresh
    // hash of exactly the shape that digest was issued over.
    for (const record of predictionRecords) {
      await expect(verifyRecordDigest(record)).resolves.toBe(record.integrity.digest);
    }
  });

  it('detects a single-character change to a record', async () => {
    const record = predictionRecords[0];
    const tampered: PredictionRecord = {
      ...record,
      probability: Math.min(0.99, record.probability + 0.01),
    };
    await expect(verifyRecordDigest(tampered)).resolves.not.toBe(record.integrity.digest);
  });

  it('detects a changed canonical question', async () => {
    const record = predictionRecords[0];
    const tampered: PredictionRecord = {
      ...record,
      canonicalQuestion: `${record.canonicalQuestion} `,
    };
    await expect(verifyRecordDigest(tampered)).resolves.not.toBe(record.integrity.digest);
  });

  it('is stable across repeated calls', async () => {
    const record = predictionRecords[0];
    expect(await verifyRecordDigest(record)).toBe(await verifyRecordDigest(record));
  });
});

describe('archive shape', () => {
  it('passes every structural invariant', () => {
    expect(assertArchiveShape(predictionRecords)).toEqual([]);
  });

  it('marks every record as a demo', () => {
    expect(predictionRecords.every((record) => record.demo)).toBe(true);
  });

  it('gives every record evidence and resolution criteria', () => {
    for (const record of predictionRecords) {
      expect(record.evidence.length).toBeGreaterThan(0);
      expect(record.resolutionCriteria.rule.length).toBeGreaterThan(20);
      expect(record.resolutionCriteria.edgeCases.length).toBeGreaterThan(0);
    }
  });

  it('has one record per id', () => {
    const ids = predictionRecords.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps probabilities strictly inside the open unit interval', () => {
    for (const record of predictionRecords) {
      expect(record.probability).toBeGreaterThan(0);
      expect(record.probability).toBeLessThan(1);
    }
  });

  it('never claims an external anchor it does not have', () => {
    expect(predictionRecords.every((record) => record.integrity.anchored === false)).toBe(true);
  });
});

describe('summarizeArchive', () => {
  const summary = summarizeArchive(predictionRecords);

  it('counts published records', () => {
    expect(summary.published).toBe(predictionRecords.length);
  });

  it('has status counts that add up to the archive size', () => {
    expect(summary.open + summary.resolved + summary.annulled).toBe(summary.published);
  });

  it('returns null rather than NaN for an empty archive', () => {
    expect(summarizeArchive([]).hitRate).toBeNull();
  });

  it('only counts decisive resolutions in the hit rate', () => {
    // Two resolved records ship in the demo archive; one YES call at 71% and
    // one NO call at 7%. Both are consistent with their published probability.
    expect(summary.resolved).toBe(2);
    expect(summary.hitRate).toBe(1);
  });
});

/**
 * The payload/event split. These are the guarantees the split exists to provide:
 * publishing freezes the payload, and nothing that happens afterwards can move
 * it.
 */
describe('sealed payload is frozen at publication', () => {
  it('does not cover status or outcomes', async () => {
    const record = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
    const payloadDigest = await digestPayload(record);

    // Reconstruct the payload without its chain. If an outcome had leaked into
    // the payload, dropping the events would change the digest.
    const withoutEvents: PredictionRecord = { ...record, events: [] };
    expect(await digestPayload(withoutEvents)).toBe(payloadDigest);
  });

  it('keeps the payload digest stable when a resolution event is appended', async () => {
    const record = predictionRecords.find((r) => r.id === 'ORC-2025-0001')!;
    const before = await digestPayload(record);

    const appended: PredictionRecord = {
      ...record,
      events: [
        ...record.events,
        {
          seq: 'e1',
          kind: 'resolved',
          occurredAt: '2029-01-01T00:00:00.000Z',
          body: {
            outcome: 'yes',
            basis: 'A synthetic outcome used only to prove the payload does not move.',
            note: 'Test fixture.',
            evidenceIds: [],
          },
          recordedAt: '2029-01-02T00:00:00.000Z',
          origin: 'observed' as const,
          algorithm: 'sha256' as const,
          schemaVersion: 2 as const,
          scope: 'event-envelope' as const,
          digest: 'f'.repeat(64),
          prevDigest: record.events[0].digest,
        },
      ],
    };

    expect(await digestPayload(appended)).toBe(before);

    // The sealed payload is what a modern record's digest covers, and it did not
    // move. A legacy-scoped record is not re-verified here, because appending an
    // event necessarily changes the legacy shape that digest was computed over —
    // which is precisely why legacy records are declared `self-consistent`.
    expect(record.integrity.payloadScope).toBe('legacy-record');
  });

  it('keeps an annulment from touching the published probability', () => {
    const record = predictionRecords.find((r) => r.id === 'ORC-2025-0009')!;
    // The record is annulled and still carries the probability it was published at.
    expect(record.probability).toBe(0.19);
  });
});

describe('event chain', () => {
  it('verifies every shipped chain', async () => {
    for (const record of predictionRecords) {
      const result = await verifyEventChain(record);
      expect(result.ok, `${record.id}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('starts with a publication that points at nothing', () => {
    for (const record of predictionRecords) {
      expect(record.events[0].kind).toBe('published');
      expect(record.events[0].prevDigest).toBeNull();
    }
  });

  it('links each event to its predecessor', () => {
    for (const record of predictionRecords) {
      record.events.forEach((event, index) => {
        const previous = record.events[index - 1];
        expect(event.prevDigest).toBe(previous ? previous.digest : null);
      });
    }
  });

  it('breaks when an event is edited', async () => {
    const record = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
    const tampered: PredictionRecord = {
      ...record,
      events: record.events.map((event, index) =>
        index === 0
          ? { ...event, occurredAt: '2025-05-20T07:00:00.000Z' }
          : event,
      ),
    };
    const result = await verifyEventChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.broken).toContain('e0');
  });

  it('breaks the link of the event after an edited one', async () => {
    const record = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
    // Edit e0 without recomputing its digest: e1 now points at a value that is
    // no longer the previous event's digest.
    const tampered: PredictionRecord = {
      ...record,
      events: record.events.map((event, index) =>
        index === 0 ? { ...event, digest: 'a'.repeat(64) } : event,
      ),
    };
    const result = await verifyEventChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.mislinked).toContain('e1');
  });

  it('gives each event a digest over its own envelope', async () => {
    for (const record of predictionRecords) {
      for (const event of record.events) {
        await expect(digestEvent(event)).resolves.toBe(event.digest);
      }
    }
  });
});

describe('legacy records are preserved, not rewritten', () => {
  const legacy = predictionRecords.filter((r) => r.integrity.payloadScope === 'legacy-record');

  it('keeps every shipped digest under the legacy scope', () => {
    expect(legacy.length).toBe(predictionRecords.length);
  });

  it('reproduces legacy digests with the legacy algorithm', async () => {
    for (const record of legacy) {
      await expect(digestLegacyRecord(record)).resolves.toBe(record.integrity.digest);
    }
  });

  it('does not claim those seals predate their outcomes', () => {
    // This is the honesty requirement: a legacy digest cannot support a claim of
    // publication-before-outcome, so no record makes that claim.
    for (const record of legacy) {
      expect(record.sealClaim).toBe('self-consistent');
    }
  });
});
