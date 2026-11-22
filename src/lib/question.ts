/**
 * Question reading.
 *
 * THE ORACLE has no forecasting engine. What exists in this prototype is a
 * transparent, deterministic text reading: it classifies a question's subject,
 * looks for a horizon, and measures lexical overlap against the demo archive.
 *
 * Nothing here is generative, nothing here assigns a probability, and every
 * output is designed to be inspectable by the person who typed the question.
 */

import { predictionRecords } from '@/data/records';
import type {
  PredictionCategory,
  PredictionRecord,
  QuestionReading,
  SuggestedQuestion,
} from '@/data/types';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'will', 'would', 'could', 'should', 'shall',
  'can', 'may', 'might', 'must', 'do', 'does', 'did', 'has', 'have', 'had', 'having',
  'in', 'on', 'at', 'by', 'for', 'with', 'without', 'from', 'to', 'of', 'into', 'over', 'under',
  'as', 'about', 'before', 'after', 'until', 'till', 'between', 'during', 'within', 'across',
  'it', 'its', 'they', 'them', 'their', 'there', 'here', 'we', 'our', 'you', 'your',
  'i', 'me', 'my', 'he', 'she', 'his', 'her', 'who', 'whom', 'which', 'what', 'when',
  'where', 'why', 'how', 'more', 'most', 'less', 'least', 'any', 'all', 'some', 'no', 'not',
  'year', 'years', 'time', 'ever', 'first', 'new', 'next', 'become', 'becomes', 'get', 'gets',
  'also', 'just', 'very', 'much', 'many', 'up', 'down', 'out', 'one', 'two',
]);

/** Subject lexicons. Keys are matched against normalized tokens and bigrams. */
const CATEGORY_LEXICON: Record<PredictionCategory, string[]> = {
  technology: [
    'ai', 'model', 'models', 'compute', 'flop', 'software', 'code', 'gpu', 'chip', 'chips',
    'semiconductor', 'robot', 'robotics', 'automation', 'algorithm', 'data', 'internet',
    'quantum', 'cryptography', 'cyber', 'cybersecurity', 'agent', 'agents', 'neural',
    'machine', 'learning', 'open', 'source', 'cloud', 'developer', 'programming',
  ],
  climate: [
    'climate', 'carbon', 'co2', 'emission', 'emissions', 'warming', 'temperature', 'battery',
    'storage', 'renewable', 'renewables', 'solar', 'wind', 'grid', 'energy', 'electricity',
    'fossil', 'methane', 'glacier', 'sea', 'level', 'heat', 'drought', 'flood', 'atmosphere',
    'ppm', 'decarbonization',
  ],
  geopolitics: [
    'election', 'state', 'states', 'nation', 'national', 'country', 'countries', 'sovereign',
    'treaty', 'sanction', 'sanctions', 'border', 'war', 'conflict', 'diplomatic', 'nato',
    'un', 'union', 'regulator', 'regulatory', 'government', 'policy', 'law', 'legislation',
    'geopolitics', 'geopolitical', 'military', 'defence', 'defense',
  ],
  economy: [
    'market', 'markets', 'sales', 'price', 'prices', 'inflation', 'gdp', 'growth', 'revenue',
    'investment', 'capital', 'stock', 'bond', 'interest', 'rate', 'rates', 'trade', 'tariff',
    'currency', 'bank', 'banking', 'economic', 'economy', 'employment', 'unemployment',
    'vehicle', 'vehicles', 'ev', 'evs', 'consumer', 'supply', 'chain', 'manufacturing',
  ],
  science: [
    'research', 'experiment', 'physics', 'fusion', 'superconductor', 'superconducting',
    'replication', 'peer', 'review', 'preprint', 'discovery', 'mathematics', 'chemistry',
    'material', 'materials', 'telescope', 'particle', 'quantum', 'laboratory', 'lab',
    'reproducible', 'reproducibility', 'ambient', 'pressure',
  ],
  health: [
    'health', 'medicine', 'medical', 'therapy', 'therapies', 'drug', 'drugs', 'vaccine',
    'vaccines', 'crispr', 'gene', 'genetic', 'disease', 'clinical', 'trial', 'trial', 'fda',
    'approval', 'approve', 'approved', 'patient', 'patients', 'hospital', 'pandemic',
    'virus', 'cancer', 'heart', 'covid', 'treatment',
  ],
  society: [
    'society', 'social', 'education', 'school', 'university', 'population', 'demographic',
    'inequality', 'poverty', 'housing', 'migration', 'immigration', 'labour', 'labor', 'work',
    'worker', 'city', 'cities', 'urban', 'culture', 'media', 'ballot', 'voting', 'voter',
    'civic', 'adjudication', 'public',
  ],
  space: [
    'space', 'lunar', 'moon', 'mars', 'orbit', 'orbital', 'launch', 'rocket', 'satellite',
    'satellites', 'asteroid', 'astronomy', 'spacecraft', 'lander', 'sample', 'station',
    'payload', 'commercial', 'crew', 'nasa', 'esa',
  ],
};

