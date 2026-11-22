import { describe, expect, it } from 'vitest';
import {
  adjacentRecords,
  assertArchiveShape,
  canonicalKey,
  filterRecords,
  findCanonicalCollisions,
  findRecord,
  predictionRecords,
  sortByPublication,
} from './records';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PredictionRecord } from './types';

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

/**
 * The product rule this suite protects: one canonical question maps to exactly
 * one official prediction, and the published probability is frozen. These tests
 * are the guard against a future edit silently forking a question.
 */
describe('canonical question uniqueness', () => {
  it('gives every record a distinct canonical question', () => {
    const questions = predictionRecords.map((record) => canonicalKey(record.canonicalQuestion));
    expect(new Set(questions).size).toBe(predictionRecords.length);
  });

  it('finds no collisions in the shipped archive', () => {
    expect(findCanonicalCollisions(predictionRecords)).toEqual([]);
  });

  it('reports no shape problems in the shipped archive', () => {
    expect(assertArchiveShape(predictionRecords)).toEqual([]);
  });

  it('treats typography and case as surface noise, not distinct questions', () => {
    const base = 'Will global installed battery storage exceed 1,200 gigawatts?';
    const variant = '  will GLOBAL installed battery storage   exceed 1,200 GIGAWATTS ';
    expect(canonicalKey(base)).toBe(canonicalKey(variant));
  });

  it('treats curly and straight quotes as the same question', () => {
    expect(canonicalKey("Will the \u201cMauna Loa\u201d series update?")).toBe(
      canonicalKey('Will the "Mauna Loa" series update?'),
    );
  });

  it('folds compatibility equivalents through NFKC', () => {
    // Full-width digits and letters, ligatures and enclosed numerals.
    expect(canonicalKey('Exceed １２００ GW?')).toBe(canonicalKey('Exceed 1200 GW?'));
    expect(canonicalKey('the \uFB01rst ① target')).toBe(canonicalKey('the first 1 target'));
  });

  it('keeps genuinely different questions apart', () => {
    const a = canonicalKey('Will battery storage exceed 1,200 GW?');
    const b = canonicalKey('Will battery storage exceed 2,100 GW?');
    expect(a).not.toBe(b);
  });

  it('flags a duplicated question as a collision', () => {
    const source = predictionRecords[0];
    const fork: PredictionRecord = {
      ...source,
      id: 'ORC-2025-0099',
      integrity: { ...source.integrity, revision: 2 },
    };
    const collisions = findCanonicalCollisions([...predictionRecords, fork]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].ids).toEqual([source.id, 'ORC-2025-0099']);
  });

  it('surfaces the collision through assertArchiveShape', () => {
    const source = predictionRecords[1];
    const fork: PredictionRecord = {
      ...source,
      id: 'ORC-2025-0098',
      integrity: { ...source.integrity, revision: 3 },
    };
    const problems = assertArchiveShape([...predictionRecords, fork]);
    expect(problems.some((problem) => problem.includes('Canonical question'))).toBe(true);
  });

  it('treats a second record as a fork even when it claims a later revision', () => {
    // Revisions belong to a record, not to a new record. A clone with a higher
    // revision number is still two records answering the same question.
    const source = predictionRecords[2];
    const fork: PredictionRecord = {
      ...source,
      id: 'ORC-2025-0097',
      integrity: { ...source.integrity, revision: 2 },
    };
    expect(findCanonicalCollisions([source, fork])).toHaveLength(1);
  });

  it('accepts a single record re-sealed at a higher revision', () => {
    const source = predictionRecords[3];
    const resealed: PredictionRecord = {
      ...source,
      integrity: { ...source.integrity, revision: 2 },
    };
    // One record, one question: nothing has been forked.
    expect(findCanonicalCollisions([resealed])).toEqual([]);
  });
});

describe('published probability is frozen', () => {
  it('keeps probability inside the open unit interval for every record', () => {
    for (const record of predictionRecords) {
      expect(record.probability).toBeGreaterThan(0);
      expect(record.probability).toBeLessThan(1);
    }
  });

  it('leaves the published probability untouched once a record resolves', () => {
    const resolved = predictionRecords.filter((record) => record.status === 'resolved');
    expect(resolved.length).toBeGreaterThan(0);
    for (const record of resolved) {
      // The outcome exists beside the probability; it never replaces it.
      expect(record.resolution).toBeDefined();
      expect(typeof record.probability).toBe('number');
    }
  });

  it('never mutates a record through the read helpers', () => {
    const before = JSON.stringify(predictionRecords);
    filterRecords(predictionRecords, { query: 'battery' });
    sortByPublication(predictionRecords);
    findRecord('ORC-2025-0001');
    adjacentRecords('ORC-2025-0007');
    expect(JSON.stringify(predictionRecords)).toBe(before);
  });
});

describe('demonstration provenance', () => {
  it('flags every shipped record as demonstration data', () => {
    expect(predictionRecords.every((record) => record.demo)).toBe(true);
  });
});

/**
 * The canonical key must survive every script, not just Latin. An earlier
 * version used `[^a-z0-9]`, which deleted whole words: an Arabic or Russian
 * question collapsed to its digits alone and then collided with any other.
 */
