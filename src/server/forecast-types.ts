/**
 * THE ORACLE — Consolidated Mathematical & Probabilistic Forecast Contracts (Stage 2A-1)
 *
 * Defines the immutable type system, epistemological claim classifications,
 * IEEE 754 `binary64` dual-channel probability representations, orthogonal
 * uncertainty decompositions (aleatoric vs. within-method parametric vs.
 * between-method structural disagreement), calibration honesty invariants,
 * and runtime contract validators specified in Consolidated Mathematical
 * Specification v4.4.3.
 *
 * Architectural guarantees:
 *   1. Epistemological honesty: every mathematical formula, statistical model,
 *      numerical approximation, or operational rule is explicitly classified by
 *      its epistemological status (`EpistemologicalClaimKind`).
 *   2. Calibration honesty: a forecast distribution may NEVER be labeled as
 *      `'empirically-calibrated-high-evidence'` unless it has passed verifiable
 *      out-of-sample walk-forward evaluation (`'empirically-verified-out-of-sample'`).
 *      Prior/posterior mathematical coherence or structural baselines never
 *      substitute for empirical calibration.
 *   3. IEEE 754 `binary64` dual-channel representation: every probability is
 *      accompanied by its log-probability `logProbability = ln(p)` and its
 *      complementary log-probability `logComplementProbability = ln(1 - p)` so
 *      that upper-tail events (`1 - p < 2^-53`) and extreme lower-tail events
 *      do not suffer catastrophic cancellation.
 *   4. Orthogonal uncertainty separation: total Bernoulli variance is partitioned
 *      without double-counting into aleatoric outcome variance, within-method
 *      parametric estimation variance, and between-method structural variance.
 *   5. Runtime contract enforcement: external or untrusted payloads are validated
 *      at runtime for structural, temporal, representation-state, normalization,
 *      and interval coherence.
 */

import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import type { IsoDateTime, PredictionCategory } from '../data/types.ts';
import type { MethodDependenceDiagnostics } from './method-selection.ts';

/* -------------------------------------------------------------------------
   1. Epistemological Classification of Claims & Formulas
   ------------------------------------------------------------------------- */

/**
 * Short normative tag identifying the epistemological status of a mathematical,
 * statistical, or operational claim in the forecasting engine:
 *
 * - `IME`: Exact Mathematical Identity (holds without approximation).
 * - `EBM`: Exact Under the Explicit Statistical Model (exact given stated assumptions).
 * - `ANC`: Controlled Numerical Approximation (bounded truncation/rounding error in `binary64`).
 * - `AA`:  Asymptotic Approximation (valid only under explicit sample-size / moment gates).
 * - `HDO`: Operational Design Heuristic (conservative engineering rule, not a theorem).
 * - `HEN`: Unverified Empirical Hypothesis (requires walk-forward validation before adoption).
 */
export type EpistemologicalClaimTag = 'IME' | 'EBM' | 'ANC' | 'AA' | 'HDO' | 'HEN';

export type EpistemologicalClaimKind =
  | 'exact-mathematical-identity'
  | 'exact-under-explicit-model'
  | 'controlled-numerical-approximation'
  | 'asymptotic-approximation'
  | 'operational-design-heuristic'
  | 'unverified-empirical-hypothesis';

export const EPISTEMOLOGICAL_TAG_BY_KIND: Readonly<
  Record<EpistemologicalClaimKind, EpistemologicalClaimTag>
> = Object.freeze({
  'exact-mathematical-identity': 'IME',
  'exact-under-explicit-model': 'EBM',
  'controlled-numerical-approximation': 'ANC',
  'asymptotic-approximation': 'AA',
  'operational-design-heuristic': 'HDO',
  'unverified-empirical-hypothesis': 'HEN',
});

export interface EpistemologicalClaimDescriptor {
  readonly kind: EpistemologicalClaimKind;
  readonly tag: EpistemologicalClaimTag;
  readonly statement: string;
  readonly validityCondition?: string;
  readonly errorBound?: string;
}

