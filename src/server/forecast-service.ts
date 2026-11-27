/**
 * THE ORACLE — End-to-End Scientific Forecast Service & HTTP Orchestrator (Stage 2B-2A)
 *
 * Connects:
 *   1. Strict HTTP request & anti-SSRF input validation
 *   2. Server-side AI question interpretation (`QuestionInterpreterProvider` / Gemini)
 *   3. Canonical proposition identity resolution (`resolveCanonicalQuestion`,
 *      `DEFAULT_ALIAS_TABLE`, `canonicalIdentity`, `identityDigest`, ledger duplicate check)
 *   4. THE ORACLE's real scientific forecasting pipeline (`runScientificForecastPipeline`)
 *   5. Explicit, non-blurred outcome classification distinguishing:
 *        - `empirical-forecast`
 *        - `structural-baseline-forecast`
 *        - `partial-execution`
 *        - `honest-abstention`
 *        - `invalid-question`
 *        - `provider-unavailable`
 *        - `provider-failure`
 *        - `pipeline-failure`
 */

import {
  DEFAULT_ALIAS_TABLE,
  resolveCanonicalQuestion,
  type CanonicalQuestionResolution,
} from '../data/question-resolver.ts';
import {
  IDENTITY_COMPONENTS,
  canonicalIdentity,
  compareIdentities,
  identityDigest,
  term,
  unresolvedTerm,
} from '../data/canonical-identity.ts';
import { sha256Hex } from '../data/hash.ts';
import { deriveLifecycle } from '../data/lifecycle.ts';
import { evaluateCandidate, parseIsoDateTimeMs } from '../data/publication.ts';
import type {
  CandidateProposition,
  IdentityComponent,
  IdentityMatch,
  IdentityTerm,
  Inference,
  PropositionIdentity,
} from '../data/publication-types.ts';
import { predictionRecords } from '../data/records.ts';
import type { IsoDateTime, PredictionCategory, PredictionRecord } from '../data/types.ts';
import { matchRecords, normalizeQuestion } from '../lib/question.ts';
import {
  FORECAST_PIPELINE_VERSION,
  ForecastPipelineRequestError,
  runScientificForecastPipeline,
  type ForecastPipelineDependencies,
  type ForecastPipelineRequest,
  type ForecastPipelineResult,
  type PipelineExecutionStatus,
  type PipelineForecastKind,
} from './forecast-pipeline.ts';
import { validateOutcomeSpaceDescriptor } from './forecast-types.ts';
import { redactProviderSecrets } from './gemini-provider.ts';
import type { PostgresPublicationRegistry } from './postgres-registry.ts';
import {
  QuestionInterpretationError,
  validateAndCanonicalizeCondition,
  type ConditionValidationOutcome,
  type QuestionInterpretation,
  type QuestionInterpretationProviderMetadata,
  type QuestionInterpretationResult,
  type QuestionInterpreterProvider,
} from './question-interpreter.ts';

export const FORECAST_OUTCOME_KINDS = Object.freeze([
  'empirical-forecast',
  'structural-baseline-forecast',
  'partial-execution',
  'honest-abstention',
  'invalid-question',
  'provider-unavailable',
  'provider-failure',
  'pipeline-failure',
] as const);

export type ForecastApiOutcomeKind = (typeof FORECAST_OUTCOME_KINDS)[number];

export interface ForecastServiceDeps {
  readonly questionInterpreter: QuestionInterpreterProvider;
  readonly registry?: Pick<
    PostgresPublicationRegistry,
    'findByIdentity' | 'listOfficialPredictions'
  >;
  readonly pipelineRunner?: (
    request: unknown,
    dependencies?: ForecastPipelineDependencies,
  ) => Promise<ForecastPipelineResult>;
  readonly pipelineDependencies?: Omit<ForecastPipelineDependencies, 'questionResolver'>;
  readonly serverHarvestDefaults?: ForecastPipelineRequest['harvestOptions'];
  /**
   * Optional server-controlled defaults merged into `ForecastPipelineRequest`
   * (never derived from or overrideable by public HTTP callers).
   */
  readonly serverPipelineRequestDefaults?: Partial<
    Omit<ForecastPipelineRequest, 'question' | 'questionId' | 'referenceTime'>
  >;
  readonly now?: () => IsoDateTime;
}

export interface ForecastHttpResponsePayload {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

const ALLOWED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'question',
  'q',
  'includeDemo',
]);

const FORBIDDEN_UNTRUSTED_KEYS: ReadonlySet<string> = new Set([
  'url',
  'urls',
  'sourceurl',
  'sourceurls',
  'evidenceurl',
  'evidenceurls',
  'endpoint',
  'endpointurl',
  'baseurl',
  'submittedevidence',
  'evidence',
  'evidenceverifier',
  'symmetryverifier',
  'combinationverifier',
  'harvestoptions',
  'adapters',
  'customweightsbymethod',
  'apikey',
  'geminiapikey',
  'geminimodel',
  'verifiedempirical',
  'isprimarysourceverified',
  'structuralSymmetryContract'.toLowerCase(),
]);

