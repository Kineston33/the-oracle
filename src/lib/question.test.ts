import { describe, expect, it } from 'vitest';
import {
  detectCategory,
  detectHorizonYear,
  draftCanonicalQuestion,
  matchRecords,
  normalizeQuestion,
  readQuestion,
  suggestedQuestions,
} from './question';
import { predictionRecords } from '@/data/records';

const NOW = new Date('2026-01-15T00:00:00.000Z');

describe('normalizeQuestion', () => {
  it('strips trailing question marks and collapses whitespace', () => {
    expect(normalizeQuestion('  Will   AI   matter?  ')).toBe('Will AI matter');
  });

  it('keeps semantically meaningful punctuation inside the text', () => {
    expect(normalizeQuestion('Will compute exceed 10^27 FLOP by 2027?')).toBe(
      'Will compute exceed 10^27 FLOP by 2027',
    );
  });

  it('preserves numbers and hyphens', () => {
    expect(normalizeQuestion('Will CO2 pass 430-ppm?')).toBe('Will CO2 pass 430-ppm');
  });
});

describe('detectCategory', () => {
  it('classifies a clear technology question', () => {
    const { category } = detectCategory(
      'will any frontier model disclose training compute above 10^27 flop'.split(' '),
    );
    expect(category).toBe('technology');
  });

  it('classifies a climate question', () => {
    const { category } = detectCategory(
      'will global battery storage capacity exceed 1200 gw'.split(' '),
    );
    expect(category).toBe('climate');
  });

  it('refuses to guess when nothing matches', () => {
    const { category, scores } = detectCategory('will the thing happen'.split(' '));
    expect(scores).toHaveLength(0);
    expect(category).toBeNull();
  });

  it('returns null for a genuinely ambiguous question instead of flipping a coin', () => {
    // "market" (economy) and "space" (space) score identically.
    const { category, scores } = detectCategory('will the market space expand'.split(' '));
    if (scores.length > 1) {
      expect(scores[0].score).toBe(scores[1].score);
    }
    expect(category).toBeNull();
  });
});

describe('detectHorizonYear', () => {
  it('reads an explicit year', () => {
    expect(detectHorizonYear('Will this happen before 2029?', NOW)).toBe(2029);
  });

  it('takes the latest year when several are mentioned', () => {
    expect(detectHorizonYear('Between 2027 and 2031, will X happen?', NOW)).toBe(2031);
  });

  it('ignores years outside the plausible horizon', () => {
    expect(detectHorizonYear('Since 1999, will this happen?', NOW)).toBeNull();
  });

  it('resolves relative expressions against the given date', () => {
    expect(detectHorizonYear('Will this happen next year?', NOW)).toBe(2027);
    expect(detectHorizonYear('Will this happen within the coming decade?', NOW)).toBe(2036);
  });

  it('returns null when no horizon is present', () => {
    expect(detectHorizonYear('Will artificial intelligence change work?', NOW)).toBeNull();
  });
});

describe('matchRecords', () => {
  it('finds the battery-storage record from a related question', () => {
    const matches = matchRecords('global battery storage capacity gigawatts');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].record.id).toBe('ORC-2025-0001');
  });

  it('finds the lunar record from a moon-focused question', () => {
    const matches = matchRecords('commercial lunar south pole sample return mission');
    expect(matches.some((m) => m.record.id === 'ORC-2025-0004')).toBe(true);
  });

  it('returns nothing for unrelated vocabulary', () => {
    expect(matchRecords('zzzz unrelated vocabulary qqqq')).toEqual([]);
  });

  it('never returns more matches than the limit', () => {
    const matches = matchRecords('will annual growth exceed projections before 2030', predictionRecords, {
      limit: 2,
    });
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('sorts matches by descending score', () => {
    const matches = matchRecords('will global battery storage capacity and ev sales grow');
    const scores = matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('draftCanonicalQuestion', () => {
  it('produces a yes/no proposition ending in a deadline', () => {
    const draft = draftCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW before 2029?',
      2029,
      NOW,
    );
    expect(draft.startsWith('Will ')).toBe(true);
    expect(draft.endsWith('by 31 December 2029?')).toBe(true);
    expect(draft).not.toMatch(/before 2029/i);
  });

  it('falls back to a three-year horizon when none is given', () => {
    const draft = draftCanonicalQuestion('Will fusion power reach the grid?', null, NOW);
    expect(draft).toContain('31 December 2029');
  });
});

describe('readQuestion', () => {
  it('never produces a probability field of its own', () => {
    const reading = readQuestion('Will global battery storage exceed 1,200 GW before 2029?', NOW);
    // Matched archive records carry their own published probabilities; the
    // reading itself must add none.
    const { matches: _matches, ...ownFields } = reading;
    void _matches;
    // "does not estimate a probability" is a caveat string, so match on the
    // field name appearing as a key or a numeric claim instead.
    expect(Object.keys(ownFields).join(' ')).not.toMatch(/probability|confidence|score/i);
    expect(Object.keys(reading)).not.toContain('probability');
    expect(Object.keys(reading)).not.toContain('confidence');
  });

  it('surfaces the honesty caveats on every reading', () => {
    const reading = readQuestion('Will global battery storage exceed 1,200 GW before 2029?', NOW);
    expect(reading.caveats.join(' ')).toMatch(/does not estimate a probability/i);
    expect(reading.caveats.join(' ')).toMatch(/runs entirely in your browser/i);
  });

  it('flags a missing horizon rather than inventing one', () => {
    const reading = readQuestion('Will artificial intelligence change how work is organised?', NOW);
    expect(reading.horizonYear).toBeNull();
    expect(reading.caveats.join(' ')).toMatch(/no horizon found/i);
  });

  it('explains when no archive record is related', () => {
    const reading = readQuestion('Will the colour blue become the default for bicycles?', NOW);
    expect(reading.matches).toHaveLength(0);
    expect(reading.caveats.join(' ')).toMatch(/no related record/i);
  });

  it('always returns at least three considerations', () => {
    const reading = readQuestion('Will global battery storage exceed 1,200 GW before 2029?', NOW);
    expect(reading.considerations.length).toBeGreaterThanOrEqual(3);
  });

  it('adds a threshold consideration when a number is present', () => {
    const reading = readQuestion('Will annual sales exceed 30 million units by 2030?', NOW);
    expect(reading.considerations.join(' ')).toMatch(/numeric threshold/i);
  });
});

describe('suggestedQuestions', () => {
  it('are all long enough to be usable', () => {
    for (const item of suggestedQuestions) {
      expect(item.question.length).toBeGreaterThan(20);
    }
  });

  it('have unique ids and questions', () => {
    const ids = new Set(suggestedQuestions.map((q) => q.id));
    const questions = new Set(suggestedQuestions.map((q) => q.question));
    expect(ids.size).toBe(suggestedQuestions.length);
    expect(questions.size).toBe(suggestedQuestions.length);
  });
});
