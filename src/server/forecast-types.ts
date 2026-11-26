/**
 * THE ORACLE — Consolidated Mathematical & Probabilistic Forecast Contracts (Stage 2A-1)
 *
 * Defines the immutable type system, epistemological claim classifications,
 * IEEE 754 `binary64` dual-channel probability representations, orthogonal
 * uncertainty decompositions (aleatoric vs. within-method parametric vs.
 * between-method structural disagreement), and calibration honesty invariants
 * specified in Consolidated Mathematical Specification v4.4.3.
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
 */

import type { IsoDateTime, PredictionCategory } from '../data/types.ts';

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

export type CalibrationVerificationStatus =
  | 'unverified-no-out-of-sample-evaluation'
  | 'insufficient-resolved-history'
  | 'out-of-sample-evaluatable-not-calibrated'
  | 'empirically-verified-out-of-sample';

export type AbstentionReason =
  | 'no-defensible-theoretical-or-empirical-basis'
  | 'undefined-or-ambiguous-outcome-space'
  | 'incompatible-method-outcome-spaces'
  | 'unverifiable-or-corrupted-input-data'
  | 'numerical-representation-or-convergence-failure';

/**
 * Enforces the fundamental epistemological invariant that probabilities cannot
 * be declared empirically calibrated before passing out-of-sample evaluation.
 */
export function isCalibrationFootingCoherent(
  footingTier: EvidentialFootingTier,
  calibrationStatus: CalibrationVerificationStatus,
): boolean {
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
      `Calibration honesty violation: footing tier '${footingTier}' cannot be declared when calibrationStatus is '${calibrationStatus}'. Out-of-sample verification is required.`,
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
  | 'method-produces-point-estimate-only';

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
 *
 * where:
 *   - `aleatoricVariance` = sum_m w_m * (p_{m,k}*(1 - p_{m,k}) - sigma^2_{param,m,k}) >= 0
 *   - `withinMethodParametricVariance` = sum_m w_m * sigma^2_{param,m,k} >= 0
 *   - `betweenMethodDisagreementVariance` = sum_m w_m * (p_{m,k} - p_bar_k)^2 >= 0
 *   - `totalEpistemicParametricVariance` = withinMethodParametricVariance + betweenMethodDisagreementVariance
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

export interface MultiMethodContrastReport {
  readonly executedMethodIds: readonly ScientificMethodId[];
  readonly discardedMethods: readonly MethodApplicabilityResult[];
  readonly weightsByMethod: Readonly<Record<string, number>>;
  readonly effectiveIndependentMethodCount: number;
  readonly entropyDecomposition: EntropyDecomposition;
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
 * Optional iteration budget override for iterative special-function evaluations.
 * Enables deterministic testing of non-convergence failure paths without
 * weakening production convergence thresholds.
 */
export interface NumericEvaluationOptions {
  readonly maxIterations?: number;
}
