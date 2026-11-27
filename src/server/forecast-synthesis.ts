/**
 * THE ORACLE — Stage 2A-2.3: Dependence-Aware Multi-Method Aggregation & Forecast Synthesis
 *
 * Pure, deterministic multi-method synthesis engine that consumes a
 * `MethodApplicabilityPlan` (Stage 2A-2.1) and the corresponding
 * `ScientificMethodOutput` results (Stage 2A-2.2) to produce a validated,
 * deeply immutable `ForecastDistributionOutput`.
 *
 * Architectural & Mathematical Guarantees (Stage 2A-2.3):
 *   1. Applicability & execution completeness:
 *      - Verifies every supplied `ScientificMethodOutput` was evaluated as
 *        applicable AND executable in the `MethodApplicabilityPlan`.
 *      - Rejects duplicate, inapplicable, deferred, unimplemented, or unknown
 *        method outputs.
 *      - Rejects missing outputs for any applicable method that has an
 *        executable implementation (never silently omits an eligible method).
 *      - Honestly reports applicable methods that remain `registered-specification-only`
 *        (`student-t-terminal-diffusion`, `first-passage-barrier-diffusion`) in
 *        `contrastReport.unexecutedApplicableMethods`.
 *      - Enforces exact canonical outcome-space identity across the plan and
 *        all participating method outputs.
 *   2. Dependence-aware two-level weighting (`[HDO]`):
 *      - Uses the connected components and unlinked singleton assessments from
 *        `MethodApplicabilityPlan.dependenceDiagnostics`.
 *      - Allocates equal prior mass `1 / C` to each active dependence component
 *        containing eligible evidence-driven methods, and divides each
 *        component's mass equally `1 / (C * |G_c|)` among its eligible members.
 *      - Explicitly classifies this weighting rule as an operational design
 *        heuristic (`[HDO]`), never as learned calibration or proof of
 *        statistical independence.
 *   3. Structural baseline separation:
 *      - When evidence-driven executable methods are available, keeps
 *        `structural-uniform-baseline` outside the evidence-driven linear pool
 *        in `referenceOnlyMethodIds` / `referenceOnlyMethodOutputs`.
 *      - When no evidence-driven executable method is available and a verified
 *        `structural-uniform-baseline` is applicable, emits a standalone
 *        structural forecast with `footingTier: 'structural-symmetry-baseline-only'`
 *        and `effectiveIndependentMethodCount: 0`.
 *   4. Dual-channel log-space linear pool & orthogonal decompositions (`[IME]`):
 *      - Synthesizes `p_bar(k) = sum_m w_m * p_m(k)` and `1 - p_bar(k)` in
 *        logarithmic space via `decomposeCategoryUncertainty` and
 *        `decomposeEnsembleEntropy`.
 *      - Never averages credible-interval endpoints across different methods:
 *        preserves the valid interval for a single-method forecast (`M = 1`)
 *        and explicitly omits combined intervals with
 *        `'multi-method-mixture-interval-not-available'` for `M >= 2`.
 *   5. Independence & calibration honesty:
 *      - Never equates `evidenceConnectedComponentCount` or method count with
 *        certified independent evidence (`effectiveIndependentMethodCount = 1`
 *        for evidence-driven forecasts unless statistical independence is
 *        explicitly verified, and `0` for structural-only or abstaining outputs).
 *      - Enforces `assertCalibrationHonesty` and never fabricates probabilities
 *        on abstention (`footingTier: 'insufficient-basis-abstain'`).
 */

import { parseIsoDateTimeMs } from '../data/publication.ts';
import type { PredictionCategory } from '../data/types.ts';
import {
  ABSTENTION_REASONS,
  CALIBRATION_VERIFICATION_STATUSES,
  EPISTEMOLOGICAL_TAG_BY_KIND,
  EVIDENTIAL_FOOTING_TIERS,
  INDEPENDENCE_CERTIFICATION_TIERS,
  INDEPENDENCE_CERTIFICATION_VERIFICATION_STATUSES,
  assertCalibrationHonesty,
  validateOutcomeSpaceDescriptor,
  validateParametricIntervalField,
  validateStatisticalIndependenceCertification,
  type AbstentionReason,
  type CalibrationVerificationStatus,
  type CategoryUncertaintyDecomposition,
  type CertifiedIndependenceRelationship,
  type CertifiedIndependentMethodGroup,
  type DependenceComponentWeightAllocation,
  type DualChannelProbability,
  type EffectiveIndependenceAssessment,
  type EpistemologicalClaimDescriptor,
  type EpistemologicalClaimKind,
  type EvidentialFootingTier,
  type ForecastDistributionOutput,
  type IndependenceCertificationTier,
  type IndependenceCertificationValidationContext,
  type IndependenceCertificationVerificationStatus,
  type MethodApplicabilityResult,
  type MethodCategoryContribution,
  type MethodWeightingPolicyReport,
  type MultiMethodContrastReport,
  type OutcomeSpaceDescriptor,
  type ParametricIntervalField,
  type ScientificMethodId,
  type ScientificMethodOutput,
  type StatisticalIndependenceCertification,
  type UnexecutedApplicableMethodReport,
} from './forecast-types.ts';

export {
  INDEPENDENCE_CERTIFICATION_TIERS,
  INDEPENDENCE_CERTIFICATION_VERIFICATION_STATUSES,
  validateStatisticalIndependenceCertification,
  type CertifiedIndependenceRelationship,
  type CertifiedIndependentMethodGroup,
  type IndependenceCertificationTier,
  type IndependenceCertificationValidationContext,
  type IndependenceCertificationVerificationStatus,
  type StatisticalIndependenceCertification,
};
import { PREDICTION_CATEGORIES } from './method-registry.ts';
import type {
  MethodApplicabilityPlan,
  MethodEvaluationRecord,
} from './method-selection.ts';
import {
  decomposeCategoryUncertainty,
  decomposeEnsembleEntropy,
  kahanNeumaierSum,
  validateExhaustiveDistribution,
  validateForecastDistributionContract,
} from './numeric-primitives.ts';

export const FORECAST_SYNTHESIS_VERSION = '2A-2.3.0' as const;

export const EVIDENCE_DRIVEN_FOOTING_TIERS: readonly EvidentialFootingTier[] =
  Object.freeze([
    'empirically-calibrated-high-evidence',
    'methodologically-sound-moderate-evidence',
    'defensible-low-confidence-exploratory',
  ]);

/* -------------------------------------------------------------------------
   1. Synthesis Input Contracts
   ------------------------------------------------------------------------- */

export interface ForecastSynthesisInput {
  readonly plan: MethodApplicabilityPlan;
  readonly methodOutputs: readonly ScientificMethodOutput[];
  /**
   * Optional explicit question category; when provided, must match
   * `plan.questionCategory` exactly.
   */
  readonly questionCategory?: PredictionCategory;
  /**
   * Evidential footing tier for the synthesized forecast.
   *   - Required when one or more evidence-driven executable methods participate
   *     (must be one of `EVIDENCE_DRIVEN_FOOTING_TIERS`).
   *   - Must be `'structural-symmetry-baseline-only'` (or omitted) when only
   *     `structural-uniform-baseline` is executable.
   *   - Must be `'insufficient-basis-abstain'` (or omitted) when no applicable
   *     executable method exists.
   */
  readonly footingTier?: EvidentialFootingTier;
  /**
   * Alias for `footingTier` accepted for caller convenience; if both are
   * supplied they must match identically.
   */
  readonly evidentialFootingTier?: EvidentialFootingTier;
  /**
   * Out-of-sample calibration verification status. Defaults to
   * `'unverified-no-out-of-sample-evaluation'`.
   */
  readonly calibrationStatus?: CalibrationVerificationStatus;
  /**
   * Explicit abstention reason used when no applicable executable method exists
   * (`footingTier === 'insufficient-basis-abstain'`). Defaults to
   * `'no-defensible-theoretical-or-empirical-basis'`.
   */
  readonly abstentionReason?: AbstentionReason;
  /**
   * Optional explicit positive weights by participating ensemble method ID
   * (must sum to `1` within `1e-12`). When omitted, the engine applies the
   * default two-level dependence-aware weighting policy (`[HDO]`).
   */
  readonly customWeightsByMethod?: Readonly<Record<string, number>>;
  /**
   * Auditable statistical independence certification covering the exact
   * participating evidence-driven methods and their certified independent
   * groups and pairwise relationships. Required whenever
   * `statisticalIndependenceVerified === true` or `verifiedIndependentMethodCount`
   * is supplied.
   */
  readonly independenceCertification?: StatisticalIndependenceCertification;
  /**
   * Whether statistical independence across participating evidence-driven
   * methods has been empirically or structurally certified. Defaults to `false`.
   * Cannot be `true` unless a valid `independenceCertification` is supplied.
   * When `false` (or omitted without certification), `effectiveIndependentMethodCount`
   * is strictly `1` for evidence-driven forecasts and `0` for structural-only
   * or abstaining outputs.
   */
  readonly statisticalIndependenceVerified?: boolean;
  /**
   * Certified count of statistically independent method groups when a valid
   * `independenceCertification` is supplied. When provided, must match
   * `independenceCertification.certifiedIndependentGroups.length` exactly.
   * Forbidden when `independenceCertification` is omitted.
   */
  readonly verifiedIndependentMethodCount?: number;
  /**
   * Optional additional domain or methodological caveats to append to
   * `methodologicalLimitations`.
   */
  readonly additionalMethodologicalLimitations?: readonly string[];
}