/* -------------------------------------------------------------------------
   2. Evidential Footing Tiers & Out-of-Sample Calibration Honesty
   ------------------------------------------------------------------------- */

/**
 * Graduated evidential footing of a forecast distribution.
 *
 * Uncertainty, small sample size, or inter-method disagreement are NOT automatic
 * grounds for abstention (`'insufficient-basis-abstain'`); instead, the engine
 * emits a complete predictive distribution annotated with its appropriate tier
 * and explicit caveats.
 *
 * Invariant: `'empirically-calibrated-high-evidence'` is strictly forbidden
 * unless `calibrationStatus === 'empirically-verified-out-of-sample'`.
 */
export type EvidentialFootingTier =
  | 'empirically-calibrated-high-evidence'
  | 'methodologically-sound-moderate-evidence'
  | 'defensible-low-confidence-exploratory'
  | 'structural-symmetry-baseline-only'
  | 'insufficient-basis-abstain';

export const EVIDENTIAL_FOOTING_TIERS: readonly EvidentialFootingTier[] = Object.freeze([
  'empirically-calibrated-high-evidence',
  'methodologically-sound-moderate-evidence',
  'defensible-low-confidence-exploratory',
  'structural-symmetry-baseline-only',
  'insufficient-basis-abstain',
]);

export type CalibrationVerificationStatus =
  | 'unverified-no-out-of-sample-evaluation'
  | 'insufficient-resolved-history'
  | 'out-of-sample-evaluatable-not-calibrated'
  | 'empirically-verified-out-of-sample';

export const CALIBRATION_VERIFICATION_STATUSES: readonly CalibrationVerificationStatus[] =
  Object.freeze([
    'unverified-no-out-of-sample-evaluation',
    'insufficient-resolved-history',
    'out-of-sample-evaluatable-not-calibrated',
    'empirically-verified-out-of-sample',
  ]);

export type AbstentionReason =
  | 'no-defensible-theoretical-or-empirical-basis'
  | 'undefined-or-ambiguous-outcome-space'
  | 'incompatible-method-outcome-spaces'
  | 'unverifiable-or-corrupted-input-data'
  | 'numerical-representation-or-convergence-failure';

export const ABSTENTION_REASONS: readonly AbstentionReason[] = Object.freeze([
  'no-defensible-theoretical-or-empirical-basis',
  'undefined-or-ambiguous-outcome-space',
  'incompatible-method-outcome-spaces',
  'unverifiable-or-corrupted-input-data',
  'numerical-representation-or-convergence-failure',
]);

/**
 * Enforces the fundamental epistemological invariant that probabilities cannot
 * be declared empirically calibrated before passing out-of-sample evaluation.
 */
export function isCalibrationFootingCoherent(
  footingTier: EvidentialFootingTier,
  calibrationStatus: CalibrationVerificationStatus,
): boolean {
  if (
    !EVIDENTIAL_FOOTING_TIERS.includes(footingTier) ||
    !CALIBRATION_VERIFICATION_STATUSES.includes(calibrationStatus)
  ) {
    return false;
  }
  if (footingTier === 'empirically-calibrated-high-evidence') {
    return calibrationStatus === 'empirically-verified-out-of-sample';
  }
  return true;
}

export function assertCalibrationHonesty(
  footingTier: EvidentialFootingTier,
  calibrationStatus: CalibrationVerificationStatus,
): void {
  if (!isCalibrationFootingCoherent(footingTier, calibrationStatus)) {
    throw new RangeError(
      `Calibration honesty violation: footing tier '${String(footingTier)}' cannot be declared when calibrationStatus is '${String(calibrationStatus)}'. Out-of-sample verification is required.`,
    );
  }
}

/* -------------------------------------------------------------------------
   3. IEEE 754 binary64 Probability Representation States & Dual-Channel Contract
   ------------------------------------------------------------------------- */

