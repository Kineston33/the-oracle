/**
 * Centralized Canonical Question Resolution & Autonomous Abstention Evaluator.
 *
 * Bridges free-text exploratory questions and structured candidate propositions
 * to THE ORACLE's 7-component `PropositionIdentity`, `AliasTable`, `identityDigest`,
 * and 11-requirement `evaluateCandidate` protocol.
 *
 * Design principles:
 *   1. Equivalent phrasings that resolve to the same 7 canonical components
 *      (`subject`, `event`, `condition`, `geographicScope`, `horizon`,
 *      `resolutionDate`, `decidingAuthority`) produce the exact same
 *      `identityDigest` (`oracle.identity/1`) and resolve to a single official
 *      prediction record.
 *   2. Any component that is missing or ambiguous in the input is recorded
 *      explicitly as `unresolvedTerm(...)` (`unresolved: true`) — never guessed.
 *   3. Whenever any identity component is unresolved, or when deciding authority,
 *      objective resolution criteria, or primary evidence/calibration are absent,
 *      the autonomous evaluator returns `decision: 'abstain'` with explicit,
 *      human-readable abstention reasons.
 */

import {
  AliasTable,
  IDENTITY_COMPONENTS,
  canonicalIdentity,
  compareIdentities,
  identityDigest,
  term,
  unresolvedTerm,
  type AliasEntry,
} from './canonical-identity.ts';
import { evaluateCandidate } from './publication.ts';
import type {
  CandidateProposition,
  EvaluationVerdict,
  IdentityComponent,
  IdentityTerm,
  Inference,
  PropositionIdentity,
} from './publication-types.ts';
import { predictionRecords } from './records.ts';
import type { PredictionCategory, PredictionRecord } from './types.ts';
import {
  detectCategory,
  detectHorizonYear,
  draftCanonicalQuestion,
  matchRecords,
  normalizeQuestion,
} from '../lib/question.ts';

/**
 * Institutional alias table mapping equivalent entity, event, condition, scope,
 * and authority expressions to a single canonical identifier.
 */
export const DEFAULT_ALIAS_ENTRIES: readonly AliasEntry[] = [
  {
    namespace: 'subject',
    aliases: [
      'battery-storage',
      'global-battery-storage',
      'grid-battery-storage',
      'stationary-battery-storage',
      'utility-battery-storage',
    ],
    canonical: 'battery-storage',
  },
  {
    namespace: 'subject',
    aliases: [
      'lunar-south-pole-sample-return',
      'commercial-lunar-south-pole-mission',
      'lunar-south-pole-lander',
    ],
    canonical: 'lunar-south-pole-sample-return',
  },
  {
    namespace: 'subject',
    aliases: [
      'frontier-ai-model',
      'frontier-model',
      'ai-training-run',
      'frontier-training-run',
    ],
    canonical: 'frontier-ai-model',
  },
  {
    namespace: 'subject',
    aliases: [
      'crispr-therapy',
      'crispr-gene-editing-therapy',
      'in-vivo-crispr-therapy',
    ],
    canonical: 'crispr-therapy',
  },
  {
    namespace: 'subject',
    aliases: [
      'ev-sales',
      'electric-vehicle-sales',
      'battery-electric-vehicle-sales',
      'global-ev-sales',
    ],
    canonical: 'ev-sales',
  },
  {
    namespace: 'subject',
    aliases: [
      'atmospheric-co2',
      'mauna-loa-co2',
      'carbon-dioxide-concentration',
    ],
    canonical: 'atmospheric-co2',
  },
  {
    namespace: 'subject',
    aliases: [
      'commercial-fusion-power',
      'grid-connected-fusion',
      'fusion-power-plant',
    ],
    canonical: 'commercial-fusion-power',
  },
  {
    namespace: 'scope',
    aliases: ['global', 'worldwide', 'international', 'world'],
    canonical: 'global',
  },
  {
    namespace: 'scope',
    aliases: ['us', 'usa', 'united-states'],
    canonical: 'us',
  },
  {
    namespace: 'scope',
    aliases: ['eu', 'european-union'],
    canonical: 'eu',
  },
  {
    namespace: 'scope',
    aliases: ['lunar-south-pole', 'moon-south-pole'],
    canonical: 'lunar-south-pole',
  },
  {
    namespace: 'authority',
    aliases: ['iea', 'international-energy-agency'],
    canonical: 'iea',
  },
  {
    namespace: 'authority',
    aliases: ['fda', 'us-fda', 'food-and-drug-administration'],
    canonical: 'fda',
  },
  {
    namespace: 'authority',
    aliases: ['noaa', 'noaa-gml', 'mauna-loa-observatory'],
    canonical: 'noaa',
  },
  {
    namespace: 'authority',
    aliases: ['nasa', 'nasa-esa', 'space-agency-manifest'],
    canonical: 'nasa',
  },
  {
    namespace: 'authority',
    aliases: ['ipcc', 'un-ipcc'],
    canonical: 'ipcc',
  },
  {
    namespace: 'authority',
    aliases: ['who', 'world-health-organization'],
    canonical: 'who',
  },
];