/* -------------------------------------------------------------------------
   2. Internal Helpers: Deep Freeze, Outcome-Space Equality & Input Validation
   ------------------------------------------------------------------------- */

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
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new RangeError(
      `${fieldName} must be a non-empty string without leading or trailing whitespace, received ${String(value)}`,
    );
  }
  return value;
}

/**
 * Enforces exact canonical equality between two `OutcomeSpaceDescriptor`
 * objects, including outcome kind, exact label sequence and ordering,
 * horizon timestamps, event-definition hash, partition thresholds, and
 * absorbing barrier metadata. Never reconciles or reorders mismatched spaces.
 */
export function assertCanonicalOutcomeSpaceEquality(
  expected: OutcomeSpaceDescriptor,
  actual: OutcomeSpaceDescriptor,
  contextLabel: string,
): void {
  if (expected.kind !== actual.kind) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.kind mismatch (expected '${expected.kind}', received '${actual.kind}')`,
    );
  }
  if (expected.outcomeLabels.length !== actual.outcomeLabels.length) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.outcomeLabels length mismatch (expected ${expected.outcomeLabels.length}, received ${actual.outcomeLabels.length})`,
    );
  }
  for (let k = 0; k < expected.outcomeLabels.length; k++) {
    if (expected.outcomeLabels[k] !== actual.outcomeLabels[k]) {
      throw new RangeError(
        `${contextLabel}: outcomeSpace.outcomeLabels[${k}] mismatch (expected '${expected.outcomeLabels[k]}', received '${actual.outcomeLabels[k]}')`,
      );
    }
  }

  const expectedStartMs = parseIsoDateTimeMs(expected.horizonStartsAt);
  const actualStartMs = parseIsoDateTimeMs(actual.horizonStartsAt);
  if (
    expected.horizonStartsAt !== actual.horizonStartsAt ||
    expectedStartMs !== actualStartMs
  ) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.horizonStartsAt mismatch (expected '${expected.horizonStartsAt}', received '${actual.horizonStartsAt}')`,
    );
  }

  const expectedEndMs = parseIsoDateTimeMs(expected.horizonEndsAt);
  const actualEndMs = parseIsoDateTimeMs(actual.horizonEndsAt);
  if (
    expected.horizonEndsAt !== actual.horizonEndsAt ||
    expectedEndMs !== actualEndMs
  ) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.horizonEndsAt mismatch (expected '${expected.horizonEndsAt}', received '${actual.horizonEndsAt}')`,
    );
  }

  if (expected.eventDefinitionHash !== actual.eventDefinitionHash) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.eventDefinitionHash mismatch (expected '${expected.eventDefinitionHash}', received '${actual.eventDefinitionHash}')`,
    );
  }

  const expThresholds = expected.partitionThresholds;
  const actThresholds = actual.partitionThresholds;
  if ((expThresholds === undefined) !== (actThresholds === undefined)) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace.partitionThresholds presence mismatch`,
    );
  }
  if (expThresholds !== undefined && actThresholds !== undefined) {
    if (expThresholds.length !== actThresholds.length) {
      throw new RangeError(
        `${contextLabel}: outcomeSpace.partitionThresholds length mismatch (expected ${expThresholds.length}, received ${actThresholds.length})`,
      );
    }
    for (let i = 0; i < expThresholds.length; i++) {
      if (!Object.is(expThresholds[i], actThresholds[i])) {
        throw new RangeError(
          `${contextLabel}: outcomeSpace.partitionThresholds[${i}] mismatch (expected ${String(expThresholds[i])}, received ${String(actThresholds[i])})`,
        );
      }
    }
  }

  if (
    !Object.is(expected.barrierLevel, actual.barrierLevel) ||
    expected.barrierDirection !== actual.barrierDirection
  ) {
    throw new RangeError(
      `${contextLabel}: outcomeSpace barrier specification mismatch (expected level=${String(expected.barrierLevel)} dir=${String(expected.barrierDirection)}, received level=${String(actual.barrierLevel)} dir=${String(actual.barrierDirection)})`,
    );
  }
}

function validateStrictOutcomeSpace(
  raw: unknown,
  fieldName: string,
): OutcomeSpaceDescriptor {
  if (!isPlainObject(raw)) {
    throw new RangeError(`${fieldName} must be a non-null object`);
  }
  if (Array.isArray(raw.outcomeLabels)) {
    for (let i = 0; i < raw.outcomeLabels.length; i++) {
      assertStrictTrimmedString(
        raw.outcomeLabels[i],
        `${fieldName}.outcomeLabels[${i}]`,
      );
    }
  }
  if (typeof raw.eventDefinitionHash === 'string') {
    assertStrictTrimmedString(
      raw.eventDefinitionHash,
      `${fieldName}.eventDefinitionHash`,
    );
  }
  return validateOutcomeSpaceDescriptor(raw);
}