/**
 * Classification of a probability pair `(logProbability, logComplementProbability)`
 * under IEEE 754 `binary64` floating-point arithmetic:
 *
 * - `'exact-zero'`: `logProbability === -Infinity` and `logComplementProbability === 0` (`p === 0`).
 * - `'underflow-to-zero'`: `-Infinity < logProbability <= -1075 * ln(2)` (`~ -745.1332191019412`)
 *   where `Math.exp(logProbability) === 0` in `binary64` and `logComplementProbability === 0`.
 * - `'subnormal-probability'`: `-1075 * ln(2) < logProbability < -1022 * ln(2)` (`~ -708.3964185322641`),
 *   where `0 < Math.exp(logProbability) < 2^-1022` lies in the IEEE 754 subnormal range.
 * - `'interior-normal'`: `logProbability >= -1022 * ln(2)` and `logComplementProbability > -54 * ln(2)`
 *   (`~ -37.42994775023705`), where `p` is a normal float and `1 - p` does not round to `1.0`.
 * - `'saturated-to-one'`: `-Infinity < logComplementProbability <= -54 * ln(2)`, where `p = 1 - exp(logComp)`
 *   rounds to `1.0` in `binary64`, while `logComplementProbability` retains the exact log upper-tail.
 * - `'exact-one'`: `logProbability === 0` and `logComplementProbability === -Infinity` (`p === 1`).
 */
export type Binary64ProbabilityStatus =
  | 'exact-zero'
  | 'underflow-to-zero'
  | 'subnormal-probability'
  | 'interior-normal'
  | 'saturated-to-one'
  | 'exact-one';

export const BINARY64_PROBABILITY_STATUSES: readonly Binary64ProbabilityStatus[] = Object.freeze([
  'exact-zero',
  'underflow-to-zero',
  'subnormal-probability',
  'interior-normal',
  'saturated-to-one',
  'exact-one',
]);

/**
 * Dual-channel probability representation in linear and logarithmic spaces.
 *
 * Preserves both `ln(p)` and `ln(1 - p)` so that downstream scoring rules
 * (Logarithmic Score, Kullback-Leibler divergence, Jensen-Shannon divergence)
 * and tail-risk calculations never evaluate `Math.log(1 - p)` after `1 - p`
 * has lost precision near `p -> 1`.
 */
export interface DualChannelProbability {
  readonly probability: number;
  readonly complementProbability: number;
  readonly logProbability: number;
  readonly logComplementProbability: number;
  readonly status: Binary64ProbabilityStatus;
}

/**
 * Diagnostic result of validating the ULP coherence of a complementary log pair
 * `(logProbability, logComplementProbability)` representing `exp(logProb) + exp(logCompProb) = 1`.
 */
export interface ComplementaryLogCoherenceResult {
  readonly valid: boolean;
  readonly status: Binary64ProbabilityStatus | null;
  readonly ulpDistance?: number;
  readonly maxAllowedUlps?: number;
  readonly reason?: string;
}

/* -------------------------------------------------------------------------
   4. Parametric Credible Intervals & Omission Contracts
   ------------------------------------------------------------------------- */

/**
 * Explicit reason why a parametric credible interval for an underlying rate or
 * probability parameter is omitted.
 */
export type ParametricCredibleIntervalOmissionReason =
  | 'point-mass-structural-baseline'
  | 'unidentifiable-concentration-parameter'
  | 'degenerate-zero-exposure-or-sample'
  | 'method-produces-point-estimate-only'
  | 'multi-method-mixture-interval-not-available';

export const PARAMETRIC_INTERVAL_OMISSION_REASONS: readonly ParametricCredibleIntervalOmissionReason[] =
  Object.freeze([
    'point-mass-structural-baseline',
    'unidentifiable-concentration-parameter',
    'degenerate-zero-exposure-or-sample',
    'method-produces-point-estimate-only',
    'multi-method-mixture-interval-not-available',
  ]);

