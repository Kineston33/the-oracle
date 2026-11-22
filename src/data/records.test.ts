import { describe, expect, it } from 'vitest';
import {
  adjacentRecords,
  filterRecords,
  findRecord,
  predictionRecords,
  sortByPublication,
} from './records';

describe('filterRecords', () => {
  it('returns everything with the default filters', () => {
    expect(filterRecords(predictionRecords, {})).toHaveLength(predictionRecords.length);
  });

  it('filters by category', () => {
    const climate = filterRecords(predictionRecords, { category: 'climate' });
    expect(climate.length).toBeGreaterThan(0);
    expect(climate.every((record) => record.category === 'climate')).toBe(true);
  });

  it('filters by status', () => {
    const resolved = filterRecords(predictionRecords, { status: 'resolved' });
    expect(resolved.every((record) => record.status === 'resolved')).toBe(true);
  });

  it('searches question text case-insensitively', () => {
    const found = filterRecords(predictionRecords, { query: 'BATTERY' });
    expect(found.some((record) => record.id === 'ORC-2025-0001')).toBe(true);
  });

  it('searches by record id', () => {
    expect(filterRecords(predictionRecords, { query: 'ORC-2025-0007' })).toHaveLength(1);
  });

  it('searches the resolution authority as well as the question', () => {
    const found = filterRecords(predictionRecords, { query: 'mauna loa' });
    expect(found.some((record) => record.id === 'ORC-2025-0007')).toBe(true);
  });

  it('combines category and status filters', () => {
    const both = filterRecords(predictionRecords, { category: 'science', status: 'resolved' });
    expect(both.every((r) => r.category === 'science' && r.status === 'resolved')).toBe(true);
  });

  it('returns an empty array rather than throwing on no match', () => {
    expect(filterRecords(predictionRecords, { query: 'zzz-no-such-record' })).toEqual([]);
  });
});

describe('sortByPublication', () => {
  it('sorts newest first by default', () => {
    const sorted = sortByPublication(predictionRecords);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(Date.parse(sorted[index - 1].publishedAt)).toBeGreaterThanOrEqual(
        Date.parse(sorted[index].publishedAt),
      );
    }
  });

  it('sorts oldest first when asked', () => {
    const sorted = sortByPublication(predictionRecords, 'oldest');
    expect(Date.parse(sorted[0].publishedAt)).toBeLessThanOrEqual(
      Date.parse(sorted[sorted.length - 1].publishedAt),
    );
  });

  it('does not mutate the input array', () => {
    const original = [...predictionRecords];
    sortByPublication(predictionRecords);
    expect(predictionRecords).toEqual(original);
  });
});

describe('findRecord', () => {
  it('finds a shipped record by id', () => {
    expect(findRecord('ORC-2025-0001')?.title).toContain('battery');
  });

  it('returns undefined for an unknown id', () => {
    expect(findRecord('ORC-9999-9999')).toBeUndefined();
  });
});

describe('adjacentRecords', () => {
  it('returns neighbours in publication order', () => {
    const { previous, next } = adjacentRecords('ORC-2025-0005');
    expect(previous).not.toBeNull();
    expect(next).not.toBeNull();
    expect(Date.parse(previous!.publishedAt)).toBeGreaterThan(
      Date.parse('2025-07-11T11:00:00.000Z'),
    );
    expect(Date.parse(next!.publishedAt)).toBeLessThan(Date.parse('2025-07-11T11:00:00.000Z'));
  });

  it('handles the unknown-id case without throwing', () => {
    expect(adjacentRecords('ORC-0000-0000')).toEqual({ previous: null, next: null });
  });
});
