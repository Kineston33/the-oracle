/**
 * THE ORACLE — Stage 2A-2.1: Deterministic Scientific Method Applicability Planner
 *
 * Evaluates every registered scientific forecasting method in a
 * `ScientificMethodRegistry` against a forecasting question's domain,
 * outcome space, horizon, empirical data availability, scientific assumptions,
 * and computational constraints to produce a deterministic, auditable
 * `MethodApplicabilityPlan`.
 *
 * Architectural guarantees (Stage 2A-2.1):
 *   1. Multi-method completeness (Principle A): evaluates the entire registry
 *      on every planning call and selects all genuinely compatible methods
 *      without arbitrary single-method tie-breaking.
 *   2. Scientific validity over mathematical convenience (Principle B): a
 *      method is rejected whenever its domain, outcome space, barrier/threshold
 *      geometry, or mandatory statistical assumptions are violated.
 *   3. Structural baseline separation (Principle C): `structural-uniform-baseline`
 *      is evaluated and tracked separately from evidence-driven models, is
 *      never classified as unconditional empirical `'applicable'`, and is never
 *      represented as empirical evidence.
 *   4. Four-state epistemic disposition (Principle D): distinguishes
 *      `'applicable'`, `'applicable-with-limitations'`, `'deferred'`, and
 *      `'inapplicable'`.
 *   5. Dependence & correlation transparency (Principle E): identifies
 *      correlated method groups and shared information channels among selected
 *      methods so later stages do not double-count shared evidence.
 *   6. Zero I/O, zero LLM, zero randomness: pure deterministic function of
 *      validated inputs and registry state.
 */

import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import type { IsoDateTime, PredictionCategory } from '../data/types.ts';
import {
  validateOutcomeSpaceDescriptor,
  type MethodApplicabilityResult,
  type OutcomeSpaceDescriptor,
  type ScientificMethodId,
} from './forecast-types.ts';
import {
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  METHOD_ASSUMPTION_IDS,
  METHOD_DATA_CHANNEL_IDS,
  PREDICTION_CATEGORIES,
  UNIVERSAL_SUBDOMAIN_TOKEN,
  hasUniversalSubdomainApplicability,
  isValidSubdomainIdentifier,
  type ComputationalCostTier,
  type MethodAssumptionId,
  type MethodDataChannelId,
  type MethodImplementationStatus,
  type ScientificMethodDescriptor,
  type ScientificMethodFamily,
  type ScientificMethodRegistry,
  type ScientificMethodRole,
} from './method-registry.ts';

export const METHOD_APPLICABILITY_PLANNER_VERSION = '2A-2.1.0' as const;

/* -------------------------------------------------------------------------
   1. Planner Input Contracts
   ------------------------------------------------------------------------- */

export interface ForecastHorizonInput {
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly referenceTime?: IsoDateTime;
  /**
   * Whether the physical/statistical time scale of the question supports
   * continuous-time rate/drift/volatility scaling across `[startsAt, endsAt]`.
   * Defaults to `true`.
   */
  readonly hasPositiveExposureScaling?: boolean;
}

export interface AvailableEvidenceInput {
  readonly availableChannels: readonly MethodDataChannelId[];
  readonly hasVerifiableEmpiricalData: boolean;
  readonly binaryTrialSuccesses?: number;
  readonly binaryTrialFailures?: number;
  readonly weightedSampleSize?: number;
  readonly kishEffectiveSampleSize?: number;
  readonly poissonEventCount?: number;
  readonly poissonExposureDuration?: number;
  readonly multinomialOutcomeCounts?: readonly number[];
  readonly continuousTrajectoryObservations?: number;
  readonly estimatedDrift?: number;
  readonly estimatedScaleOrVolatility?: number;
  readonly degreesOfFreedom?: number;
  readonly initialStateLevel?: number;
  readonly lowConfidenceEvidence?: boolean;
  readonly missingOptionalCovariates?: readonly string[];
  readonly dataQualityNotes?: readonly string[];
}

export interface AssumptionDeclarationsInput {
  readonly verifiedAssumptions: readonly MethodAssumptionId[];
  readonly unverifiedButPlausibleAssumptions?: readonly MethodAssumptionId[];
  readonly violatedAssumptions?: readonly MethodAssumptionId[];
  readonly knownDomainConstraints?: readonly string[];
  /**
   * Whether the non-evidential `structural-uniform-baseline` may be included
   * as a structural reference benchmark when its partition-symmetry assumptions
   * hold. Defaults to `true`.
   */
  readonly allowStructuralBaseline?: boolean;
  /**
   * When `true`, any mandatory assumption that is neither in `verifiedAssumptions`
   * nor in `unverifiedButPlausibleAssumptions` causes the method to be `'deferred'`
   * pending assumption verification rather than `'applicable-with-limitations'`.
   * Defaults to `false`.
   */
  readonly requireExplicitAssumptionVerification?: boolean;
}

export interface ComputationalCapabilitiesInput {
  readonly maxAllowedCostTier: ComputationalCostTier;
  readonly allowIterativeSpecialFunctions: boolean;
  readonly maxMemoryKbBudget?: number;
}

export interface MethodApplicabilityPlanningInput {
  readonly questionId?: string;
  readonly questionCategory: PredictionCategory;
  readonly subdomain?: string;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly horizon: ForecastHorizonInput;
  readonly availableEvidence: AvailableEvidenceInput;
  readonly assumptions: AssumptionDeclarationsInput;
  readonly computationalCapabilities: ComputationalCapabilitiesInput;
}

/* -------------------------------------------------------------------------
   2. Planner Output & Gate Diagnostic Contracts
   ------------------------------------------------------------------------- */

export type MethodGateId =
  | 'domain-compatibility'
  | 'outcome-space-compatibility'
  | 'horizon-compatibility'
  | 'scientific-assumptions'
  | 'required-data-availability'
  | 'computational-feasibility';

export const METHOD_GATE_IDS: readonly MethodGateId[] = Object.freeze([
  'domain-compatibility',
  'outcome-space-compatibility',
  'horizon-compatibility',
  'scientific-assumptions',
  'required-data-availability',
  'computational-feasibility',
]);

export type MethodGateStatus =
  | 'passed'
  | 'passed-with-limitations'
  | 'deferred'
  | 'failed';

export type MethodApplicabilityDisposition =
  | 'applicable'
  | 'applicable-with-limitations'
  | 'deferred'
  | 'inapplicable';

export type MethodSelectionReasonCode =
  | 'DOMAIN_COMPATIBLE'
  | 'DOMAIN_COMPATIBLE_WITH_CAVEATS'
  | 'DOMAIN_CATEGORY_INCOMPATIBLE'
  | 'DOMAIN_SUBDOMAIN_INCOMPATIBLE'
  | 'DOMAIN_SUBDOMAIN_MISSING_DEFERRED'
  | 'STRUCTURAL_BASELINE_DISALLOWED'
  | 'OUTCOME_SPACE_COMPATIBLE'
  | 'OUTCOME_SPACE_KIND_INCOMPATIBLE'
  | 'OUTCOME_CARDINALITY_INCOMPATIBLE'
  | 'MISSING_PARTITION_THRESHOLDS'
  | 'MISSING_BARRIER_SPECIFICATION'
  | 'HORIZON_COMPATIBLE'
  | 'HORIZON_OUTSIDE_VALIDATED_DOMAIN'
  | 'HORIZON_EXPOSURE_SCALING_INVALID'
  | 'ASSUMPTIONS_VERIFIED'
  | 'ASSUMPTIONS_PLAUSIBLE_WITH_UNVERIFIED_PREMISES'
  | 'MANDATORY_ASSUMPTION_UNVERIFIED_DEFERRED'
  | 'MANDATORY_ASSUMPTION_VIOLATED'
  | 'REQUIRED_DATA_AVAILABLE'
  | 'DATA_AVAILABLE_WITH_SAMPLE_OR_QUALITY_LIMITATIONS'
  | 'STRUCTURAL_BASELINE_ZERO_EMPIRICAL_EVIDENCE'
  | 'MISSING_REQUIRED_DATA_CHANNELS'
  | 'MISSING_EMPIRICAL_EVIDENCE_BASIS'
  | 'INSUFFICIENT_MINIMUM_OBSERVATIONS'
  | 'INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE'
  | 'MISSING_POSITIVE_EXPOSURE_DURATION'
  | 'MISSING_INITIAL_STATE_LEVEL'
  | 'INITIAL_STATE_ALREADY_AT_OR_BEYOND_BARRIER'
  | 'DEGENERATE_NON_POSITIVE_VOLATILITY'
  | 'DEGREES_OF_FREEDOM_OUT_OF_RANGE'
  | 'COMPUTATIONAL_RESOURCES_SUFFICIENT'
  | 'COMPUTATIONAL_COST_TIER_EXCEEDED'
  | 'ITERATIVE_SPECIAL_FUNCTIONS_DISABLED'
  | 'MEMORY_BUDGET_EXCEEDED';

export interface MethodGateEvaluation {
  readonly gateId: MethodGateId;
  readonly status: MethodGateStatus;
  readonly reasonCode: MethodSelectionReasonCode;
  readonly explanation: string;
}

export interface MethodEvaluationRecord {
  readonly methodId: ScientificMethodId;
  readonly methodName: string;
  readonly methodFamily: ScientificMethodFamily;
  readonly role: ScientificMethodRole;
  readonly disposition: MethodApplicabilityDisposition;
  /**
   * True when `disposition` is `'applicable'` or `'applicable-with-limitations'`.
   */
  readonly applicable: boolean;
  /**
   * Truthful execution status from the registry (`false` in Stage 2A-2.1).
   */
  readonly hasExecutableImplementation: boolean;
  readonly implementationStatus: MethodImplementationStatus;
  readonly gates: readonly MethodGateEvaluation[];
  readonly failedGateIds: readonly MethodGateId[];
  readonly deferredGateIds: readonly MethodGateId[];
  readonly limitationGateIds: readonly MethodGateId[];
  readonly reasonCodes: readonly MethodSelectionReasonCode[];
  readonly rationale: string;
  readonly missingDataRequirements: readonly string[];
  readonly unverifiedAssumptions: readonly MethodAssumptionId[];
  readonly violatedAssumptions: readonly MethodAssumptionId[];
  readonly activeLimitations: readonly string[];
  readonly correlationGroupId: string;
  readonly correlatedWithMethodIds: readonly ScientificMethodId[];
  readonly independenceWarning: string;
  readonly contractResult: MethodApplicabilityResult;
}

export type CorrelationRelationshipSource =
  | 'shared-correlation-group'
  | 'explicit-correlated-method-declaration'
  | 'binary-conjugate-simplex-reduction';

export type BinaryBetaDirichletObservationAlignment =
  | 'identical-binary-and-multinomial-counts'
  | 'permuted-or-divergent-counts'
  | 'counts-not-simultaneously-observed';

export interface BinaryBetaDirichletEquivalenceDiagnostic {
  readonly methodPair: readonly [
    'beta-binomial-conjugate',
    'dirichlet-multinomial-symmetry',
  ];
  readonly outcomeSpaceIsBinary: true;
  readonly observationAlignment: BinaryBetaDirichletObservationAlignment;
  readonly binaryObservationCounts?: readonly [number, number];
  readonly multinomialObservationCounts?: readonly [number, number];
  /**
   * True when `multinomialOutcomeCounts` equals `[binaryTrialSuccesses, binaryTrialFailures]`.
   * Even when `true`, numerical identity of posterior predictive distributions
   * remains conditional on compatible prior hyperparameters `(alpha_1, alpha_2) = (alpha_0, beta_0)`
   * and shared modeling assumptions.
   */
  readonly observationsMatchExactly: boolean;
  readonly predictiveEquivalenceCondition: string;
  readonly nonIdenticalCaveat: string;
  readonly treatAsIndependentVotes: false;
}