/**
 * Credible interval for the underlying epistemic parameter `theta_k` (e.g., the
 * binomial success parameter or Poisson transform parameter), explicitly
 * distinguished from the aleatoric single-trial outcome `Y in {0, 1}`.
 */
export interface ParametricCredibleInterval {
  readonly level: number;
  readonly lower: number;
  readonly upper: number;
  readonly median: number;
  readonly parameterName: string;
  readonly interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency';
}

export type ParametricIntervalField =
  | {
      readonly kind: 'available';
      readonly interval: ParametricCredibleInterval;
    }
  | {
      readonly kind: 'omitted';
      readonly reason: ParametricCredibleIntervalOmissionReason;
      readonly explanation: string;
    };

/* -------------------------------------------------------------------------
   5. Orthogonal Separation of Aleatoric and Parametric (Epistemic) Uncertainty
   ------------------------------------------------------------------------- */

/**
 * Per-category input from an individual scientific method `m` for orthogonal
 * uncertainty and entropy decomposition.
 */
export interface MethodCategoryContribution {
  readonly methodId: ScientificMethodId;
  readonly weight: number;
  readonly predictiveProbability: DualChannelProbability;
  /**
   * Epistemic variance `Var(p_{m,k} | D)` of the underlying probability parameter
   * within method `m`. Must satisfy `0 <= parametricVariance <= p_{m,k} * (1 - p_{m,k})`.
   */
  readonly parametricVariance: number;
}

/**
 * Exact three-way orthogonal decomposition of total Bernoulli outcome variance
 * for category `k` across a weighted ensemble of methods:
 *
 *   p_bar_k * (1 - p_bar_k) = sigma^2_{aleatoric,k} + sigma^2_{within,k} + sigma^2_{between,k}
 */
export interface CategoryUncertaintyDecomposition {
  readonly outcomeIndex: number;
  readonly outcomeLabel: string;
  readonly predictiveProbability: DualChannelProbability;
  readonly totalBernoulliVariance: number;
  readonly aleatoricVariance: number;
  readonly withinMethodParametricVariance: number;
  readonly betweenMethodDisagreementVariance: number;
  readonly totalEpistemicParametricVariance: number;
  readonly closureResidual: number;
  readonly parametricInterval: ParametricIntervalField;
}

/**
 * Exact Shannon entropy decomposition of a weighted multi-method ensemble
 * (measured in nats):
 *
 *   H(p_bar) = H_within + JSD_w
 */
export interface EntropyDecomposition {
  readonly totalPredictiveEntropyNats: number;
  readonly withinMethodExpectedEntropyNats: number;
  readonly jensenShannonDivergenceNats: number;
  readonly normalizedDisagreementIndex: number;
  readonly closureResidualNats: number;
}

/* -------------------------------------------------------------------------
   6. Scientific Method Identifiers, Outcome Space & Multi-Method Contracts
   ------------------------------------------------------------------------- */

export type CoreScientificMethodId =
  | 'beta-binomial-conjugate'
  | 'weighted-kish-effective-binomial'
  | 'poisson-gamma-hazard'
  | 'dirichlet-multinomial-symmetry'
  | 'student-t-terminal-diffusion'
  | 'first-passage-barrier-diffusion'
  | 'structural-uniform-baseline';

export type ScientificMethodId = CoreScientificMethodId | `custom:${string}`;

export type OutcomeSpaceKind =
  | 'binary'
  | 'categorical-exhaustive'
  | 'discretized-continuous-partition'
  | 'first-passage-before-horizon';

export const OUTCOME_SPACE_KINDS: readonly OutcomeSpaceKind[] = Object.freeze([
  'binary',
  'categorical-exhaustive',
  'discretized-continuous-partition',
  'first-passage-before-horizon',
]);

