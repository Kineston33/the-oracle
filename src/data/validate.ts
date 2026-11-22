/**
 * Archive validation.
 *
 * This module deliberately imports no JSON and no browser APIs, so the exact
 * same rules run in three places:
 *
 *   1. the test suite,
 *   2. `scripts/validate-archive.mjs`, which `npm run build` and
 *      `npm run seal` both invoke, and
 *   3. any future publication pipeline.
 *
 * The rule this file exists to enforce: one canonical question maps to exactly
 * one official prediction.
 */

import type { PredictionRecord } from './types';

/**
 * A comparison form for a canonical question: case, punctuation, quotes and
 * whitespace are folded so that two records asking the same thing with
 * different typography produce the same key.
 *
 * Unicode-aware on purpose. `\p{L}` keeps letters from every script and `\p{M}`
 * keeps combining marks, so accented Latin, Cyrillic, Greek, Arabic, Hebrew and
 * the Indic scripts all survive intact. An earlier ASCII-only pattern
 * (`[^a-z0-9]`) silently deleted every non-English word, which meant an Arabic
 * or Russian question reduced to its digits and collided with any other.
 *
 * NFKC runs first so compatibility equivalents fold together: ﬁ → fi, ① → 1,
 * full-width ＡＢＣ → ABC. Diacritics are *not* stripped — "baterias" and
 * "baterías" stay distinct, because in a forecasting archive they can be
 * different questions and a false merge is worse than a missed one. Falling
 * back to a diacritic-insensitive comparison is listed as a known limitation.
 *
 * This compares wording, not meaning. Two paraphrase-equivalent questions are
 * not detected; that is a stated limitation, not something this function
 * pretends to solve.
 */
export function canonicalKey(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, '"')
    // Keep letters, numbers and combining marks from any script. Everything
    // else (whitespace, punctuation, symbols) becomes a single separator.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QuestionCollision {
  key: string;
  ids: string[];
}

/**
 * Finds canonical questions that appear on more than one record.
 *
 * Revisions live *on* a record (`integrity.revision`), so a second record
 * carrying the same canonical question is never a legitimate revision — it is a
 * fork, and two true answers to the same question would then exist.
 */
export function findCanonicalCollisions(
  records: readonly PredictionRecord[],
): QuestionCollision[] {
  const byKey = new Map<string, string[]>();
  for (const record of records) {
    const key = canonicalKey(record.canonicalQuestion);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(record.id);
    else byKey.set(key, [record.id]);
  }

  const collisions: QuestionCollision[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length > 1) collisions.push({ key, ids });
  }
  return collisions;
}

/**
 * Structural checks over the archive. Returns human-readable problems; an empty
 * array means the archive is publishable.
 */
export function assertArchiveShape(records: readonly PredictionRecord[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) problems.push(`Duplicate record id: ${record.id}`);
    ids.add(record.id);

    if (!/^ORC-\d{4}-\d{4}$/.test(record.id)) {
      problems.push(`Malformed record id: ${record.id}`);
    }
    if (!record.demo) problems.push(`Record ${record.id} is missing the demo flag`);
    if (record.evidence.length === 0) problems.push(`Record ${record.id} has no evidence`);
    if (record.probability <= 0 || record.probability >= 1) {
      problems.push(`Record ${record.id} has an out-of-range probability`);
    }
    if (!/^[0-9a-f]{64}$/.test(record.integrity.digest)) {
      problems.push(`Record ${record.id} has no valid SHA-256 digest`);
    }
    if (Date.parse(record.horizon.endsAt) <= Date.parse(record.publishedAt)) {
      problems.push(`Record ${record.id} ends before it was published`);
    }
    if (Date.parse(record.resolutionCriteria.resolveOn) < Date.parse(record.horizon.endsAt)) {
      problems.push(`Record ${record.id} resolves before its horizon ends`);
    }
    if (record.status === 'resolved' && record.resolution?.outcome === 'indeterminate') {
      problems.push(`Record ${record.id} is resolved with an indeterminate outcome`);
    }
    if (!canonicalKey(record.canonicalQuestion)) {
      problems.push(`Record ${record.id} has an empty canonical question`);
    }
  }

  // One canonical question, one official prediction.
  for (const collision of findCanonicalCollisions(records)) {
    problems.push(
      `Canonical question claimed by more than one record without supersession: ${collision.ids.join(', ')}`,
    );
  }

  return problems;
}
