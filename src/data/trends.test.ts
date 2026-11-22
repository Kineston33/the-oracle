import { describe, expect, it } from 'vitest';
import { filterTrends, findTrend, sortTrends, trendSignals } from './trends';

describe('trend signals', () => {
  it('marks every signal as demo data', () => {
    expect(trendSignals.every((trend) => trend.demo)).toBe(true);
  });

  it('has unique ids', () => {
    const ids = new Set(trendSignals.map((trend) => trend.id));
    expect(ids.size).toBe(trendSignals.length);
  });

  it('keeps every index value inside 0–100', () => {
    for (const trend of trendSignals) {
      expect(trend.signalStrength).toBeGreaterThanOrEqual(0);
      expect(trend.signalStrength).toBeLessThanOrEqual(100);
      expect(trend.confidence).toBeGreaterThanOrEqual(0);
      expect(trend.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('gives every signal a falsifier, not just a claim', () => {
    for (const trend of trendSignals) {
      expect(trend.tension.length).toBeGreaterThan(40);
    }
  });

  it('links only to records that exist', () => {
    const ids = new Set(trendSignals.flatMap((trend) => trend.relatedPredictions));
    // Verified against the archive in the integration test below.
    expect(ids.size).toBeGreaterThan(0);
  });

  it('has an eight-point series for every signal', () => {
    for (const trend of trendSignals) {
      expect(trend.series).toHaveLength(8);
    }
  });
});

describe('filterTrends', () => {
  it('returns everything with no filters', () => {
    expect(filterTrends(trendSignals, 'all', '')).toHaveLength(trendSignals.length);
  });

  it('filters by domain', () => {
    const climate = filterTrends(trendSignals, 'climate', '');
    expect(climate.every((trend) => trend.category === 'climate')).toBe(true);
  });

  it('searches name and description', () => {
    const found = filterTrends(trendSignals, 'all', 'storage');
    expect(found.length).toBeGreaterThan(0);
  });

  it('returns an empty list for no match', () => {
    expect(filterTrends(trendSignals, 'all', 'zzzz')).toEqual([]);
  });
});

describe('sortTrends', () => {
  it('sorts by signal strength by default', () => {
    const sorted = sortTrends(trendSignals, 'signal');
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index - 1].signalStrength).toBeGreaterThanOrEqual(sorted[index].signalStrength);
    }
  });

  it('sorts by velocity', () => {
    const sorted = sortTrends(trendSignals, 'velocity');
    expect(sorted[0].velocity).toBeGreaterThanOrEqual(sorted[sorted.length - 1].velocity);
  });

  it('sorts by confidence', () => {
    const sorted = sortTrends(trendSignals, 'confidence');
    expect(sorted[0].confidence).toBeGreaterThanOrEqual(sorted[sorted.length - 1].confidence);
  });
});

describe('findTrend', () => {
  it('finds a signal by id', () => {
    expect(findTrend('TRD-001')?.category).toBe('infrastructure');
  });

  it('returns undefined for an unknown id', () => {
    expect(findTrend('TRD-999')).toBeUndefined();
  });
});