export interface OutcomeSpaceDescriptor {
  readonly kind: OutcomeSpaceKind;
  readonly outcomeLabels: readonly string[];
  readonly horizonStartsAt: IsoDateTime;
  readonly horizonEndsAt: IsoDateTime;
  readonly eventDefinitionHash: string;
  readonly partitionThresholds?: readonly number[];
  readonly barrierLevel?: number;
  readonly barrierDirection?: 'up-and-in' | 'down-and-in';
}

export interface MethodApplicabilityResult {
  readonly methodId: ScientificMethodId;
  readonly applicable: boolean;
  readonly rationale: string;
  readonly failedGateIds: readonly string[];
}

export interface ScientificMethodOutput {
  readonly methodId: ScientificMethodId;
  readonly methodFamily:
    | 'conjugate-discrete-frequency'
    | 'weighted-effective-sample'
    | 'continuous-time-hazard'
    | 'categorical-exchangeable-symmetry'
    | 'continuous-stochastic-diffusion'
    | 'first-passage-boundary'
    | 'structural-baseline'
    | 'custom-scientific-method';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly outcomes: readonly DualChannelProbability[];
  readonly parametricVariances: readonly number[];
  readonly parametricIntervals: readonly ParametricIntervalField[];
  readonly effectiveSampleSize: number;
  readonly epistemologicalClaims: readonly EpistemologicalClaimDescriptor[];
  readonly warnings: readonly string[];
}

export interface UnexecutedApplicableMethodReport {
  readonly methodId: ScientificMethodId;
  readonly disposition: 'applicable' | 'applicable-with-limitations';
  readonly implementationStatus: string;
  readonly reason: string;
}

export interface DependenceComponentWeightAllocation {
  readonly componentId: string;
  readonly correlationGroupIds: readonly string[];
  readonly isSingletonUnlinked: boolean;
  readonly memberMethodIds: readonly ScientificMethodId[];
  readonly componentWeight: number;
  readonly weightPerMethod: Readonly<Record<string, number>>;
}

export type MethodWeightingPolicyId =
  | 'equal-component-then-equal-within-component-hdo'
  | 'single-evidence-method-unit-weight'
  | 'structural-baseline-standalone-unit-weight'
  | 'custom-explicit-weights-hdo'
  | 'abstention-no-weights';

export interface MethodWeightingPolicyReport {
  readonly policyId: MethodWeightingPolicyId;
  readonly epistemologicalTag: 'HDO' | 'IME';
  readonly rationale: string;
  readonly evidenceConnectedComponentCount: number;
  readonly componentAllocations: readonly DependenceComponentWeightAllocation[];
}

export interface EffectiveIndependenceAssessment {
  readonly executedMethodCount: number;
  readonly ensembleContributingMethodCount: number;
  readonly referenceOnlyMethodCount: number;
  readonly declaredEvidenceComponentCount: number;
  readonly statisticalIndependenceVerified: boolean;
  readonly effectiveIndependentMethodCount: number;
  readonly explanation: string;
}

export interface MultiMethodContrastReport {
  readonly executedMethodIds: readonly ScientificMethodId[];
  readonly ensembleContributingMethodIds?: readonly ScientificMethodId[];
  readonly referenceOnlyMethodIds?: readonly ScientificMethodId[];
  readonly referenceOnlyMethodOutputs?: readonly ScientificMethodOutput[];
  readonly unexecutedApplicableMethods?: readonly UnexecutedApplicableMethodReport[];
  readonly deferredMethods?: readonly MethodApplicabilityResult[];
  readonly discardedMethods: readonly MethodApplicabilityResult[];
  readonly weightsByMethod: Readonly<Record<string, number>>;
  readonly weightingPolicy?: MethodWeightingPolicyReport;
  readonly dependenceDiagnostics?: MethodDependenceDiagnostics;
  readonly statisticalIndependenceVerified?: boolean;
  readonly effectiveIndependentMethodCount: number;
  readonly independenceSemantics?: EffectiveIndependenceAssessment;
  readonly entropyDecomposition: EntropyDecomposition | null;
  readonly categoryDecompositions: readonly CategoryUncertaintyDecomposition[];
}