describe('canonicalKey across scripts', () => {
  it('preserves Spanish accents instead of deleting the word', () => {
    const key = canonicalKey('¿Se superarán los 1.200 GW de almacenamiento antes de 2030?');
    expect(key).toContain('superarán');
    expect(key).toContain('almacenamiento');
  });

  it('preserves Portuguese accents', () => {
    const key = canonicalKey('A capacidade de armazenamento excederá 1.200 GW?');
    expect(key).toContain('excederá');
    expect(key).toContain('capacidade');
  });

  it('preserves French accents and apostrophes', () => {
    const key = canonicalKey("La capacité d'stockage dépassera-t-elle 1 200 GW ?");
    expect(key).toContain('capacité');
    expect(key).toContain('dépassera');
  });

  it('preserves Cyrillic', () => {
    const key = canonicalKey('Превысит ли мощность накопителей 1200 ГВт?');
    expect(key).toContain('превысит');
    expect(key).toContain('накопителей');
    expect(key).not.toBe('1200');
  });

  it('preserves Greek', () => {
    const key = canonicalKey('Θα ξεπεράσει η αποθήκευση 1200 GW;');
    expect(key).toContain('ξεπεράσει');
    expect(key).toContain('αποθήκευση');
  });

  it('preserves Arabic', () => {
    const key = canonicalKey('هل ستتجاوز سعة التخزين 1200 جيجاواط؟');
    expect(key).toContain('التخزين');
    expect(key).toContain('جيجاواط');
    expect(key).not.toBe('1200');
  });

  it('preserves Hebrew', () => {
    const key = canonicalKey('האם קיבולת האחסון תעלה על 1200 גיגוואט?');
    expect(key).toContain('האחסון');
  });

  it('preserves Japanese and Chinese', () => {
    expect(canonicalKey('蓄電池の設備容量は1,200GWを超えるか？')).toContain('蓄電池');
    expect(canonicalKey('电池储能容量会超过1200吉瓦吗？')).toContain('电池');
  });

  it('preserves Devanagari', () => {
    const key = canonicalKey('क्या भंडारण क्षमता 1200 गीगावाट से अधिक होगी?');
    expect(key).toContain('भंडारण');
  });

  it('keeps combining marks attached', () => {
    // é written as e + U+0301 must survive as a letter with its mark.
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(canonicalKey(composed)).toBe(canonicalKey(decomposed));
    expect(canonicalKey(decomposed)).toBe('café');
  });

  it('does not let two different Arabic questions collide', () => {
    const a = canonicalKey('هل ستتجاوز سعة التخزين 1200 جيجاواط؟');
    const b = canonicalKey('هل ستنخفض أسعار الطاقة 1200 دولار؟');
    expect(a).not.toBe(b);
  });

  it('does not let two different Cyrillic questions collide', () => {
    const a = canonicalKey('Превысит ли мощность накопителей 1200 ГВт?');
    const b = canonicalKey('Снизятся ли цены на энергию 1200 рублей?');
    expect(a).not.toBe(b);
  });

  it('still detects typographic variation within a non-Latin script', () => {
    const a = canonicalKey('هل ستتجاوز سعة التخزين 1200 جيجاواط؟');
    const b = canonicalKey('  هل   ستتجاوز سعة التخزين 1200 جيجاواط  ');
    expect(a).toBe(b);
  });

  it('still detects typographic variation across accents and case', () => {
    const a = canonicalKey('¿SE SUPERARÁN los 1.200 GW de almacenamiento?');
    const b = canonicalKey('  ¿Se   superarán los 1.200 GW de almacenamiento?  ');
    expect(a).toBe(b);
  });

  it('keeps a thousands separator distinct from a bare number', () => {
    // "1.200" and "1200" are the same quantity in different conventions, but the
    // key compares wording, not arithmetic. Keeping them apart is the
    // conservative direction: a missed merge is safer than a false one.
    expect(canonicalKey('1.200 GW')).not.toBe(canonicalKey('1200 GW'));
  });

  it('does not merge an accented word with its unaccented form', () => {
    // Deliberate: a false merge is worse than a missed one. See limitations.
    expect(canonicalKey('baterías')).not.toBe(canonicalKey('baterias'));
  });

  it('returns an empty key for text with no letters or digits', () => {
    expect(canonicalKey('   ?!·—  ')).toBe('');
  });
});

/**
 * The publication gate works because `validate.ts` has no runtime dependencies:
 * Node can import it directly, without a bundler, and run the same rules the
 * tests run. If someone adds a JSON or DOM import here, that silently breaks.
 */
describe('validation module stays importable outside the bundle', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/data/validate.ts'), 'utf8');

  it('declares no runtime imports', () => {
    const runtimeImports = source
      .split('\n')
      .filter((line) => /^import (?!type )/.test(line.trim()));
    expect(runtimeImports).toEqual([]);
  });

  it('imports types only from the domain module', () => {
    expect(source).toMatch(/import type \{ PredictionRecord \} from '\.\/types'/);
  });

  it('does not reach for JSON data or the DOM', () => {
    expect(source).not.toMatch(/records\.json/);
    expect(source).not.toMatch(/\bdocument\.|\bwindow\./);
  });
});