export interface CorrelatedMethodPairDiagnostic {
  readonly methodPair: readonly [ScientificMethodId, ScientificMethodId];
  readonly relationshipSources: readonly CorrelationRelationshipSource[];
  readonly correlationGroupIds: readonly string[];
  readonly sharedInformationChannels: readonly MethodDataChannelId[];
  readonly sharedAssumptions: readonly MethodAssumptionId[];
  readonly binaryBetaDirichletEquivalence?: BinaryBetaDirichletEquivalenceDiagnostic;
  readonly explanation: string;
}

export interface CorrelatedMethodGroupDiagnostic {
  readonly correlationGroupId: string;
  readonly correlationGroupIds: readonly string[];
  readonly applicableMethodIds: readonly ScientificMethodId[];
  readonly relationshipSources: readonly CorrelationRelationshipSource[];
  readonly pairwiseRelationships: readonly CorrelatedMethodPairDiagnostic[];
  readonly sharedInformationChannels: readonly MethodDataChannelId[];
  readonly sharedAssumptions: readonly MethodAssumptionId[];
  readonly commonRequiredAssumptions: readonly MethodAssumptionId[];
  readonly binaryBetaDirichletEquivalence?: BinaryBetaDirichletEquivalenceDiagnostic;
  readonly treatAsIndependentVotes: false;
  readonly warning: string;
}

export type PairwiseDependenceClassification =
  | 'declared-correlated'
  | 'binary-conjugate-simplex-equivalence-candidate'
  | 'structural-baseline-non-evidential'
  | 'unknown-not-established';

export interface MethodPairDependenceAssessment {
  readonly methodPair: readonly [ScientificMethodId, ScientificMethodId];
  readonly classification: PairwiseDependenceClassification;
  /**
   * Stage 2A-2.1 never infers statistical independence merely because two
   * methods have different identifiers or correlationGroupIds. Always `false`.
   */
  readonly inferredStatisticallyIndependent: false;
  readonly canCountAsIndependentVotes: false;
  readonly relationshipSources: readonly CorrelationRelationshipSource[];
  readonly sharedInformationChannels: readonly MethodDataChannelId[];
  readonly sharedAssumptions: readonly MethodAssumptionId[];
  readonly explanation: string;
}

export interface MethodDependenceDiagnostics {
  readonly connectedComponents: readonly CorrelatedMethodGroupDiagnostic[];
  /**
   * Selected evidence-driven methods that have no declared correlation edges
   * with any other selected evidence-driven method. Their dependence with
   * other selected methods is classified as `'unknown-not-established'`,
   * never as verified statistical independence.
   */
  readonly unlinkedSelectedEvidenceMethodIds: readonly ScientificMethodId[];
  readonly pairwiseAssessments: readonly MethodPairDependenceAssessment[];
  readonly binaryBetaDirichletEquivalence?: BinaryBetaDirichletEquivalenceDiagnostic;
  /**
   * Count of connected components among selected evidence-driven methods.
   * Represents the number of declared correlation clusters, NOT a certified
   * count of statistically independent evidence sources.
   */
  readonly evidenceConnectedComponentCount: number;
  readonly epistemicIndependencePolicy: 'unknown-until-empirically-or-structurally-audited';
  readonly summaryWarning: string;
}

export interface MethodApplicabilityPlan {
  readonly registryVersion: string;
  readonly plannerVersion: string;
  readonly questionId?: string;
  readonly questionCategory: PredictionCategory;
  readonly subdomain?: string;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly horizonMs: number;
  readonly evaluatedMethods: readonly MethodEvaluationRecord[];
  readonly applicableMethods: readonly MethodEvaluationRecord[];
  readonly strictlyApplicableMethods: readonly MethodEvaluationRecord[];
  readonly applicableWithLimitationsMethods: readonly MethodEvaluationRecord[];
  readonly deferredMethods: readonly MethodEvaluationRecord[];
  readonly inapplicableMethods: readonly MethodEvaluationRecord[];
  readonly evidenceDrivenApplicableMethodIds: readonly ScientificMethodId[];
  readonly structuralBaselineMethodIds: readonly ScientificMethodId[];
  readonly deferredMethodIds: readonly ScientificMethodId[];
  readonly inapplicableMethodIds: readonly ScientificMethodId[];
  readonly correlatedMethodGroups: readonly CorrelatedMethodGroupDiagnostic[];
  readonly dependenceDiagnostics: MethodDependenceDiagnostics;
  readonly missingDataByMethod: Readonly<Record<string, readonly string[]>>;
  readonly unverifiedAssumptionsByMethod: Readonly<
    Record<string, readonly MethodAssumptionId[]>
  >;
  readonly discardedMethodResults: readonly MethodApplicabilityResult[];
}

/* -------------------------------------------------------------------------
   3. Runtime Validation of Untrusted Planner Inputs
   ------------------------------------------------------------------------- */

const EMPIRICAL_DATA_CHANNELS: ReadonlySet<MethodDataChannelId> = new Set([
  'binary-trial-counts',
  'weighted-binary-trials',
  'kish-effective-sample-size',
  'poisson-event-counts',
  'continuous-exposure-duration',
  'multinomial-category-counts',
  'continuous-state-trajectory',
  'drift-and-scale-estimates',
  'tail-degrees-of-freedom',
]);

const COST_TIER_RANK: Readonly<Record<ComputationalCostTier, number>> = Object.freeze({
  low: 1,
  moderate: 2,
  high: 3,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i]);
    }
    return Object.freeze(obj);
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFreeze(record[key]);
  }
  return Object.freeze(obj);
}

function assertStrictTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new RangeError(
      `${fieldName} must be a non-empty string without leading or trailing whitespace, received ${String(value)}`,
    );
  }
  return value;
}

function assertUniqueEnumArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): readonly T[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${fieldName} must be an array`);
  }
  const seen = new Set<string>();
  const copy: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = assertStrictTrimmedString(value[i], `${fieldName}[${i}]`);
    if (!(allowedValues as readonly string[]).includes(item)) {
      throw new RangeError(
        `${fieldName}[${i}] ('${item}') is not one of [${allowedValues.join(', ')}]`,
      );
    }
    if (seen.has(item)) {
      throw new RangeError(`${fieldName} contains duplicate entry '${item}'`);
    }
    seen.add(item);
    copy.push(item as T);
  }
  return Object.freeze(copy);
}

function assertUniqueStringArray(
  value: unknown,
  fieldName: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${fieldName} must be an array`);
  }
  const seen = new Set<string>();
  const copy: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = assertStrictTrimmedString(value[i], `${fieldName}[${i}]`);
    if (seen.has(item)) {
      throw new RangeError(`${fieldName} contains duplicate entry '${item}'`);
    }
    seen.add(item);
    copy.push(item);
  }
  return Object.freeze(copy);
}

function assertNonNegativeSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${fieldName} must be a non-negative safe integer, received ${String(value)}`,
    );
  }
  return value;
}

function assertFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new RangeError(
      `${fieldName} must be a finite number, received ${String(value)}`,
    );
  }
  return value;
}

/**
 * Validates at runtime that an untrusted `MethodApplicabilityPlanningInput`
 * is structurally, temporally, and mathematically coherent without mutating
 * the input or silently normalizing scientifically meaningful fields.
 */
export function validateMethodApplicabilityPlanningInput(
  value: unknown,
): MethodApplicabilityPlanningInput {
  if (!isPlainObject(value)) {
    throw new RangeError('MethodApplicabilityPlanningInput must be a non-null object');
  }

  const questionId =
    value.questionId !== undefined
      ? assertStrictTrimmedString(value.questionId, 'questionId')
      : undefined;

  const questionCategory = value.questionCategory;
  if (
    typeof questionCategory !== 'string' ||
    !(PREDICTION_CATEGORIES as readonly string[]).includes(questionCategory)
  ) {
    throw new RangeError(
      `questionCategory must be one of [${PREDICTION_CATEGORIES.join(', ')}], received ${String(questionCategory)}`,
    );
  }

  let subdomain: string | undefined;
  if (value.subdomain !== undefined) {
    subdomain = assertStrictTrimmedString(value.subdomain, 'subdomain');
    if (!isValidSubdomainIdentifier(subdomain)) {
      throw new RangeError(
        `subdomain ('${subdomain}') must be a canonical kebab-case subdomain identifier; wildcard or pseudo-wildcard strings are forbidden on planning inputs`,
      );
    }
  }

  // Reject untrimmed outcome labels or eventDefinitionHash instead of silently normalizing
  if (!isPlainObject(value.outcomeSpace)) {
    throw new RangeError('outcomeSpace must be a non-null object');
  }
  if (Array.isArray(value.outcomeSpace.outcomeLabels)) {
    for (let i = 0; i < value.outcomeSpace.outcomeLabels.length; i++) {
      assertStrictTrimmedString(
        value.outcomeSpace.outcomeLabels[i],
        `outcomeSpace.outcomeLabels[${i}]`,
      );
    }
  }
  if (typeof value.outcomeSpace.eventDefinitionHash === 'string') {
    assertStrictTrimmedString(
      value.outcomeSpace.eventDefinitionHash,
      'outcomeSpace.eventDefinitionHash',
    );
  }
  const outcomeSpace = validateOutcomeSpaceDescriptor(value.outcomeSpace);

  // Horizon validation & cross-check with outcomeSpace
  if (!isPlainObject(value.horizon)) {
    throw new RangeError('horizon must be a non-null object');
  }
  const startsAt = value.horizon.startsAt;
  const endsAt = value.horizon.endsAt;
  if (typeof startsAt !== 'string' || !isValidIsoDateTime(startsAt)) {
    throw new RangeError(
      `horizon.startsAt must be a valid ISO-8601 UTC timestamp, received ${String(startsAt)}`,
    );
  }
  if (typeof endsAt !== 'string' || !isValidIsoDateTime(endsAt)) {
    throw new RangeError(
      `horizon.endsAt must be a valid ISO-8601 UTC timestamp, received ${String(endsAt)}`,
    );
  }
  const startMs = parseIsoDateTimeMs(startsAt);
  const endMs = parseIsoDateTimeMs(endsAt);
  if (startMs === null || endMs === null || startMs >= endMs) {
    throw new RangeError(
      `horizon requires startsAt (${startsAt}) < endsAt (${endsAt})`,
    );
  }
  if (startsAt !== outcomeSpace.horizonStartsAt || endsAt !== outcomeSpace.horizonEndsAt) {
    throw new RangeError(
      `Contradictory horizon declaration: horizon [${startsAt}, ${endsAt}] does not match outcomeSpace [${outcomeSpace.horizonStartsAt}, ${outcomeSpace.horizonEndsAt}]`,
    );
  }

  let referenceTime: IsoDateTime | undefined;
  if (value.horizon.referenceTime !== undefined) {
    if (
      typeof value.horizon.referenceTime !== 'string' ||
      !isValidIsoDateTime(value.horizon.referenceTime)
    ) {
      throw new RangeError(
        `horizon.referenceTime must be a valid ISO-8601 UTC timestamp, received ${String(value.horizon.referenceTime)}`,
      );
    }
    const refMs = parseIsoDateTimeMs(value.horizon.referenceTime);
    if (refMs === null || refMs > endMs) {
      throw new RangeError(
        `horizon.referenceTime (${value.horizon.referenceTime}) cannot be after horizon.endsAt (${endsAt})`,
      );
    }
    referenceTime = value.horizon.referenceTime;
  }

  const hasPositiveExposureScaling =
    value.horizon.hasPositiveExposureScaling !== undefined
      ? value.horizon.hasPositiveExposureScaling
      : true;
  if (typeof hasPositiveExposureScaling !== 'boolean') {
    throw new RangeError('horizon.hasPositiveExposureScaling must be a boolean');
  }

  // Available evidence validation
  if (!isPlainObject(value.availableEvidence)) {
    throw new RangeError('availableEvidence must be a non-null object');
  }
  const ev = value.availableEvidence;
  const availableChannels = assertUniqueEnumArray(
    ev.availableChannels,
    'availableEvidence.availableChannels',
    METHOD_DATA_CHANNEL_IDS,
  );
  if (typeof ev.hasVerifiableEmpiricalData !== 'boolean') {
    throw new RangeError(
      'availableEvidence.hasVerifiableEmpiricalData must be a boolean',
    );
  }

  const binaryTrialSuccesses =
    ev.binaryTrialSuccesses !== undefined
      ? assertNonNegativeSafeInteger(
          ev.binaryTrialSuccesses,
          'availableEvidence.binaryTrialSuccesses',
        )
      : undefined;
  const binaryTrialFailures =
    ev.binaryTrialFailures !== undefined
      ? assertNonNegativeSafeInteger(
          ev.binaryTrialFailures,
          'availableEvidence.binaryTrialFailures',
        )
      : undefined;
  if ((binaryTrialSuccesses !== undefined) !== (binaryTrialFailures !== undefined)) {
    throw new RangeError(
      'availableEvidence.binaryTrialSuccesses and binaryTrialFailures must both be provided together',
    );
  }
  if (
    availableChannels.includes('binary-trial-counts') &&
    binaryTrialSuccesses === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares channel 'binary-trial-counts' but omits binaryTrialSuccesses/binaryTrialFailures",
    );
  }
  if (
    !availableChannels.includes('binary-trial-counts') &&
    binaryTrialSuccesses !== undefined
  ) {
    throw new RangeError(
      "availableEvidence provides binaryTrialSuccesses/binaryTrialFailures without declaring 'binary-trial-counts' in availableChannels",
    );
  }

  const weightedSampleSize =
    ev.weightedSampleSize !== undefined
      ? assertNonNegativeSafeInteger(
          ev.weightedSampleSize,
          'availableEvidence.weightedSampleSize',
        )
      : undefined;
  const kishEffectiveSampleSize =
    ev.kishEffectiveSampleSize !== undefined
      ? assertFiniteNumber(
          ev.kishEffectiveSampleSize,
          'availableEvidence.kishEffectiveSampleSize',
        )
      : undefined;
  if (kishEffectiveSampleSize !== undefined && kishEffectiveSampleSize < 0) {
    throw new RangeError(
      `availableEvidence.kishEffectiveSampleSize must be >= 0, received ${kishEffectiveSampleSize}`,
    );
  }
  if (
    weightedSampleSize !== undefined &&
    kishEffectiveSampleSize !== undefined &&
    kishEffectiveSampleSize > weightedSampleSize + 1e-12
  ) {
    throw new RangeError(
      `Contradictory Kish effective sample size: kishEffectiveSampleSize (${kishEffectiveSampleSize}) cannot exceed weightedSampleSize (${weightedSampleSize})`,
    );
  }
  if (
    availableChannels.includes('weighted-binary-trials') &&
    weightedSampleSize === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'weighted-binary-trials' but omits weightedSampleSize",
    );
  }
  if (
    availableChannels.includes('kish-effective-sample-size') &&
    kishEffectiveSampleSize === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'kish-effective-sample-size' but omits kishEffectiveSampleSize",
    );
  }

  const poissonEventCount =
    ev.poissonEventCount !== undefined
      ? assertNonNegativeSafeInteger(
          ev.poissonEventCount,
          'availableEvidence.poissonEventCount',
        )
      : undefined;
  const poissonExposureDuration =
    ev.poissonExposureDuration !== undefined
      ? assertFiniteNumber(
          ev.poissonExposureDuration,
          'availableEvidence.poissonExposureDuration',
        )
      : undefined;
  if (poissonExposureDuration !== undefined && poissonExposureDuration < 0) {
    throw new RangeError(
      `availableEvidence.poissonExposureDuration must be >= 0, received ${poissonExposureDuration}`,
    );
  }
  if (
    availableChannels.includes('poisson-event-counts') &&
    poissonEventCount === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'poisson-event-counts' but omits poissonEventCount",
    );
  }
  if (
    availableChannels.includes('continuous-exposure-duration') &&
    poissonExposureDuration === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'continuous-exposure-duration' but omits poissonExposureDuration",
    );
  }

  let multinomialOutcomeCounts: readonly number[] | undefined;
  if (ev.multinomialOutcomeCounts !== undefined) {
    if (!Array.isArray(ev.multinomialOutcomeCounts)) {
      throw new RangeError('availableEvidence.multinomialOutcomeCounts must be an array');
    }
    if (ev.multinomialOutcomeCounts.length !== outcomeSpace.outcomeLabels.length) {
      throw new RangeError(
        `availableEvidence.multinomialOutcomeCounts length (${ev.multinomialOutcomeCounts.length}) must equal outcomeSpace.outcomeLabels.length (${outcomeSpace.outcomeLabels.length})`,
      );
    }
    const countsCopy: number[] = [];
    for (let i = 0; i < ev.multinomialOutcomeCounts.length; i++) {
      countsCopy.push(
        assertNonNegativeSafeInteger(
          ev.multinomialOutcomeCounts[i],
          `availableEvidence.multinomialOutcomeCounts[${i}]`,
        ),
      );
    }
    multinomialOutcomeCounts = Object.freeze(countsCopy);
  }
  if (
    availableChannels.includes('multinomial-category-counts') &&
    multinomialOutcomeCounts === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'multinomial-category-counts' but omits multinomialOutcomeCounts",
    );
  }
  if (
    !availableChannels.includes('multinomial-category-counts') &&
    multinomialOutcomeCounts !== undefined
  ) {
    throw new RangeError(
      "availableEvidence provides multinomialOutcomeCounts without declaring 'multinomial-category-counts'",
    );
  }

  const continuousTrajectoryObservations =
    ev.continuousTrajectoryObservations !== undefined
      ? assertNonNegativeSafeInteger(
          ev.continuousTrajectoryObservations,
          'availableEvidence.continuousTrajectoryObservations',
        )
      : undefined;
  if (
    availableChannels.includes('continuous-state-trajectory') &&
    continuousTrajectoryObservations === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'continuous-state-trajectory' but omits continuousTrajectoryObservations",
    );
  }

  const estimatedDrift =
    ev.estimatedDrift !== undefined
      ? assertFiniteNumber(ev.estimatedDrift, 'availableEvidence.estimatedDrift')
      : undefined;
  const estimatedScaleOrVolatility =
    ev.estimatedScaleOrVolatility !== undefined
      ? assertFiniteNumber(
          ev.estimatedScaleOrVolatility,
          'availableEvidence.estimatedScaleOrVolatility',
        )
      : undefined;
  if (
    availableChannels.includes('drift-and-scale-estimates') &&
    (estimatedDrift === undefined || estimatedScaleOrVolatility === undefined)
  ) {
    throw new RangeError(
      "availableEvidence declares 'drift-and-scale-estimates' but omits estimatedDrift or estimatedScaleOrVolatility",
    );
  }

  const degreesOfFreedom =
    ev.degreesOfFreedom !== undefined
      ? assertFiniteNumber(ev.degreesOfFreedom, 'availableEvidence.degreesOfFreedom')
      : undefined;
  if (
    availableChannels.includes('tail-degrees-of-freedom') &&
    degreesOfFreedom === undefined
  ) {
    throw new RangeError(
      "availableEvidence declares 'tail-degrees-of-freedom' but omits degreesOfFreedom",
    );
  }

  const initialStateLevel =
    ev.initialStateLevel !== undefined
      ? assertFiniteNumber(ev.initialStateLevel, 'availableEvidence.initialStateLevel')
      : undefined;

  const hasAnyEmpiricalChannel = availableChannels.some((ch) =>
    EMPIRICAL_DATA_CHANNELS.has(ch),
  );
  const hasAnyQuantitativeEmpiricalField =
    binaryTrialSuccesses !== undefined ||
    weightedSampleSize !== undefined ||
    kishEffectiveSampleSize !== undefined ||
    poissonEventCount !== undefined ||
    poissonExposureDuration !== undefined ||
    multinomialOutcomeCounts !== undefined ||
    continuousTrajectoryObservations !== undefined ||
    estimatedDrift !== undefined ||
    estimatedScaleOrVolatility !== undefined ||
    degreesOfFreedom !== undefined;

  if (ev.hasVerifiableEmpiricalData && !hasAnyEmpiricalChannel) {
    throw new RangeError(
      'Contradictory data declaration: hasVerifiableEmpiricalData is true, but no empirical data channels are listed in availableChannels',
    );
  }
  if (
    !ev.hasVerifiableEmpiricalData &&
    (hasAnyEmpiricalChannel || hasAnyQuantitativeEmpiricalField)
  ) {
    throw new RangeError(
      'Contradictory data declaration: hasVerifiableEmpiricalData is false, but empirical data channels or quantitative observations were provided',
    );
  }

  if (
    ev.lowConfidenceEvidence !== undefined &&
    typeof ev.lowConfidenceEvidence !== 'boolean'
  ) {
    throw new RangeError('availableEvidence.lowConfidenceEvidence must be a boolean');
  }
  const missingOptionalCovariates =
    ev.missingOptionalCovariates !== undefined
      ? assertUniqueStringArray(
          ev.missingOptionalCovariates,
          'availableEvidence.missingOptionalCovariates',
        )
      : undefined;
  const dataQualityNotes =
    ev.dataQualityNotes !== undefined
      ? assertUniqueStringArray(
          ev.dataQualityNotes,
          'availableEvidence.dataQualityNotes',
        )
      : undefined;

  // Assumptions validation & disjointness check
  if (!isPlainObject(value.assumptions)) {
    throw new RangeError('assumptions must be a non-null object');
  }
  const verifiedAssumptions = assertUniqueEnumArray(
    value.assumptions.verifiedAssumptions,
    'assumptions.verifiedAssumptions',
    METHOD_ASSUMPTION_IDS,
  );
  const unverifiedButPlausibleAssumptions =
    value.assumptions.unverifiedButPlausibleAssumptions !== undefined
      ? assertUniqueEnumArray(
          value.assumptions.unverifiedButPlausibleAssumptions,
          'assumptions.unverifiedButPlausibleAssumptions',
          METHOD_ASSUMPTION_IDS,
        )
      : Object.freeze([] as MethodAssumptionId[]);
  const violatedAssumptions =
    value.assumptions.violatedAssumptions !== undefined
      ? assertUniqueEnumArray(
          value.assumptions.violatedAssumptions,
          'assumptions.violatedAssumptions',
          METHOD_ASSUMPTION_IDS,
        )
      : Object.freeze([] as MethodAssumptionId[]);

  for (const a of verifiedAssumptions) {
    if (unverifiedButPlausibleAssumptions.includes(a)) {
      throw new RangeError(
        `Contradictory assumption declaration: '${a}' is listed in both verifiedAssumptions and unverifiedButPlausibleAssumptions`,
      );
    }
    if (violatedAssumptions.includes(a)) {
      throw new RangeError(
        `Contradictory assumption declaration: '${a}' is listed in both verifiedAssumptions and violatedAssumptions`,
      );
    }
  }
  for (const a of unverifiedButPlausibleAssumptions) {
    if (violatedAssumptions.includes(a)) {
      throw new RangeError(
        `Contradictory assumption declaration: '${a}' is listed in both unverifiedButPlausibleAssumptions and violatedAssumptions`,
      );
    }
  }

  const knownDomainConstraints =
    value.assumptions.knownDomainConstraints !== undefined
      ? assertUniqueStringArray(
          value.assumptions.knownDomainConstraints,
          'assumptions.knownDomainConstraints',
        )
      : undefined;
  const allowStructuralBaseline =
    value.assumptions.allowStructuralBaseline !== undefined
      ? value.assumptions.allowStructuralBaseline
      : true;
  if (typeof allowStructuralBaseline !== 'boolean') {
    throw new RangeError('assumptions.allowStructuralBaseline must be a boolean');
  }
  const requireExplicitAssumptionVerification =
    value.assumptions.requireExplicitAssumptionVerification !== undefined
      ? value.assumptions.requireExplicitAssumptionVerification
      : false;
  if (typeof requireExplicitAssumptionVerification !== 'boolean') {
    throw new RangeError(
      'assumptions.requireExplicitAssumptionVerification must be a boolean',
    );
  }

  // Computational capabilities validation
  if (!isPlainObject(value.computationalCapabilities)) {
    throw new RangeError('computationalCapabilities must be a non-null object');
  }
  const cc = value.computationalCapabilities;
  if (
    cc.maxAllowedCostTier !== 'low' &&
    cc.maxAllowedCostTier !== 'moderate' &&
    cc.maxAllowedCostTier !== 'high'
  ) {
    throw new RangeError(
      `computationalCapabilities.maxAllowedCostTier must be 'low', 'moderate', or 'high', received ${String(cc.maxAllowedCostTier)}`,
    );
  }
  if (typeof cc.allowIterativeSpecialFunctions !== 'boolean') {
    throw new RangeError(
      'computationalCapabilities.allowIterativeSpecialFunctions must be a boolean',
    );
  }
  const maxMemoryKbBudget =
    cc.maxMemoryKbBudget !== undefined
      ? assertFiniteNumber(
          cc.maxMemoryKbBudget,
          'computationalCapabilities.maxMemoryKbBudget',
        )
      : undefined;
  if (maxMemoryKbBudget !== undefined && maxMemoryKbBudget <= 0) {
    throw new RangeError(
      `computationalCapabilities.maxMemoryKbBudget must be > 0, received ${maxMemoryKbBudget}`,
    );
  }

  const validated: MethodApplicabilityPlanningInput = {
    ...(questionId !== undefined ? { questionId } : {}),
    questionCategory: questionCategory as PredictionCategory,
    ...(subdomain !== undefined ? { subdomain } : {}),
    outcomeSpace,
    horizon: {
      startsAt,
      endsAt,
      ...(referenceTime !== undefined ? { referenceTime } : {}),
      ...(value.horizon.hasPositiveExposureScaling !== undefined
        ? { hasPositiveExposureScaling }
        : {}),
    },
    availableEvidence: {
      availableChannels,
      hasVerifiableEmpiricalData: ev.hasVerifiableEmpiricalData,
      ...(binaryTrialSuccesses !== undefined ? { binaryTrialSuccesses } : {}),
      ...(binaryTrialFailures !== undefined ? { binaryTrialFailures } : {}),
      ...(weightedSampleSize !== undefined ? { weightedSampleSize } : {}),
      ...(kishEffectiveSampleSize !== undefined ? { kishEffectiveSampleSize } : {}),
      ...(poissonEventCount !== undefined ? { poissonEventCount } : {}),
      ...(poissonExposureDuration !== undefined ? { poissonExposureDuration } : {}),
      ...(multinomialOutcomeCounts !== undefined ? { multinomialOutcomeCounts } : {}),
      ...(continuousTrajectoryObservations !== undefined
        ? { continuousTrajectoryObservations }
        : {}),
      ...(estimatedDrift !== undefined ? { estimatedDrift } : {}),
      ...(estimatedScaleOrVolatility !== undefined ? { estimatedScaleOrVolatility } : {}),
      ...(degreesOfFreedom !== undefined ? { degreesOfFreedom } : {}),
      ...(initialStateLevel !== undefined ? { initialStateLevel } : {}),
      ...(ev.lowConfidenceEvidence !== undefined
        ? { lowConfidenceEvidence: ev.lowConfidenceEvidence }
        : {}),
      ...(missingOptionalCovariates !== undefined ? { missingOptionalCovariates } : {}),
      ...(dataQualityNotes !== undefined ? { dataQualityNotes } : {}),
    },
    assumptions: {
      verifiedAssumptions,
      ...(value.assumptions.unverifiedButPlausibleAssumptions !== undefined
        ? { unverifiedButPlausibleAssumptions }
        : {}),
      ...(value.assumptions.violatedAssumptions !== undefined
        ? { violatedAssumptions }
        : {}),
      ...(knownDomainConstraints !== undefined ? { knownDomainConstraints } : {}),
      ...(value.assumptions.allowStructuralBaseline !== undefined
        ? { allowStructuralBaseline }
        : {}),
      ...(value.assumptions.requireExplicitAssumptionVerification !== undefined
        ? { requireExplicitAssumptionVerification }
        : {}),
    },
    computationalCapabilities: {
      maxAllowedCostTier: cc.maxAllowedCostTier,
      allowIterativeSpecialFunctions: cc.allowIterativeSpecialFunctions,
      ...(maxMemoryKbBudget !== undefined ? { maxMemoryKbBudget } : {}),
    },
  };

  return deepFreeze(validated);
}

/* -------------------------------------------------------------------------
   4. Gate Evaluators for Individual Scientific Methods
   ------------------------------------------------------------------------- */

function evaluateDomainGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
): {
  readonly gate: MethodGateEvaluation;
  readonly missingDomainRequirements: readonly string[];
  readonly limitationNotes: readonly string[];
} {
  if (
    descriptor.role === 'structural-symmetry-baseline' &&
    input.assumptions.allowStructuralBaseline === false
  ) {
    return {
      gate: Object.freeze({
        gateId: 'domain-compatibility',
        status: 'failed',
        reasonCode: 'STRUCTURAL_BASELINE_DISALLOWED',
        explanation: `Method '${descriptor.methodId}' is a non-evidential structural baseline and allowStructuralBaseline is false.`,
      }),
      missingDomainRequirements: Object.freeze([]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (!descriptor.domain.applicableCategories.includes(input.questionCategory)) {
    return {
      gate: Object.freeze({
        gateId: 'domain-compatibility',
        status: 'failed',
        reasonCode: 'DOMAIN_CATEGORY_INCOMPATIBLE',
        explanation: `Question category '${input.questionCategory}' is outside '${descriptor.methodId}' applicable categories [${descriptor.domain.applicableCategories.join(', ')}].`,
      }),
      missingDomainRequirements: Object.freeze([]),
      limitationNotes: Object.freeze([]),
    };
  }

  // Defensive validation of descriptor subdomain metadata (never infer universal
  // applicability from an empty array or arbitrary strings):
  if (
    !Array.isArray(descriptor.domain.applicableSubdomains) ||
    descriptor.domain.applicableSubdomains.length === 0
  ) {
    throw new RangeError(
      `Descriptor '${descriptor.methodId}' has an empty or invalid domain.applicableSubdomains; universal subdomain applicability is never inferred from an empty array`,
    );
  }
  if (
    descriptor.domain.universalSubdomainApplicability !== undefined &&
    typeof descriptor.domain.universalSubdomainApplicability !== 'boolean'
  ) {
    throw new RangeError(
      `Descriptor '${descriptor.methodId}' has non-boolean domain.universalSubdomainApplicability`,
    );
  }
  if (
    descriptor.domain.universalSubdomainApplicability === false &&
    descriptor.domain.applicableSubdomains.includes(UNIVERSAL_SUBDOMAIN_TOKEN)
  ) {
    throw new RangeError(
      `Descriptor '${descriptor.methodId}' has contradictory domain declaration: universalSubdomainApplicability is false, but applicableSubdomains includes '${UNIVERSAL_SUBDOMAIN_TOKEN}'`,
    );
  }
  for (const sub of descriptor.domain.applicableSubdomains) {
    if (sub !== UNIVERSAL_SUBDOMAIN_TOKEN && !isValidSubdomainIdentifier(sub)) {
      throw new RangeError(
        `Descriptor '${descriptor.methodId}' contains invalid or pseudo-wildcard subdomain '${String(sub)}' in domain.applicableSubdomains`,
      );
    }
  }

  const isUniversalSubdomain = hasUniversalSubdomainApplicability(descriptor.domain);
  const declaredNamedSubdomains = descriptor.domain.applicableSubdomains.filter(
    (sub) => sub !== UNIVERSAL_SUBDOMAIN_TOKEN,
  );

  if (input.subdomain !== undefined) {
    const matchesNamedSubdomain = declaredNamedSubdomains.includes(input.subdomain);
    if (!matchesNamedSubdomain && !isUniversalSubdomain) {
      return {
        gate: Object.freeze({
          gateId: 'domain-compatibility',
          status: 'failed',
          reasonCode: 'DOMAIN_SUBDOMAIN_INCOMPATIBLE',
          explanation: `Question subdomain '${input.subdomain}' is outside '${descriptor.methodId}' declared applicable subdomains [${declaredNamedSubdomains.join(', ')}].`,
        }),
        missingDomainRequirements: Object.freeze([]),
        limitationNotes: Object.freeze([]),
      };
    }
  } else if (!isUniversalSubdomain) {
    const missingSubdomainRequirement = `Question subdomain is missing; method '${descriptor.methodId}' requires an explicit subdomain matching one of [${declaredNamedSubdomains.join(', ')}]`;
    return {
      gate: Object.freeze({
        gateId: 'domain-compatibility',
        status: 'deferred',
        reasonCode: 'DOMAIN_SUBDOMAIN_MISSING_DEFERRED',
        explanation: `Method '${descriptor.methodId}' is deferred because question lacks sufficient domain specificity: ${missingSubdomainRequirement}.`,
      }),
      missingDomainRequirements: Object.freeze([missingSubdomainRequirement]),
      limitationNotes: Object.freeze([]),
    };
  }

  const subdomainMatchDescription =
    input.subdomain !== undefined
      ? declaredNamedSubdomains.includes(input.subdomain)
        ? `subdomain '${input.subdomain}'`
        : `subdomain '${input.subdomain}' via explicit universal subdomain scope ('${UNIVERSAL_SUBDOMAIN_TOKEN}')`
      : `explicit universal subdomain scope ('${UNIVERSAL_SUBDOMAIN_TOKEN}')`;

  const domainConstraints = input.assumptions.knownDomainConstraints ?? [];
  if (domainConstraints.length > 0) {
    const limitationNotes = Object.freeze(
      domainConstraints.map((c) => `Domain constraint caveat: ${c}`),
    );
    return {
      gate: Object.freeze({
        gateId: 'domain-compatibility',
        status: 'passed-with-limitations',
        reasonCode: 'DOMAIN_COMPATIBLE_WITH_CAVEATS',
        explanation: `Question category '${input.questionCategory}' and ${subdomainMatchDescription} are compatible with '${descriptor.methodId}' (${descriptor.domain.mathematicalParadigm}), subject to documented domain caveat(s): ${domainConstraints.join('; ')}.`,
      }),
      missingDomainRequirements: Object.freeze([]),
      limitationNotes,
    };
  }

  return {
    gate: Object.freeze({
      gateId: 'domain-compatibility',
      status: 'passed',
      reasonCode: 'DOMAIN_COMPATIBLE',
      explanation: `Question category '${input.questionCategory}' and ${subdomainMatchDescription} are compatible with '${descriptor.methodId}' (${descriptor.domain.mathematicalParadigm}).`,
    }),
    missingDomainRequirements: Object.freeze([]),
    limitationNotes: Object.freeze([]),
  };
}

function evaluateOutcomeSpaceGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
): MethodGateEvaluation {
  const osc = descriptor.outcomeSpaceCompatibility;
  const space = input.outcomeSpace;
  const k = space.outcomeLabels.length;

  if (!osc.supportedKinds.includes(space.kind)) {
    return Object.freeze({
      gateId: 'outcome-space-compatibility',
      status: 'failed',
      reasonCode: 'OUTCOME_SPACE_KIND_INCOMPATIBLE',
      explanation: `Outcome space kind '${space.kind}' is not supported by '${descriptor.methodId}' (supports [${osc.supportedKinds.join(', ')}]).`,
    });
  }

  if (k < osc.minOutcomes || (osc.maxOutcomes !== null && k > osc.maxOutcomes)) {
    return Object.freeze({
      gateId: 'outcome-space-compatibility',
      status: 'failed',
      reasonCode: 'OUTCOME_CARDINALITY_INCOMPATIBLE',
      explanation: `Outcome count K=${k} is outside '${descriptor.methodId}' supported cardinality [${osc.minOutcomes}, ${osc.maxOutcomes ?? 'Infinity'}].`,
    });
  }

  if (
    osc.requiresPartitionThresholds &&
    (!Array.isArray(space.partitionThresholds) || space.partitionThresholds.length === 0)
  ) {
    return Object.freeze({
      gateId: 'outcome-space-compatibility',
      status: 'failed',
      reasonCode: 'MISSING_PARTITION_THRESHOLDS',
      explanation: `Method '${descriptor.methodId}' requires explicit continuous partitionThresholds to map terminal state values to outcome bins.`,
    });
  }

  if (
    osc.requiresBarrierSpecification &&
    (space.barrierLevel === undefined || space.barrierDirection === undefined)
  ) {
    return Object.freeze({
      gateId: 'outcome-space-compatibility',
      status: 'failed',
      reasonCode: 'MISSING_BARRIER_SPECIFICATION',
      explanation: `Method '${descriptor.methodId}' requires an absorbing barrierLevel and barrierDirection.`,
    });
  }

  return Object.freeze({
    gateId: 'outcome-space-compatibility',
    status: 'passed',
    reasonCode: 'OUTCOME_SPACE_COMPATIBLE',
    explanation: `Outcome space '${space.kind}' with K=${k} outcomes is compatible with '${descriptor.methodId}'.`,
  });
}

function evaluateHorizonGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
  horizonMs: number,
): MethodGateEvaluation {
  const hc = descriptor.horizonConstraints;

  if (
    hc.requiresPositiveExposureRateScaling &&
    input.horizon.hasPositiveExposureScaling === false
  ) {
    return Object.freeze({
      gateId: 'horizon-compatibility',
      status: 'failed',
      reasonCode: 'HORIZON_EXPOSURE_SCALING_INVALID',
      explanation: `Method '${descriptor.methodId}' requires positive continuous-time exposure/rate scaling across the forecast horizon (${hc.scientificJustification}).`,
    });
  }

  if (hc.constrained) {
    if (hc.minHorizonMs !== undefined && horizonMs < hc.minHorizonMs) {
      return Object.freeze({
        gateId: 'horizon-compatibility',
        status: 'failed',
        reasonCode: 'HORIZON_OUTSIDE_VALIDATED_DOMAIN',
        explanation: `Horizon duration ${horizonMs} ms is shorter than '${descriptor.methodId}' minimum validated horizon ${hc.minHorizonMs} ms (${hc.scientificJustification}).`,
      });
    }
    if (hc.maxHorizonMs !== undefined && horizonMs > hc.maxHorizonMs) {
      return Object.freeze({
        gateId: 'horizon-compatibility',
        status: 'failed',
        reasonCode: 'HORIZON_OUTSIDE_VALIDATED_DOMAIN',
        explanation: `Horizon duration ${horizonMs} ms exceeds '${descriptor.methodId}' maximum validated horizon ${hc.maxHorizonMs} ms (${hc.scientificJustification}).`,
      });
    }
  }

  return Object.freeze({
    gateId: 'horizon-compatibility',
    status: 'passed',
    reasonCode: 'HORIZON_COMPATIBLE',
    explanation: `Forecast horizon (${horizonMs} ms) satisfies '${descriptor.methodId}' temporal conditions without artificial duration cutoffs.`,
  });
}

function evaluateAssumptionsGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
): {
  readonly gate: MethodGateEvaluation;
  readonly unverifiedAssumptions: readonly MethodAssumptionId[];
  readonly violatedAssumptions: readonly MethodAssumptionId[];
  readonly limitationNotes: readonly string[];
} {
  const verifiedSet = new Set(input.assumptions.verifiedAssumptions);
  const plausibleSet = new Set(input.assumptions.unverifiedButPlausibleAssumptions ?? []);
  const violatedSet = new Set(input.assumptions.violatedAssumptions ?? []);

  const violated: MethodAssumptionId[] = [];
  const unverifiedPlausible: MethodAssumptionId[] = [];
  const unverifiedUnspecified: MethodAssumptionId[] = [];

  for (const req of descriptor.requiredAssumptions) {
    if (violatedSet.has(req.id)) {
      if (req.mandatory) {
        violated.push(req.id);
      }
    } else if (!verifiedSet.has(req.id)) {
      if (plausibleSet.has(req.id)) {
        unverifiedPlausible.push(req.id);
      } else if (req.mandatory) {
        unverifiedUnspecified.push(req.id);
      }
    }
  }

  const allUnverified = Object.freeze([...unverifiedPlausible, ...unverifiedUnspecified]);
  const frozenViolated = Object.freeze(violated);

  if (frozenViolated.length > 0) {
    return {
      gate: Object.freeze({
        gateId: 'scientific-assumptions',
        status: 'failed',
        reasonCode: 'MANDATORY_ASSUMPTION_VIOLATED',
        explanation: `Mandatory scientific assumption(s) [${frozenViolated.join(', ')}] required by '${descriptor.methodId}' are explicitly violated.`,
      }),
      unverifiedAssumptions: allUnverified,
      violatedAssumptions: frozenViolated,
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    unverifiedUnspecified.length > 0 &&
    input.assumptions.requireExplicitAssumptionVerification === true
  ) {
    return {
      gate: Object.freeze({
        gateId: 'scientific-assumptions',
        status: 'deferred',
        reasonCode: 'MANDATORY_ASSUMPTION_UNVERIFIED_DEFERRED',
        explanation: `Mandatory assumption(s) [${unverifiedUnspecified.join(', ')}] for '${descriptor.methodId}' have not yet been verified and requireExplicitAssumptionVerification is true.`,
      }),
      unverifiedAssumptions: allUnverified,
      violatedAssumptions: frozenViolated,
      limitationNotes: Object.freeze([]),
    };
  }

  if (allUnverified.length > 0) {
    const note = `Assumptions [${allUnverified.join(', ')}] remain unverified and hold as explicit modeling premises rather than empirically confirmed invariants.`;
    return {
      gate: Object.freeze({
        gateId: 'scientific-assumptions',
        status: 'passed-with-limitations',
        reasonCode: 'ASSUMPTIONS_PLAUSIBLE_WITH_UNVERIFIED_PREMISES',
        explanation: `No mandatory assumptions for '${descriptor.methodId}' are violated, but [${allUnverified.join(', ')}] remain unverified.`,
      }),
      unverifiedAssumptions: allUnverified,
      violatedAssumptions: frozenViolated,
      limitationNotes: Object.freeze([note]),
    };
  }

  return {
    gate: Object.freeze({
      gateId: 'scientific-assumptions',
      status: 'passed',
      reasonCode: 'ASSUMPTIONS_VERIFIED',
      explanation: `All mandatory statistical and mathematical assumptions [${descriptor.requiredAssumptions.map((a) => a.id).join(', ')}] for '${descriptor.methodId}' are verified.`,
    }),
    unverifiedAssumptions: allUnverified,
    violatedAssumptions: frozenViolated,
    limitationNotes: Object.freeze([]),
  };
}

function evaluateRequiredDataGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
): {
  readonly gate: MethodGateEvaluation;
  readonly missingDataRequirements: readonly string[];
  readonly limitationNotes: readonly string[];
} {
  const ev = input.availableEvidence;
  const minCond = descriptor.requiredData.minimumConditions;
  const availableSet = new Set(ev.availableChannels);

  // 1. Check hard scientific parameter / state validity failures first:
  if (
    minCond.requiresPositiveScaleOrVolatility &&
    ev.estimatedScaleOrVolatility !== undefined &&
    ev.estimatedScaleOrVolatility <= 0
  ) {
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'failed',
        reasonCode: 'DEGENERATE_NON_POSITIVE_VOLATILITY',
        explanation: `Method '${descriptor.methodId}' requires strictly positive scale/volatility sigma > 0, received ${ev.estimatedScaleOrVolatility}.`,
      }),
      missingDataRequirements: Object.freeze([]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    minCond.minDegreesOfFreedom !== undefined &&
    ev.degreesOfFreedom !== undefined &&
    (ev.degreesOfFreedom < minCond.minDegreesOfFreedom ||
      (minCond.maxDegreesOfFreedom !== undefined &&
        ev.degreesOfFreedom > minCond.maxDegreesOfFreedom))
  ) {
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'failed',
        reasonCode: 'DEGREES_OF_FREEDOM_OUT_OF_RANGE',
        explanation: `Method '${descriptor.methodId}' requires degreesOfFreedom in [${minCond.minDegreesOfFreedom}, ${minCond.maxDegreesOfFreedom ?? 'Infinity'}], received ${ev.degreesOfFreedom}.`,
      }),
      missingDataRequirements: Object.freeze([]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    minCond.requiresInitialStateStrictlyOutsideBarrier &&
    input.outcomeSpace.barrierLevel !== undefined &&
    input.outcomeSpace.barrierDirection !== undefined &&
    ev.initialStateLevel !== undefined
  ) {
    const barrier = input.outcomeSpace.barrierLevel;
    const dir = input.outcomeSpace.barrierDirection;
    const x0 = ev.initialStateLevel;
    const alreadyCrossed =
      (dir === 'up-and-in' && x0 >= barrier) ||
      (dir === 'down-and-in' && x0 <= barrier);
    if (alreadyCrossed) {
      return {
        gate: Object.freeze({
          gateId: 'required-data-availability',
          status: 'failed',
          reasonCode: 'INITIAL_STATE_ALREADY_AT_OR_BEYOND_BARRIER',
          explanation: `Initial state X_0=${x0} is already at or beyond the '${dir}' absorbing barrier B=${barrier} at horizon start.`,
        }),
        missingDataRequirements: Object.freeze([]),
        limitationNotes: Object.freeze([]),
      };
    }
  }

  // 2. Check missing required channels and minimum observation requirements (deferred):
  const missingRequirements: string[] = [];
  for (const reqChannel of descriptor.requiredData.requiredInputChannels) {
    if (!availableSet.has(reqChannel)) {
      missingRequirements.push(`Required input channel '${reqChannel}' is not available`);
    }
  }

  if (minCond.requiresVerifiableEmpiricalEvidence && !ev.hasVerifiableEmpiricalData) {
    missingRequirements.push(
      `Method '${descriptor.methodId}' requires verifiable empirical evidence (hasVerifiableEmpiricalData: true)`,
    );
  }

  if (missingRequirements.length > 0) {
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'deferred',
        reasonCode: !ev.hasVerifiableEmpiricalData && minCond.requiresVerifiableEmpiricalEvidence
          ? 'MISSING_EMPIRICAL_EVIDENCE_BASIS'
          : 'MISSING_REQUIRED_DATA_CHANNELS',
        explanation: `Method '${descriptor.methodId}' is deferred pending required inputs: ${missingRequirements.join('; ')}.`,
      }),
      missingDataRequirements: Object.freeze(missingRequirements),
      limitationNotes: Object.freeze([]),
    };
  }

  // Quantitative sample size & exposure checks once channels are present:
  const reqChannels = descriptor.requiredData.requiredInputChannels;
  let observedSampleSize = 0;
  if (reqChannels.includes('weighted-binary-trials')) {
    observedSampleSize = ev.weightedSampleSize ?? 0;
  } else if (reqChannels.includes('binary-trial-counts')) {
    observedSampleSize =
      (ev.binaryTrialSuccesses ?? 0) + (ev.binaryTrialFailures ?? 0);
  } else if (reqChannels.includes('poisson-event-counts')) {
    observedSampleSize = ev.poissonEventCount ?? 0;
  } else if (reqChannels.includes('multinomial-category-counts')) {
    observedSampleSize = (ev.multinomialOutcomeCounts ?? []).reduce(
      (acc, v) => acc + v,
      0,
    );
  } else if (reqChannels.includes('continuous-state-trajectory')) {
    observedSampleSize = ev.continuousTrajectoryObservations ?? 0;
  }

  if (
    minCond.minTotalObservations !== undefined &&
    observedSampleSize < minCond.minTotalObservations
  ) {
    const reqMsg = `Minimum total observations >= ${minCond.minTotalObservations} required (observed ${observedSampleSize})`;
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'deferred',
        reasonCode: 'INSUFFICIENT_MINIMUM_OBSERVATIONS',
        explanation: `Method '${descriptor.methodId}' is deferred: ${reqMsg}.`,
      }),
      missingDataRequirements: Object.freeze([reqMsg]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    minCond.minEffectiveSampleSize !== undefined &&
    (ev.kishEffectiveSampleSize === undefined ||
      ev.kishEffectiveSampleSize < minCond.minEffectiveSampleSize)
  ) {
    const reqMsg = `Minimum Kish effective sample size >= ${minCond.minEffectiveSampleSize} required (observed ${String(ev.kishEffectiveSampleSize)})`;
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'deferred',
        reasonCode: 'INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE',
        explanation: `Method '${descriptor.methodId}' is deferred: ${reqMsg}.`,
      }),
      missingDataRequirements: Object.freeze([reqMsg]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    minCond.requiresPositiveExposureDuration &&
    (ev.poissonExposureDuration === undefined || ev.poissonExposureDuration <= 0)
  ) {
    const reqMsg = `Positive continuous exposure duration T > 0 required (observed ${String(ev.poissonExposureDuration)})`;
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'deferred',
        reasonCode: 'MISSING_POSITIVE_EXPOSURE_DURATION',
        explanation: `Method '${descriptor.methodId}' is deferred: ${reqMsg}.`,
      }),
      missingDataRequirements: Object.freeze([reqMsg]),
      limitationNotes: Object.freeze([]),
    };
  }

  if (
    minCond.requiresInitialStateStrictlyOutsideBarrier &&
    ev.initialStateLevel === undefined
  ) {
    const reqMsg =
      'Initial state level X_0 at horizonStartsAt is required to measure distance to absorbing barrier';
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'deferred',
        reasonCode: 'MISSING_INITIAL_STATE_LEVEL',
        explanation: `Method '${descriptor.methodId}' is deferred: ${reqMsg}.`,
      }),
      missingDataRequirements: Object.freeze([reqMsg]),
      limitationNotes: Object.freeze([]),
    };
  }

  // 3. Structural baseline & sample-size / quality limitations:
  if (descriptor.role === 'structural-symmetry-baseline') {
    const baselineNote =
      'Structural symmetry baseline carries zero empirical evidence (effectiveSampleSize = 0) and serves strictly as a maximum-entropy benchmark.';
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'passed-with-limitations',
        reasonCode: 'STRUCTURAL_BASELINE_ZERO_EMPIRICAL_EVIDENCE',
        explanation: baselineNote,
      }),
      missingDataRequirements: Object.freeze([]),
      limitationNotes: Object.freeze([baselineNote]),
    };
  }

  const limitations: string[] = [];
  if (
    minCond.recommendedMinObservationsForHighConfidence > 0 &&
    observedSampleSize < minCond.recommendedMinObservationsForHighConfidence
  ) {
    limitations.push(
      `Observed sample size (${observedSampleSize}) is below recommended high-confidence threshold (${minCond.recommendedMinObservationsForHighConfidence}); posterior variance will remain sensitive to prior specification.`,
    );
  }
  if (
    descriptor.methodId === 'weighted-kish-effective-binomial' &&
    ev.kishEffectiveSampleSize !== undefined &&
    ev.kishEffectiveSampleSize < minCond.recommendedMinObservationsForHighConfidence
  ) {
    limitations.push(
      `Kish effective sample size (${ev.kishEffectiveSampleSize}) is below recommended high-confidence threshold (${minCond.recommendedMinObservationsForHighConfidence}) due to weight concentration.`,
    );
  }
  if (ev.lowConfidenceEvidence === true) {
    limitations.push(
      'Available empirical evidence is flagged as low-confidence or exploratory.',
    );
  }
  if (ev.missingOptionalCovariates && ev.missingOptionalCovariates.length > 0) {
    limitations.push(
      `Optional covariates [${ev.missingOptionalCovariates.join(', ')}] are unavailable.`,
    );
  }

  if (limitations.length > 0) {
    return {
      gate: Object.freeze({
        gateId: 'required-data-availability',
        status: 'passed-with-limitations',
        reasonCode: 'DATA_AVAILABLE_WITH_SAMPLE_OR_QUALITY_LIMITATIONS',
        explanation: `Required data channels for '${descriptor.methodId}' are present, with limitations: ${limitations.join(' ')}`,
      }),
      missingDataRequirements: Object.freeze([]),
      limitationNotes: Object.freeze(limitations),
    };
  }

  return {
    gate: Object.freeze({
      gateId: 'required-data-availability',
      status: 'passed',
      reasonCode: 'REQUIRED_DATA_AVAILABLE',
      explanation: `All required data channels [${descriptor.requiredData.requiredInputChannels.join(', ')}] and sample-size thresholds for '${descriptor.methodId}' are satisfied.`,
    }),
    missingDataRequirements: Object.freeze([]),
    limitationNotes: Object.freeze([]),
  };
}

function evaluateComputationalGate(
  descriptor: ScientificMethodDescriptor,
  input: MethodApplicabilityPlanningInput,
): MethodGateEvaluation {
  const cp = descriptor.computationalProfile;
  const cc = input.computationalCapabilities;

  if (COST_TIER_RANK[cp.costTier] > COST_TIER_RANK[cc.maxAllowedCostTier]) {
    return Object.freeze({
      gateId: 'computational-feasibility',
      status: 'deferred',
      reasonCode: 'COMPUTATIONAL_COST_TIER_EXCEEDED',
      explanation: `Method '${descriptor.methodId}' requires costTier '${cp.costTier}' (${cp.complexityClass}), which exceeds maxAllowedCostTier '${cc.maxAllowedCostTier}'.`,
    });
  }

  if (cp.requiresIterativeSpecialFunctions && !cc.allowIterativeSpecialFunctions) {
    return Object.freeze({
      gateId: 'computational-feasibility',
      status: 'deferred',
      reasonCode: 'ITERATIVE_SPECIAL_FUNCTIONS_DISABLED',
      explanation: `Method '${descriptor.methodId}' requires iterative special-function evaluation, which is disabled in computationalCapabilities.`,
    });
  }

  if (
    cc.maxMemoryKbBudget !== undefined &&
    cp.maxMemoryKbEstimate > cc.maxMemoryKbBudget
  ) {
    return Object.freeze({
      gateId: 'computational-feasibility',
      status: 'deferred',
      reasonCode: 'MEMORY_BUDGET_EXCEEDED',
      explanation: `Method '${descriptor.methodId}' estimated memory (${cp.maxMemoryKbEstimate} KB) exceeds maxMemoryKbBudget (${cc.maxMemoryKbBudget} KB).`,
    });
  }

  return Object.freeze({
    gateId: 'computational-feasibility',
    status: 'passed',
    reasonCode: 'COMPUTATIONAL_RESOURCES_SUFFICIENT',
    explanation: `Computational cost '${cp.costTier}' (${cp.complexityClass}, ~${cp.maxMemoryKbEstimate} KB) is within available capabilities.`,
  });
}

/* -------------------------------------------------------------------------
   5. Deterministic Correlation Graph & Dependence Diagnostics
   ------------------------------------------------------------------------- */

const RELATIONSHIP_SOURCE_ORDER: readonly CorrelationRelationshipSource[] = Object.freeze([
  'shared-correlation-group',
  'explicit-correlated-method-declaration',
  'binary-conjugate-simplex-reduction',
]);

function buildBinaryBetaDirichletEquivalenceDiagnostic(
  input: MethodApplicabilityPlanningInput,
): BinaryBetaDirichletEquivalenceDiagnostic {
  const ev = input.availableEvidence;
  const hasBinaryCounts =
    ev.binaryTrialSuccesses !== undefined && ev.binaryTrialFailures !== undefined;
  const hasMultinomialCounts =
    Array.isArray(ev.multinomialOutcomeCounts) &&
    ev.multinomialOutcomeCounts.length === 2;

  let observationAlignment: BinaryBetaDirichletObservationAlignment =
    'counts-not-simultaneously-observed';
  let observationsMatchExactly = false;

  if (hasBinaryCounts && hasMultinomialCounts) {
    const k = ev.binaryTrialSuccesses!;
    const f = ev.binaryTrialFailures!;
    const n1 = ev.multinomialOutcomeCounts![0]!;
    const n2 = ev.multinomialOutcomeCounts![1]!;
    if (n1 === k && n2 === f) {
      observationAlignment = 'identical-binary-and-multinomial-counts';
      observationsMatchExactly = true;
    } else {
      observationAlignment = 'permuted-or-divergent-counts';
      observationsMatchExactly = false;
    }
  }

  return Object.freeze({
    methodPair: Object.freeze([
      'beta-binomial-conjugate',
      'dirichlet-multinomial-symmetry',
    ] as const),
    outcomeSpaceIsBinary: true,
    observationAlignment,
    ...(hasBinaryCounts
      ? {
          binaryObservationCounts: Object.freeze([
            ev.binaryTrialSuccesses!,
            ev.binaryTrialFailures!,
          ] as const),
        }
      : {}),
    ...(hasMultinomialCounts
      ? {
          multinomialObservationCounts: Object.freeze([
            ev.multinomialOutcomeCounts![0]!,
            ev.multinomialOutcomeCounts![1]!,
          ] as const),
        }
      : {}),
    observationsMatchExactly,
    predictiveEquivalenceCondition:
      'On a binary outcome space (K = 2), the two-category Dirichlet(alpha_1, alpha_2)-Multinomial(n_1, n_2) model is algebraically related to the Beta(alpha_0, beta_0)-Binomial(k, n - k) model and yields an equivalent predictive distribution when [n_1, n_2] = [k, n - k] under compatible prior parameters (alpha_1, alpha_2) = (alpha_0, beta_0).',
    nonIdenticalCaveat:
      'Do not assume numerical identity when prior hyperparameters, observation counts, or modeling assumptions differ; however, both methods remain structurally dependent and must never be counted as two independent votes.',
    treatAsIndependentVotes: false,
  });
}

function buildDependenceDiagnostics(
  applicableMethods: readonly MethodEvaluationRecord[],
  descriptorById: ReadonlyMap<ScientificMethodId, ScientificMethodDescriptor>,
  input: MethodApplicabilityPlanningInput,
): MethodDependenceDiagnostics {
  const m = applicableMethods.length;
  const adj: number[][] = Array.from({ length: m }, () => []);
  const edgeByPairKey = new Map<string, CorrelatedMethodPairDiagnostic>();
  const pairwiseAssessments: MethodPairDependenceAssessment[] = [];

  const applicableIdSet = new Set(applicableMethods.map((r) => r.methodId));
  const isBinaryOutcomeSpace =
    input.outcomeSpace.kind === 'binary' &&
    input.outcomeSpace.outcomeLabels.length === 2;
  const hasBinaryBetaAndDirichlet =
    isBinaryOutcomeSpace &&
    applicableIdSet.has('beta-binomial-conjugate') &&
    applicableIdSet.has('dirichlet-multinomial-symmetry');

  const binaryBetaDirichletEquivalence = hasBinaryBetaAndDirichlet
    ? buildBinaryBetaDirichletEquivalenceDiagnostic(input)
    : undefined;

  for (let i = 0; i < m; i++) {
    const recA = applicableMethods[i]!;
    const descA = descriptorById.get(recA.methodId)!;
    const channelsA = new Set<MethodDataChannelId>([
      ...descA.dependenceProfile.sharedInformationChannels,
      ...descA.requiredData.requiredInputChannels,
    ]);
    const assumptionsA = new Set<MethodAssumptionId>([
      ...descA.dependenceProfile.sharedLatentAssumptions,
      ...descA.requiredAssumptions.map((a) => a.id),
    ]);

    for (let j = i + 1; j < m; j++) {
      const recB = applicableMethods[j]!;
      const descB = descriptorById.get(recB.methodId)!;
      const channelsB = new Set<MethodDataChannelId>([
        ...descB.dependenceProfile.sharedInformationChannels,
        ...descB.requiredData.requiredInputChannels,
      ]);
      const assumptionsB = new Set<MethodAssumptionId>([
        ...descB.dependenceProfile.sharedLatentAssumptions,
        ...descB.requiredAssumptions.map((a) => a.id),
      ]);

      const sameGroup =
        descA.dependenceProfile.correlationGroupId ===
        descB.dependenceProfile.correlationGroupId;
      const explicitLink =
        descA.dependenceProfile.correlatedWithMethodIds.includes(recB.methodId) ||
        descB.dependenceProfile.correlatedWithMethodIds.includes(recA.methodId);
      const isBinaryBetaDirichletPair =
        binaryBetaDirichletEquivalence !== undefined &&
        ((recA.methodId === 'beta-binomial-conjugate' &&
          recB.methodId === 'dirichlet-multinomial-symmetry') ||
          (recA.methodId === 'dirichlet-multinomial-symmetry' &&
            recB.methodId === 'beta-binomial-conjugate'));

      const relationshipSources: CorrelationRelationshipSource[] = [];
      if (sameGroup) {
        relationshipSources.push('shared-correlation-group');
      }
      if (explicitLink) {
        relationshipSources.push('explicit-correlated-method-declaration');
      }
      if (isBinaryBetaDirichletPair) {
        relationshipSources.push('binary-conjugate-simplex-reduction');
      }
      const frozenSources = Object.freeze(relationshipSources);

      const intersectingChannels = [...channelsA].filter((ch) =>
        channelsB.has(ch),
      );
      const intersectingAssumptions = [...assumptionsA].filter((a) =>
        assumptionsB.has(a),
      );

      if (frozenSources.length > 0) {
        adj[i]!.push(j);
        adj[j]!.push(i);

        const pairSharedChannels = Object.freeze(
          intersectingChannels.length > 0
            ? intersectingChannels
            : Array.from(
                new Set<MethodDataChannelId>([
                  ...descA.dependenceProfile.sharedInformationChannels,
                  ...descB.dependenceProfile.sharedInformationChannels,
                ]),
              ),
        );
        const pairSharedAssumptions = Object.freeze(
          intersectingAssumptions.length > 0
            ? intersectingAssumptions
            : Array.from(
                new Set<MethodAssumptionId>([
                  ...descA.dependenceProfile.sharedLatentAssumptions,
                  ...descB.dependenceProfile.sharedLatentAssumptions,
                ]),
              ),
        );
        const pairGroupIds = Object.freeze(
          Array.from(
            new Set([
              descA.dependenceProfile.correlationGroupId,
              descB.dependenceProfile.correlationGroupId,
            ]),
          ),
        );

        const explanation = isBinaryBetaDirichletPair
          ? `Methods '${recA.methodId}' and '${recB.methodId}' are linked via [${frozenSources.join(', ')}] on a binary outcome space (K = 2; observationAlignment = '${binaryBetaDirichletEquivalence.observationAlignment}', observationsMatchExactly = ${String(binaryBetaDirichletEquivalence.observationsMatchExactly)}); they must never be treated as two independent votes.`
          : `Methods '${recA.methodId}' and '${recB.methodId}' are linked via [${frozenSources.join(', ')}] (correlationGroupIds: [${pairGroupIds.join(', ')}], sharedInformationChannels: [${pairSharedChannels.join(', ')}]).`;

        const pairDiag: CorrelatedMethodPairDiagnostic = Object.freeze({
          methodPair: Object.freeze([recA.methodId, recB.methodId] as const),
          relationshipSources: frozenSources,
          correlationGroupIds: pairGroupIds,
          sharedInformationChannels: pairSharedChannels,
          sharedAssumptions: pairSharedAssumptions,
          ...(isBinaryBetaDirichletPair
            ? { binaryBetaDirichletEquivalence }
            : {}),
          explanation,
        });
        edgeByPairKey.set(`${i}:${j}`, pairDiag);

        pairwiseAssessments.push(
          Object.freeze({
            methodPair: Object.freeze([recA.methodId, recB.methodId] as const),
            classification: isBinaryBetaDirichletPair
              ? 'binary-conjugate-simplex-equivalence-candidate'
              : 'declared-correlated',
            inferredStatisticallyIndependent: false,
            canCountAsIndependentVotes: false,
            relationshipSources: frozenSources,
            sharedInformationChannels: pairSharedChannels,
            sharedAssumptions: pairSharedAssumptions,
            explanation,
          }),
        );
      } else if (
        recA.role === 'structural-symmetry-baseline' ||
        recB.role === 'structural-symmetry-baseline'
      ) {
        pairwiseAssessments.push(
          Object.freeze({
            methodPair: Object.freeze([recA.methodId, recB.methodId] as const),
            classification: 'structural-baseline-non-evidential',
            inferredStatisticallyIndependent: false,
            canCountAsIndependentVotes: false,
            relationshipSources: Object.freeze([]),
            sharedInformationChannels: Object.freeze(intersectingChannels),
            sharedAssumptions: Object.freeze(intersectingAssumptions),
            explanation: `One of ['${recA.methodId}', '${recB.methodId}'] is a non-evidential structural symmetry baseline (effectiveSampleSize = 0) and does not represent an independent empirical forecast.`,
          }),
        );
      } else {
        pairwiseAssessments.push(
          Object.freeze({
            methodPair: Object.freeze([recA.methodId, recB.methodId] as const),
            classification: 'unknown-not-established',
            inferredStatisticallyIndependent: false,
            canCountAsIndependentVotes: false,
            relationshipSources: Object.freeze([]),
            sharedInformationChannels: Object.freeze(intersectingChannels),
            sharedAssumptions: Object.freeze(intersectingAssumptions),
            explanation: `Statistical dependence between '${recA.methodId}' (${descA.dependenceProfile.correlationGroupId}) and '${recB.methodId}' (${descB.dependenceProfile.correlationGroupId}) cannot be established from declared registry metadata alone and is classified as unknown rather than statistically independent.`,
          }),
        );
      }
    }
  }

  // Deterministic connected components over 0 .. m - 1:
  const visited = new Array<boolean>(m).fill(false);
  const connectedComponents: CorrelatedMethodGroupDiagnostic[] = [];
  const unlinkedSelectedEvidenceMethodIds: ScientificMethodId[] = [];
  let evidenceConnectedComponentCount = 0;

  for (let start = 0; start < m; start++) {
    if (visited[start]) continue;
    const queue: number[] = [start];
    visited[start] = true;
    const compIndices: number[] = [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      compIndices.push(curr);
      for (const next of adj[curr]!) {
        if (!visited[next]) {
          visited[next] = true;
          queue.push(next);
        }
      }
    }

    compIndices.sort((a, b) => a - b);
    const compRecords = compIndices.map((idx) => applicableMethods[idx]!);
    const hasEvidenceDrivenMember = compRecords.some(
      (r) => r.role === 'evidence-driven-model',
    );
    if (hasEvidenceDrivenMember) {
      evidenceConnectedComponentCount += 1;
    }

    if (compIndices.length === 1) {
      const singleRec = compRecords[0]!;
      if (singleRec.role === 'evidence-driven-model') {
        unlinkedSelectedEvidenceMethodIds.push(singleRec.methodId);
      }
      continue;
    }

    const compMethodIds = Object.freeze(compRecords.map((r) => r.methodId));
    const compGroupIds = Object.freeze(
      Array.from(new Set(compRecords.map((r) => r.correlationGroupId))),
    );
    const primaryGroupId = compGroupIds[0]!;

    const compPairs: CorrelatedMethodPairDiagnostic[] = [];
    const compSourceSet = new Set<CorrelationRelationshipSource>();
    for (let aIdx = 0; aIdx < compIndices.length; aIdx++) {
      for (let bIdx = aIdx + 1; bIdx < compIndices.length; bIdx++) {
        const u = compIndices[aIdx]!;
        const v = compIndices[bIdx]!;
        const pairDiag = edgeByPairKey.get(`${u}:${v}`);
        if (pairDiag !== undefined) {
          compPairs.push(pairDiag);
          for (const src of pairDiag.relationshipSources) {
            compSourceSet.add(src);
          }
        }
      }
    }

    const orderedRelationshipSources = Object.freeze(
      RELATIONSHIP_SOURCE_ORDER.filter((src) => compSourceSet.has(src)),
    );

    const sharedChannelsSet = new Set<MethodDataChannelId>();
    const sharedAssumptionsSet = new Set<MethodAssumptionId>();
    const requiredAssumptionCounts = new Map<MethodAssumptionId, number>();

    for (const r of compRecords) {
      const desc = descriptorById.get(r.methodId)!;
      for (const ch of desc.dependenceProfile.sharedInformationChannels) {
        sharedChannelsSet.add(ch);
      }
      for (const a of desc.dependenceProfile.sharedLatentAssumptions) {
        sharedAssumptionsSet.add(a);
      }
      for (const reqA of desc.requiredAssumptions) {
        requiredAssumptionCounts.set(
          reqA.id,
          (requiredAssumptionCounts.get(reqA.id) ?? 0) + 1,
        );
      }
    }

    const commonRequiredAssumptions: MethodAssumptionId[] = [];
    for (const [assumptionId, count] of requiredAssumptionCounts.entries()) {
      if (count >= 2) {
        commonRequiredAssumptions.push(assumptionId);
        sharedAssumptionsSet.add(assumptionId);
      }
    }

    const compHasBinaryBetaDirichlet =
      binaryBetaDirichletEquivalence !== undefined &&
      compMethodIds.includes('beta-binomial-conjugate') &&
      compMethodIds.includes('dirichlet-multinomial-symmetry');

    const warningParts: string[] = [
      `Methods [${compMethodIds.join(', ')}] form a connected dependence component across correlation group(s) [${compGroupIds.join(', ')}] via [${orderedRelationshipSources.join(', ')}], sharing information channels [${[...sharedChannelsSet].join(', ')}] and assumptions [${[...sharedAssumptionsSet].join(', ')}].`,
    ];
    if (compHasBinaryBetaDirichlet) {
      warningParts.push(
        `On this binary outcome space (K = 2), 'beta-binomial-conjugate' and 'dirichlet-multinomial-symmetry' are algebraically related (observationAlignment: '${binaryBetaDirichletEquivalence.observationAlignment}', observationsMatchExactly: ${String(binaryBetaDirichletEquivalence.observationsMatchExactly)}) and must never be counted as two independent votes.`,
      );
    } else {
      warningParts.push(
        'Downstream synthesis must account for their statistical dependence and must not treat them as independent votes.',
      );
    }

    connectedComponents.push(
      Object.freeze({
        correlationGroupId: primaryGroupId,
        correlationGroupIds: compGroupIds,
        applicableMethodIds: compMethodIds,
        relationshipSources: orderedRelationshipSources,
        pairwiseRelationships: Object.freeze(compPairs),
        sharedInformationChannels: Object.freeze([...sharedChannelsSet]),
        sharedAssumptions: Object.freeze([...sharedAssumptionsSet]),
        commonRequiredAssumptions: Object.freeze(commonRequiredAssumptions),
        ...(compHasBinaryBetaDirichlet
          ? { binaryBetaDirichletEquivalence }
          : {}),
        treatAsIndependentVotes: false,
        warning: warningParts.join(' '),
      }),
    );
  }

  const summaryWarning =
    connectedComponents.length > 0
      ? `Detected ${connectedComponents.length} correlated method component(s) among selected methods; cross-component pairs with no declared correlation edge remain classified as 'unknown-not-established' rather than statistically independent.`
      : `No multi-method declared correlation components among selected methods; any pair of selected evidence-driven methods without a declared correlation edge is classified as 'unknown-not-established' rather than statistically independent.`;

  return Object.freeze({
    connectedComponents: Object.freeze(connectedComponents),
    unlinkedSelectedEvidenceMethodIds: Object.freeze(
      unlinkedSelectedEvidenceMethodIds,
    ),
    pairwiseAssessments: Object.freeze(pairwiseAssessments),
    ...(binaryBetaDirichletEquivalence !== undefined
      ? { binaryBetaDirichletEquivalence }
      : {}),
    evidenceConnectedComponentCount,
    epistemicIndependencePolicy:
      'unknown-until-empirically-or-structurally-audited',
    summaryWarning,
  });
}

/* -------------------------------------------------------------------------
   6. Deterministic Registry-Wide Applicability Planner
   ------------------------------------------------------------------------- */

/**
 * Evaluates every registered scientific method in `registry` against `rawInput`
 * and produces a deeply frozen, deterministic `MethodApplicabilityPlan`.
 *
 * Never executes forecasting algorithms, network requests, or random sampling.
 */
export function planMethodApplicability(
  rawInput: unknown,
  registry: ScientificMethodRegistry = DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
): MethodApplicabilityPlan {
  if (
    !registry ||
    typeof registry !== 'object' ||
    typeof registry.listAll !== 'function' ||
    typeof registry.version !== 'string'
  ) {
    throw new RangeError(
      'planMethodApplicability requires a valid ScientificMethodRegistry instance',
    );
  }

  const input = validateMethodApplicabilityPlanningInput(rawInput);
  const startMs = parseIsoDateTimeMs(input.horizon.startsAt)!;
  const endMs = parseIsoDateTimeMs(input.horizon.endsAt)!;
  const horizonMs = endMs - startMs;

  const allDescriptors = registry.listAll();
  if (!Array.isArray(allDescriptors) || allDescriptors.length === 0) {
    throw new RangeError('ScientificMethodRegistry contains zero registered methods');
  }

  const descriptorById = new Map<ScientificMethodId, ScientificMethodDescriptor>();
  for (const desc of allDescriptors) {
    if (descriptorById.has(desc.methodId)) {
      throw new RangeError(
        `Registry contains duplicate methodId '${desc.methodId}'`,
      );
    }
    descriptorById.set(desc.methodId, desc);
  }
  for (const desc of allDescriptors) {
    const seenCorr = new Set<string>();
    for (const corrId of desc.dependenceProfile.correlatedWithMethodIds) {
      if (corrId === desc.methodId) {
        throw new RangeError(
          `Descriptor '${desc.methodId}' contains self-reference in correlatedWithMethodIds`,
        );
      }
      if (seenCorr.has(corrId)) {
        throw new RangeError(
          `Descriptor '${desc.methodId}' contains duplicate '${corrId}' in correlatedWithMethodIds`,
        );
      }
      seenCorr.add(corrId);
      const peer = descriptorById.get(corrId);
      if (!peer) {
        throw new RangeError(
          `Descriptor '${desc.methodId}' references unknown correlatedWithMethodId '${corrId}'`,
        );
      }
      if (!peer.dependenceProfile.correlatedWithMethodIds.includes(desc.methodId)) {
        throw new RangeError(
          `Asymmetric correlation relationship: '${desc.methodId}' declares '${corrId}' in correlatedWithMethodIds, but '${corrId}' does not declare '${desc.methodId}'`,
        );
      }
    }
  }

  const evaluatedMethods: MethodEvaluationRecord[] = [];
  const applicableMethods: MethodEvaluationRecord[] = [];
  const strictlyApplicableMethods: MethodEvaluationRecord[] = [];
  const applicableWithLimitationsMethods: MethodEvaluationRecord[] = [];
  const deferredMethods: MethodEvaluationRecord[] = [];
  const inapplicableMethods: MethodEvaluationRecord[] = [];

  const evidenceDrivenApplicableMethodIds: ScientificMethodId[] = [];
  const structuralBaselineMethodIds: ScientificMethodId[] = [];
  const deferredMethodIds: ScientificMethodId[] = [];
  const inapplicableMethodIds: ScientificMethodId[] = [];

  const missingDataByMethod: Record<string, readonly string[]> = {};
  const unverifiedAssumptionsByMethod: Record<
    string,
    readonly MethodAssumptionId[]
  > = {};
  const discardedMethodResults: MethodApplicabilityResult[] = [];

  for (const descriptor of allDescriptors) {
    const domainEval = evaluateDomainGate(descriptor, input);
    const outcomeSpaceGate = evaluateOutcomeSpaceGate(descriptor, input);
    const horizonGate = evaluateHorizonGate(descriptor, input, horizonMs);
    const assumptionsEval = evaluateAssumptionsGate(descriptor, input);
    const dataEval = evaluateRequiredDataGate(descriptor, input);
    const computeGate = evaluateComputationalGate(descriptor, input);

    const gates: readonly MethodGateEvaluation[] = Object.freeze([
      domainEval.gate,
      outcomeSpaceGate,
      horizonGate,
      assumptionsEval.gate,
      dataEval.gate,
      computeGate,
    ]);

    const failedGateIds: MethodGateId[] = [];
    const deferredGateIds: MethodGateId[] = [];
    const limitationGateIds: MethodGateId[] = [];
    const reasonCodes: MethodSelectionReasonCode[] = [];

    for (const g of gates) {
      reasonCodes.push(g.reasonCode);
      if (g.status === 'failed') {
        failedGateIds.push(g.gateId);
      } else if (g.status === 'deferred') {
        deferredGateIds.push(g.gateId);
      } else if (g.status === 'passed-with-limitations') {
        limitationGateIds.push(g.gateId);
      }
    }

    let disposition: MethodApplicabilityDisposition;
    if (failedGateIds.length > 0) {
      disposition = 'inapplicable';
    } else if (deferredGateIds.length > 0) {
      disposition = 'deferred';
    } else if (
      limitationGateIds.length > 0 ||
      descriptor.role === 'structural-symmetry-baseline'
    ) {
      disposition = 'applicable-with-limitations';
    } else {
      disposition = 'applicable';
    }

    const applicable =
      disposition === 'applicable' || disposition === 'applicable-with-limitations';

    const activeLimitations = Object.freeze([
      ...domainEval.limitationNotes,
      ...assumptionsEval.limitationNotes,
      ...dataEval.limitationNotes,
    ]);

    const combinedMissingRequirements = Object.freeze([
      ...domainEval.missingDomainRequirements,
      ...dataEval.missingDataRequirements,
    ]);

    const nonPassingExplanations = gates
      .filter((g) => g.status !== 'passed')
      .map((g) => `[${g.gateId}: ${g.reasonCode}] ${g.explanation}`);

    const rationale =
      nonPassingExplanations.length > 0
        ? nonPassingExplanations.join(' | ')
        : `All 6 applicability gates passed for '${descriptor.methodId}' (${descriptor.name}).`;

    const contractFailedGates = Object.freeze([
      ...failedGateIds,
      ...deferredGateIds,
    ]);

    const contractResult: MethodApplicabilityResult = Object.freeze({
      methodId: descriptor.methodId,
      applicable,
      rationale,
      failedGateIds: contractFailedGates,
    });

    const record: MethodEvaluationRecord = Object.freeze({
      methodId: descriptor.methodId,
      methodName: descriptor.name,
      methodFamily: descriptor.methodFamily,
      role: descriptor.role,
      disposition,
      applicable,
      hasExecutableImplementation: descriptor.hasExecutableImplementation,
      implementationStatus: descriptor.implementationStatus,
      gates,
      failedGateIds: Object.freeze(failedGateIds),
      deferredGateIds: Object.freeze(deferredGateIds),
      limitationGateIds: Object.freeze(limitationGateIds),
      reasonCodes: Object.freeze(reasonCodes),
      rationale,
      missingDataRequirements: combinedMissingRequirements,
      unverifiedAssumptions: assumptionsEval.unverifiedAssumptions,
      violatedAssumptions: assumptionsEval.violatedAssumptions,
      activeLimitations,
      correlationGroupId: descriptor.dependenceProfile.correlationGroupId,
      correlatedWithMethodIds: descriptor.dependenceProfile.correlatedWithMethodIds,
      independenceWarning: descriptor.dependenceProfile.independenceWarning,
      contractResult,
    });

    evaluatedMethods.push(record);
    missingDataByMethod[descriptor.methodId] = combinedMissingRequirements;
    unverifiedAssumptionsByMethod[descriptor.methodId] =
      assumptionsEval.unverifiedAssumptions;

    if (applicable) {
      applicableMethods.push(record);
      if (disposition === 'applicable') {
        strictlyApplicableMethods.push(record);
      } else {
        applicableWithLimitationsMethods.push(record);
      }
      if (descriptor.role === 'structural-symmetry-baseline') {
        structuralBaselineMethodIds.push(descriptor.methodId);
      } else {
        evidenceDrivenApplicableMethodIds.push(descriptor.methodId);
      }
    } else {
      discardedMethodResults.push(contractResult);
      if (disposition === 'deferred') {
        deferredMethods.push(record);
        deferredMethodIds.push(descriptor.methodId);
      } else {
        inapplicableMethods.push(record);
        inapplicableMethodIds.push(descriptor.methodId);
      }
    }
  }

  // Build deterministic correlation graph and dependence diagnostics (Principle E):
  const dependenceDiagnostics = buildDependenceDiagnostics(
    applicableMethods,
    descriptorById,
    input,
  );
  const correlatedMethodGroups = dependenceDiagnostics.connectedComponents;

  const plan: MethodApplicabilityPlan = {
    registryVersion: registry.version,
    plannerVersion: METHOD_APPLICABILITY_PLANNER_VERSION,
    ...(input.questionId !== undefined ? { questionId: input.questionId } : {}),
    questionCategory: input.questionCategory,
    ...(input.subdomain !== undefined ? { subdomain: input.subdomain } : {}),
    outcomeSpace: input.outcomeSpace,
    horizonMs,
    evaluatedMethods: Object.freeze(evaluatedMethods),
    applicableMethods: Object.freeze(applicableMethods),
    strictlyApplicableMethods: Object.freeze(strictlyApplicableMethods),
    applicableWithLimitationsMethods: Object.freeze(
      applicableWithLimitationsMethods,
    ),
    deferredMethods: Object.freeze(deferredMethods),
    inapplicableMethods: Object.freeze(inapplicableMethods),
    evidenceDrivenApplicableMethodIds: Object.freeze(
      evidenceDrivenApplicableMethodIds,
    ),
    structuralBaselineMethodIds: Object.freeze(structuralBaselineMethodIds),
    deferredMethodIds: Object.freeze(deferredMethodIds),
    inapplicableMethodIds: Object.freeze(inapplicableMethodIds),
    correlatedMethodGroups,
    dependenceDiagnostics,
    missingDataByMethod: Object.freeze(missingDataByMethod),
    unverifiedAssumptionsByMethod: Object.freeze(unverifiedAssumptionsByMethod),
    discardedMethodResults: Object.freeze(discardedMethodResults),
  };

  return deepFreeze(plan);
}