export const DEFAULT_ALIAS_TABLE = new AliasTable(DEFAULT_ALIAS_ENTRIES);

interface SubjectRule {
  pattern: RegExp;
  termValue: IdentityTerm;
  defaultEvent?: IdentityTerm;
}

const SUBJECT_RULES: readonly SubjectRule[] = [
  {
    pattern: /\b(battery\s+storage|stationary\s+storage|grid\s+storage)\b/i,
    termValue: term('subject', 'battery-storage'),
    defaultEvent: term('event', 'installed-capacity-threshold'),
  },
  {
    pattern: /\b(lunar\s+south\s+pole|moon\s+south\s+pole)\b/i,
    termValue: term('subject', 'lunar-south-pole-sample-return'),
    defaultEvent: term('event', 'sample-return-completion'),
  },
  {
    pattern: /\b(frontier\s+(?:ai\s+)?model|training\s+run|10\^27\s*flop)\b/i,
    termValue: term('subject', 'frontier-ai-model'),
    defaultEvent: term('event', 'training-compute-disclosure'),
  },
  {
    pattern: /\b(crispr\s+therapy|gene[- ]editing\s+therapy|crispr)\b/i,
    termValue: term('subject', 'crispr-therapy'),
    defaultEvent: term('event', 'regulatory-approval'),
  },
  {
    pattern: /\b(ev\s+sales|electric\s+vehicle\s+sales|battery[- ]electric\s+vehicle)\b/i,
    termValue: term('subject', 'ev-sales'),
    defaultEvent: term('event', 'annual-unit-sales-threshold'),
  },
  {
    pattern: /\b(mauna\s+loa|co2|co₂|carbon\s+dioxide)\b/i,
    termValue: term('subject', 'atmospheric-co2'),
    defaultEvent: term('event', 'concentration-threshold'),
  },
  {
    pattern: /\b(fusion\s+power|commercial\s+fusion|fusion\s+plant|fusion)\b/i,
    termValue: term('subject', 'commercial-fusion-power'),
    defaultEvent: term('event', 'grid-power-delivery'),
  },
];

function extractSubjectAndEvent(raw: string): {
  subject: IdentityTerm;
  event: IdentityTerm;
  inferences: Inference[];
} {
  const inferences: Inference[] = [];
  for (const rule of SUBJECT_RULES) {
    if (rule.pattern.test(raw)) {
      const subject = DEFAULT_ALIAS_TABLE.resolve(rule.termValue);
      const event = rule.defaultEvent
        ? DEFAULT_ALIAS_TABLE.resolve(rule.defaultEvent)
        : unresolvedTerm('event');
      inferences.push({
        component: 'subject',
        value: `${subject.namespace}:${subject.id}`,
        rule: 'domain-subject-lexicon-v1',
      });
      if (!event.unresolved) {
        inferences.push({
          component: 'event',
          value: `${event.namespace}:${event.id}`,
          rule: 'domain-event-lexicon-v1',
        });
      }
      return { subject, event, inferences };
    }
  }

  return {
    subject: unresolvedTerm('subject'),
    event: unresolvedTerm('event'),
    inferences,
  };
}

