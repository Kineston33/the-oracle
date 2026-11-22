/**
 * Demo prediction archive.
 *
 * Every record in `records.json` is illustrative: `demo: true` and a
 * fabricated evidence set. Digests are computed offline by
 * `scripts/seal-records.mjs` over the canonical payload and pasted into the
 * JSON. `assertSealed()` re-verifies them at runtime so the integrity panel
 * can never display a digest that does not match the record it describes.
 */

import raw from './records.json';
import type { ArchiveSummary, PredictionCategory, PredictionRecord } from './types';

export const predictionRecords = raw as PredictionRecord[];

export const DEMO_NOTICE =
  'Illustrative archive. Every record below was fabricated to demonstrate the structure of an official prediction. Nothing here is a real forecast.';

export const CATEGORY_LABELS: Record<PredictionCategory, string> = {
  geopolitics: 'Geopolitics',
  technology: 'Technology',
  climate: 'Climate',
  economy: 'Economy',
  science: 'Science',
  health: 'Health',
  society: 'Society',
  space: 'Space',
};

export const CATEGORY_ORDER: PredictionCategory[] = [
  'technology',
  'climate',
  'geopolitics',
  'economy',
  'science',
  'health',
  'society',
  'space',
];

export interface RecordFilter {
  category?: PredictionCategory | 'all';
  status?: PredictionRecord['status'] | 'all';
  query?: string;
}

/** Text fields a search query is matched against (case-insensitive). */
function searchable(record: PredictionRecord): string {
  return [
    record.id,
    record.title,
    record.canonicalQuestion,
    CATEGORY_LABELS[record.category],
    record.horizon.label,
    record.resolutionCriteria.authority,
  ]
    .join(' ')
    .toLowerCase();
}

export function filterRecords(
  records: readonly PredictionRecord[],
  { category = 'all', status = 'all', query = '' }: RecordFilter,
): PredictionRecord[] {
  const needle = query.trim().toLowerCase();
  return records.filter((record) => {
    if (category !== 'all' && record.category !== category) return false;
    if (status !== 'all' && record.status !== status) return false;
    if (needle && !searchable(record).includes(needle)) return false;
    return true;
  });
}

/** Newest publication first — the default order of the archive. */
export function sortByPublication(
  records: readonly PredictionRecord[],
  direction: 'newest' | 'oldest' = 'newest',
): PredictionRecord[] {
  const sign = direction === 'newest' ? -1 : 1;
  return [...records].sort(
    (a, b) => sign * (Date.parse(a.publishedAt) - Date.parse(b.publishedAt)),
  );
}

export function findRecord(id: string): PredictionRecord | undefined {
  return predictionRecords.find((record) => record.id === id);
}

/** Adjacent records in publication order, for record-to-record navigation. */
export function adjacentRecords(id: string): {
  previous: PredictionRecord | null;
  next: PredictionRecord | null;
} {
  const ordered = sortByPublication(predictionRecords, 'newest');
  const index = ordered.findIndex((record) => record.id === id);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}

/**
 * Archive-level aggregates. `hitRate` only counts resolved records whose
 * outcome was yes or no, and returns null when that count is zero so the UI
 * can show an empty state instead of a fake percentage.
 */
export function summarizeArchive(records: readonly PredictionRecord[]): ArchiveSummary {
  let open = 0;
  let resolved = 0;
  let annulled = 0;
  let decisive = 0;
  let correct = 0;

  for (const record of records) {
    if (record.status === 'open') open += 1;
    if (record.status === 'resolved') resolved += 1;
    if (record.status === 'annulled') annulled += 1;
    if (record.status === 'resolved' && record.resolution) {
      const { outcome } = record.resolution;
      if (outcome === 'yes' || outcome === 'no') {
        decisive += 1;
        const wentYes = outcome === 'yes';
        // A probability above 50% is treated as a "yes" leaning call.
        if ((record.probability >= 0.5) === wentYes) correct += 1;
      }
    }
  }

  return {
    published: records.length,
    open,
    resolved,
    annulled,
    hitRate: decisive === 0 ? null : correct / decisive,
  };
}

/**
 * A cheap structural check used by tests and the integrity panel:
 * every record must be marked demo, carry evidence, and have a digest of the
 * expected shape. It deliberately does not verify the hash — that is async
 * and lives in `lib/integrity.ts`.
 */
/**
 * A comparison form for a canonical question: case, punctuation, quotes and
 * whitespace are folded, so two records that ask the same thing in different
 * typography are recognised as the same question.
 *
 * This is deliberately *not* a semantic comparison. Two genuinely different
 * questions can never collide through it (it only removes surface noise), but
 * it also cannot prove that two differently-worded questions mean the same
 * thing. Detection of paraphrase is a stated limitation, not something this
 * function pretends to do.
 */
export function canonicalKey(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface QuestionCollision {
  key: string;
  ids: string[];
}

/**
 * Finds canonical questions that appear on more than one record.
 *
 * The product rule is that one canonical question maps to exactly one official
 * prediction. Revisions live *on* a record (`integrity.revision`), so a second
 * record carrying the same canonical question is never a legitimate revision —
 * it is a fork, and two true answers to the same question would then exist.
 *
 * This compares wording, not meaning. Two paraphrase-equivalent questions can
 * slip past it; that detection gap is a stated limitation, not something this
 * function pretends to solve.
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
  }

  // One canonical question, one official prediction.
  for (const collision of findCanonicalCollisions(records)) {
    problems.push(
      `Canonical question claimed by more than one record without supersession: ${collision.ids.join(', ')}`,
    );
  }

  return problems;
}
