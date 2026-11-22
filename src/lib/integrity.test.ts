import { describe, expect, it } from 'vitest';
import { canonicalize, digestRecord, sealedPayload, shortDigest } from './integrity';
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

describe('digestRecord', () => {
  it('reproduces the digest sealed into each shipped record', async () => {
    // This is the core integrity guarantee: a record's stored digest must match
    // a fresh hash of its payload. A failure here means the archive was edited
    // without re-sealing.
    for (const record of predictionRecords) {
      await expect(digestRecord(record)).resolves.toBe(record.integrity.digest);
    }
  });

  it('detects a single-character change to a record', async () => {
    const record = predictionRecords[0];
    const tampered: PredictionRecord = {
      ...record,
      probability: Math.min(0.99, record.probability + 0.01),
    };
    await expect(digestRecord(tampered)).resolves.not.toBe(record.integrity.digest);
  });

  it('detects a changed canonical question', async () => {
    const record = predictionRecords[0];
    const tampered: PredictionRecord = {
      ...record,
      canonicalQuestion: `${record.canonicalQuestion} `,
    };
    await expect(digestRecord(tampered)).resolves.not.toBe(record.integrity.digest);
  });

  it('is stable across repeated calls', async () => {
    const record = predictionRecords[0];
    const first = await digestRecord(record);
    const second = await digestRecord(record);
    expect(first).toBe(second);
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