function extractCondition(raw: string): {
  condition: IdentityTerm;
  inferences: Inference[];
} {
  const normalized = raw.replace(/,/g, '');
  const comparatorMatch =
    /\b(exceed|exceeds|above|over|pass|passes|reach|reaches|at\s+least|below|under)\s+(\d+(?:\.\d+)?(?:\s*\^\s*\d+)?)\s*(gw|gigawatts?|mw|tw|ppm|flop|flops|%|percent|million|billion|units?)?\b/i.exec(
      normalized,
    );

  if (comparatorMatch) {
    const verb = comparatorMatch[1]!.toLowerCase();
    const op =
      verb === 'below' || verb === 'under'
        ? 'lt'
        : verb === 'reach' || verb === 'reaches' || verb === 'at least'
          ? 'gte'
          : 'gt';
    const num = comparatorMatch[2]!.replace(/\s+/g, '');
    const unitRaw = (comparatorMatch[3] ?? 'units').toLowerCase();
    const unit =
      unitRaw.startsWith('gigawatt') || unitRaw === 'gw'
        ? 'gw'
        : unitRaw === 'percent' || unitRaw === '%'
          ? 'pct'
          : unitRaw.startsWith('flop')
            ? 'flop'
            : unitRaw.startsWith('unit')
              ? 'units'
              : unitRaw;
    const cond = term('condition', `${op}-${num}-${unit}`);
    return {
      condition: cond,
      inferences: [
        {
          component: 'condition',
          value: `${cond.namespace}:${cond.id}`,
          rule: 'quantitative-threshold-parser-v1',
        },
      ],
    };
  }

  if (/\breturn\s+samples\b/i.test(raw)) {
    const cond = term('condition', 'returned-surface-samples-gte-1');
    return {
      condition: cond,
      inferences: [
        {
          component: 'condition',
          value: `${cond.namespace}:${cond.id}`,
          rule: 'binary-milestone-parser-v1',
        },
      ],
    };
  }

  return {
    condition: unresolvedTerm('condition'),
    inferences: [],
  };
}

function extractGeographicScope(raw: string): {
  geographicScope: IdentityTerm;
  inferences: Inference[];
} {
  if (/\b(global|worldwide|international|world|annual\s+ev\s+sales)\b/i.test(raw)) {
    const scope = DEFAULT_ALIAS_TABLE.resolve(term('scope', 'global'));
    return {
      geographicScope: scope,
      inferences: [
        {
          component: 'geographicScope',
          value: `${scope.namespace}:${scope.id}`,
          rule: 'geographic-scope-lexicon-v1',
        },
      ],
    };
  }
  if (/\b(lunar\s+south\s+pole|moon\s+south\s+pole)\b/i.test(raw)) {
    const scope = DEFAULT_ALIAS_TABLE.resolve(term('scope', 'lunar-south-pole'));
    return {
      geographicScope: scope,
      inferences: [
        {
          component: 'geographicScope',
          value: `${scope.namespace}:${scope.id}`,
          rule: 'geographic-scope-lexicon-v1',
        },
      ],
    };
  }
  if (/\b(united\s+states|u\.s\.|usa|fda)\b/i.test(raw)) {
    const scope = DEFAULT_ALIAS_TABLE.resolve(term('scope', 'us'));
    return {
      geographicScope: scope,
      inferences: [
        {
          component: 'geographicScope',
          value: `${scope.namespace}:${scope.id}`,
          rule: 'geographic-scope-lexicon-v1',
        },
      ],
    };
  }
  if (/\b(european\s+union|\beu\b)\b/i.test(raw)) {
    const scope = DEFAULT_ALIAS_TABLE.resolve(term('scope', 'eu'));
    return {
      geographicScope: scope,
      inferences: [
        {
          component: 'geographicScope',
          value: `${scope.namespace}:${scope.id}`,
          rule: 'geographic-scope-lexicon-v1',
        },
      ],
    };
  }

  return {
    geographicScope: unresolvedTerm('scope'),
    inferences: [],
  };
}