export interface ForecastDistributionOutput {
  readonly questionCategory: PredictionCategory;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly footingTier: EvidentialFootingTier;
  readonly calibrationStatus: CalibrationVerificationStatus;
  readonly outcomes: readonly DualChannelProbability[];
  readonly contrastReport: MultiMethodContrastReport;
  readonly epistemologicalClaims: readonly EpistemologicalClaimDescriptor[];
  readonly methodologicalLimitations: readonly string[];
  readonly abstentionReason?: AbstentionReason;
}

/**
 * Optional iteration and error-budget overrides for iterative special-function
 * evaluations. Enables deterministic testing of non-convergence and error-budget
 * failure paths without weakening production convergence thresholds.
 */
export interface NumericEvaluationOptions {
  readonly maxIterations?: number;
  readonly relativeTolerance?: number;
  readonly absoluteTolerance?: number;
  readonly leftTailCutoff?: number;
  readonly rightTailCutoff?: number;
}

/* -------------------------------------------------------------------------
   7. Runtime Contract Validators for Outcome Space & Parametric Intervals
   ------------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates at runtime that an untrusted value is a well-formed, temporally
 * ordered, and structurally coherent `OutcomeSpaceDescriptor`.
 */
export function validateOutcomeSpaceDescriptor(value: unknown): OutcomeSpaceDescriptor {
  if (!isPlainObject(value)) {
    throw new RangeError('OutcomeSpaceDescriptor must be a non-null object');
  }

  const kind = value.kind;
  if (typeof kind !== 'string' || !OUTCOME_SPACE_KINDS.includes(kind as OutcomeSpaceKind)) {
    throw new RangeError(
      `OutcomeSpaceDescriptor.kind must be one of ${OUTCOME_SPACE_KINDS.join(', ')}, received ${String(kind)}`,
    );
  }

  const rawLabels = value.outcomeLabels;
  if (!Array.isArray(rawLabels) || rawLabels.length < 2) {
    throw new RangeError(
      'OutcomeSpaceDescriptor.outcomeLabels must be an array of at least 2 labels',
    );
  }
  if (
    (kind === 'binary' || kind === 'first-passage-before-horizon') &&
    rawLabels.length !== 2
  ) {
    throw new RangeError(
      `OutcomeSpaceDescriptor with kind '${kind}' must have exactly 2 outcomeLabels, received ${rawLabels.length}`,
    );
  }

  const seenLabels = new Set<string>();
  const normalizedLabels: string[] = [];
  for (let i = 0; i < rawLabels.length; i++) {
    const label = rawLabels[i];
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new RangeError(
        `OutcomeSpaceDescriptor.outcomeLabels[${i}] must be a non-empty string`,
      );
    }
    const trimmed = label.trim();
    if (seenLabels.has(trimmed)) {
      throw new RangeError(
        `OutcomeSpaceDescriptor.outcomeLabels contains duplicate label '${trimmed}'`,
      );
    }
    seenLabels.add(trimmed);
    normalizedLabels.push(trimmed);
  }

  const horizonStartsAt = value.horizonStartsAt;
  const horizonEndsAt = value.horizonEndsAt;
  if (typeof horizonStartsAt !== 'string' || !isValidIsoDateTime(horizonStartsAt)) {
    throw new RangeError(
      `OutcomeSpaceDescriptor.horizonStartsAt must be a valid ISO-8601 UTC timestamp, received ${String(horizonStartsAt)}`,
    );
  }
  if (typeof horizonEndsAt !== 'string' || !isValidIsoDateTime(horizonEndsAt)) {
    throw new RangeError(
      `OutcomeSpaceDescriptor.horizonEndsAt must be a valid ISO-8601 UTC timestamp, received ${String(horizonEndsAt)}`,
    );
  }
  const startMs = parseIsoDateTimeMs(horizonStartsAt);
  const endMs = parseIsoDateTimeMs(horizonEndsAt);
  if (startMs === null || endMs === null || startMs >= endMs) {
    throw new RangeError(
      `OutcomeSpaceDescriptor requires horizonStartsAt (${horizonStartsAt}) < horizonEndsAt (${horizonEndsAt})`,
    );
  }

  const eventDefinitionHash = value.eventDefinitionHash;
  if (typeof eventDefinitionHash !== 'string' || eventDefinitionHash.trim().length < 8) {
    throw new RangeError(
      'OutcomeSpaceDescriptor.eventDefinitionHash must be a non-empty string of length >= 8',
    );
  }

  let frozenThresholds: readonly number[] | undefined;
  if (kind === 'discretized-continuous-partition') {
    const rawThresholds = value.partitionThresholds;
    if (
      !Array.isArray(rawThresholds) ||
      rawThresholds.length !== normalizedLabels.length - 1
    ) {
      throw new RangeError(
        `discretized-continuous-partition requires partitionThresholds of length ${normalizedLabels.length - 1}`,
      );
    }
    const thresholds: number[] = [];
    for (let i = 0; i < rawThresholds.length; i++) {
      const t = rawThresholds[i];
      if (typeof t !== 'number' || !Number.isFinite(t)) {
        throw new RangeError(
          `partitionThresholds[${i}] must be a finite number, received ${String(t)}`,
        );
      }
      if (i > 0 && t <= thresholds[i - 1]!) {
        throw new RangeError(
          `partitionThresholds must be strictly increasing, found ${t} <= ${thresholds[i - 1]} at index ${i}`,
        );
      }
      thresholds.push(t);
    }
    frozenThresholds = Object.freeze(thresholds);
  } else if (value.partitionThresholds !== undefined) {
    throw new RangeError(
      `partitionThresholds is only valid for kind 'discretized-continuous-partition', not '${kind}'`,
    );
  }

  let barrierLevel: number | undefined;
  let barrierDirection: 'up-and-in' | 'down-and-in' | undefined;
  if (kind === 'first-passage-before-horizon') {
    if (typeof value.barrierLevel !== 'number' || !Number.isFinite(value.barrierLevel)) {
      throw new RangeError(
        'first-passage-before-horizon requires a finite numeric barrierLevel',
      );
    }
    if (value.barrierDirection !== 'up-and-in' && value.barrierDirection !== 'down-and-in') {
      throw new RangeError(
        `first-passage-before-horizon requires barrierDirection 'up-and-in' or 'down-and-in', received ${String(value.barrierDirection)}`,
      );
    }
    barrierLevel = value.barrierLevel;
    barrierDirection = value.barrierDirection;
  } else if (value.barrierLevel !== undefined || value.barrierDirection !== undefined) {
    throw new RangeError(
      `barrierLevel and barrierDirection are only valid for kind 'first-passage-before-horizon', not '${kind}'`,
    );
  }

  const validated: OutcomeSpaceDescriptor = {
    kind: kind as OutcomeSpaceKind,
    outcomeLabels: Object.freeze(normalizedLabels),
    horizonStartsAt,
    horizonEndsAt,
    eventDefinitionHash: eventDefinitionHash.trim(),
    ...(frozenThresholds !== undefined ? { partitionThresholds: frozenThresholds } : {}),
    ...(barrierLevel !== undefined ? { barrierLevel } : {}),
    ...(barrierDirection !== undefined ? { barrierDirection } : {}),
  };

  return Object.freeze(validated);
}