function validateSuppliedMethodOutput(
  raw: unknown,
  index: number,
  canonicalOutcomeSpace: OutcomeSpaceDescriptor,
): ScientificMethodOutput {
  if (!isPlainObject(raw)) {
    throw new RangeError(
      `methodOutputs[${index}] must be a non-null ScientificMethodOutput object`,
    );
  }
  const methodId = assertStrictTrimmedString(
    raw.methodId,
    `methodOutputs[${index}].methodId`,
  ) as ScientificMethodId;
  const methodFamily = assertStrictTrimmedString(
    raw.methodFamily,
    `methodOutputs[${index}].methodFamily`,
  ) as ScientificMethodOutput['methodFamily'];

  const outcomeSpace = validateStrictOutcomeSpace(
    raw.outcomeSpace,
    `methodOutputs[${index} (${methodId})].outcomeSpace`,
  );
  assertCanonicalOutcomeSpaceEquality(
    canonicalOutcomeSpace,
    outcomeSpace,
    `methodOutputs[${index} (${methodId})]`,
  );

  const outcomeCount = canonicalOutcomeSpace.outcomeLabels.length;
  const outcomes = validateExhaustiveDistribution(raw.outcomes, outcomeCount);

  if (
    !Array.isArray(raw.parametricVariances) ||
    raw.parametricVariances.length !== outcomeCount
  ) {
    throw new RangeError(
      `methodOutputs[${index} (${methodId})].parametricVariances must be an array of length ${outcomeCount}`,
    );
  }
  const parametricVariances: number[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    const v = raw.parametricVariances[k];
    const maxVar =
      outcomes[k]!.probability * outcomes[k]!.complementProbability + 1e-15;
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      Number.isNaN(v) ||
      v < 0 ||
      v > maxVar
    ) {
      throw new RangeError(
        `methodOutputs[${index} (${methodId})].parametricVariances[${k}] (${String(v)}) must be finite in [0, p_k*(1-p_k)]`,
      );
    }
    parametricVariances.push(v);
  }

  if (
    !Array.isArray(raw.parametricIntervals) ||
    raw.parametricIntervals.length !== outcomeCount
  ) {
    throw new RangeError(
      `methodOutputs[${index} (${methodId})].parametricIntervals must be an array of length ${outcomeCount}`,
    );
  }
  const parametricIntervals: ParametricIntervalField[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    parametricIntervals.push(
      validateParametricIntervalField(raw.parametricIntervals[k], outcomes[k]!),
    );
  }

  if (
    typeof raw.effectiveSampleSize !== 'number' ||
    !Number.isFinite(raw.effectiveSampleSize) ||
    Number.isNaN(raw.effectiveSampleSize) ||
    raw.effectiveSampleSize < 0
  ) {
    throw new RangeError(
      `methodOutputs[${index} (${methodId})].effectiveSampleSize must be a finite non-negative number, received ${String(raw.effectiveSampleSize)}`,
    );
  }
  if (methodId === 'structural-uniform-baseline' && raw.effectiveSampleSize !== 0) {
    throw new RangeError(
      `structural-uniform-baseline must have effectiveSampleSize === 0, received ${raw.effectiveSampleSize}`,
    );
  }

  if (!Array.isArray(raw.epistemologicalClaims) || raw.epistemologicalClaims.length === 0) {
    throw new RangeError(
      `methodOutputs[${index} (${methodId})].epistemologicalClaims must be a non-empty array`,
    );
  }
  const claims: EpistemologicalClaimDescriptor[] = [];
  for (let c = 0; c < raw.epistemologicalClaims.length; c++) {
    const claimRaw = raw.epistemologicalClaims[c];
    if (!isPlainObject(claimRaw)) {
      throw new RangeError(
        `methodOutputs[${index} (${methodId})].epistemologicalClaims[${c}] must be an object`,
      );
    }
    const kind = claimRaw.kind as EpistemologicalClaimKind;
    const expectedTag = EPISTEMOLOGICAL_TAG_BY_KIND[kind];
    if (!expectedTag || claimRaw.tag !== expectedTag) {
      throw new RangeError(
        `methodOutputs[${index} (${methodId})].epistemologicalClaims[${c}] has incoherent (kind='${String(claimRaw.kind)}', tag='${String(claimRaw.tag)}')`,
      );
    }
    const statement = assertStrictTrimmedString(
      claimRaw.statement,
      `methodOutputs[${index} (${methodId})].epistemologicalClaims[${c}].statement`,
    );
    claims.push(
      Object.freeze({
        kind,
        tag: expectedTag,
        statement,
        ...(claimRaw.validityCondition !== undefined
          ? {
              validityCondition: assertStrictTrimmedString(
                claimRaw.validityCondition,
                `methodOutputs[${index}].epistemologicalClaims[${c}].validityCondition`,
              ),
            }
          : {}),
        ...(claimRaw.errorBound !== undefined
          ? {
              errorBound: assertStrictTrimmedString(
                claimRaw.errorBound,
                `methodOutputs[${index}].epistemologicalClaims[${c}].errorBound`,
              ),
            }
          : {}),
      }),
    );
  }

  if (!Array.isArray(raw.warnings)) {
    throw new RangeError(
      `methodOutputs[${index} (${methodId})].warnings must be an array`,
    );
  }
  const warnings: string[] = [];
  for (let w = 0; w < raw.warnings.length; w++) {
    warnings.push(
      assertStrictTrimmedString(
        raw.warnings[w],
        `methodOutputs[${index} (${methodId})].warnings[${w}]`,
      ),
    );
  }

  return deepFreeze({
    methodId,
    methodFamily,
    outcomeSpace,
    outcomes,
    parametricVariances: Object.freeze(parametricVariances),
    parametricIntervals: Object.freeze(parametricIntervals),
    effectiveSampleSize: raw.effectiveSampleSize,
    epistemologicalClaims: Object.freeze(claims),
    warnings: Object.freeze(warnings),
  });
}

function validatePlanStructure(rawPlan: unknown): MethodApplicabilityPlan {
  if (!isPlainObject(rawPlan)) {
    throw new RangeError(
      'ForecastSynthesisInput.plan must be a non-null MethodApplicabilityPlan object',
    );
  }
  const questionCategory = rawPlan.questionCategory as PredictionCategory;
  if (
    typeof questionCategory !== 'string' ||
    !PREDICTION_CATEGORIES.includes(questionCategory)
  ) {
    throw new RangeError(
      `plan.questionCategory must be one of ${PREDICTION_CATEGORIES.join(', ')}, received ${String(questionCategory)}`,
    );
  }

  validateStrictOutcomeSpace(rawPlan.outcomeSpace, 'plan.outcomeSpace');

  if (
    !Array.isArray(rawPlan.evaluatedMethods) ||
    rawPlan.evaluatedMethods.length === 0
  ) {
    throw new RangeError(
      'plan.evaluatedMethods must be a non-empty array of MethodEvaluationRecord items',
    );
  }
  if (!Array.isArray(rawPlan.applicableMethods)) {
    throw new RangeError('plan.applicableMethods must be an array');
  }
  if (!Array.isArray(rawPlan.deferredMethods)) {
    throw new RangeError('plan.deferredMethods must be an array');
  }
  if (!Array.isArray(rawPlan.inapplicableMethods)) {
    throw new RangeError('plan.inapplicableMethods must be an array');
  }
  if (!Array.isArray(rawPlan.discardedMethodResults)) {
    throw new RangeError('plan.discardedMethodResults must be an array');
  }
  if (
    !isPlainObject(rawPlan.dependenceDiagnostics) ||
    !Array.isArray(rawPlan.dependenceDiagnostics.connectedComponents) ||
    !Array.isArray(rawPlan.dependenceDiagnostics.unlinkedSelectedEvidenceMethodIds) ||
    !Array.isArray(rawPlan.dependenceDiagnostics.pairwiseAssessments)
  ) {
    throw new RangeError(
      'plan.dependenceDiagnostics must be a valid MethodDependenceDiagnostics object',
    );
  }

  const seenEvalIds = new Set<string>();
  for (let i = 0; i < rawPlan.evaluatedMethods.length; i++) {
    const rec = rawPlan.evaluatedMethods[i];
    if (!isPlainObject(rec)) {
      throw new RangeError(`plan.evaluatedMethods[${i}] must be an object`);
    }
    const id = assertStrictTrimmedString(
      rec.methodId,
      `plan.evaluatedMethods[${i}].methodId`,
    );
    if (seenEvalIds.has(id)) {
      throw new RangeError(
        `plan.evaluatedMethods contains duplicate methodId '${id}'`,
      );
    }
    seenEvalIds.add(id);
  }

  return rawPlan as unknown as MethodApplicabilityPlan;
}

/* -------------------------------------------------------------------------
   3. Two-Level Dependence-Aware Weighting Policy ([HDO])
   ------------------------------------------------------------------------- */

/**
 * Computes the two-level dependence-aware model weights (`[HDO]`) for the
 * eligible executable evidence-driven methods using `plan.dependenceDiagnostics`:
 *
 *   1. Identifies the active dependence connected components containing
 *      eligible evidence-driven methods (`connectedComponents` restricted to
 *      eligible methods, plus singleton components for each eligible method in
 *      `unlinkedSelectedEvidenceMethodIds`).
 *   2. Assigns equal prior mass `1 / C` to each of the `C` active components.
 *   3. Divides each component's mass equally `1 / (C * |G_c|)` among its
 *      `|G_c|` eligible methods.
 *
 * If `customWeightsByMethod` is explicitly supplied, validates that its keys
 * match `eligibleEvidenceMethodIds` and its weights are finite, strictly
 * positive (`> 0`), and sum to `1` within `1e-12`.
 */