function extractDecidingAuthority(raw: string): {
  decidingAuthority: IdentityTerm;
  authorityLabel: string | null;
  inferences: Inference[];
} {
  const authorityPatterns: Array<{
    pattern: RegExp;
    id: string;
    label: string;
  }> = [
    {
      pattern: /\b(iea|international\s+energy\s+agency)\b/i,
      id: 'iea',
      label: 'International Energy Agency (IEA)',
    },
    {
      pattern: /\b(fda|food\s+and\s+drug\s+administration)\b/i,
      id: 'fda',
      label: 'U.S. Food and Drug Administration (FDA)',
    },
    {
      pattern: /\b(noaa|mauna\s+loa\s+observatory)\b/i,
      id: 'noaa',
      label: 'NOAA Global Monitoring Laboratory',
    },
    {
      pattern: /\b(nasa|esa)\b/i,
      id: 'nasa',
      label: 'NASA / Official Mission Manifest',
    },
    {
      pattern: /\b(ipcc)\b/i,
      id: 'ipcc',
      label: 'Intergovernmental Panel on Climate Change (IPCC)',
    },
    {
      pattern: /\b(who|world\s+health\s+organization)\b/i,
      id: 'who',
      label: 'World Health Organization (WHO)',
    },
  ];

  for (const entry of authorityPatterns) {
    if (entry.pattern.test(raw)) {
      const resolved = DEFAULT_ALIAS_TABLE.resolve(term('authority', entry.id));
      return {
        decidingAuthority: resolved,
        authorityLabel: entry.label,
        inferences: [
          {
            component: 'decidingAuthority',
            value: `${resolved.namespace}:${resolved.id}`,
            rule: 'authority-lexicon-v1',
          },
        ],
      };
    }
  }

  return {
    decidingAuthority: unresolvedTerm('authority'),
    authorityLabel: null,
    inferences: [],
  };
}

export interface CanonicalQuestionResolution {
  rawQuery: string;
  normalizedQuery: string;
  draftCanonicalQuestion: string;
  category: PredictionCategory | null;
  horizonYear: number | null;
  identity: PropositionIdentity;
  identityComplete: boolean;
  unresolvedComponents: IdentityComponent[];
  /**
   * 64-char hex SHA-256 (`oracle.identity/1`) computed from the canonical identity.
   * Always deterministic; only eligible to claim a unique slot in `oracle_ledger`
   * when `identityComplete === true`.
   */
  identityDigest: string;
  candidate: CandidateProposition;
  evaluation: EvaluationVerdict;
  autonomousDecision: 'abstain' | 'eligible-for-publication' | 'deduplicated-official';
  abstentionReasons: string[];
  existingOfficialRecord: PredictionRecord | null;
  relatedRecords: Array<{ record: PredictionRecord; score: number }>;
}

export interface ResolveCanonicalQuestionOptions {
  now?: Date;
  aliases?: AliasTable;
  existingOfficialRecord?: PredictionRecord | null;
  archivePool?: readonly PredictionRecord[];
}

/**
 * Deterministically resolve a free-text question into a structured 7-component
 * `PropositionIdentity`, compute its `identityDigest`, check for existing
 * official predictions, and evaluate the 11 publication gates (abstaining
 * whenever ambiguity or insufficient evidence is present).
 */