const BARE_URL_ONLY_PATTERN = /^\s*(?:https?|ftp|file|javascript|data):\/\/?\S*\s*$/i;
const URL_IN_QUESTION_PATTERN = /\b(?:https?|ftp|file):\/\/|(?:javascript|data|vbscript):/i;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildHorizonSlug(
  horizon: QuestionInterpretation['timeHorizon'],
): string {
  if (
    horizon.year !== null &&
    horizon.endsAt !== null &&
    horizon.endsAt.endsWith('-12-31T23:59:59Z')
  ) {
    return `by-end-of-${horizon.year}`;
  }
  if (horizon.endsAt !== null) {
    return `by-${horizon.endsAt.slice(0, 10)}`;
  }
  return horizon.label ?? 'unknown';
}

function buildSafeThematicKeywords(searchQuery: string): readonly string[] {
  const tokens = searchQuery
    .toLowerCase()
    .split(/[^a-z0-9\p{L}\p{N}-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 40);
  const unique = [...new Set(tokens)];
  return Object.freeze(unique.slice(0, 10));
}

function resolveComponentTerm(
  deterministicTerm: IdentityTerm,
  interpreted: {
    readonly id: string | null;
    readonly namespace: string | null;
    readonly resolved: boolean;
  },
  fallbackNamespace: string,
  ruleTag: string,
  componentName: IdentityComponent,
  inferences: Inference[],
): IdentityTerm {
  if (!deterministicTerm.unresolved && deterministicTerm.id !== 'unknown') {
    const resolved = DEFAULT_ALIAS_TABLE.resolve(deterministicTerm);
    inferences.push({
      component: componentName,
      value: `${resolved.namespace}:${resolved.id}`,
      rule: 'deterministic-lexicon-v1',
    });
    return resolved;
  }

  if (interpreted.resolved && interpreted.id !== null) {
    const ns = interpreted.namespace?.trim() || fallbackNamespace;
    const candidate = term(ns, interpreted.id);
    if (candidate.namespace.length > 0 && candidate.id.length > 0 && candidate.id !== 'unknown') {
      const resolved = DEFAULT_ALIAS_TABLE.resolve(candidate);
      inferences.push({
        component: componentName,
        value: `${resolved.namespace}:${resolved.id}`,
        rule: ruleTag,
      });
      return resolved;
    }
  }

  return unresolvedTerm(fallbackNamespace);
}

export async function resolveCanonicalWithInterpretation(options: {
  readonly rawQuestion: string;
  readonly referenceTime: IsoDateTime;
  readonly interpretation: QuestionInterpretation;
  readonly providerId: string;
  readonly registry?: ForecastServiceDeps['registry'];
  readonly includeDemo: boolean;
}): Promise<{
  readonly resolution: CanonicalQuestionResolution;
  readonly horizonWindow: {
    readonly startsAt: IsoDateTime;
    readonly endsAt: IsoDateTime;
    readonly label: string;
  } | null;
  readonly deterministicVsAiComparison: IdentityMatch;
  readonly deterministicFallbackUsed: boolean;
  readonly validatedCondition: ConditionValidationOutcome;
}> {
  const refDate = new Date(parseIsoDateTimeMs(options.referenceTime)!);
  const deterministic = await resolveCanonicalQuestion(options.rawQuestion, {
    now: refDate,
  });

  const interp = options.interpretation;
  const aiRuleTag = `ai-interpreter-${options.providerId}-v1`;
  const inferences: Inference[] = [];
  const validatedCondition = validateAndCanonicalizeCondition(interp.condition);

  const subject = resolveComponentTerm(
    deterministic.identity.subject,
    interp.subject,
    'subject',
    aiRuleTag,
    'subject',
    inferences,
  );
  const event = resolveComponentTerm(
    deterministic.identity.event,
    interp.event,
    'event',
    aiRuleTag,
    'event',
    inferences,
  );

  let condition: IdentityTerm;
  let aiConditionDiagnostic: string | null = null;
  if (
    !deterministic.identity.condition.unresolved &&
    deterministic.identity.condition.id !== 'unknown'
  ) {
    condition = DEFAULT_ALIAS_TABLE.resolve(deterministic.identity.condition);
    inferences.push({
      component: 'condition',
      value: `${condition.namespace}:${condition.id}`,
      rule: 'deterministic-lexicon-v1',
    });
  } else if (validatedCondition.valid && validatedCondition.canonicalId !== null) {
    const candidate = term('condition', validatedCondition.canonicalId);
    if (
      candidate.namespace.length > 0 &&
      candidate.id.length > 0 &&
      candidate.id !== 'unknown'
    ) {
      condition = DEFAULT_ALIAS_TABLE.resolve(candidate);
      inferences.push({
        component: 'condition',
        value: `${condition.namespace}:${condition.id}`,
        rule:
          validatedCondition.kind === 'quantitative'
            ? `${aiRuleTag}-structured-condition`
            : aiRuleTag,
      });
    } else {
      condition = unresolvedTerm('condition');
      aiConditionDiagnostic =
        'Canonicalized AI condition produced an empty or unknown identifier and was demoted to unresolved.';
    }
  } else {
    condition = unresolvedTerm('condition');
    if (validatedCondition.demoted && validatedCondition.diagnostic) {
      aiConditionDiagnostic = validatedCondition.diagnostic;
    }
  }

  const geographicScope = resolveComponentTerm(
    deterministic.identity.geographicScope,
    interp.geographicScope,
    'scope',
    aiRuleTag,
    'geographicScope',
    inferences,
  );
  const decidingAuthority = resolveComponentTerm(
    deterministic.identity.decidingAuthority,
    interp.decidingAuthority,
    'authority',
    aiRuleTag,
    'decidingAuthority',
    inferences,
  );

  let horizonTerm: IdentityTerm;
  let horizonWindow: {
    readonly startsAt: IsoDateTime;
    readonly endsAt: IsoDateTime;
    readonly label: string;
  } | null = null;
  let usedSubYearAiHorizonRefinement = false;

  const detHasCoarseYearEndHorizon =
    !deterministic.identity.horizon.unresolved &&
    deterministic.identity.horizon.id.startsWith('by-end-of-') &&
    deterministic.candidate.horizon !== null;
  const aiEndsMs =
    interp.timeHorizon.resolved && interp.timeHorizon.endsAt !== null
      ? parseIsoDateTimeMs(interp.timeHorizon.endsAt)
      : null;
  const detEndsMs =
    deterministic.candidate.horizon !== null
      ? parseIsoDateTimeMs(deterministic.candidate.horizon.endsAt)
      : null;
  const aiRefinesCoarseDeterministicYear =
    detHasCoarseYearEndHorizon &&
    interp.timeHorizon.resolved &&
    interp.timeHorizon.startsAt !== null &&
    interp.timeHorizon.endsAt !== null &&
    aiEndsMs !== null &&
    detEndsMs !== null &&
    new Date(aiEndsMs).getUTCFullYear() === new Date(detEndsMs).getUTCFullYear() &&
    aiEndsMs < detEndsMs &&
    !buildHorizonSlug(interp.timeHorizon).startsWith('by-end-of-');

  if (
    !deterministic.identity.horizon.unresolved &&
    deterministic.identity.horizon.id !== 'unknown' &&
    deterministic.candidate.horizon !== null &&
    !aiRefinesCoarseDeterministicYear
  ) {
    horizonTerm = deterministic.identity.horizon;
    horizonWindow = deterministic.candidate.horizon;
    inferences.push({
      component: 'horizon',
      value: `${horizonTerm.namespace}:${horizonTerm.id}`,
      rule: 'deterministic-horizon-v1',
    });
  } else if (
    interp.timeHorizon.resolved &&
    interp.timeHorizon.startsAt !== null &&
    interp.timeHorizon.endsAt !== null
  ) {
    const slug = buildHorizonSlug(interp.timeHorizon);
    const candidateH = term('horizon', slug);
    horizonTerm = candidateH.id.length > 0 ? candidateH : unresolvedTerm('horizon');
    if (!horizonTerm.unresolved) {
      usedSubYearAiHorizonRefinement = aiRefinesCoarseDeterministicYear;
      horizonWindow = {
        startsAt: interp.timeHorizon.startsAt,
        endsAt: interp.timeHorizon.endsAt,
        label: interp.timeHorizon.label ?? slug,
      };
      inferences.push({
        component: 'horizon',
        value: `${horizonTerm.namespace}:${horizonTerm.id}`,
        rule: aiRefinesCoarseDeterministicYear
          ? `${aiRuleTag}-subyear-refinement`
          : aiRuleTag,
      });
    }
  } else {
    horizonTerm = unresolvedTerm('horizon');
  }

  let resolutionDateIso = '';
  if (deterministic.identity.resolutionDate && !usedSubYearAiHorizonRefinement) {
    resolutionDateIso = deterministic.identity.resolutionDate;
  } else if (interp.resolutionDate.resolved && interp.resolutionDate.isoDateTime) {
    const rdMs = parseIsoDateTimeMs(interp.resolutionDate.isoDateTime);
    const endMs = horizonWindow ? parseIsoDateTimeMs(horizonWindow.endsAt) : null;
    if (rdMs !== null && (endMs === null || rdMs >= endMs)) {
      resolutionDateIso = interp.resolutionDate.isoDateTime;
      inferences.push({
        component: 'resolutionDate',
        value: resolutionDateIso,
        rule: usedSubYearAiHorizonRefinement
          ? `${aiRuleTag}-subyear-refinement`
          : aiRuleTag,
      });
    }
  } else if (deterministic.identity.resolutionDate) {
    resolutionDateIso = deterministic.identity.resolutionDate;
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

  const resolvedIdentity = canonicalIdentity(rawIdentity, DEFAULT_ALIAS_TABLE);
  const selfComparison = compareIdentities(
    resolvedIdentity,
    resolvedIdentity,
    DEFAULT_ALIAS_TABLE,
  );
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
  const computedIdentityDigest = await identityDigest(
    resolvedIdentity,
    DEFAULT_ALIAS_TABLE,
  );

  // Build AI-only identity strictly to detect divergence against deterministic parser
  const aiOnlyIdentity: PropositionIdentity = canonicalIdentity(
    {
      subject:
        interp.subject.resolved && interp.subject.id
          ? term(interp.subject.namespace ?? 'subject', interp.subject.id)
          : unresolvedTerm('subject'),
      event:
        interp.event.resolved && interp.event.id
          ? term(interp.event.namespace ?? 'event', interp.event.id)
          : unresolvedTerm('event'),
      condition:
        validatedCondition.valid && validatedCondition.canonicalId !== null
          ? term('condition', validatedCondition.canonicalId)
          : unresolvedTerm('condition'),
      geographicScope:
        interp.geographicScope.resolved && interp.geographicScope.id
          ? term(interp.geographicScope.namespace ?? 'scope', interp.geographicScope.id)
          : unresolvedTerm('scope'),
      horizon:
        interp.timeHorizon.resolved && interp.timeHorizon.endsAt
          ? term('horizon', buildHorizonSlug(interp.timeHorizon))
          : unresolvedTerm('horizon'),
      resolutionDate:
        interp.resolutionDate.resolved && interp.resolutionDate.isoDateTime
          ? interp.resolutionDate.isoDateTime
          : '',
      decidingAuthority:
        interp.decidingAuthority.resolved && interp.decidingAuthority.id
          ? term(
              interp.decidingAuthority.namespace ?? 'authority',
              interp.decidingAuthority.id,
            )
          : unresolvedTerm('authority'),
    },
    DEFAULT_ALIAS_TABLE,
  );

  const deterministicVsAiComparison = compareIdentities(
    deterministic.identity,
    aiOnlyIdentity,
    DEFAULT_ALIAS_TABLE,
  );

  const existingMatch = options.registry
    ? await options.registry.findByIdentity(computedIdentityDigest)
    : null;
  const officialRecords = options.registry
    ? await options.registry.listOfficialPredictions()
    : [];
  const archivePool: readonly PredictionRecord[] = options.includeDemo
    ? [...officialRecords, ...predictionRecords]
    : officialRecords;

  const effectiveCategory: PredictionCategory | null =
    deterministic.category ?? interp.category;
  const draftedQuestion =
    interp.canonicalQuestionDraft ?? deterministic.draftCanonicalQuestion;
  const authorityLabel =
    interp.decidingAuthority.label ??
    (deterministic.candidate.resolutionCriteria?.authority ?? null);

  const candidate: CandidateProposition = {
    candidateId: `cand-${computedIdentityDigest.slice(0, 12)}`,
    submittedQuery: options.rawQuestion.trim(),
    proposedQuestion: draftedQuestion,
    proposedIdentity: resolvedIdentity,
    category: effectiveCategory ?? 'technology',
    probability: null,
    rationale: null,
    horizon: horizonWindow
      ? {
          startsAt: horizonWindow.startsAt,
          endsAt: horizonWindow.endsAt,
          label: horizonWindow.label,
        }
      : null,
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
      `Canonical identity resolved with ${options.providerId} linguistic parsing plus deterministic alias verification; no probability or evidence inferred from AI interpretation.`,
      ...(aiConditionDiagnostic ? [aiConditionDiagnostic] : []),
      ...interp.interpretationLimitations,
    ],
    inferences,
    stage: 'exploratory-query',
    createdAt: options.referenceTime,
  };

  const evaluation = evaluateCandidate(candidate, {
    publishedAt: options.referenceTime,
  });

  const existingOfficialRecord = existingMatch?.record ?? null;
  const abstentionReasons: string[] = [];
  if (aiConditionDiagnostic) {
    abstentionReasons.push(aiConditionDiagnostic);
  }
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

  const relatedRecords = matchRecords(
    interp.normalizedSearchQuery || deterministic.normalizedQuery,
    archivePool,
  );

  const horizonYear =
    deterministic.horizonYear ??
    interp.timeHorizon.year ??
    (horizonWindow
      ? new Date(parseIsoDateTimeMs(horizonWindow.endsAt)!).getUTCFullYear()
      : null);

  const resolution: CanonicalQuestionResolution = {
    rawQuery: options.rawQuestion.trim(),
    normalizedQuery: normalizeQuestion(options.rawQuestion),
    draftCanonicalQuestion: draftedQuestion,
    category: effectiveCategory,
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

  return {
    resolution,
    horizonWindow,
    deterministicVsAiComparison,
    deterministicFallbackUsed: deterministic.identityComplete,
    validatedCondition,
  };
}

function mapPipelineStatusToOutcomeKind(
  pipelineStatus: PipelineExecutionStatus,
  forecastKind: PipelineForecastKind,
): ForecastApiOutcomeKind {
  if (pipelineStatus === 'failed-execution' || forecastKind === 'failed') {
    return 'pipeline-failure';
  }
  if (pipelineStatus === 'partial-execution') {
    return 'partial-execution';
  }
  if (pipelineStatus === 'structural-baseline-forecast') {
    return 'structural-baseline-forecast';
  }
  if (pipelineStatus === 'successful-empirical-forecast') {
    return 'empirical-forecast';
  }
  return 'honest-abstention';
}

function summarizePipelineResult(result: ForecastPipelineResult): Record<string, unknown> {
  return {
    pipelineVersion: result.pipelineVersion,
    executedAt: result.executedAt,
    referenceTime: result.referenceTime,
    pipelineStatus: result.pipelineStatus,
    forecastKind: result.forecastKind,
    isEmpiricalForecast: result.isEmpiricalForecast,
    outcomeSpace: result.outcomeSpace,
    footingTier: result.footingTier,
    calibrationStatus: result.calibrationStatus,
    probabilityDistribution: result.probabilityDistribution,
    uncertaintyDecomposition: result.uncertaintyDecomposition,
    evidenceCollection: {
      status: result.evidenceCollectionStatus,
      retrievedEvidenceCount: result.retrievedEvidenceCount,
      validatedQuantitativeEvidenceCount: result.validatedQuantitativeEvidenceCount,
      providerReports: result.harvestResult.providerReports.map((p) => ({
        provider: p.provider,
        status: p.status,
        httpStatus: p.httpStatus,
        durationMs: p.durationMs,
        acceptedCount: p.accepted.length,
        discardedCount: p.discarded.length,
        error: p.error,
      })),
      evidenceReferences: result.evidenceReferences,
      discardedCount: result.discardedHarvestDiagnostics.length,
      assessmentNotes: result.evidenceAssessment.assessmentNotes,
    },
    methods: {
      executedMethodIds: result.executedMethodIds,
      executedMethodDiagnostics: result.executedMethodDiagnostics,
      skippedMethods: result.skippedMethods,
      methodExecutionFailures: result.methodExecutionFailures,
      unexecutedApplicableMethods: result.unexecutedApplicableMethods,
    },
    ...(result.abstentionReason !== undefined
      ? { abstentionReason: result.abstentionReason }
      : {}),
    limitations: result.limitations,
    missingRequirements: result.missingRequirements,
    missingRequirementsByMethod: result.missingRequirementsByMethod,
  };
}

export async function executeForecastApiRequest(
  rawBody: unknown,
  deps: ForecastServiceDeps,
): Promise<ForecastHttpResponsePayload> {
  const referenceTime: IsoDateTime =
    deps.now?.() ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // 1. Strict HTTP request & trust-boundary validation
  if (!isPlainObject(rawBody)) {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'invalid_request_body',
        message: 'Request body must be a JSON object with a non-empty question string.',
        pipelineInvoked: false,
      },
    };
  }

  for (const key of Object.keys(rawBody)) {
    const lowered = key.toLowerCase();
    if (FORBIDDEN_UNTRUSTED_KEYS.has(lowered)) {
      return {
        statusCode: 400,
        body: {
          outcomeKind: 'invalid-question',
          error: 'untrusted_input_rejected',
          message: `Untrusted parameter '${key}' is not permitted on this public endpoint; THE ORACLE blocks caller-supplied URLs, evidence claims, verifiers, and provider credentials.`,
          pipelineInvoked: false,
        },
      };
    }
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return {
        statusCode: 400,
        body: {
          outcomeKind: 'invalid-question',
          error: 'unsupported_parameter',
          message: `Unsupported parameter '${key}'. Allowed fields: question, includeDemo.`,
          pipelineInvoked: false,
        },
      };
    }
  }

  const rawQuestionValue = rawBody.question ?? rawBody.q;
  if (typeof rawQuestionValue !== 'string') {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'invalid_question',
        message: 'Field "question" must be a non-empty string.',
        pipelineInvoked: false,
      },
    };
  }

  if (CONTROL_CHAR_PATTERN.test(rawQuestionValue)) {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'invalid_question',
        message: 'Question contains disallowed control characters.',
        pipelineInvoked: false,
      },
    };
  }

  const trimmedQuestion = rawQuestionValue.trim();
  if (trimmedQuestion.length < 3 || trimmedQuestion.length > 1000) {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'invalid_question',
        message: 'Question must be between 3 and 1000 characters.',
        pipelineInvoked: false,
      },
    };
  }

  if (
    BARE_URL_ONLY_PATTERN.test(trimmedQuestion) ||
    URL_IN_QUESTION_PATTERN.test(trimmedQuestion)
  ) {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'url_not_permitted',
        message:
          'Questions cannot contain raw URLs or protocol schemes; supply a plain-language forecasting question.',
        pipelineInvoked: false,
      },
    };
  }

  const includeDemo =
    typeof rawBody.includeDemo === 'boolean' ? rawBody.includeDemo : false;

  // 2. Check configured AI Question Interpreter provider (fail closed if unconfigured)
  const providerStatus: QuestionInterpretationProviderMetadata =
    deps.questionInterpreter.getStatus();
  if (!deps.questionInterpreter.isConfigured()) {
    return {
      statusCode: 503,
      body: {
        outcomeKind: 'provider-unavailable',
        error: 'ai_provider_unconfigured',
        message:
          providerStatus.reason ??
          'AI-assisted forecasting is unavailable because GEMINI_API_KEY is not configured on the server.',
        aiInterpretation: {
          invoked: false,
          provider: providerStatus,
        },
        pipelineInvoked: false,
      },
    };
  }

  // 3. Call Gemini (or injected QuestionInterpreterProvider) strictly for linguistic parsing
  let interpResult: QuestionInterpretationResult;
  try {
    interpResult = await deps.questionInterpreter.interpretQuestion({
      question: trimmedQuestion,
      referenceTime,
    });
  } catch (err) {
    if (err instanceof QuestionInterpretationError) {
      return {
        statusCode: err.httpStatus,
        body: {
          outcomeKind: 'provider-failure',
          error: err.code,
          retryable: err.retryable,
          message: redactProviderSecrets(err.message),
          details: err.details.map((d) => redactProviderSecrets(d)),
          aiInterpretation: {
            invoked: true,
            provider: providerStatus,
          },
          pipelineInvoked: false,
        },
      };
    }

    const msg = redactProviderSecrets(
      err instanceof Error ? err.message : String(err),
    );
    return {
      statusCode: 502,
      body: {
        outcomeKind: 'provider-failure',
        error: 'provider_upstream_error',
        retryable: true,
        message: `AI interpretation provider failed unexpectedly: ${msg}`,
        aiInterpretation: {
          invoked: true,
          provider: providerStatus,
        },
        pipelineInvoked: false,
      },
    };
  }

  const interp = interpResult.interpretation;

  // 4. Canonical proposition identity resolution via existing ORACLE infrastructure
  const {
    resolution,
    horizonWindow,
    deterministicVsAiComparison,
    validatedCondition,
  } = await resolveCanonicalWithInterpretation({
    rawQuestion: trimmedQuestion,
    referenceTime,
    interpretation: interp,
    providerId: interpResult.providerId,
    registry: deps.registry,
    includeDemo,
  });

  const effectiveMissingComponents: readonly IdentityComponent[] =
    !validatedCondition.condition.resolved &&
    !interp.missingComponents.includes('condition')
      ? [...interp.missingComponents, 'condition']
      : interp.missingComponents;
  const effectiveAmbiguousComponents =
    validatedCondition.demoted &&
    validatedCondition.diagnostic &&
    !interp.ambiguousComponents.some((item) => item.component === 'condition')
      ? [
          ...interp.ambiguousComponents,
          {
            component: 'condition' as const,
            reason: validatedCondition.diagnostic,
          },
        ]
      : interp.ambiguousComponents;

  const aiInterpretationSummary = {
    invoked: true,
    providerId: interpResult.providerId,
    model: interpResult.model,
    interpretedAt: interpResult.interpretedAt,
    latencyMs: interpResult.latencyMs,
    ...(interpResult.tokenUsage ? { tokenUsage: interpResult.tokenUsage } : {}),
    isForecastableProposition: interp.isForecastableProposition,
    canonicalQuestionDraft: interp.canonicalQuestionDraft,
    category: interp.category,
    categoryRationale: interp.categoryRationale,
    components: {
      subject: interp.subject,
      event: interp.event,
      condition: validatedCondition.condition,
      geographicScope: interp.geographicScope,
      timeHorizon: interp.timeHorizon,
      resolutionDate: interp.resolutionDate,
      decidingAuthority: interp.decidingAuthority,
    },
    missingComponents: effectiveMissingComponents,
    ambiguousComponents: effectiveAmbiguousComponents,
    clarifyingQuestions: interp.clarifyingQuestions,
    normalizedSearchQuery: interp.normalizedSearchQuery,
    limitations: interp.interpretationLimitations,
  };

  const canonicalResolutionSummary = {
    rawQuestion: resolution.rawQuery,
    normalizedQuestion: resolution.normalizedQuery,
    draftCanonicalQuestion: resolution.draftCanonicalQuestion,
    category: resolution.category,
    horizonYear: resolution.horizonYear,
    identity: resolution.identity,
    identityDigest: resolution.identityDigest,
    identityComplete: resolution.identityComplete,
    unresolvedComponents: resolution.unresolvedComponents,
    autonomousDecision: resolution.autonomousDecision,
    abstentionReasons: resolution.abstentionReasons,
    existingOfficialRecord: resolution.existingOfficialRecord,
    relatedRecordsCount: resolution.relatedRecords.length,
    relatedRecords: resolution.relatedRecords.map((r) => ({
      id: r.record.id,
      canonicalQuestion: r.record.canonicalQuestion,
      category: r.record.category,
      status: Array.isArray(r.record.events) ? deriveLifecycle(r.record).status : 'open',
      demo: Boolean(r.record.demo),
      score: r.score,
    })),
    deterministicVsAiAlignment: {
      outcome: deterministicVsAiComparison.outcome,
      because: deterministicVsAiComparison.because,
      detail: deterministicVsAiComparison.detail,
    },
  };

  // Reject clear non-questions / gibberish / non-forecastable inputs
  if (
    !interp.isForecastableProposition &&
    interp.canonicalQuestionDraft === null &&
    resolution.category === null
  ) {
    return {
      statusCode: 400,
      body: {
        outcomeKind: 'invalid-question',
        error: 'not_a_forecasting_question',
        message:
          'Input could not be parsed as a falsifiable forecasting question.',
        aiInterpretation: aiInterpretationSummary,
        canonicalResolution: canonicalResolutionSummary,
        pipelineInvoked: false,
      },
    };
  }

  // 5. Check whether sufficient non-fabricated structure exists to invoke scientific pipeline
  if (resolution.category === null || horizonWindow === null) {
    return {
      statusCode: 200,
      body: {
        outcomeKind: 'honest-abstention',
        isEmpiricalForecast: false,
        forecastKind: 'abstained',
        pipelineInvoked: false,
        pipelineVersion: FORECAST_PIPELINE_VERSION,
        footingTier: 'insufficient-basis-abstain',
        probabilityDistribution: null,
        abstentionReason: 'undefined-or-ambiguous-outcome-space',
        message:
          'THE ORACLE abstained without generating a probability because the question lacks an unambiguous domain category or fixed forecast horizon.',
        missingComponents: resolution.unresolvedComponents,
        clarifyingQuestions: interp.clarifyingQuestions,
        abstentionReasons: resolution.abstentionReasons,
        aiInterpretation: aiInterpretationSummary,
        canonicalResolution: canonicalResolutionSummary,
      },
    };
  }

  const refMs = parseIsoDateTimeMs(referenceTime)!;
  const endMs = parseIsoDateTimeMs(horizonWindow.endsAt)!;
  if (endMs <= refMs) {
    return {
      statusCode: 200,
      body: {
        outcomeKind: 'honest-abstention',
        isEmpiricalForecast: false,
        forecastKind: 'abstained',
        pipelineInvoked: false,
        pipelineVersion: FORECAST_PIPELINE_VERSION,
        footingTier: 'insufficient-basis-abstain',
        probabilityDistribution: null,
        abstentionReason: 'expired-horizon',
        message: `THE ORACLE abstained because the parsed forecast horizon (${horizonWindow.endsAt}) is not in the future relative to server reference time (${referenceTime}).`,
        missingComponents: resolution.unresolvedComponents,
        clarifyingQuestions: interp.clarifyingQuestions,
        abstentionReasons: [
          `Horizon ended at ${horizonWindow.endsAt} <= referenceTime ${referenceTime}.`,
          ...resolution.abstentionReasons,
        ],
        aiInterpretation: aiInterpretationSummary,
        canonicalResolution: canonicalResolutionSummary,
      },
    };
  }

  // 6. Build canonical OutcomeSpaceDescriptor and invoke real `runScientificForecastPipeline`
  const eventDefHash = await sha256Hex(
    `oracle.outcome-space/1\n${resolution.identityDigest}\nbinary:Yes|No`,
  );
  const defaultOutcomeSpace = validateOutcomeSpaceDescriptor({
    kind: 'binary',
    outcomeLabels: ['Yes', 'No'],
    horizonStartsAt: horizonWindow.startsAt,
    horizonEndsAt: horizonWindow.endsAt,
    eventDefinitionHash: `sha256:${eventDefHash}`,
  });

  const thematicKeywords = buildSafeThematicKeywords(interp.normalizedSearchQuery);
  const serverDefaults = deps.serverPipelineRequestDefaults ?? {};
  const effectiveOutcomeSpace = serverDefaults.outcomeSpace ?? defaultOutcomeSpace;
  const effectiveSubdomain =
    serverDefaults.subdomain ??
    (effectiveOutcomeSpace.kind === 'binary'
      ? 'binary-event-occurrence'
      : effectiveOutcomeSpace.kind === 'categorical-exhaustive'
        ? 'categorical-state-distribution'
        : undefined);
  const pipelineRequest: ForecastPipelineRequest = {
    ...serverDefaults,
    question: trimmedQuestion,
    questionId: resolution.candidate.candidateId,
    questionCategory: serverDefaults.questionCategory ?? resolution.category,
    ...(effectiveSubdomain !== undefined ? { subdomain: effectiveSubdomain } : {}),
    outcomeSpace: effectiveOutcomeSpace,
    horizon: serverDefaults.horizon ?? {
      startsAt: effectiveOutcomeSpace.horizonStartsAt,
      endsAt: effectiveOutcomeSpace.horizonEndsAt,
      referenceTime,
    },
    referenceTime,
    harvestOptions: {
      ...(deps.serverHarvestDefaults ?? {}),
      ...(serverDefaults.harvestOptions ?? {}),
      ...(thematicKeywords.length > 0 ? { thematicKeywords } : {}),
    },
    additionalLimitations: [
      `AI question interpretation (${interpResult.providerId}/${interpResult.model}) contributed canonical component parsing only and supplied zero empirical evidence or probabilities.`,
      ...interp.interpretationLimitations,
      ...(serverDefaults.additionalLimitations ?? []),
    ],
  };

  const pipelineRunner = deps.pipelineRunner ?? runScientificForecastPipeline;
  const pipelineDeps: ForecastPipelineDependencies = {
    ...(deps.pipelineDependencies ?? {}),
    questionResolver: async () => resolution,
    now: () => referenceTime,
  };

  let pipelineResult: ForecastPipelineResult;
  try {
    pipelineResult = await pipelineRunner(pipelineRequest, pipelineDeps);
  } catch (err) {
    const isReqErr = err instanceof ForecastPipelineRequestError;
    const rawErrMsg = err instanceof Error ? err.message : String(err);
    const diagnostics = isReqErr ? err.diagnostics : [rawErrMsg];
    return {
      statusCode: isReqErr ? 422 : 500,
      body: {
        outcomeKind: 'pipeline-failure',
        error: isReqErr
          ? 'scientific_pipeline_request_rejected'
          : 'scientific_pipeline_failure',
        message: `Scientific forecasting pipeline failed: ${redactProviderSecrets(rawErrMsg)}`,
        diagnostics: diagnostics.map((d) => redactProviderSecrets(d)),
        pipelineInvoked: true,
        pipelineVersion: FORECAST_PIPELINE_VERSION,
        aiInterpretation: aiInterpretationSummary,
        canonicalResolution: canonicalResolutionSummary,
      },
    };
  }

  const outcomeKind = mapPipelineStatusToOutcomeKind(
    pipelineResult.pipelineStatus,
    pipelineResult.forecastKind,
  );

  const statusCode = outcomeKind === 'pipeline-failure' ? 500 : 200;

  return {
    statusCode,
    body: {
      outcomeKind,
      ...(outcomeKind === 'pipeline-failure'
        ? { error: 'scientific_pipeline_execution_failed' }
        : {}),
      isEmpiricalForecast: pipelineResult.isEmpiricalForecast,
      forecastKind: pipelineResult.forecastKind,
      pipelineStatus: pipelineResult.pipelineStatus,
      partialExecution: pipelineResult.pipelineStatus === 'partial-execution',
      ...(outcomeKind === 'structural-baseline-forecast'
        ? {
            nonEmpiricalBaselineNotice:
              'Structural uniform baseline forecast based solely on verified outcome symmetry — not an empirical forecast.',
          }
        : {}),
      pipelineInvoked: true,
      pipelineVersion: pipelineResult.pipelineVersion,
      footingTier: pipelineResult.footingTier,
      calibrationStatus: pipelineResult.calibrationStatus,
      probabilityDistribution: pipelineResult.probabilityDistribution,
      ...(pipelineResult.abstentionReason !== undefined
        ? { abstentionReason: pipelineResult.abstentionReason }
        : {}),
      missingComponents: resolution.unresolvedComponents,
      clarifyingQuestions: interp.clarifyingQuestions,
      aiInterpretation: aiInterpretationSummary,
      canonicalResolution: canonicalResolutionSummary,
      pipeline: summarizePipelineResult(pipelineResult),
    },
  };
}