/**
 * Validates at runtime a `ParametricIntervalField` and checks its coherence
 * with an optional `DualChannelProbability` (including representation-state
 * compatibility at exact boundaries `0` and `1`).
 */
export function validateParametricIntervalField(
  value: unknown,
  predictiveProbability?: DualChannelProbability,
): ParametricIntervalField {
  if (!isPlainObject(value)) {
    throw new RangeError('ParametricIntervalField must be a non-null object');
  }

  if (value.kind === 'omitted') {
    const reason = value.reason;
    if (
      typeof reason !== 'string' ||
      !PARAMETRIC_INTERVAL_OMISSION_REASONS.includes(
        reason as ParametricCredibleIntervalOmissionReason,
      )
    ) {
      throw new RangeError(
        `Invalid ParametricCredibleIntervalOmissionReason: ${String(reason)}`,
      );
    }
    const explanation = value.explanation;
    if (typeof explanation !== 'string' || explanation.trim().length === 0) {
      throw new RangeError(
        'Omitted ParametricIntervalField requires a non-empty explanation string',
      );
    }
    return Object.freeze({
      kind: 'omitted',
      reason: reason as ParametricCredibleIntervalOmissionReason,
      explanation: explanation.trim(),
    });
  }

  if (value.kind === 'available') {
    const rawInterval = value.interval;
    if (!isPlainObject(rawInterval)) {
      throw new RangeError('Available ParametricIntervalField requires an interval object');
    }
    const { level, lower, upper, median, parameterName, interpretation } = rawInterval;
    if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0 || level >= 1) {
      throw new RangeError(
        `ParametricCredibleInterval.level must lie in (0, 1), received ${String(level)}`,
      );
    }
    if (
      typeof lower !== 'number' ||
      typeof upper !== 'number' ||
      typeof median !== 'number' ||
      !Number.isFinite(lower) ||
      !Number.isFinite(upper) ||
      !Number.isFinite(median) ||
      lower < 0 ||
      upper > 1 ||
      lower > median ||
      median > upper
    ) {
      throw new RangeError(
        `ParametricCredibleInterval bounds must satisfy 0 <= lower <= median <= upper <= 1, received [${String(lower)}, ${String(median)}, ${String(upper)}]`,
      );
    }
    if (typeof parameterName !== 'string' || parameterName.trim().length === 0) {
      throw new RangeError('ParametricCredibleInterval.parameterName must be a non-empty string');
    }
    if (interpretation !== 'epistemic-parameter-uncertainty-not-outcome-frequency') {
      throw new RangeError(
        `Invalid ParametricCredibleInterval.interpretation: ${String(interpretation)}`,
      );
    }

    if (predictiveProbability !== undefined) {
      // Note [IME]: For a random parameter theta in [0, 1], E[theta] = 0 iff P(theta = 0) = 1
      // and E[theta] = 1 iff P(theta = 1) = 1. However, for non-degenerate skewed posteriors
      // (such as Beta(alpha, beta) with alpha << 1 or beta << 1), the posterior mean
      // E[theta] = predictiveProbability.probability is NOT required to lie inside an
      // equal-tailed or HPD credible interval [lower, upper]; only 0 <= lower <= median <= upper <= 1
      // and lower < upper are universal mathematical invariants.
      if (predictiveProbability.status === 'exact-zero') {
        if (lower !== 0 || median !== 0 || upper !== 0) {
          throw new RangeError(
            `Incoherent parametric interval [${lower}, ${upper}] for 'exact-zero' probability: must be [0, 0]`,
          );
        }
      } else if (predictiveProbability.status === 'exact-one') {
        if (lower !== 1 || median !== 1 || upper !== 1) {
          throw new RangeError(
            `Incoherent parametric interval [${lower}, ${upper}] for 'exact-one' probability: must be [1, 1]`,
          );
        }
      } else if (lower === upper) {
        throw new RangeError(
          `Non-degenerate probability (status '${predictiveProbability.status}') cannot have a zero-width available parametric interval [${lower}, ${upper}]; use kind: 'omitted' for point-mass parameters`,
        );
      }
    }

    return Object.freeze({
      kind: 'available',
      interval: Object.freeze({
        level,
        lower,
        upper,
        median,
        parameterName: parameterName.trim(),
        interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
      }),
    });
  }

  throw new RangeError(
    `ParametricIntervalField.kind must be 'available' or 'omitted', received ${String(value.kind)}`,
  );
}