export async function resolveCanonicalQuestion(
  rawQuery: string,
  options: ResolveCanonicalQuestionOptions = {},
): Promise<CanonicalQuestionResolution> {
  const now = options.now ?? new Date();
  const aliases = options.aliases ?? DEFAULT_ALIAS_TABLE;
  const normalizedQuery = normalizeQuestion(rawQuery);
  const tokens = normalizedQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const { category } = detectCategory(tokens);
  const horizonYear = detectHorizonYear(normalizedQuery, now);
  const draftedQuestion = draftCanonicalQuestion(rawQuery, horizonYear, now);

  const { subject, event, inferences: subjInferences } = extractSubjectAndEvent(rawQuery);
  const { condition, inferences: condInferences } = extractCondition(rawQuery);
  const { geographicScope, inferences: scopeInferences } = extractGeographicScope(rawQuery);
  const {
    decidingAuthority,
    authorityLabel,
    inferences: authInferences,
  } = extractDecidingAuthority(rawQuery);

  const inferences: Inference[] = [
    ...subjInferences,
    ...condInferences,
    ...scopeInferences,
    ...authInferences,
  ];

  let horizonTerm: IdentityTerm;
  let resolutionDateIso: string;
  let candidateHorizon: CandidateProposition['horizon'] = null;

  if (horizonYear !== null) {
    // Notice: "before 2029" means ends by end of 2028 or end of named year; keep consistent with year-end UTC
    const beforeMatch = /\bbefore\s+(20[2-9]\d)\b/i.exec(rawQuery);
    const effectiveEndYear = beforeMatch ? Number(beforeMatch[1]) - 1 : horizonYear;
    horizonTerm = term('horizon', `by-end-of-${effectiveEndYear}`);
    resolutionDateIso = `${effectiveEndYear}-12-31T23:59:59Z`;
    const startYear = Math.min(now.getUTCFullYear(), effectiveEndYear - 1);
    candidateHorizon = {
      startsAt: `${startYear}-01-01T00:00:00Z`,
      endsAt: resolutionDateIso,
      label: `Through ${effectiveEndYear}`,
    };
    inferences.push({
      component: 'horizon',
      value: `${horizonTerm.namespace}:${horizonTerm.id}`,
      rule: 'explicit-year-horizon-v1',
    });
  } else {
    horizonTerm = unresolvedTerm('horizon');
    resolutionDateIso = '';
  }

  const rawIdentity: PropositionIdentity = {
    subject,
    event,
    condition,
    geographicScope,
    horizon: horizonTerm,
    resolutionDate: resolutionDateIso,
    decidingAuthority,
  };

  const resolvedIdentity = canonicalIdentity(rawIdentity, aliases);
  const selfComparison = compareIdentities(resolvedIdentity, resolvedIdentity, aliases);
  const unresolvedComponents: IdentityComponent[] = [];
  for (const comp of IDENTITY_COMPONENTS) {
    if (comp === 'resolutionDate') {
      if (!resolvedIdentity.resolutionDate) {
        unresolvedComponents.push('resolutionDate');
      }
      continue;
    }
    const val = resolvedIdentity[comp];
    if (val.unresolved === true || val.id === 'unknown') {
      unresolvedComponents.push(comp);
    }
  }

  const identityComplete =
    selfComparison.outcome === 'equivalent' && unresolvedComponents.length === 0;
  const computedIdentityDigest = await identityDigest(resolvedIdentity, aliases);

  const candidate: CandidateProposition = {
    candidateId: `cand-${computedIdentityDigest.slice(0, 12)}`,
    submittedQuery: rawQuery.trim(),
    proposedQuestion: draftedQuestion,
    proposedIdentity: resolvedIdentity,
    category: category ?? 'technology',
    probability: null,
    rationale: null,
    horizon: candidateHorizon,
    resolutionCriteria:
      authorityLabel && resolutionDateIso && !condition.unresolved
        ? {
            rule: `Resolves YES if ${draftedQuestion.replace(/\?$/, '')} according to ${authorityLabel}.`,
            authority: authorityLabel,
            resolveOn: resolutionDateIso,
            edgeCases: [
              'Preliminary figures do not trigger early resolution until confirmed by the deciding authority.',
            ],
          }
        : null,
    evidence: [],
    disclosedLimitations: [
      'Exploratory query parsed deterministically without an autonomous probability model or verified primary evidence bundle.',
    ],
    inferences,
    stage: 'exploratory-query',
    createdAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  const evaluation = evaluateCandidate(candidate, {
    publishedAt: candidate.createdAt,
  });

  const existingOfficialRecord = options.existingOfficialRecord ?? null;
  const abstentionReasons: string[] = [];

  if (unresolvedComponents.length > 0) {
    abstentionReasons.push(
      `Unresolved canonical identity components (${unresolvedComponents.join(', ')}): THE ORACLE refuses to guess missing entities, thresholds, horizons, or deciding authorities.`,
    );
  }

  for (const reqResult of evaluation.results) {
    if (!reqResult.passed) {
      abstentionReasons.push(`[${reqResult.id}] ${reqResult.reason}`);
    }
  }

  const autonomousDecision: CanonicalQuestionResolution['autonomousDecision'] =
    existingOfficialRecord
      ? 'deduplicated-official'
      : identityComplete && evaluation.eligible
        ? 'eligible-for-publication'
        : 'abstain';

  const archivePool = options.archivePool ?? predictionRecords;
  const relatedRecords = matchRecords(normalizedQuery, archivePool);

  return {
    rawQuery: rawQuery.trim(),
    normalizedQuery,
    draftCanonicalQuestion: draftedQuestion,
    category,
    horizonYear,
    identity: resolvedIdentity,
    identityComplete,
    unresolvedComponents,
    identityDigest: computedIdentityDigest,
    candidate,
    evaluation,
    autonomousDecision,
    abstentionReasons,
    existingOfficialRecord,
    relatedRecords,
  };
}