export function computeDependenceAwareMethodWeights(
  plan: MethodApplicabilityPlan,
  eligibleEvidenceMethodIds: readonly ScientificMethodId[],
  customWeightsByMethod?: Readonly<Record<string, number>>,
): {
  readonly weightsByMethod: Readonly<Record<string, number>>;
  readonly orderedWeights: readonly number[];
  readonly weightingPolicy: MethodWeightingPolicyReport;
} {
  if (eligibleEvidenceMethodIds.length === 0) {
    return Object.freeze({
      weightsByMethod: Object.freeze({}),
      orderedWeights: Object.freeze([]),
      weightingPolicy: Object.freeze({
        policyId: 'abstention-no-weights',
        epistemologicalTag: 'IME',
        rationale:
          'No eligible executable methods are present; no ensemble weights are assigned.',
        evidenceConnectedComponentCount: 0,
        componentAllocations: Object.freeze([]),
      }),
    });
  }

  const eligibleSet = new Set<ScientificMethodId>(eligibleEvidenceMethodIds);
  const evalById = new Map<ScientificMethodId, MethodEvaluationRecord>();
  for (const rec of plan.evaluatedMethods) {
    evalById.set(rec.methodId, rec);
  }

  // Construct active components over eligibleEvidenceMethodIds in deterministic plan order:
  const assignedMethods = new Set<ScientificMethodId>();
  const rawComponents: Array<{
    readonly componentId: string;
    readonly correlationGroupIds: readonly string[];
    readonly isSingletonUnlinked: boolean;
    readonly memberMethodIds: readonly ScientificMethodId[];
  }> = [];

  for (const comp of plan.dependenceDiagnostics.connectedComponents) {
    const eligibleMembers = comp.applicableMethodIds.filter((id) =>
      eligibleSet.has(id),
    );
    if (eligibleMembers.length > 0) {
      for (const id of eligibleMembers) {
        if (assignedMethods.has(id)) {
          throw new RangeError(
            `Corrupted plan.dependenceDiagnostics: method '${id}' appears in multiple connectedComponents`,
          );
        }
        assignedMethods.add(id);
      }
      rawComponents.push({
        componentId: comp.correlationGroupId,
        correlationGroupIds: Object.freeze([...comp.correlationGroupIds]),
        isSingletonUnlinked: false,
        memberMethodIds: Object.freeze(eligibleMembers),
      });
    }
  }

  for (const unlinkedId of plan.dependenceDiagnostics.unlinkedSelectedEvidenceMethodIds) {
    if (eligibleSet.has(unlinkedId)) {
      if (assignedMethods.has(unlinkedId)) {
        throw new RangeError(
          `Corrupted plan.dependenceDiagnostics: method '${unlinkedId}' appears in both connectedComponents and unlinkedSelectedEvidenceMethodIds`,
        );
      }
      assignedMethods.add(unlinkedId);
      const rec = evalById.get(unlinkedId);
      const groupId = rec?.correlationGroupId ?? `singleton:${unlinkedId}`;
      rawComponents.push({
        componentId: groupId,
        correlationGroupIds: Object.freeze([groupId]),
        isSingletonUnlinked: true,
        memberMethodIds: Object.freeze([unlinkedId]),
      });
    }
  }

  // Defensive check: if a customized plan omitted an eligible method from
  // dependenceDiagnostics lists, reject the inconsistent plan rather than guessing:
  for (const id of eligibleEvidenceMethodIds) {
    if (!assignedMethods.has(id)) {
      throw new RangeError(
        `Inconsistent plan.dependenceDiagnostics: eligible evidence-driven method '${id}' is missing from both connectedComponents and unlinkedSelectedEvidenceMethodIds`,
      );
    }
  }

  // Sort components deterministically by the first member's position in eligibleEvidenceMethodIds:
  const indexByMethod = new Map<ScientificMethodId, number>();
  eligibleEvidenceMethodIds.forEach((id, idx) => indexByMethod.set(id, idx));
  rawComponents.sort(
    (a, b) =>
      (indexByMethod.get(a.memberMethodIds[0]!) ?? 0) -
      (indexByMethod.get(b.memberMethodIds[0]!) ?? 0),
  );

  const componentCount = rawComponents.length;

  if (customWeightsByMethod !== undefined) {
    if (!isPlainObject(customWeightsByMethod)) {
      throw new RangeError('customWeightsByMethod must be a plain object');
    }
    const customKeys = Object.keys(customWeightsByMethod);
    if (customKeys.length !== eligibleEvidenceMethodIds.length) {
      throw new RangeError(
        `customWeightsByMethod key count (${customKeys.length}) must match eligible participating method count (${eligibleEvidenceMethodIds.length})`,
      );
    }
    const rawCustomWeights: number[] = [];
    for (const id of eligibleEvidenceMethodIds) {
      if (!Object.prototype.hasOwnProperty.call(customWeightsByMethod, id)) {
        throw new RangeError(
          `customWeightsByMethod is missing weight for participating method '${id}'`,
        );
      }
      const w = customWeightsByMethod[id];
      if (
        typeof w !== 'number' ||
        !Number.isFinite(w) ||
        Number.isNaN(w) ||
        w <= 0 ||
        w > 1
      ) {
        throw new RangeError(
          `customWeightsByMethod['${id}'] must be a finite positive number in (0, 1], received ${String(w)}`,
        );
      }
      rawCustomWeights.push(w);
    }
    const customSum = kahanNeumaierSum(rawCustomWeights);
    if (!Number.isFinite(customSum) || Math.abs(customSum - 1) > 1e-12) {
      throw new RangeError(
        `customWeightsByMethod must sum to 1 within 1e-12, received sum = ${customSum}`,
      );
    }

    const normalizedMap: Record<string, number> = {};
    const orderedWeights: number[] = [];
    for (let i = 0; i < eligibleEvidenceMethodIds.length; i++) {
      const id = eligibleEvidenceMethodIds[i]!;
      const normW = rawCustomWeights[i]! / customSum;
      normalizedMap[id] = normW;
      orderedWeights.push(normW);
    }

    const allocations: DependenceComponentWeightAllocation[] = rawComponents.map(
      (comp) => {
        const perMethod: Record<string, number> = {};
        const memberWeights: number[] = [];
        for (const mId of comp.memberMethodIds) {
          const w = normalizedMap[mId]!;
          perMethod[mId] = w;
          memberWeights.push(w);
        }
        return Object.freeze({
          componentId: comp.componentId,
          correlationGroupIds: comp.correlationGroupIds,
          isSingletonUnlinked: comp.isSingletonUnlinked,
          memberMethodIds: comp.memberMethodIds,
          componentWeight: kahanNeumaierSum(memberWeights),
          weightPerMethod: Object.freeze(perMethod),
        });
      },
    );

    return Object.freeze({
      weightsByMethod: Object.freeze(normalizedMap),
      orderedWeights: Object.freeze(orderedWeights),
      weightingPolicy: Object.freeze({
        policyId: 'custom-explicit-weights-hdo',
        epistemologicalTag: 'HDO',
        rationale:
          'Explicit caller-supplied operational prior weights [HDO] over participating evidence-driven methods (not learned in-sample stacking weights or verified empirical calibration).',
        evidenceConnectedComponentCount: componentCount,
        componentAllocations: Object.freeze(allocations),
      }),
    });
  }

  // Default two-level dependence-aware policy [HDO]:
  //   Component weight W(G_c) = 1 / C
  //   Method weight w_m = 1 / (C * |G_c|)
  const rawWeightByMethod = new Map<ScientificMethodId, number>();
  const allocations: DependenceComponentWeightAllocation[] = [];

  for (const comp of rawComponents) {
    const compWeight = 1 / componentCount;
    const memberCount = comp.memberMethodIds.length;
    const memberWeight = 1 / (componentCount * memberCount);
    const perMethod: Record<string, number> = {};
    for (const mId of comp.memberMethodIds) {
      rawWeightByMethod.set(mId, memberWeight);
      perMethod[mId] = memberWeight;
    }
    allocations.push(
      Object.freeze({
        componentId: comp.componentId,
        correlationGroupIds: comp.correlationGroupIds,
        isSingletonUnlinked: comp.isSingletonUnlinked,
        memberMethodIds: comp.memberMethodIds,
        componentWeight: compWeight,
        weightPerMethod: Object.freeze(perMethod),
      }),
    );
  }

  const orderedRawWeights = eligibleEvidenceMethodIds.map(
    (id) => rawWeightByMethod.get(id)!,
  );
  const weightSum = kahanNeumaierSum(orderedRawWeights);
  if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-12) {
    throw new RangeError(
      `Numerical normalization failure in dependence-aware weighting: sum = ${weightSum}`,
    );
  }

  const weightsByMethod: Record<string, number> = {};
  const orderedWeights: number[] = [];
  for (let i = 0; i < eligibleEvidenceMethodIds.length; i++) {
    const id = eligibleEvidenceMethodIds[i]!;
    const w =
      eligibleEvidenceMethodIds.length === 1
        ? 1
        : orderedRawWeights[i]!;
    weightsByMethod[id] = w;
    orderedWeights.push(w);
  }

  const isSingleMethod = eligibleEvidenceMethodIds.length === 1;
  const rationale = isSingleMethod
    ? `Single eligible executable evidence-driven method '${eligibleEvidenceMethodIds[0]}' receives unit weight (w = 1).`
    : `Two-level dependence-aware operational prior [HDO]: equal prior mass (1/${componentCount}) across ${componentCount} declared dependence connected component(s) [${rawComponents.map((c) => `${c.componentId}(${c.memberMethodIds.join(', ')})`).join('; ')}], divided equally among eligible methods within each component so correlated model families do not receive inflated weight from having multiple registered formulations. Singleton unlinked methods remain classified as having unknown cross-method dependence, not verified statistical independence.`;

  return Object.freeze({
    weightsByMethod: Object.freeze(weightsByMethod),
    orderedWeights: Object.freeze(orderedWeights),
    weightingPolicy: Object.freeze({
      policyId: isSingleMethod
        ? 'single-evidence-method-unit-weight'
        : 'equal-component-then-equal-within-component-hdo',
      epistemologicalTag: isSingleMethod ? 'IME' : 'HDO',
      rationale,
      evidenceConnectedComponentCount: componentCount,
      componentAllocations: Object.freeze(allocations),
    }),
  });
}