const CATEGORY_KEYWORDS = Object.entries(CATEGORY_LEXICON) as Array<
  [PredictionCategory, string[]]
>;

/** Human labels for the considerations checklist. */
const CONSIDERATION_TEMPLATES = {
  binary:
    'Phrase it so the answer is unambiguously yes or no. “Improves”, “significant” and “widely adopted” cannot be resolved without a threshold.',
  threshold:
    'Name the numeric threshold and whether the boundary itself counts. “Exceeds 1,200 GW” and “reaches 1,200 GW” resolve differently at exactly 1,200.',
  authority:
    'Name the single authority or dataset that decides the question. If two credible sources could disagree, the rule must say which one is binding.',
  horizon:
    'Fix the resolution date and the horizon separately. A question can cover a period and still be decided later, once the data is published.',
  baseRate:
    'Write down the reference class before you look at the evidence. It is the cheapest defence against a probability that only feels right.',
  falsifiability:
    'State what observation would make you lower this probability. A question whose answer could never surprise you is not a question.',
  window:
    'Decide how late data and revocations are handled. Restatements after the resolution window should not reopen a sealed record.',
  aggregation:
    'Decide how partial evidence counts. A single replication is not two, and an announcement is not an institution.',
} as const;

type ConsiderationKey = keyof typeof CONSIDERATION_TEMPLATES;

/** Suggested questions on the homepage. All illustrative. */
export const suggestedQuestions: SuggestedQuestion[] = [
  {
    id: 'SQ-1',
    question: 'Will global battery storage exceed 1,200 GW before 2029?',
    category: 'climate',
    intent: 'forecast',
    note: 'A threshold question with a fixed dataset as the deciding authority.',
  },
  {
    id: 'SQ-2',
    question: 'When will a commercial mission return samples from the lunar south pole?',
    category: 'space',
    intent: 'forecast',
    note: 'A scheduling question where the reference class is first-of-kind landers.',
  },
  {
    id: 'SQ-3',
    question: 'Will any frontier model disclose training above 10^27 FLOP by mid-2027?',
    category: 'technology',
    intent: 'forecast',
    note: 'A disclosure question, decided by a primary source rather than an estimate.',
  },
  {
    id: 'SQ-4',
    question: 'Will a CRISPR therapy be approved for a condition affecting 1% of adults?',
    category: 'health',
    intent: 'forecast',
    note: 'A regulatory question with a prevalence floor built into the test.',
  },
  {
    id: 'SQ-5',
    question: 'Will annual EV sales pass 30 million units before 2030?',
    category: 'economy',
    intent: 'forecast',
    note: 'A cumulative-adoption question sensitive to how vehicles are classified.',
  },
];

/* -------------------------------------------------------------------------
   Normalization
   ------------------------------------------------------------------------- */

const PUNCTUATION = /[^\p{L}\p{N}\s^%.-]/gu;