/* -------------------------------------------------------------------------
   4. Main Synthesis Engine: synthesizeForecastDistribution
   ------------------------------------------------------------------------- */

/**
 * Pure deterministic multi-method synthesis engine.
 *
 * Consumes a validated `MethodApplicabilityPlan` and the `ScientificMethodOutput`
 * records of all applicable executable methods, returning a deeply frozen
 * `ForecastDistributionOutput` validated by `validateForecastDistributionContract`.
 */
export function synthesizeForecastDistribution(
  rawInput: unknown,
): ForecastDistributionOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'ForecastSynthesisInput must be a non-null plain object',
    );
  }

  const plan = validatePlanStructure(rawInput.plan);
  const canonicalOutcomeSpace = plan.outcomeSpace;
  const outcomeCount = canonicalOutcomeSpace.outcomeLabels.length;

  if (rawInput.questionCategory !== undefined) {
    if (rawInput.questionCategory !== plan.questionCategory) {
      throw new RangeError(
        `ForecastSynthesisInput.questionCategory ('${String(rawInput.questionCategory)}') does not match plan.questionCategory ('${plan.questionCategory}')`,
      );
    }
  }
  const questionCategory = plan.questionCategory;

  const calibrationStatus: CalibrationVerificationStatus =
    rawInput.calibrationStatus !== undefined
      ? (rawInput.calibrationStatus as CalibrationVerificationStatus)
      : 'unverified-no-out-of-sample-evaluation';
  if (!CALIBRATION_VERIFICATION_STATUSES.includes(calibrationStatus)) {
    throw new RangeError(
      `Invalid calibrationStatus '${String(calibrationStatus)}'; expected one of ${CALIBRATION_VERIFICATION_STATUSES.join(', ')}`,
    );
  }

  if (
    rawInput.footingTier !== undefined &&
    rawInput.evidentialFootingTier !== undefined &&
    rawInput.footingTier !== rawInput.evidentialFootingTier
  ) {
    throw new RangeError(
      `Conflicting footingTier ('${String(rawInput.footingTier)}') and evidentialFootingTier ('${String(rawInput.evidentialFootingTier)}')`,
    );
  }
  const requestedFootingTier = (rawInput.footingTier ??
    rawInput.evidentialFootingTier) as EvidentialFootingTier | undefined;
  if (
    requestedFootingTier !== undefined &&
    !EVIDENTIAL_FOOTING_TIERS.includes(requestedFootingTier)
  ) {
    throw new RangeError(
      `Invalid footingTier '${String(requestedFootingTier)}'; expected one of ${EVIDENTIAL_FOOTING_TIERS.join(', ')}`,
    );
  }

  const additionalLimitations: string[] = [];
  if (rawInput.additionalMethodologicalLimitations !== undefined) {
    if (!Array.isArray(rawInput.additionalMethodologicalLimitations)) {
      throw new RangeError(
        'additionalMethodologicalLimitations must be an array of strings when provided',
      );
    }
    for (let i = 0; i < rawInput.additionalMethodologicalLimitations.length; i++) {
      additionalLimitations.push(
        assertStrictTrimmedString(
          rawInput.additionalMethodologicalLimitations[i],
          `additionalMethodologicalLimitations[${i}]`,
        ),
      );
    }
  }

  if (!Array.isArray(rawInput.methodOutputs)) {
    throw new RangeError(
      'ForecastSynthesisInput.methodOutputs must be an array of ScientificMethodOutput items',
    );
  }

  // Index plan evaluation records by methodId in canonical registry order:
  const evalById = new Map<ScientificMethodId, MethodEvaluationRecord>();
  for (const rec of plan.evaluatedMethods) {
    evalById.set(rec.methodId, rec);
  }

  // Validate each supplied method output and enforce:
  //   - No duplicate methodIds
  //   - Every supplied method was evaluated in `plan` as `applicable === true`
  //   - Every supplied method has `hasExecutableImplementation === true` and
  //     `implementationStatus === 'implemented-and-verified'`
  //   - Every supplied method matches `plan.outcomeSpace` identically
  const suppliedById = new Map<ScientificMethodId, ScientificMethodOutput>();
  for (let i = 0; i < rawInput.methodOutputs.length; i++) {
    const validatedOutput = validateSuppliedMethodOutput(
      rawInput.methodOutputs[i],
      i,
      canonicalOutcomeSpace,
    );
    const id = validatedOutput.methodId;
    if (suppliedById.has(id)) {
      throw new RangeError(
        `Duplicate ScientificMethodOutput for methodId '${id}' at index ${i}`,
      );
    }

    const evalRec = evalById.get(id);
    if (!evalRec) {
      throw new RangeError(
        `Supplied methodOutput '${id}' is not present in plan.evaluatedMethods`,
      );
    }
    if (!evalRec.applicable) {
      throw new RangeError(
        `Supplied methodOutput '${id}' is not applicable according to the plan (disposition: '${evalRec.disposition}', failedGateIds: [${evalRec.failedGateIds.join(', ')}], deferredGateIds: [${evalRec.deferredGateIds.join(', ')}])`,
      );
    }
    if (
      !evalRec.hasExecutableImplementation ||
      evalRec.implementationStatus !== 'implemented-and-verified'
    ) {
      throw new RangeError(
        `Supplied methodOutput '${id}' is marked unimplemented in the plan (hasExecutableImplementation: ${String(evalRec.hasExecutableImplementation)}, implementationStatus: '${evalRec.implementationStatus}') and cannot be accepted as a verified execution output`,
      );
    }
    if (validatedOutput.methodFamily !== evalRec.methodFamily) {
      throw new RangeError(
        `Supplied methodOutput '${id}' has methodFamily '${validatedOutput.methodFamily}', expected '${evalRec.methodFamily}' from plan`,
      );
    }

    suppliedById.set(id, validatedOutput);
  }

  // Partition plan.applicableMethods into:
  //   1. Eligible executable evidence-driven methods
  //   2. Eligible executable structural baseline methods
  //   3. Applicable but unimplemented methods (reported honestly in unexecutedApplicableMethods)
  // And verify NO applicable executable method is missing from `methodOutputs`!
  const eligibleEvidenceMethodIds: ScientificMethodId[] = [];
  const eligibleStructuralBaselineIds: ScientificMethodId[] = [];
  const unexecutedApplicableMethods: UnexecutedApplicableMethodReport[] = [];

  for (const rec of plan.evaluatedMethods) {
    if (!rec.applicable) {
      continue;
    }
    const isExecutable =
      rec.hasExecutableImplementation &&
      rec.implementationStatus === 'implemented-and-verified';

    if (!isExecutable) {
      const disposition: 'applicable' | 'applicable-with-limitations' =
        rec.disposition === 'applicable'
          ? 'applicable'
          : 'applicable-with-limitations';
      unexecutedApplicableMethods.push(
        Object.freeze({
          methodId: rec.methodId,
          disposition,
          implementationStatus: rec.implementationStatus,
          reason: `Method '${rec.methodId}' is ${disposition} according to the Stage 2A-2.1 planner, but remains '${rec.implementationStatus}' (hasExecutableImplementation: false) in Stage 2A-2.2/2A-2.3 and was not executed.`,
        }),
      );
      continue;
    }

    if (!suppliedById.has(rec.methodId)) {
      throw new RangeError(
        `Missing ScientificMethodOutput for applicable executable method '${rec.methodId}' (disposition: '${rec.disposition}'); eligible executable methods must never be silently omitted`,
      );
    }

    if (rec.role === 'structural-symmetry-baseline') {
      eligibleStructuralBaselineIds.push(rec.methodId);
    } else {
      eligibleEvidenceMethodIds.push(rec.methodId);
    }
  }

  // Ordered executedMethodIds in canonical plan evaluation order:
  const executedMethodIds: ScientificMethodId[] = [];
  for (const rec of plan.evaluatedMethods) {
    if (suppliedById.has(rec.methodId)) {
      executedMethodIds.push(rec.methodId);
    }
  }

  // Collect deferred and discarded/inapplicable methods from the plan:
  const deferredMethods: MethodApplicabilityResult[] = plan.deferredMethods.map(
    (rec) =>
      Object.freeze({
        methodId: rec.methodId,
        applicable: false,
        rationale: rec.rationale,
        failedGateIds: Object.freeze([...rec.deferredGateIds]),
      }),
  );

  const discardedMethods: MethodApplicabilityResult[] =
    plan.discardedMethodResults.map((dm) =>
      Object.freeze({
        methodId: dm.methodId,
        applicable: false,
        rationale: dm.rationale,
        failedGateIds: Object.freeze([...dm.failedGateIds]),
      }),
    );

  // Build shared methodological limitations preserving plan limitations, unexecuted methods,
  // deferred methods, dependence warnings, and calibration honesty:
  const limitationsSet = new Set<string>();
  const addLimitation = (msg: string): void => {
    const trimmed = msg.trim();
    if (trimmed.length > 0) {
      limitationsSet.add(trimmed);
    }
  };

  for (const rec of plan.applicableMethods) {
    for (const lim of rec.activeLimitations) {
      addLimitation(`[${rec.methodId}] ${lim}`);
    }
    if (rec.unverifiedAssumptions.length > 0) {
      addLimitation(
        `[${rec.methodId}] Unverified but plausible assumptions: [${rec.unverifiedAssumptions.join(', ')}].`,
      );
    }
  }
  for (const unexec of unexecutedApplicableMethods) {
    addLimitation(unexec.reason);
  }
  for (const defRec of plan.deferredMethods) {
    addLimitation(
      `Deferred method '${defRec.methodId}' not executed (deferredGateIds: [${defRec.deferredGateIds.join(', ')}]): ${defRec.rationale}`,
    );
  }
  addLimitation(plan.dependenceDiagnostics.summaryWarning);
  if (plan.dependenceDiagnostics.binaryBetaDirichletEquivalence !== undefined) {
    const eq = plan.dependenceDiagnostics.binaryBetaDirichletEquivalence;
    addLimitation(
      `Binary Beta-Binomial / Dirichlet-Multinomial dependence diagnostic: observationAlignment='${eq.observationAlignment}', observationsMatchExactly=${String(eq.observationsMatchExactly)}. ${eq.nonIdenticalCaveat}`,
    );
  }

  /* -----------------------------------------------------------------------
     PATH A: Honest Abstention (no applicable executable evidence-driven or
             structural baseline method exists)
     ----------------------------------------------------------------------- */
  if (
    eligibleEvidenceMethodIds.length === 0 &&
    eligibleStructuralBaselineIds.length === 0
  ) {
    if (
      requestedFootingTier !== undefined &&
      requestedFootingTier !== 'insufficient-basis-abstain'
    ) {
      throw new RangeError(
        `Cannot claim footingTier '${requestedFootingTier}' when no applicable executable evidence-driven or structural baseline method exists; must be 'insufficient-basis-abstain'`,
      );
    }
    if (rawInput.customWeightsByMethod !== undefined) {
      throw new RangeError(
        'customWeightsByMethod cannot be supplied when no eligible executable methods exist',
      );
    }
    if (rawInput.statisticalIndependenceVerified === true) {
      throw new RangeError(
        'statisticalIndependenceVerified cannot be true when no eligible executable methods exist',
      );
    }
    if (rawInput.verifiedIndependentMethodCount !== undefined) {
      throw new RangeError(
        'verifiedIndependentMethodCount cannot be supplied when no eligible executable methods exist',
      );
    }
    if (rawInput.independenceCertification !== undefined) {
      throw new RangeError(
        'independenceCertification cannot be supplied when no eligible executable methods exist',
      );
    }

    const footingTier: EvidentialFootingTier = 'insufficient-basis-abstain';
    assertCalibrationHonesty(footingTier, calibrationStatus);

    const abstentionReason: AbstentionReason =
      (rawInput.abstentionReason as AbstentionReason | undefined) ??
      'no-defensible-theoretical-or-empirical-basis';
    if (!ABSTENTION_REASONS.includes(abstentionReason)) {
      throw new RangeError(
        `Invalid abstentionReason '${String(abstentionReason)}'; expected one of ${ABSTENTION_REASONS.join(', ')}`,
      );
    }

    addLimitation(
      `Forecast synthesis abstained (reason: '${abstentionReason}'): zero applicable executable evidence-driven or structural baseline methods were available. No fallback or uniform probability distribution was fabricated.`,
    );
    for (const extra of additionalLimitations) {
      addLimitation(extra);
    }

    const independenceSemantics: EffectiveIndependenceAssessment = Object.freeze({
      executedMethodCount: 0,
      ensembleContributingMethodCount: 0,
      referenceOnlyMethodCount: 0,
      declaredEvidenceComponentCount: 0,
      statisticalIndependenceVerified: false,
      effectiveIndependentMethodCount: 0,
      explanation:
        'Abstention: zero executable methods were run; effectiveIndependentMethodCount is 0.',
    });

    const weightingPolicy: MethodWeightingPolicyReport = Object.freeze({
      policyId: 'abstention-no-weights',
      epistemologicalTag: 'IME',
      rationale:
        'No applicable executable methods exist; ensemble weights are empty and no probability distribution is fabricated.',
      evidenceConnectedComponentCount: 0,
      componentAllocations: Object.freeze([]),
    });

    const contrastReport: MultiMethodContrastReport = Object.freeze({
      executedMethodIds: Object.freeze([]),
      ensembleContributingMethodIds: Object.freeze([]),
      referenceOnlyMethodIds: Object.freeze([]),
      referenceOnlyMethodOutputs: Object.freeze([]),
      unexecutedApplicableMethods: Object.freeze(unexecutedApplicableMethods),
      deferredMethods: Object.freeze(deferredMethods),
      discardedMethods: Object.freeze(discardedMethods),
      weightsByMethod: Object.freeze({}),
      weightingPolicy,
      dependenceDiagnostics: plan.dependenceDiagnostics,
      statisticalIndependenceVerified: false,
      effectiveIndependentMethodCount: 0,
      independenceSemantics,
      entropyDecomposition: null,
      categoryDecompositions: Object.freeze([]),
    });

    const epistemologicalClaims: readonly EpistemologicalClaimDescriptor[] =
      Object.freeze([
        Object.freeze({
          kind: 'operational-design-heuristic',
          tag: 'HDO',
          statement:
            'Honest abstention rule: when no applicable executable evidence-driven method or verified structural symmetry baseline exists, THE ORACLE abstains explicitly without fabricating a uniform or fallback probability distribution.',
        }),
      ]);

    const abstainingOutput: ForecastDistributionOutput = {
      questionCategory,
      outcomeSpace: canonicalOutcomeSpace,
      footingTier,
      calibrationStatus,
      outcomes: Object.freeze([]),
      contrastReport,
      epistemologicalClaims,
      methodologicalLimitations: Object.freeze([...limitationsSet]),
      abstentionReason,
    };

    return deepFreeze(validateForecastDistributionContract(abstainingOutput));
  }

  /* -----------------------------------------------------------------------
     PATH B: Standalone Structural Symmetry Baseline Only (zero executable
             evidence-driven methods, verified structural baseline available)
     ----------------------------------------------------------------------- */
  if (eligibleEvidenceMethodIds.length === 0) {
    if (
      requestedFootingTier !== undefined &&
      requestedFootingTier !== 'structural-symmetry-baseline-only'
    ) {
      throw new RangeError(
        `Cannot claim footingTier '${requestedFootingTier}' when only structural-uniform-baseline is executable; must be 'structural-symmetry-baseline-only'`,
      );
    }
    if (rawInput.abstentionReason !== undefined) {
      throw new RangeError(
        'abstentionReason must not be provided when a valid structural-uniform-baseline forecast is produced',
      );
    }
    if (rawInput.statisticalIndependenceVerified === true) {
      throw new RangeError(
        'statisticalIndependenceVerified cannot be true for a non-evidential structural-symmetry-baseline-only forecast',
      );
    }
    if (rawInput.verifiedIndependentMethodCount !== undefined) {
      throw new RangeError(
        'verifiedIndependentMethodCount is not permitted for a structural-symmetry-baseline-only forecast',
      );
    }
    if (rawInput.independenceCertification !== undefined) {
      throw new RangeError(
        'independenceCertification is not permitted for a structural-symmetry-baseline-only forecast',
      );
    }

    const footingTier: EvidentialFootingTier =
      'structural-symmetry-baseline-only';
    assertCalibrationHonesty(footingTier, calibrationStatus);

    const baselineId = eligibleStructuralBaselineIds[0]!;
    const baselineOutput = suppliedById.get(baselineId)!;

    if (rawInput.customWeightsByMethod !== undefined) {
      if (
        !isPlainObject(rawInput.customWeightsByMethod) ||
        Object.keys(rawInput.customWeightsByMethod).length !== 1 ||
        rawInput.customWeightsByMethod[baselineId] !== 1
      ) {
        throw new RangeError(
          `customWeightsByMethod for standalone '${baselineId}' must be { '${baselineId}': 1 }`,
        );
      }
    }

    const categoryDecompositions: CategoryUncertaintyDecomposition[] = [];
    for (let k = 0; k < outcomeCount; k++) {
      categoryDecompositions.push(
        decomposeCategoryUncertainty(
          k,
          canonicalOutcomeSpace.outcomeLabels[k]!,
          [
            {
              methodId: baselineId,
              weight: 1,
              predictiveProbability: baselineOutput.outcomes[k]!,
              parametricVariance: baselineOutput.parametricVariances[k]!,
            },
          ],
          baselineOutput.parametricIntervals[k]!,
        ),
      );
    }

    const synthesizedOutcomes = validateExhaustiveDistribution(
      categoryDecompositions.map((d) => d.predictiveProbability),
      outcomeCount,
    );
    const entropyDecomposition = decomposeEnsembleEntropy(
      [baselineOutput.outcomes],
      [1],
      synthesizedOutcomes,
    );

    for (const w of baselineOutput.warnings) {
      addLimitation(`[${baselineId}] ${w}`);
    }
    addLimitation(
      'Standalone structural symmetry baseline (effectiveSampleSize = 0, effectiveIndependentMethodCount = 0): reflects partition permutation symmetry only and contains zero empirical evidence or empirical calibration.',
    );
    for (const extra of additionalLimitations) {
      addLimitation(extra);
    }

    const weightingPolicy: MethodWeightingPolicyReport = Object.freeze({
      policyId: 'structural-baseline-standalone-unit-weight',
      epistemologicalTag: 'HDO',
      rationale:
        'No executable evidence-driven method is applicable; the verified structural-uniform-baseline provides a standalone non-evidential maximum-entropy reference distribution (w = 1, effectiveSampleSize = 0).',
      evidenceConnectedComponentCount: 0,
      componentAllocations: Object.freeze([]),
    });

    const independenceSemantics: EffectiveIndependenceAssessment = Object.freeze({
      executedMethodCount: 1,
      ensembleContributingMethodCount: 1,
      referenceOnlyMethodCount: 0,
      declaredEvidenceComponentCount: 0,
      statisticalIndependenceVerified: false,
      effectiveIndependentMethodCount: 0,
      explanation:
        'Structural symmetry baseline carries zero empirical evidence (effectiveSampleSize = 0) and is assigned effectiveIndependentMethodCount = 0 so it is never mistaken for an empirical forecast.',
    });

    const contrastReport: MultiMethodContrastReport = Object.freeze({
      executedMethodIds: Object.freeze([baselineId]),
      ensembleContributingMethodIds: Object.freeze([baselineId]),
      referenceOnlyMethodIds: Object.freeze([]),
      referenceOnlyMethodOutputs: Object.freeze([]),
      unexecutedApplicableMethods: Object.freeze(unexecutedApplicableMethods),
      deferredMethods: Object.freeze(deferredMethods),
      discardedMethods: Object.freeze(discardedMethods),
      weightsByMethod: Object.freeze({ [baselineId]: 1 }),
      weightingPolicy,
      dependenceDiagnostics: plan.dependenceDiagnostics,
      statisticalIndependenceVerified: false,
      effectiveIndependentMethodCount: 0,
      independenceSemantics,
      entropyDecomposition,
      categoryDecompositions: Object.freeze(categoryDecompositions),
    });

    const structuralOutput: ForecastDistributionOutput = {
      questionCategory,
      outcomeSpace: canonicalOutcomeSpace,
      footingTier,
      calibrationStatus,
      outcomes: synthesizedOutcomes,
      contrastReport,
      epistemologicalClaims: baselineOutput.epistemologicalClaims,
      methodologicalLimitations: Object.freeze([...limitationsSet]),
    };

    return deepFreeze(validateForecastDistributionContract(structuralOutput));
  }

  /* -----------------------------------------------------------------------
     PATH C: Evidence-Driven Multi-Method (or Single-Method) Synthesis
     ----------------------------------------------------------------------- */
  if (requestedFootingTier === undefined) {
    throw new RangeError(
      `ForecastSynthesisInput.footingTier is required when evidence-driven methods participate; must be explicitly set to one of [${EVIDENCE_DRIVEN_FOOTING_TIERS.join(', ')}]`,
    );
  }
  if (!EVIDENCE_DRIVEN_FOOTING_TIERS.includes(requestedFootingTier)) {
    throw new RangeError(
      `Evidence-driven synthesis requires an evidence-driven footingTier in [${EVIDENCE_DRIVEN_FOOTING_TIERS.join(', ')}], received '${requestedFootingTier}'`,
    );
  }
  if (rawInput.abstentionReason !== undefined) {
    throw new RangeError(
      'abstentionReason must not be provided when evidence-driven methods produce a forecast',
    );
  }

  assertCalibrationHonesty(requestedFootingTier, calibrationStatus);

  // Separate reference-only structural baseline from participating evidence-driven methods:
  const referenceOnlyMethodIds = Object.freeze([
    ...eligibleStructuralBaselineIds,
  ]);
  const referenceOnlyMethodOutputs = Object.freeze(
    eligibleStructuralBaselineIds.map((id) => suppliedById.get(id)!),
  );

  // Compute two-level dependence-aware weights over eligibleEvidenceMethodIds:
  const { weightsByMethod, orderedWeights, weightingPolicy } =
    computeDependenceAwareMethodWeights(
      plan,
      eligibleEvidenceMethodIds,
      rawInput.customWeightsByMethod as
        | Readonly<Record<string, number>>
        | undefined,
    );

  // Determine honest effectiveIndependentMethodCount & validate declared certification:
  // In Stage 2A-2.3 no trusted runtime verification authority exists to authenticate
  // external certification references, so statisticalIndependenceVerified is strictly
  // false and effectiveIndependentMethodCount is strictly 1 for evidence-driven forecasts.
  if (rawInput.statisticalIndependenceVerified === true) {
    throw new RangeError(
      "statisticalIndependenceVerified cannot be true in Stage 2A-2.3: no trusted verification mechanism exists to authenticate external independence references; certifications are preserved as 'declared' with statisticalIndependenceVerified = false and effectiveIndependentMethodCount = 1",
    );
  }
  if (rawInput.verifiedIndependentMethodCount !== undefined) {
    throw new RangeError(
      'verifiedIndependentMethodCount cannot be supplied in Stage 2A-2.3: no trusted verification mechanism exists to promote declared certifications or increase effectiveIndependentMethodCount above 1',
    );
  }

  const statisticalIndependenceVerified = false;
  const effectiveIndependentMethodCount = 1;
  let validatedIndependenceCertification:
    | StatisticalIndependenceCertification
    | undefined;

  if (rawInput.independenceCertification !== undefined) {
    const correlatedMethodSets: Array<readonly ScientificMethodId[]> = [];
    for (const comp of plan.dependenceDiagnostics.connectedComponents) {
      correlatedMethodSets.push(comp.applicableMethodIds);
    }
    if (plan.dependenceDiagnostics.binaryBetaDirichletEquivalence !== undefined) {
      correlatedMethodSets.push([
        'beta-binomial-conjugate',
        'dirichlet-multinomial-symmetry',
      ]);
    }
    for (const comp of weightingPolicy.componentAllocations) {
      correlatedMethodSets.push(comp.memberMethodIds);
    }

    validatedIndependenceCertification =
      validateStatisticalIndependenceCertification(
        rawInput.independenceCertification,
        {
          expectedParticipatingMethodIds: eligibleEvidenceMethodIds,
          correlatedMethodSets,
          maxIndependentComponents:
            weightingPolicy.evidenceConnectedComponentCount,
        },
      );
  }

  const participatingOutputs = eligibleEvidenceMethodIds.map(
    (id) => suppliedById.get(id)!,
  );
  const isSingleEvidenceMethod = participatingOutputs.length === 1;

  // Synthesize per-category distributions and orthogonal variance decompositions:
  const categoryDecompositions: CategoryUncertaintyDecomposition[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    const contributions: MethodCategoryContribution[] = [];
    for (let m = 0; m < participatingOutputs.length; m++) {
      const mOut = participatingOutputs[m]!;
      contributions.push({
        methodId: mOut.methodId,
        weight: orderedWeights[m]!,
        predictiveProbability: mOut.outcomes[k]!,
        parametricVariance: mOut.parametricVariances[k]!,
      });
    }

    // Parametric interval policy (Section 6):
    //   - Single-method forecast (M = 1): preserve the method's original validated interval.
    //   - Multi-method mixture (M >= 2): never average lower/upper interval endpoints;
    //     explicitly omit with 'multi-method-mixture-interval-not-available'.
    const parametricInterval: ParametricIntervalField = isSingleEvidenceMethod
      ? participatingOutputs[0]!.parametricIntervals[k]!
      : {
          kind: 'omitted',
          reason: 'multi-method-mixture-interval-not-available',
          explanation: `Combined parametric credible interval is omitted for multi-method linear pool (${participatingOutputs.length} participating methods: [${eligibleEvidenceMethodIds.join(', ')}]); averaging marginal credible-interval endpoints across distinct models does not form a valid mixture posterior quantile interval.`,
        };

    categoryDecompositions.push(
      decomposeCategoryUncertainty(
        k,
        canonicalOutcomeSpace.outcomeLabels[k]!,
        contributions,
        parametricInterval,
      ),
    );
  }

  const synthesizedOutcomes: readonly DualChannelProbability[] =
    validateExhaustiveDistribution(
      categoryDecompositions.map((d) => d.predictiveProbability),
      outcomeCount,
    );

  const methodDistributions = participatingOutputs.map((o) => o.outcomes);
  const entropyDecomposition = decomposeEnsembleEntropy(
    methodDistributions,
    orderedWeights,
    synthesizedOutcomes,
  );

  // Collect epistemological claims from participating methods + synthesis claims:
  const epistemologicalClaims: EpistemologicalClaimDescriptor[] = [
    Object.freeze({
      kind: 'exact-mathematical-identity',
      tag: 'IME',
      statement: `Linear probability pool p_bar(k) = sum_m w_m * p_m(k), three-way orthogonal Bernoulli variance decomposition p_bar(k)*(1 - p_bar(k)) = sigma^2_aleatoric(k) + sigma^2_within(k) + sigma^2_between(k), and Shannon entropy decomposition H(p_bar) = H_within + JSD_w hold identically across all ${outcomeCount} exhaustive categories.`,
    }),
    Object.freeze({
      kind: 'controlled-numerical-approximation',
      tag: 'ANC',
      statement:
        'Dual-channel log-probability and log-complement mixture aggregation uses logSumExp and tail-safe log1mexp in IEEE 754 binary64 without subtracting rounded linear probabilities from 1.',
      errorBound:
        'Closure residuals |totalBernoulliVariance - (aleatoric + within + between)| <= 1e-12 and |H(p_bar) - (H_within + JSD_w)| <= 1e-12.',
    }),
  ];

  if (!isSingleEvidenceMethod) {
    epistemologicalClaims.push(
      Object.freeze({
        kind: 'operational-design-heuristic',
        tag: 'HDO',
        statement: weightingPolicy.rationale,
        validityCondition:
          'Operational model-combination prior prior to out-of-sample walk-forward stacking validation; does not establish statistical independence across components.',
      }),
    );
  }

  // Append deduplicated epistemological claims from participating evidence-driven methods:
  const seenClaimKey = new Set<string>(
    epistemologicalClaims.map((c) => `${c.tag}:${c.statement}`),
  );
  for (const mOut of participatingOutputs) {
    for (const c of mOut.epistemologicalClaims) {
      const taggedStatement = `[${mOut.methodId}] ${c.statement}`;
      const key = `${c.tag}:${taggedStatement}`;
      if (!seenClaimKey.has(key)) {
        seenClaimKey.add(key);
        epistemologicalClaims.push(
          Object.freeze({
            kind: c.kind,
            tag: c.tag,
            statement: taggedStatement,
            ...(c.validityCondition !== undefined
              ? { validityCondition: c.validityCondition }
              : {}),
            ...(c.errorBound !== undefined ? { errorBound: c.errorBound } : {}),
          }),
        );
      }
    }
    for (const w of mOut.warnings) {
      addLimitation(`[${mOut.methodId}] ${w}`);
    }
  }

  if (referenceOnlyMethodIds.length > 0) {
    addLimitation(
      `Structural baseline separation: [${referenceOnlyMethodIds.join(', ')}] was executed as a non-evidential reference benchmark only (weight = 0 in the evidence-driven linear pool) and does not contribute to ensemble probabilities, uncertainty decompositions, or effectiveIndependentMethodCount.`,
    );
  }

  if (!isSingleEvidenceMethod) {
    if (!statisticalIndependenceVerified) {
      addLimitation(
        `Independence caveat: ${participatingOutputs.length} evidence-driven methods across ${weightingPolicy.evidenceConnectedComponentCount} declared dependence component(s) were combined via linear pooling [HDO], but cross-method statistical independence is not established (effectiveIndependentMethodCount = ${effectiveIndependentMethodCount}). Between-method disagreement (JSD_w = ${entropyDecomposition.jensenShannonDivergenceNats.toExponential(4)} nats) reflects structural model divergence, not independent empirical corroboration.`,
      );
    }
    addLimitation(
      'Parametric intervals are omitted for the multi-method mixture because averaging marginal credible-interval endpoints across distinct models is mathematically invalid.',
    );
  }

  if (calibrationStatus !== 'empirically-verified-out-of-sample') {
    addLimitation(
      `Calibration status is '${calibrationStatus}': synthesized probabilities represent model-conditional and operational-prior [HDO] outputs and are NOT empirically calibrated out-of-sample.`,
    );
  }

  if (validatedIndependenceCertification !== undefined) {
    addLimitation(
      `Declared independence certification ('${validatedIndependenceCertification.certificationId}', declared status: '${validatedIndependenceCertification.verificationStatus}', ${validatedIndependenceCertification.certifiedIndependentGroups.length} declared independent groups) was structurally validated and recorded with tier = 'declared'. Because no trusted runtime certification-verification mechanism exists in Stage 2A-2.3 to authenticate external evidence references, statisticalIndependenceVerified remains false and effectiveIndependentMethodCount remains 1.`,
    );
  }

  for (const extra of additionalLimitations) {
    addLimitation(extra);
  }

  const independenceSemantics: EffectiveIndependenceAssessment = Object.freeze({
    executedMethodCount: executedMethodIds.length,
    ensembleContributingMethodCount: eligibleEvidenceMethodIds.length,
    referenceOnlyMethodCount: referenceOnlyMethodIds.length,
    declaredEvidenceComponentCount:
      weightingPolicy.evidenceConnectedComponentCount,
    ...(validatedIndependenceCertification !== undefined
      ? {
          certificationTier: 'declared' as const,
          declaredIndependentGroupCount:
            validatedIndependenceCertification.certifiedIndependentGroups
              .length,
          independenceCertification: validatedIndependenceCertification,
        }
      : {}),
    statisticalIndependenceVerified,
    effectiveIndependentMethodCount,
    explanation:
      validatedIndependenceCertification !== undefined
        ? `Independence certification '${validatedIndependenceCertification.certificationId}' (${validatedIndependenceCertification.certifiedIndependentGroups.length} declared independent group(s)) is recorded as tier 'declared' (not authenticated by a trusted runtime verification mechanism); statisticalIndependenceVerified remains false and effectiveIndependentMethodCount is conservatively fixed at 1.`
        : `Statistical independence across the ${eligibleEvidenceMethodIds.length} participating evidence-driven method(s) (${weightingPolicy.evidenceConnectedComponentCount} declared dependence component(s)) is not established; effectiveIndependentMethodCount is conservatively fixed at 1 so correlated or unverified methods are never counted as multiple independent votes.`,
  });

  const contrastReport: MultiMethodContrastReport = Object.freeze({
    executedMethodIds: Object.freeze(executedMethodIds),
    ensembleContributingMethodIds: Object.freeze(eligibleEvidenceMethodIds),
    referenceOnlyMethodIds,
    referenceOnlyMethodOutputs,
    unexecutedApplicableMethods: Object.freeze(unexecutedApplicableMethods),
    deferredMethods: Object.freeze(deferredMethods),
    discardedMethods: Object.freeze(discardedMethods),
    weightsByMethod,
    weightingPolicy,
    dependenceDiagnostics: plan.dependenceDiagnostics,
    statisticalIndependenceVerified,
    ...(validatedIndependenceCertification !== undefined
      ? { independenceCertification: validatedIndependenceCertification }
      : {}),
    effectiveIndependentMethodCount,
    independenceSemantics,
    entropyDecomposition,
    categoryDecompositions: Object.freeze(categoryDecompositions),
  });

  const output: ForecastDistributionOutput = {
    questionCategory,
    outcomeSpace: canonicalOutcomeSpace,
    footingTier: requestedFootingTier,
    calibrationStatus,
    outcomes: synthesizedOutcomes,
    contrastReport,
    epistemologicalClaims: Object.freeze(epistemologicalClaims),
    methodologicalLimitations: Object.freeze([...limitationsSet]),
  };

  return deepFreeze(validateForecastDistributionContract(output));
}