/** Lowercase, strip stray punctuation, collapse whitespace, drop trailing ?. */
export function normalizeQuestion(raw: string): string {
  return raw
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!]+$/g, '')
    .trim();
}

function tokenize(normalized: string): string[] {
  return normalized
    .toLowerCase()
    .split(/[\s/]+/)
    .map((token) => token.replace(/^[^a-z0-9^]+|[^a-z0-9^]+$/g, ''))
    .filter((token) => token.length > 1 || /\d/.test(token));
}

/** Very light stemming: enough to match "elections" with "election". */
function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function contentTokens(tokens: readonly string[]): string[] {
  return tokens
    .filter((token) => !STOPWORDS.has(token))
    .map(stem)
    .filter((token) => token.length > 1);
}

/* -------------------------------------------------------------------------
   Category + horizon detection
   ------------------------------------------------------------------------- */

export function detectCategory(tokens: readonly string[]): {
  category: PredictionCategory | null;
  scores: Array<{ category: PredictionCategory; score: number }>;
} {
  const normalized = tokens.map((token) => token.toLowerCase());
  const scores = CATEGORY_KEYWORDS.map(([category, keywords]) => {
    let score = 0;
    for (const keyword of keywords) {
      for (const token of normalized) {
        if (token === keyword) score += 2;
        else if (token.length > 4 && keyword.length > 4 && token.startsWith(keyword)) score += 1;
      }
    }
    return { category, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return { category: null, scores: [] };

  // Only commit to a category when there is a clear winner.
  const [first, second] = scores;
  const decisive = !second || first.score >= second.score * 1.35;
  return { category: decisive ? first.category : null, scores };
}

const YEAR_PATTERN = /\b(20[2-9]\d)\b/g;
const RELATIVE_PATTERN =
  /\b(next|this|coming|following)\s+(year|decade|quarter|two years|three years|five years|ten years)\b/;

export function detectHorizonYear(
  raw: string,
  now: Date = new Date(),
): number | null {
  const years = [...raw.matchAll(YEAR_PATTERN)].map((match) => Number(match[1]));
  if (years.length > 0) return Math.max(...years);

  const relative = raw.toLowerCase().match(RELATIVE_PATTERN);
  if (!relative) return null;

  const base = now.getUTCFullYear();
  const unit = relative[2];
  if (unit === 'year') return base + 1;
  if (unit === 'quarter') return base + 1;
  if (unit === 'decade') return base + 10;
  if (unit === 'two years') return base + 2;
  if (unit === 'three years') return base + 3;
  if (unit === 'five years') return base + 5;
  if (unit === 'ten years') return base + 10;
  return null;
}

/* -------------------------------------------------------------------------
   Archive matching
   ------------------------------------------------------------------------- */

export interface MatchOptions {
  minScore?: number;
  limit?: number;
}

/**
 * Lexical relatedness against the demo archive.
 *
 * The score is deliberately simple and explainable: the share of the question's
 * content tokens that also appear in a record, damped by how much of the record
 * the question actually covers. It measures shared vocabulary, not meaning — a
 * distinction the UI states outright.
 */
export function matchRecords(
  normalized: string,
  records: readonly PredictionRecord[] = predictionRecords,
  { minScore = 0.06, limit = 4 }: MatchOptions = {},
): Array<{ record: PredictionRecord; score: number }> {
  const queryTokens = new Set(contentTokens(tokenize(normalized)));
  if (queryTokens.size === 0) return [];

  const matches = records.map((record) => {
    const recordTokens = new Set(
      contentTokens(
        tokenize(
          normalizeQuestion(
            `${record.canonicalQuestion} ${record.title} ${record.resolutionCriteria.authority}`,
          ),
        ),
      ),
    );

    let shared = 0;
    for (const token of queryTokens) {
      if (recordTokens.has(token)) shared += 1;
      else {
        // Allow prefix matches ("storage"/"storages", "clinical"/"clinics").
        for (const candidate of recordTokens) {
          if (candidate.length > 5 && token.length > 5 && candidate.startsWith(token.slice(0, 5))) {
            shared += 0.5;
            break;
          }
        }
      }
    }

    const coverage = shared / Math.sqrt(queryTokens.size * Math.max(recordTokens.size, 1));
    return { record, score: Math.min(1, coverage) };
  });

  return matches
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------
   Considerations + canonical draft
   ------------------------------------------------------------------------- */

function chooseConsiderations(
  normalized: string,
  horizonYear: number | null,
): ConsiderationKey[] {
  const keys: ConsiderationKey[] = ['binary', 'authority', 'falsifiability'];
  const lower = normalized.toLowerCase();

  if (/\d/.test(normalized)) keys.push('threshold');
  if (horizonYear === null) keys.unshift('horizon');
  else keys.push('window');
  if (/\b(approve|approved|approval|regulator|authority|dataset|report|published)\b/.test(lower)) {
    keys.push('authority');
  }
  if (/\b(most|many|widely|significant|substantial|major|large|rapidly)\b/.test(lower)) {
    keys.push('threshold');
  }
  if (/\b(two|multiple|several|both|pair)\b/.test(lower)) keys.push('aggregation');
  if (/\b(year|annual|quarter|month|deadline|before|by)\b/.test(lower)) keys.push('horizon');
  keys.push('baseRate');

  return [...new Set(keys)].slice(0, 5);
}

/**
 * Produce a yes/no draft from the input, without inventing a subject.
 * Anything the client could not determine stays as an explicit placeholder.
 */
export function draftCanonicalQuestion(
  raw: string,
  horizonYear: number | null,
  now: Date = new Date(),
): string {
  const normalized = normalizeQuestion(raw);
  if (!normalized) return '';

  const stripped = normalized
    .replace(/^(will|does|do|is|are|can|could|would|should)\b\s*/i, '')
    .replace(/^(there|it)\b\s*/i, '');

  const withoutHorizon = stripped
    .replace(/\b(before|by|in|during|through|until)\s+(the\s+end\s+of\s+)?20[2-9]\d\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const year = horizonYear ?? now.getUTCFullYear() + 3;
  const clause = withoutHorizon || 'the stated development occurs';
  return `Will ${clause} by 31 December ${year}?`;
}

/** Full reading of a question, including everything the UI shows. */
export function readQuestion(raw: string, now: Date = new Date()): QuestionReading {
  const normalized = normalizeQuestion(raw);
  const tokens = tokenize(normalized);
  const { category } = detectCategory(tokens);
  const horizonYear = detectHorizonYear(normalized, now);
  const matches = matchRecords(normalized);
  const considerationKeys = chooseConsiderations(normalized, horizonYear);

  const caveats: string[] = [];
  if (category === null) {
    caveats.push(
      'Subject not recognised. This reading uses keyword lexicons, not language understanding, so an unusual subject will stay unclassified.',
    );
  }
  if (horizonYear === null) {
    caveats.push(
      'No horizon found. Without a date the question cannot be resolved, so the draft below assumes a placeholder three-year window.',
    );
  }
  if (matches.length === 0) {
    caveats.push(
      'No related record in the demo archive. That is expected: the archive holds ten illustrative records, not the world.',
    );
  }
  caveats.push(
    'This reading is deterministic and runs entirely in your browser. It does not use a language model and it does not estimate a probability.',
  );

  return {
    raw: raw.trim(),
    normalized,
    tokens,
    category,
    horizonYear,
    matches,
    considerations: considerationKeys.map((key) => CONSIDERATION_TEMPLATES[key]),
    caveats,
  };
}

/** Export the consideration keys so the checklist can be keyed stably. */
export function considerationEntries(
  raw: string,
  horizonYear: number | null,
): Array<{ key: ConsiderationKey; text: string }> {
  const normalized = normalizeQuestion(raw);
  return chooseConsiderations(normalized, horizonYear).map((key) => ({
    key,
    text: CONSIDERATION_TEMPLATES[key],
  }));
}
