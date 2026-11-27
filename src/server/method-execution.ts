/**
 * THE ORACLE — Stage 2A-2.2: Foundational Executable Scientific Method Adapters
 *
 * Implements pure, deterministic, IEEE 754 `binary64` dual-channel execution
 * adapters for the five foundational registered scientific forecasting methods:
 *
 *   1. `beta-binomial-conjugate`
 *   2. `weighted-kish-effective-binomial`
 *   3. `poisson-gamma-hazard`
 *   4. `dirichlet-multinomial-symmetry`
 *   5. `structural-uniform-baseline`
 *
 * The two continuous-time diffusion / barrier methods
 * (`student-t-terminal-diffusion` and `first-passage-barrier-diffusion`) remain
 * explicitly unimplemented in Stage 2A-2.2 and throw
 * `UnimplementedScientificMethodError` if invoked.
 *
 * Architectural guarantees:
 *   1. Zero I/O, zero LLM, zero randomness: pure deterministic functions of
 *      validated inputs and the Stage 2A-1 numerical primitive library.
 *   2. Strict input contracts: priors, sufficient statistics, exposure units,
 *      outcome mappings, and symmetry premises must be explicitly supplied and
 *      validated at runtime; nothing is silently invented or clamped.
 *   3. Dual-channel log-space probability construction: every outcome category
 *      carries coherent linear and logarithmic `(ln p, ln(1 - p))` channels
 *      validated via `validateExhaustiveDistribution`.
 *   4. Certified special-function domain enforcement: Beta and Gamma quantile
 *      inversions enforce the certified shape domain `[0.05, 1e4]` and propagate
 *      `NumericConvergenceError` without silent fallback approximations.
 *   5. Epistemological honesty:
 *      - `weighted-kish-effective-binomial` is explicitly classified as an
 *        operational design heuristic (`[HDO]`) quasi-posterior rather than an
 *        exact Bayesian likelihood, without claiming nominal coverage (`[HEN]`).
 *      - `structural-uniform-baseline` requires an explicit verified partition-
 *        symmetry premise, sets `effectiveSampleSize = 0` and zero parametric
 *        variance, omits intervals with `'point-mass-structural-baseline'`, and
 *        never claims empirical evidence or calibration.
 */

import {
  validateOutcomeSpaceDescriptor,
  validateParametricIntervalField,
  type DualChannelProbability,
  type EpistemologicalClaimDescriptor,
  type NumericEvaluationOptions,
  type OutcomeSpaceDescriptor,
  type ParametricIntervalField,
  type ScientificMethodId,
  type ScientificMethodOutput,
} from './forecast-types.ts';
import {
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  type MethodImplementationStatus,
  type ScientificMethodRegistry,
} from './method-registry.ts';
import {
  LN_ROUND_TO_ZERO_THRESHOLD_BINARY64,
  createDualChannelProbabilityFromLog,
  createDualChannelProbabilityFromPair,
  inverseRegularizedGammaQ,
  inverseRegularizedIncompleteBeta,
  kahanNeumaierSum,
  log1mexp,
  validateExhaustiveDistribution,
} from './numeric-primitives.ts';

export const METHOD_EXECUTION_VERSION = '2A-2.2.0' as const;

/**
 * Default equal-tailed credible interval level (95%) for parametric epistemic
 * uncertainty intervals.
 */
export const DEFAULT_CREDIBLE_INTERVAL_LEVEL = 0.95 as const;

/**
 * Certified lower bound on Beta and Gamma shape parameters for
 * `inverseRegularizedIncompleteBeta` and `inverseRegularizedGammaQ`.
 */
export const MIN_CERTIFIED_SHAPE_PARAMETER = 0.05 as const;

/**
 * Certified upper bound on Beta and Gamma shape parameters for
 * `inverseRegularizedIncompleteBeta` and `inverseRegularizedGammaQ`.
 */
export const MAX_CERTIFIED_SHAPE_PARAMETER = 1e4 as const;

export const EXECUTABLE_SCIENTIFIC_METHOD_IDS = Object.freeze([
  'beta-binomial-conjugate',
  'weighted-kish-effective-binomial',
  'poisson-gamma-hazard',
  'dirichlet-multinomial-symmetry',
  'structural-uniform-baseline',
] as const);

export type ExecutableScientificMethodId =
  (typeof EXECUTABLE_SCIENTIFIC_METHOD_IDS)[number];

export const UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS = Object.freeze([
  'student-t-terminal-diffusion',
  'first-passage-barrier-diffusion',
] as const);

export type UnimplementedScientificMethodId =
  (typeof UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS)[number];

/**
 * Explicit error thrown when attempting to execute a registered scientific
 * method specification that does not yet have an executable adapter.
 */
export class UnimplementedScientificMethodError extends RangeError {
  readonly methodId: ScientificMethodId;
  readonly implementationStatus: MethodImplementationStatus;

  constructor(
    methodId: ScientificMethodId,
    implementationStatus: MethodImplementationStatus,
  ) {
    super(
      `Scientific method '${methodId}' does not have an executable implementation in Stage 2A-2.2 (implementationStatus: '${implementationStatus}')`,
    );
    this.name = 'UnimplementedScientificMethodError';
    this.methodId = methodId;
    this.implementationStatus = implementationStatus;
  }
}

/* -------------------------------------------------------------------------
   1. Method-Specific Execution Input Contracts
   ------------------------------------------------------------------------- */

export interface BetaBinomialExecutionInput {
  readonly methodId: 'beta-binomial-conjugate';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  /**
   * Explicit 0-based index (`0` or `1`) identifying which entry in
   * `outcomeSpace.outcomeLabels` represents a binary "success" outcome.
   */
  readonly successOutcomeIndex: 0 | 1;
  readonly prior: {
    readonly alpha: number;
    readonly beta: number;
  };
  readonly observed: {
    readonly successes: number;
    readonly failures: number;
  };
  readonly credibleIntervalLevel?: number;
  readonly numericOptions?: NumericEvaluationOptions;
}

export interface WeightedKishExecutionInput {
  readonly methodId: 'weighted-kish-effective-binomial';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  /**
   * Explicit 0-based index (`0` or `1`) identifying which entry in
   * `outcomeSpace.outcomeLabels` represents a binary "success" outcome.
   */
  readonly successOutcomeIndex: 0 | 1;
  readonly prior: {
    readonly alpha: number;
    readonly beta: number;
  };
  readonly observed: {
    readonly weightedSuccessMass: number;
    readonly weightedFailureMass: number;
    readonly sumSquaredWeights: number;
    readonly observationCount: number;
  };
  readonly credibleIntervalLevel?: number;
  readonly numericOptions?: NumericEvaluationOptions;
}

export interface PoissonGammaExecutionInput {
  readonly methodId: 'poisson-gamma-hazard';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  /**
   * Explicit 0-based index (`0` or `1`) identifying which entry in
   * `outcomeSpace.outcomeLabels` represents "at least one event occurs over
   * forecast exposure H" (`N(H) >= 1`). The complementary index (`1 - eventOutcomeIndex`)
   * represents "zero events occur" (`N(H) = 0`).
   */
  readonly eventOutcomeIndex: 0 | 1;
  /**
   * Gamma(shape, rate) conjugate prior in shape-rate parameterization:
   * `f(lambda) = (rate^shape / Gamma(shape)) * lambda^(shape - 1) * exp(-rate * lambda)`.
   */
  readonly prior: {
    readonly shape: number;
    readonly rate: number;
    readonly parameterization?: 'shape-rate';
  };
  readonly observed: {
    readonly eventCount: number;
    readonly exposureDuration: number;
    readonly exposureUnit?: string;
  };
  readonly forecast: {
    readonly exposureDuration: number;
    readonly exposureUnit?: string;
  };
  /**
   * Explicit exposure time/volume unit shared by `observed.exposureDuration`
   * and `forecast.exposureDuration` (for example, `'years'`, `'days'`, or
   * `'reactor-years'`). May be supplied here and/or on `observed.exposureUnit`
   * and `forecast.exposureUnit`; all supplied unit strings must match exactly.
   */
  readonly exposureUnit?: string;
  readonly credibleIntervalLevel?: number;
  readonly numericOptions?: NumericEvaluationOptions;
}

export interface DirichletMultinomialExecutionInput {
  readonly methodId: 'dirichlet-multinomial-symmetry';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly prior: {
    readonly alpha: readonly number[];
  };
  readonly observed: {
    readonly counts: readonly number[];
  };
  readonly credibleIntervalLevel?: number;
  readonly numericOptions?: NumericEvaluationOptions;
}

export interface StructuralUniformExecutionInput {
  readonly methodId: 'structural-uniform-baseline';
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  /**
   * Explicit verification of the partition-symmetry premise required before
   * applying the maximum-entropy uniform distribution `P(category k) = 1 / K`.
   * Uniformity is NEVER applied merely because empirical evidence is missing.
   */
  readonly symmetryPremise: {
    readonly partitionSymmetryVerified: boolean;
    readonly exhaustiveMutuallyExclusiveVerified?: boolean;
    readonly symmetryRationale: string;
  };
}

export interface UnimplementedMethodExecutionInput {
  readonly methodId: UnimplementedScientificMethodId | `custom:${string}`;
  readonly outcomeSpace?: OutcomeSpaceDescriptor;
  readonly [key: string]: unknown;
}

export type ScientificMethodExecutionInput =
  | BetaBinomialExecutionInput
  | WeightedKishExecutionInput
  | PoissonGammaExecutionInput
  | DirichletMultinomialExecutionInput
  | StructuralUniformExecutionInput
  | UnimplementedMethodExecutionInput;

/* -------------------------------------------------------------------------
   2. Internal Validation, Deep-Freeze & Dual-Channel Ratio Helpers
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
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new RangeError(
      `${fieldName} must be a non-empty string without leading or trailing whitespace, received ${String(value)}`,
    );
  }
  return value;
}

function validateStrictOutcomeSpace(value: unknown): OutcomeSpaceDescriptor {
  if (!isPlainObject(value)) {
    throw new RangeError('outcomeSpace must be a non-null object');
  }
  if (Array.isArray(value.outcomeLabels)) {
    for (let i = 0; i < value.outcomeLabels.length; i++) {
      assertStrictTrimmedString(
        value.outcomeLabels[i],
        `outcomeSpace.outcomeLabels[${i}]`,
      );
    }
  }
  if (typeof value.eventDefinitionHash === 'string') {
    assertStrictTrimmedString(
      value.eventDefinitionHash,
      'outcomeSpace.eventDefinitionHash',
    );
  }
  return validateOutcomeSpaceDescriptor(value);
}

function assertBinaryOutcomeIndex(value: unknown, fieldName: string): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new RangeError(
      `${fieldName} must be explicitly 0 or 1, received ${String(value)}`,
    );
  }
  return value;
}

function assertFinitePositive(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Number.isNaN(value) ||
    value <= 0
  ) {
    throw new RangeError(
      `${fieldName} must be a finite positive number (> 0), received ${String(value)}`,
    );
  }
  return value;
}

function assertFiniteNonNegative(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Number.isNaN(value) ||
    value < 0
  ) {
    throw new RangeError(
      `${fieldName} must be a finite non-negative number (>= 0), received ${String(value)}`,
    );
  }
  return value;
}

function assertNonNegativeSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${fieldName} must be a non-negative safe integer, received ${String(value)}`,
    );
  }
  return value;
}

function assertPositiveSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `${fieldName} must be a positive safe integer (>= 1), received ${String(value)}`,
    );
  }
  return value;
}

function assertCertifiedShapeParameter(value: unknown, fieldName: string): number {
  const num = assertFinitePositive(value, fieldName);
  if (num < MIN_CERTIFIED_SHAPE_PARAMETER || num > MAX_CERTIFIED_SHAPE_PARAMETER) {
    throw new RangeError(
      `${fieldName} must lie within certified numerical domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}], received ${num}`,
    );
  }
  return num;
}

function validateCredibleIntervalLevel(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_CREDIBLE_INTERVAL_LEVEL;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Number.isNaN(value) ||
    value <= 0 ||
    value >= 1
  ) {
    throw new RangeError(
      `credibleIntervalLevel must be a finite number strictly in (0, 1), received ${String(value)}`,
    );
  }
  return value;
}

function validateNumericOptions(
  value: unknown,
): NumericEvaluationOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new RangeError('numericOptions must be a plain object when provided');
  }
  if (
    value.maxIterations !== undefined &&
    (typeof value.maxIterations !== 'number' ||
      !Number.isSafeInteger(value.maxIterations) ||
      value.maxIterations < 1)
  ) {
    throw new RangeError(
      `numericOptions.maxIterations must be a positive integer >= 1, received ${String(value.maxIterations)}`,
    );
  }
  return value as NumericEvaluationOptions;
}

function safeComplementaryLogFromSmallLog(smallLog: number): number {
  const raw = log1mexp(smallLog);
  if (
    raw === 0 &&
    smallLog > LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 &&
    Math.exp(smallLog) > 0
  ) {
    return -Number.MIN_VALUE;
  }
  return raw === 0 ? 0 : raw;
}

/**
 * Constructs a `DualChannelProbability` for `p = part / (part + complementPart)`
 * and `1 - p = complementPart / (part + complementPart)` where `part > 0` and
 * `complementPart > 0` using cancellation-free log-ratio arithmetic [IME / ANC].
 *
 * By always evaluating the smaller of the two ratios `r = min / max <= 1` via
 * `smallLog = Math.log(r) - Math.log1p(r)` and deriving `largeLog` via
 * `log1mexp(smallLog)`, both channels preserve full 53-bit accuracy and
 * 0-ULP complementary coherence across the entire IEEE 754 `binary64` range.
 */
function createDualChannelFromPositiveRatioParts(
  part: number,
  complementPart: number,
): DualChannelProbability {
  if (part === complementPart) {
    const negLn2 = -Math.LN2;
    return createDualChannelProbabilityFromPair(negLn2, negLn2);
  }
  if (part < complementPart) {
    const r = part / complementPart;
    const logProb = Math.log(r) - Math.log1p(r);
    const logCompProb = safeComplementaryLogFromSmallLog(logProb);
    return createDualChannelProbabilityFromPair(logProb, logCompProb);
  }
  const r = complementPart / part;
  const logCompProb = Math.log(r) - Math.log1p(r);
  const logProb = safeComplementaryLogFromSmallLog(logCompProb);
  return createDualChannelProbabilityFromPair(logProb, logCompProb);
}

function buildBetaEqualTailedInterval(
  alpha: number,
  beta: number,
  level: number,
  parameterName: string,
  predictiveProbability: DualChannelProbability,
  numericOptions?: NumericEvaluationOptions,
): ParametricIntervalField {
  const alphaTail = 0.5 * (1 - level);
  const lower = inverseRegularizedIncompleteBeta(
    alphaTail,
    alpha,
    beta,
    numericOptions,
  );
  const median = inverseRegularizedIncompleteBeta(0.5, alpha, beta, numericOptions);
  const upper = inverseRegularizedIncompleteBeta(
    1 - alphaTail,
    alpha,
    beta,
    numericOptions,
  );

  return validateParametricIntervalField(
    {
      kind: 'available',
      interval: {
        level,
        lower,
        median,
        upper,
        parameterName,
        interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
      },
    },
    predictiveProbability,
  );
}

/* -------------------------------------------------------------------------
   3. Method A — Beta-Binomial Conjugate Reference Updater
   ------------------------------------------------------------------------- */

/**
 * Executes the exact Beta-Binomial conjugate model (`beta-binomial-conjugate`):
 *
 *   - `alphaPosterior = alpha + successes`
 *   - `betaPosterior  = beta + failures`
 *   - `P(success next) = alphaPosterior / (alphaPosterior + betaPosterior)`
 *   - `Var(theta | D)  = (alphaPosterior * betaPosterior) / ((alphaPosterior + betaPosterior)^2 * (alphaPosterior + betaPosterior + 1))`
 */
export function executeBetaBinomialConjugate(
  rawInput: unknown,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'BetaBinomialExecutionInput must be a non-null object',
    );
  }
  if (rawInput.methodId !== 'beta-binomial-conjugate') {
    throw new RangeError(
      `executeBetaBinomialConjugate requires methodId 'beta-binomial-conjugate', received '${String(rawInput.methodId)}'`,
    );
  }

  const outcomeSpace = validateStrictOutcomeSpace(rawInput.outcomeSpace);
  if (
    outcomeSpace.kind !== 'binary' ||
    outcomeSpace.outcomeLabels.length !== 2
  ) {
    throw new RangeError(
      `beta-binomial-conjugate requires a binary outcomeSpace with exactly 2 outcomes, received kind '${outcomeSpace.kind}' with ${outcomeSpace.outcomeLabels.length} outcomes`,
    );
  }

  const successOutcomeIndex = assertBinaryOutcomeIndex(
    rawInput.successOutcomeIndex,
    'successOutcomeIndex',
  );
  const failureOutcomeIndex: 0 | 1 = successOutcomeIndex === 0 ? 1 : 0;

  if (!isPlainObject(rawInput.prior)) {
    throw new RangeError('prior must be a non-null object with alpha and beta');
  }
  const priorAlpha = assertCertifiedShapeParameter(
    rawInput.prior.alpha,
    'prior.alpha',
  );
  const priorBeta = assertCertifiedShapeParameter(
    rawInput.prior.beta,
    'prior.beta',
  );

  if (!isPlainObject(rawInput.observed)) {
    throw new RangeError(
      'observed must be a non-null object with successes and failures',
    );
  }
  const successes = assertNonNegativeSafeInteger(
    rawInput.observed.successes,
    'observed.successes',
  );
  const failures = assertNonNegativeSafeInteger(
    rawInput.observed.failures,
    'observed.failures',
  );

  const level = validateCredibleIntervalLevel(rawInput.credibleIntervalLevel);
  const numericOptions = validateNumericOptions(rawInput.numericOptions);

  const alphaPosterior = assertCertifiedShapeParameter(
    priorAlpha + successes,
    'alphaPosterior (prior.alpha + observed.successes)',
  );
  const betaPosterior = assertCertifiedShapeParameter(
    priorBeta + failures,
    'betaPosterior (prior.beta + observed.failures)',
  );

  const totalObservations = successes + failures;
  const totalPosterior = alphaPosterior + betaPosterior;

  const successProb = createDualChannelFromPositiveRatioParts(
    alphaPosterior,
    betaPosterior,
  );
  const failureProb = createDualChannelFromPositiveRatioParts(
    betaPosterior,
    alphaPosterior,
  );

  const outcomesPair: [DualChannelProbability, DualChannelProbability] =
    successOutcomeIndex === 0
      ? [successProb, failureProb]
      : [failureProb, successProb];

  const validatedOutcomes = validateExhaustiveDistribution(outcomesPair, 2);

  const posteriorVariance =
    (alphaPosterior * betaPosterior) /
    (totalPosterior * totalPosterior * (totalPosterior + 1));

  const successInterval = buildBetaEqualTailedInterval(
    alphaPosterior,
    betaPosterior,
    level,
    `theta_bernoulli[${outcomeSpace.outcomeLabels[successOutcomeIndex]}]`,
    validatedOutcomes[successOutcomeIndex]!,
    numericOptions,
  );
  const failureInterval = buildBetaEqualTailedInterval(
    betaPosterior,
    alphaPosterior,
    level,
    `theta_bernoulli[${outcomeSpace.outcomeLabels[failureOutcomeIndex]}]`,
    validatedOutcomes[failureOutcomeIndex]!,
    numericOptions,
  );

  const parametricIntervals: readonly ParametricIntervalField[] =
    successOutcomeIndex === 0
      ? Object.freeze([successInterval, failureInterval])
      : Object.freeze([failureInterval, successInterval]);

  const epistemologicalClaims: readonly EpistemologicalClaimDescriptor[] =
    Object.freeze([
      Object.freeze({
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement: `Conjugate Beta(${alphaPosterior}, ${betaPosterior}) posterior predictive mean alphaPosterior / (alphaPosterior + betaPosterior) and epistemic parameter variance alphaPosterior * betaPosterior / ((alphaPosterior + betaPosterior)^2 * (alphaPosterior + betaPosterior + 1)) are exact under exchangeable Bernoulli trials with Beta(${priorAlpha}, ${priorBeta}) prior.`,
        validityCondition:
          'Exchangeable binary trials and stationary latent success probability theta across reference class and forecast horizon.',
      }),
      Object.freeze({
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement: `Equal-tailed ${(level * 100).toFixed(1)}% Beta credible intervals are evaluated via inverseRegularizedIncompleteBeta with Lentz-Thompson continued fractions and safeguarded Halley refinement in binary64.`,
        errorBound: 'Relative error <= 1e-13 across certified shape domain [0.05, 1e4].',
      }),
    ]);

  const warnings: string[] = [
    'Assumes exchangeable binary reference trials and a stationary success parameter between historical evidence and target horizon.',
    'Dependence note: shares binary trial information with weighted-kish-effective-binomial and (for K = 2) dirichlet-multinomial-symmetry; do not treat their outputs as independent votes.',
  ];
  if (totalObservations === 0) {
    warnings.push(
      'Zero empirical binary trials observed (n = 0): predictive distribution reflects the Beta prior specification only.',
    );
  } else if (totalObservations < 10) {
    warnings.push(
      `Small observed sample size (n = ${totalObservations} < 10): posterior mean and credible interval width remain sensitive to Beta(${priorAlpha}, ${priorBeta}) prior hyperparameters.`,
    );
  }

  const output: ScientificMethodOutput = {
    methodId: 'beta-binomial-conjugate',
    methodFamily: 'conjugate-discrete-frequency',
    outcomeSpace,
    outcomes: validatedOutcomes,
    parametricVariances: Object.freeze([posteriorVariance, posteriorVariance]),
    parametricIntervals,
    effectiveSampleSize: totalObservations,
    epistemologicalClaims,
    warnings: Object.freeze(warnings),
  };

  return deepFreeze(output);
}

/* -------------------------------------------------------------------------
   4. Method B — Weighted-Kish Effective Binomial Quasi-Posterior Updater
   ------------------------------------------------------------------------- */

/**
 * Executes the Kish effective-sample quasi-posterior binomial model
 * (`weighted-kish-effective-binomial`):
 *
 *   - `sumWeights = weightedSuccessMass + weightedFailureMass`
 *   - `nEffective = sumWeights^2 / sumSquaredWeights`
 *   - `weightedSuccessRate = weightedSuccessMass / sumWeights`
 *   - `effectiveSuccesses = nEffective * weightedSuccessRate`
 *   - `effectiveFailures  = nEffective * (1 - weightedSuccessRate)`
 *   - `alphaPosterior = prior.alpha + effectiveSuccesses`
 *   - `betaPosterior  = prior.beta + effectiveFailures`
 *
 * Explicitly classified as an operational design heuristic (`[HDO]`) quasi-
 * posterior rather than an exact Bayesian likelihood.
 */
export function executeWeightedKishEffectiveBinomial(
  rawInput: unknown,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'WeightedKishExecutionInput must be a non-null object',
    );
  }
  if (rawInput.methodId !== 'weighted-kish-effective-binomial') {
    throw new RangeError(
      `executeWeightedKishEffectiveBinomial requires methodId 'weighted-kish-effective-binomial', received '${String(rawInput.methodId)}'`,
    );
  }

  const outcomeSpace = validateStrictOutcomeSpace(rawInput.outcomeSpace);
  if (
    outcomeSpace.kind !== 'binary' ||
    outcomeSpace.outcomeLabels.length !== 2
  ) {
    throw new RangeError(
      `weighted-kish-effective-binomial requires a binary outcomeSpace with exactly 2 outcomes, received kind '${outcomeSpace.kind}' with ${outcomeSpace.outcomeLabels.length} outcomes`,
    );
  }

  const successOutcomeIndex = assertBinaryOutcomeIndex(
    rawInput.successOutcomeIndex,
    'successOutcomeIndex',
  );
  const failureOutcomeIndex: 0 | 1 = successOutcomeIndex === 0 ? 1 : 0;

  if (!isPlainObject(rawInput.prior)) {
    throw new RangeError('prior must be a non-null object with alpha and beta');
  }
  const priorAlpha = assertCertifiedShapeParameter(
    rawInput.prior.alpha,
    'prior.alpha',
  );
  const priorBeta = assertCertifiedShapeParameter(
    rawInput.prior.beta,
    'prior.beta',
  );

  if (!isPlainObject(rawInput.observed)) {
    throw new RangeError(
      'observed must be a non-null object with weightedSuccessMass, weightedFailureMass, sumSquaredWeights, and observationCount',
    );
  }
  const weightedSuccessMass = assertFiniteNonNegative(
    rawInput.observed.weightedSuccessMass,
    'observed.weightedSuccessMass',
  );
  const weightedFailureMass = assertFiniteNonNegative(
    rawInput.observed.weightedFailureMass,
    'observed.weightedFailureMass',
  );
  const sumSquaredWeights = assertFinitePositive(
    rawInput.observed.sumSquaredWeights,
    'observed.sumSquaredWeights',
  );
  const observationCount = assertPositiveSafeInteger(
    rawInput.observed.observationCount,
    'observed.observationCount',
  );

  const sumWeights = weightedSuccessMass + weightedFailureMass;
  if (!Number.isFinite(sumWeights) || sumWeights <= 0) {
    throw new RangeError(
      `sumWeights (weightedSuccessMass + weightedFailureMass) must be finite and strictly positive (> 0), received ${sumWeights}`,
    );
  }

  const nEffective = (sumWeights * sumWeights) / sumSquaredWeights;
  if (!Number.isFinite(nEffective) || nEffective <= 0) {
    throw new RangeError(
      `Kish effective sample size nEffective = sumWeights^2 / sumSquaredWeights must be finite and strictly positive, received ${nEffective}`,
    );
  }

  // Cauchy-Schwarz bound for N non-negative weights with positive sum:
  //   1 <= (sum w_i)^2 / sum(w_i^2) <= observationCount
  // Allow a tight binary64 rounding tolerance 64 * Number.EPSILON * observationCount (~1.42e-14 * N).
  const kishBoundTolerance = 64 * Number.EPSILON * Math.max(1, observationCount);
  if (nEffective < 1 - kishBoundTolerance) {
    throw new RangeError(
      `Inconsistent weight moments: Kish effective sample size (${nEffective}) < 1 - tolerance (${1 - kishBoundTolerance}); sumSquaredWeights (${sumSquaredWeights}) cannot exceed sumWeights^2 (${sumWeights * sumWeights}) for non-negative weights`,
    );
  }
  if (nEffective > observationCount + kishBoundTolerance) {
    throw new RangeError(
      `Inconsistent weight moments: Kish effective sample size (${nEffective}) exceeds observationCount (${observationCount}) beyond binary64 tolerance (${kishBoundTolerance})`,
    );
  }

  const weightedSuccessRate = weightedSuccessMass / sumWeights;
  const effectiveSuccesses = nEffective * weightedSuccessRate;
  const effectiveFailures = nEffective * (1 - weightedSuccessRate);

  const level = validateCredibleIntervalLevel(rawInput.credibleIntervalLevel);
  const numericOptions = validateNumericOptions(rawInput.numericOptions);

  const alphaPosterior = assertCertifiedShapeParameter(
    priorAlpha + effectiveSuccesses,
    'alphaPosterior (prior.alpha + effectiveSuccesses)',
  );
  const betaPosterior = assertCertifiedShapeParameter(
    priorBeta + effectiveFailures,
    'betaPosterior (prior.beta + effectiveFailures)',
  );
  const totalPosterior = alphaPosterior + betaPosterior;

  const successProb = createDualChannelFromPositiveRatioParts(
    alphaPosterior,
    betaPosterior,
  );
  const failureProb = createDualChannelFromPositiveRatioParts(
    betaPosterior,
    alphaPosterior,
  );

  const outcomesPair: [DualChannelProbability, DualChannelProbability] =
    successOutcomeIndex === 0
      ? [successProb, failureProb]
      : [failureProb, successProb];

  const validatedOutcomes = validateExhaustiveDistribution(outcomesPair, 2);

  const quasiPosteriorVariance =
    (alphaPosterior * betaPosterior) /
    (totalPosterior * totalPosterior * (totalPosterior + 1));

  const successInterval = buildBetaEqualTailedInterval(
    alphaPosterior,
    betaPosterior,
    level,
    `theta_quasi_kish[${outcomeSpace.outcomeLabels[successOutcomeIndex]}]`,
    validatedOutcomes[successOutcomeIndex]!,
    numericOptions,
  );
  const failureInterval = buildBetaEqualTailedInterval(
    betaPosterior,
    alphaPosterior,
    level,
    `theta_quasi_kish[${outcomeSpace.outcomeLabels[failureOutcomeIndex]}]`,
    validatedOutcomes[failureOutcomeIndex]!,
    numericOptions,
  );

  const parametricIntervals: readonly ParametricIntervalField[] =
    successOutcomeIndex === 0
      ? Object.freeze([successInterval, failureInterval])
      : Object.freeze([failureInterval, successInterval]);

  const epistemologicalClaims: readonly EpistemologicalClaimDescriptor[] =
    Object.freeze([
      Object.freeze({
        kind: 'exact-mathematical-identity',
        tag: 'IME',
        statement: `Kish effective sample size nEffective = (sum w_i)^2 / sum(w_i^2) = ${nEffective.toFixed(6)} satisfies 1 <= nEffective <= N (${observationCount}) by the Cauchy-Schwarz inequality for non-negative weights.`,
      }),
      Object.freeze({
        kind: 'operational-design-heuristic',
        tag: 'HDO',
        statement:
          'Constructing fractional Beta pseudo-counts (effectiveSuccesses = nEffective * weightedSuccessRate, effectiveFailures = nEffective * (1 - weightedSuccessRate)) is an operational design heuristic [HDO] quasi-posterior, NOT an exact Bayesian likelihood.',
        validityCondition:
          'Exogenous non-negative importance or recency weights with bounded design effect.',
      }),
      Object.freeze({
        kind: 'unverified-empirical-hypothesis',
        tag: 'HEN',
        statement:
          'Quasi-posterior Beta intervals summarize design-effect-inflated epistemic dispersion only; nominal frequentist or Bayesian credible-interval coverage is NOT claimed without empirical out-of-sample validation.',
      }),
      Object.freeze({
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement: `Equal-tailed ${(level * 100).toFixed(1)}% quasi-posterior Beta quantiles are evaluated via inverseRegularizedIncompleteBeta in binary64.`,
        errorBound: 'Relative error <= 1e-13 across certified shape domain [0.05, 1e4].',
      }),
    ]);

  const warnings: string[] = [
    'Quasi-posterior design heuristic [HDO]: Kish effective-sample scaling constructs fractional Beta pseudo-counts and is NOT an exact Bayesian likelihood.',
    'Coverage caveat [HEN]: equal-tailed quasi-posterior intervals do not claim nominal credible-interval coverage without empirical out-of-sample validation.',
    'Dependence warning: this method may share the same underlying binary trial corpus as beta-binomial-conjugate and dirichlet-multinomial-symmetry; their outputs must NEVER be treated as independent votes.',
  ];
  if (nEffective < 10) {
    warnings.push(
      `Low Kish effective sample size (nEffective = ${nEffective.toFixed(3)} < 10 from N = ${observationCount} raw observations): weight concentration inflates quasi-posterior variance.`,
    );
  }

  const output: ScientificMethodOutput = {
    methodId: 'weighted-kish-effective-binomial',
    methodFamily: 'weighted-effective-sample',
    outcomeSpace,
    outcomes: validatedOutcomes,
    parametricVariances: Object.freeze([
      quasiPosteriorVariance,
      quasiPosteriorVariance,
    ]),
    parametricIntervals,
    effectiveSampleSize: nEffective,
    epistemologicalClaims,
    warnings: Object.freeze(warnings),
  };

  return deepFreeze(output);
}

/* -------------------------------------------------------------------------
   5. Method C — Poisson-Gamma Continuous-Time Hazard Forecaster
   ------------------------------------------------------------------------- */

/**
 * Executes the Poisson-Gamma continuous-time hazard model
 * (`poisson-gamma-hazard`) in **shape-rate parameterization**:
 *
 *   - `posteriorShape = priorShape + observedEventCount`
 *   - `posteriorRate  = priorRate  + observedExposure`
 *   - `L(H) = (posteriorRate / (posteriorRate + H))^posteriorShape`
 *   - `P(no event in H) = L(H)`
 *   - `P(at least one event in H) = 1 - L(H)` (evaluated in log-space via `log1mexp`)
 *   - `Var(P(event | lambda)) = L(2H) - L(H)^2`
 *   - Equal-tailed credible intervals for `P(event | lambda) = 1 - exp(-lambda * H)`
 *     obtained by transforming exact Gamma posterior quantiles via
 *     `inverseRegularizedGammaQ`.
 */
export function executePoissonGammaHazard(
  rawInput: unknown,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'PoissonGammaExecutionInput must be a non-null object',
    );
  }
  if (rawInput.methodId !== 'poisson-gamma-hazard') {
    throw new RangeError(
      `executePoissonGammaHazard requires methodId 'poisson-gamma-hazard', received '${String(rawInput.methodId)}'`,
    );
  }

  const outcomeSpace = validateStrictOutcomeSpace(rawInput.outcomeSpace);
  if (
    outcomeSpace.kind !== 'binary' ||
    outcomeSpace.outcomeLabels.length !== 2
  ) {
    throw new RangeError(
      `poisson-gamma-hazard requires a binary outcomeSpace with exactly 2 outcomes, received kind '${outcomeSpace.kind}' with ${outcomeSpace.outcomeLabels.length} outcomes`,
    );
  }

  const eventOutcomeIndex = assertBinaryOutcomeIndex(
    rawInput.eventOutcomeIndex,
    'eventOutcomeIndex',
  );
  const noEventOutcomeIndex: 0 | 1 = eventOutcomeIndex === 0 ? 1 : 0;

  if (!isPlainObject(rawInput.prior)) {
    throw new RangeError(
      'prior must be a non-null object with shape and rate (shape-rate parameterization)',
    );
  }
  if (
    rawInput.prior.parameterization !== undefined &&
    rawInput.prior.parameterization !== 'shape-rate'
  ) {
    throw new RangeError(
      `poisson-gamma-hazard requires Gamma prior in 'shape-rate' parameterization, received '${String(rawInput.prior.parameterization)}'`,
    );
  }
  if ('scale' in rawInput.prior && rawInput.prior.scale !== undefined) {
    throw new RangeError(
      'poisson-gamma-hazard forbids shape-scale parameterization (prior.scale); supply prior.shape and prior.rate explicitly',
    );
  }

  const priorShape = assertCertifiedShapeParameter(
    rawInput.prior.shape,
    'prior.shape',
  );
  const priorRate = assertFinitePositive(rawInput.prior.rate, 'prior.rate');

  if (!isPlainObject(rawInput.observed)) {
    throw new RangeError(
      'observed must be a non-null object with eventCount and exposureDuration',
    );
  }
  const observedEventCount = assertNonNegativeSafeInteger(
    rawInput.observed.eventCount,
    'observed.eventCount',
  );
  const observedExposure = assertFinitePositive(
    rawInput.observed.exposureDuration,
    'observed.exposureDuration',
  );

  if (!isPlainObject(rawInput.forecast)) {
    throw new RangeError(
      'forecast must be a non-null object with exposureDuration',
    );
  }
  const forecastExposure = assertFinitePositive(
    rawInput.forecast.exposureDuration,
    'forecast.exposureDuration',
  );

  // Enforce explicit, matching exposure units across observed and forecast durations
  // (never derive exposure units implicitly from timestamps):
  const topLevelUnit =
    rawInput.exposureUnit !== undefined
      ? assertStrictTrimmedString(rawInput.exposureUnit, 'exposureUnit')
      : undefined;
  const observedUnit =
    rawInput.observed.exposureUnit !== undefined
      ? assertStrictTrimmedString(
          rawInput.observed.exposureUnit,
          'observed.exposureUnit',
        )
      : undefined;
  const forecastUnit =
    rawInput.forecast.exposureUnit !== undefined
      ? assertStrictTrimmedString(
          rawInput.forecast.exposureUnit,
          'forecast.exposureUnit',
        )
      : undefined;

  if (
    observedUnit === undefined &&
    forecastUnit === undefined &&
    topLevelUnit === undefined
  ) {
    throw new RangeError(
      'poisson-gamma-hazard requires an explicit exposureUnit (via observed.exposureUnit + forecast.exposureUnit and/or top-level exposureUnit)',
    );
  }
  if (
    (observedUnit !== undefined) !== (forecastUnit !== undefined) &&
    topLevelUnit === undefined
  ) {
    throw new RangeError(
      'Both observed.exposureUnit and forecast.exposureUnit must be explicitly declared when top-level exposureUnit is omitted',
    );
  }
  if (
    observedUnit !== undefined &&
    forecastUnit !== undefined &&
    observedUnit !== forecastUnit
  ) {
    throw new RangeError(
      `Incompatible exposure units: observed.exposureUnit ('${observedUnit}') must match forecast.exposureUnit ('${forecastUnit}')`,
    );
  }
  const resolvedExposureUnit = (topLevelUnit ?? observedUnit ?? forecastUnit)!;
  if (
    (observedUnit !== undefined && observedUnit !== resolvedExposureUnit) ||
    (forecastUnit !== undefined && forecastUnit !== resolvedExposureUnit)
  ) {
    throw new RangeError(
      `Inconsistent exposureUnit declarations: top-level ('${String(topLevelUnit)}'), observed ('${String(observedUnit)}'), forecast ('${String(forecastUnit)}') must all match`,
    );
  }

  const level = validateCredibleIntervalLevel(rawInput.credibleIntervalLevel);
  const numericOptions = validateNumericOptions(rawInput.numericOptions);

  const posteriorShape = assertCertifiedShapeParameter(
    priorShape + observedEventCount,
    'posteriorShape (prior.shape + observed.eventCount)',
  );
  const posteriorRate = assertFinitePositive(
    priorRate + observedExposure,
    'posteriorRate (prior.rate + observed.exposureDuration)',
  );

  // Dimensionless forecast exposure ratio x = H / posteriorRate > 0:
  const exposureRatio = forecastExposure / posteriorRate;
  if (!Number.isFinite(exposureRatio) || exposureRatio <= 0) {
    throw new RangeError(
      `Dimensionless exposure ratio H / posteriorRate must be finite and positive, received ${exposureRatio}`,
    );
  }

  // ln(P(no event)) = ln(L(H)) = -posteriorShape * ln(1 + H / posteriorRate) [IME / ANC]:
  // Use Math.log1p(exposureRatio) when exposureRatio <= 1e8, or exact log ratio for huge exposureRatio.
  const logOnePlusX =
    exposureRatio <= 1e8
      ? Math.log1p(exposureRatio)
      : Math.log(exposureRatio) + Math.log1p(1 / exposureRatio);
  const logNoEventProb = -posteriorShape * logOnePlusX;
  const logEventProb = log1mexp(logNoEventProb);

  let noEventProb: DualChannelProbability;
  let eventProb: DualChannelProbability;
  if (logNoEventProb <= -Math.LN2) {
    const safeComp = safeComplementaryLogFromSmallLog(logNoEventProb);
    noEventProb = createDualChannelProbabilityFromPair(logNoEventProb, safeComp);
    eventProb = createDualChannelProbabilityFromPair(safeComp, logNoEventProb);
  } else {
    const safeComp = safeComplementaryLogFromSmallLog(logEventProb);
    eventProb = createDualChannelProbabilityFromPair(logEventProb, safeComp);
    noEventProb = createDualChannelProbabilityFromPair(safeComp, logEventProb);
  }

  const outcomesPair: [DualChannelProbability, DualChannelProbability] =
    eventOutcomeIndex === 0
      ? [eventProb, noEventProb]
      : [noEventProb, eventProb];

  const validatedOutcomes = validateExhaustiveDistribution(outcomesPair, 2);

  // Exact posterior epistemic variance of conditional event probability P(event | lambda) = 1 - exp(-lambda * H):
  //   Var(P(event | lambda) | D) = L(2H) - L(H)^2
  // Using algebraic identity (1 + x)^2 / (1 + 2x) = 1 + x^2 / (1 + 2x):
  //   2*ln(L(H)) - ln(L(2H)) = -posteriorShape * ln(1 + x^2 / (1 + 2x)) <= 0
  //   L(2H) - L(H)^2 = exp(ln(L(2H))) * (-expm1(-posteriorShape * ln(1 + x^2 / (1 + 2x))))
  // For x > 1e8, avoid 2 * x overflow and x / 2 truncation by evaluating:
  //   ln(1 + 2x) = ln(x) + ln(2) + ln(1 + 0.5 / x)
  //   x^2 / (1 + 2x) = x / (2 + 1 / x)
  const logOnePlusTwoX =
    exposureRatio <= 1e8
      ? Math.log1p(2 * exposureRatio)
      : Math.log(exposureRatio) + Math.LN2 + Math.log1p(0.5 / exposureRatio);
  const logL2H = -posteriorShape * logOnePlusTwoX;
  const ratioDiffArg =
    exposureRatio <= 1e8
      ? (exposureRatio * exposureRatio) / (1 + 2 * exposureRatio)
      : exposureRatio / (2 + 1 / exposureRatio);
  const logOnePlusRatioDiff =
    ratioDiffArg <= 1e8
      ? Math.log1p(ratioDiffArg)
      : Math.log(ratioDiffArg) + Math.log1p(1 / ratioDiffArg);
  const logRatioDiff = -posteriorShape * logOnePlusRatioDiff;
  const rawConditionalVariance =
    Math.exp(logL2H) * -Math.expm1(logRatioDiff);
  const maxBernoulliVariance =
    eventProb.probability * eventProb.complementProbability;
  const posteriorEventProbVariance = Math.min(
    maxBernoulliVariance,
    Math.max(0, rawConditionalVariance),
  );

  // Equal-tailed credible intervals via monotone transformation of Gamma(posteriorShape, 1)
  // quantiles X = posteriorRate * lambda, where lambda * H = exposureRatio * X:
  //   P(X <= x_p) = p  <=>  Q(posteriorShape, x_p) = 1 - p
  const alphaTail = 0.5 * (1 - level);
  const xLower = inverseRegularizedGammaQ(
    posteriorShape,
    1 - alphaTail,
    numericOptions,
  );
  const xMedian = inverseRegularizedGammaQ(posteriorShape, 0.5, numericOptions);
  const xUpper = inverseRegularizedGammaQ(
    posteriorShape,
    alphaTail,
    numericOptions,
  );

  // g(x) = 1 - exp(-exposureRatio * x) = -expm1(-exposureRatio * x) is strictly increasing in x:
  const eventLower = Math.min(1, Math.max(0, -Math.expm1(-exposureRatio * xLower)));
  const eventMedian = Math.min(
    1,
    Math.max(eventLower, -Math.expm1(-exposureRatio * xMedian)),
  );
  const eventUpper = Math.min(
    1,
    Math.max(eventMedian, -Math.expm1(-exposureRatio * xUpper)),
  );

  // 1 - g(x) = exp(-exposureRatio * x) is strictly decreasing in x:
  const noEventLower = Math.min(1, Math.max(0, Math.exp(-exposureRatio * xUpper)));
  const noEventMedian = Math.min(
    1,
    Math.max(noEventLower, Math.exp(-exposureRatio * xMedian)),
  );
  const noEventUpper = Math.min(
    1,
    Math.max(noEventMedian, Math.exp(-exposureRatio * xLower)),
  );

  const warnings: string[] = [
    `Continuous-time Poisson-Gamma hazard evaluated in shape-rate parameterization over forecast exposure H = ${forecastExposure} ${resolvedExposureUnit} (historical exposure T = ${observedExposure} ${resolvedExposureUnit}).`,
    'Assumes conditionally independent Poisson increments and stationary hazard intensity across observed and forecast exposure windows.',
  ];

  let eventIntervalField: ParametricIntervalField;
  let noEventIntervalField: ParametricIntervalField;

  if (
    (eventProb.status !== 'exact-zero' &&
      eventProb.status !== 'exact-one' &&
      eventLower === eventUpper) ||
    (noEventProb.status !== 'exact-zero' &&
      noEventProb.status !== 'exact-one' &&
      noEventLower === noEventUpper)
  ) {
    const saturationMsg = `Transformed Gamma(${posteriorShape}, ${posteriorRate}) hazard quantiles collapsed in binary64 at extreme exposure ratio H / posteriorRate = ${exposureRatio.toExponential(4)} (logNoEventProb = ${logNoEventProb.toExponential(4)}).`;
    warnings.push(saturationMsg);
    eventIntervalField = validateParametricIntervalField(
      {
        kind: 'omitted',
        reason: 'unidentifiable-concentration-parameter',
        explanation: saturationMsg,
      },
      validatedOutcomes[eventOutcomeIndex]!,
    );
    noEventIntervalField = validateParametricIntervalField(
      {
        kind: 'omitted',
        reason: 'unidentifiable-concentration-parameter',
        explanation: saturationMsg,
      },
      validatedOutcomes[noEventOutcomeIndex]!,
    );
  } else {
    eventIntervalField = validateParametricIntervalField(
      {
        kind: 'available',
        interval: {
          level,
          lower: eventLower,
          median: eventMedian,
          upper: eventUpper,
          parameterName: `P(N(${forecastExposure} ${resolvedExposureUnit}) >= 1 | lambda)[${outcomeSpace.outcomeLabels[eventOutcomeIndex]}]`,
          interpretation:
            'epistemic-parameter-uncertainty-not-outcome-frequency',
        },
      },
      validatedOutcomes[eventOutcomeIndex]!,
    );
    noEventIntervalField = validateParametricIntervalField(
      {
        kind: 'available',
        interval: {
          level,
          lower: noEventLower,
          median: noEventMedian,
          upper: noEventUpper,
          parameterName: `P(N(${forecastExposure} ${resolvedExposureUnit}) = 0 | lambda)[${outcomeSpace.outcomeLabels[noEventOutcomeIndex]}]`,
          interpretation:
            'epistemic-parameter-uncertainty-not-outcome-frequency',
        },
      },
      validatedOutcomes[noEventOutcomeIndex]!,
    );
  }

  const parametricIntervals: readonly ParametricIntervalField[] =
    eventOutcomeIndex === 0
      ? Object.freeze([eventIntervalField, noEventIntervalField])
      : Object.freeze([noEventIntervalField, eventIntervalField]);

  if (observedEventCount < 5) {
    warnings.push(
      `Small observed event count (k = ${observedEventCount} < 5 over ${observedExposure} ${resolvedExposureUnit}): posterior hazard rate remains sensitive to Gamma(${priorShape}, ${priorRate}) prior.`,
    );
  }
  if (forecastExposure > observedExposure) {
    warnings.push(
      `Forecast exposure duration (${forecastExposure} ${resolvedExposureUnit}) exceeds historical observed exposure (${observedExposure} ${resolvedExposureUnit}); rate uncertainty scales nonlinearly over longer horizons.`,
    );
  }

  const epistemologicalClaims: readonly EpistemologicalClaimDescriptor[] =
    Object.freeze([
      Object.freeze({
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement: `Under Gamma(${priorShape}, ${priorRate}) shape-rate prior and Poisson(${observedEventCount} events in ${observedExposure} ${resolvedExposureUnit}) likelihood, the posterior rate is Gamma(${posteriorShape}, ${posteriorRate}), the zero-event survival probability is L(H) = (posteriorRate / (posteriorRate + H))^posteriorShape, and the conditional event-probability variance is Var(P(event | lambda)) = L(2H) - L(H)^2.`,
        validityCondition:
          'Conditionally independent Poisson increments and homogeneous intensity in matching exposure units.',
      }),
      Object.freeze({
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement: `Complementary event probability 1 - L(H) is evaluated in log-space via log1mexp, and equal-tailed ${(level * 100).toFixed(1)}% credible intervals transform inverseRegularizedGammaQ quantiles via -expm1(-lambda * H).`,
        errorBound: 'Relative error <= 1e-13 across certified Gamma shape domain [0.05, 1e4].',
      }),
    ]);

  const output: ScientificMethodOutput = {
    methodId: 'poisson-gamma-hazard',
    methodFamily: 'continuous-time-hazard',
    outcomeSpace,
    outcomes: validatedOutcomes,
    parametricVariances: Object.freeze([
      posteriorEventProbVariance,
      posteriorEventProbVariance,
    ]),
    parametricIntervals,
    effectiveSampleSize: observedEventCount,
    epistemologicalClaims,
    warnings: Object.freeze(warnings),
  };

  return deepFreeze(output);
}

/* -------------------------------------------------------------------------
   6. Method D — Dirichlet-Multinomial Categorical Forecaster
   ------------------------------------------------------------------------- */

/**
 * Executes the exact Dirichlet-Multinomial conjugate categorical model
 * (`dirichlet-multinomial-symmetry`):
 *
 *   - `posteriorAlpha[k] = priorAlpha[k] + observedCount[k]`
 *   - `P(category k next) = posteriorAlpha[k] / sum(posteriorAlpha)`
 *   - Marginal posterior `theta_k | D ~ Beta(posteriorAlpha[k], sum_{j != k} posteriorAlpha[j])`
 *   - Marginal variance and equal-tailed marginal Beta credible intervals for
 *     every category `k in {0, ..., K - 1}`.
 */
export function executeDirichletMultinomialSymmetry(
  rawInput: unknown,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'DirichletMultinomialExecutionInput must be a non-null object',
    );
  }
  if (rawInput.methodId !== 'dirichlet-multinomial-symmetry') {
    throw new RangeError(
      `executeDirichletMultinomialSymmetry requires methodId 'dirichlet-multinomial-symmetry', received '${String(rawInput.methodId)}'`,
    );
  }

  const outcomeSpace = validateStrictOutcomeSpace(rawInput.outcomeSpace);
  if (
    outcomeSpace.kind !== 'binary' &&
    outcomeSpace.kind !== 'categorical-exhaustive' &&
    outcomeSpace.kind !== 'discretized-continuous-partition'
  ) {
    throw new RangeError(
      `dirichlet-multinomial-symmetry requires an exhaustive categorical outcome space ('binary', 'categorical-exhaustive', or 'discretized-continuous-partition'), received '${outcomeSpace.kind}'`,
    );
  }

  const kCount = outcomeSpace.outcomeLabels.length;
  if (kCount < 2 || kCount > 64) {
    throw new RangeError(
      `dirichlet-multinomial-symmetry supports outcome cardinality K in [2, 64], received K = ${kCount}`,
    );
  }

  if (!isPlainObject(rawInput.prior) || !Array.isArray(rawInput.prior.alpha)) {
    throw new RangeError(
      'prior.alpha must be an explicit array of positive concentration parameters',
    );
  }
  if (!isPlainObject(rawInput.observed) || !Array.isArray(rawInput.observed.counts)) {
    throw new RangeError(
      'observed.counts must be an explicit array of non-negative integer category counts',
    );
  }

  if (rawInput.prior.alpha.length !== kCount) {
    throw new RangeError(
      `prior.alpha length (${rawInput.prior.alpha.length}) must match outcomeSpace.outcomeLabels length (${kCount})`,
    );
  }
  if (rawInput.observed.counts.length !== kCount) {
    throw new RangeError(
      `observed.counts length (${rawInput.observed.counts.length}) must match outcomeSpace.outcomeLabels length (${kCount})`,
    );
  }

  const level = validateCredibleIntervalLevel(rawInput.credibleIntervalLevel);
  const numericOptions = validateNumericOptions(rawInput.numericOptions);

  const priorAlpha: number[] = [];
  const observedCounts: number[] = [];
  const posteriorAlpha: number[] = [];

  for (let k = 0; k < kCount; k++) {
    const a0 = assertCertifiedShapeParameter(
      rawInput.prior.alpha[k],
      `prior.alpha[${k}]`,
    );
    const nk = assertNonNegativeSafeInteger(
      rawInput.observed.counts[k],
      `observed.counts[${k}]`,
    );
    const aPost = assertCertifiedShapeParameter(
      a0 + nk,
      `posteriorAlpha[${k}] (prior.alpha[${k}] + observed.counts[${k}])`,
    );
    priorAlpha.push(a0);
    observedCounts.push(nk);
    posteriorAlpha.push(aPost);
  }

  // Validate complement sums sum_{j != k} posteriorAlpha[j] lie within certified Beta shape domain:
  const complementAlpha: number[] = [];
  for (let k = 0; k < kCount; k++) {
    const others: number[] = [];
    for (let j = 0; j < kCount; j++) {
      if (j !== k) {
        others.push(posteriorAlpha[j]!);
      }
    }
    const compSum = assertCertifiedShapeParameter(
      kahanNeumaierSum(others),
      `complementPosteriorAlpha[${k}] (sum_{j != ${k}} posteriorAlpha[j])`,
    );
    complementAlpha.push(compSum);
  }

  const totalObservations = kahanNeumaierSum(observedCounts);
  const rawOutcomes: DualChannelProbability[] = [];
  const parametricVariances: number[] = [];

  for (let k = 0; k < kCount; k++) {
    const ak = posteriorAlpha[k]!;
    const bk = complementAlpha[k]!;
    const totalK = ak + bk;
    rawOutcomes.push(createDualChannelFromPositiveRatioParts(ak, bk));
    parametricVariances.push(
      (ak * bk) / (totalK * totalK * (totalK + 1)),
    );
  }

  const validatedOutcomes = validateExhaustiveDistribution(rawOutcomes, kCount);

  const parametricIntervals: ParametricIntervalField[] = [];
  for (let k = 0; k < kCount; k++) {
    const ak = posteriorAlpha[k]!;
    const bk = complementAlpha[k]!;
    parametricIntervals.push(
      buildBetaEqualTailedInterval(
        ak,
        bk,
        level,
        `theta_dirichlet[${outcomeSpace.outcomeLabels[k]}]`,
        validatedOutcomes[k]!,
        numericOptions,
      ),
    );
  }

  const epistemologicalClaims: EpistemologicalClaimDescriptor[] = [
    Object.freeze({
      kind: 'exact-under-explicit-model',
      tag: 'EBM',
      statement: `Under exchangeable K-category (${kCount}-category) multinomial sampling with conjugate Dirichlet prior, marginal category parameters follow Beta(posteriorAlpha[k], sum_{j!=k} posteriorAlpha[j]) with exact predictive mean posteriorAlpha[k] / sum(posteriorAlpha).`,
      validityCondition:
        'Exchangeable multinomial trials over a mutually exclusive and collectively exhaustive K-partition.',
    }),
    Object.freeze({
      kind: 'controlled-numerical-approximation',
      tag: 'ANC',
      statement: `Marginal equal-tailed ${(level * 100).toFixed(1)}% Beta credible intervals for all ${kCount} categories are evaluated via inverseRegularizedIncompleteBeta in binary64.`,
      errorBound: 'Relative error <= 1e-13 across certified shape domain [0.05, 1e4].',
    }),
  ];

  const warnings: string[] = [
    'Dirichlet covariance structure is purely negative across categories and does not encode metric ordering across discretized bins.',
  ];
  if (kCount === 2) {
    warnings.push(
      'Binary outcome space (K = 2): the 2-category Dirichlet-Multinomial model is mathematically related to beta-binomial-conjugate (and produces an equivalent predictive distribution only when priors and binary counts match); never treat both outputs as independent votes.',
    );
  }
  if (totalObservations === 0) {
    warnings.push(
      'Zero empirical multinomial observations (n = 0): predictive distribution reflects the Dirichlet prior concentration vector only.',
    );
  } else if (totalObservations < 15) {
    warnings.push(
      `Small total sample size (n = ${totalObservations} < 15 across K = ${kCount} categories): posterior probabilities remain sensitive to prior concentration parameters.`,
    );
  }

  const output: ScientificMethodOutput = {
    methodId: 'dirichlet-multinomial-symmetry',
    methodFamily: 'categorical-exchangeable-symmetry',
    outcomeSpace,
    outcomes: validatedOutcomes,
    parametricVariances: Object.freeze(parametricVariances),
    parametricIntervals: Object.freeze(parametricIntervals),
    effectiveSampleSize: totalObservations,
    epistemologicalClaims: Object.freeze(epistemologicalClaims),
    warnings: Object.freeze(warnings),
  };

  return deepFreeze(output);
}

/* -------------------------------------------------------------------------
   7. Method E — Maximum-Entropy Structural Uniform Baseline
   ------------------------------------------------------------------------- */

/**
 * Executes the non-evidential maximum-entropy structural uniform baseline
 * (`structural-uniform-baseline`):
 *
 *   - Requires explicit verification of `symmetryPremise.partitionSymmetryVerified === true`
 *     and a non-empty `symmetryRationale`.
 *   - Assigns `P(category k) = 1 / K` across all `K` exhaustive outcomes.
 *   - Sets `effectiveSampleSize = 0` and `parametricVariances = [0, ..., 0]`.
 *   - Marks all parametric intervals as omitted with `'point-mass-structural-baseline'`.
 *   - Never claims empirical evidence or empirical calibration.
 */
export function executeStructuralUniformBaseline(
  rawInput: unknown,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'StructuralUniformExecutionInput must be a non-null object',
    );
  }
  if (rawInput.methodId !== 'structural-uniform-baseline') {
    throw new RangeError(
      `executeStructuralUniformBaseline requires methodId 'structural-uniform-baseline', received '${String(rawInput.methodId)}'`,
    );
  }

  const outcomeSpace = validateStrictOutcomeSpace(rawInput.outcomeSpace);
  if (
    outcomeSpace.kind !== 'binary' &&
    outcomeSpace.kind !== 'categorical-exhaustive'
  ) {
    throw new RangeError(
      `structural-uniform-baseline is valid only for 'binary' or 'categorical-exhaustive' outcome spaces where label permutation symmetry can hold, received '${outcomeSpace.kind}'`,
    );
  }

  const kCount = outcomeSpace.outcomeLabels.length;
  if (kCount < 2 || kCount > 64) {
    throw new RangeError(
      `structural-uniform-baseline supports outcome cardinality K in [2, 64], received K = ${kCount}`,
    );
  }

  if (!isPlainObject(rawInput.symmetryPremise)) {
    throw new RangeError(
      'structural-uniform-baseline requires an explicit symmetryPremise object; uniformity is never applied merely because empirical evidence is missing',
    );
  }
  if (rawInput.symmetryPremise.partitionSymmetryVerified !== true) {
    throw new RangeError(
      'structural-uniform-baseline requires symmetryPremise.partitionSymmetryVerified === true; uniformity cannot be applied without an explicitly verified partition-symmetry premise',
    );
  }
  if (
    rawInput.symmetryPremise.exhaustiveMutuallyExclusiveVerified !== undefined &&
    rawInput.symmetryPremise.exhaustiveMutuallyExclusiveVerified !== true
  ) {
    throw new RangeError(
      'structural-uniform-baseline requires symmetryPremise.exhaustiveMutuallyExclusiveVerified to be true when provided',
    );
  }
  const symmetryRationale = assertStrictTrimmedString(
    rawInput.symmetryPremise.symmetryRationale,
    'symmetryPremise.symmetryRationale',
  );

  // For each category k in {0, ..., K - 1}, P(category k) = 1 / K and
  // complement probability = (K - 1) / K:
  const unitOutcome =
    kCount === 2
      ? createDualChannelFromPositiveRatioParts(1, 1)
      : createDualChannelProbabilityFromLog(-Math.log(kCount));

  const rawOutcomes: DualChannelProbability[] = new Array<DualChannelProbability>(
    kCount,
  ).fill(unitOutcome);

  const validatedOutcomes = validateExhaustiveDistribution(rawOutcomes, kCount);

  const parametricVariances: number[] = new Array<number>(kCount).fill(0);
  const parametricIntervals: ParametricIntervalField[] = [];
  for (let k = 0; k < kCount; k++) {
    parametricIntervals.push(
      validateParametricIntervalField(
        {
          kind: 'omitted',
          reason: 'point-mass-structural-baseline',
          explanation: `Structural uniform baseline assigns a fixed non-evidential reference probability P(${outcomeSpace.outcomeLabels[k]}) = 1/${kCount} from the declared partition-symmetry premise (${symmetryRationale}), not from empirical parameter estimation.`,
        },
        validatedOutcomes[k]!,
      ),
    );
  }

  const epistemologicalClaims: readonly EpistemologicalClaimDescriptor[] =
    Object.freeze([
      Object.freeze({
        kind: 'exact-mathematical-identity',
        tag: 'IME',
        statement: `The uniform distribution P(category k) = 1/${kCount} uniquely maximizes Shannon entropy H(p) = ln(${kCount}) over the ${kCount}-simplex under permutation invariance of the exhaustive outcome partition.`,
        validityCondition: `Verified partition-symmetry premise: ${symmetryRationale}`,
      }),
      Object.freeze({
        kind: 'operational-design-heuristic',
        tag: 'HDO',
        statement:
          'Serves strictly as a zero-evidence structural reference baseline (effectiveSampleSize = 0); uniformity follows from the declared symmetry premise and does NOT represent empirical evidence or empirical calibration.',
      }),
    ]);

  const warnings: readonly string[] = Object.freeze([
    `Non-evidential structural baseline (effectiveSampleSize = 0): P(category k) = 1/${kCount} follows strictly from the declared partition-symmetry premise (${symmetryRationale}), NOT from observed empirical evidence or empirical calibration.`,
    'Must never be presented as an empirically calibrated forecast or combined as an independent empirical vote.',
  ]);

  const output: ScientificMethodOutput = {
    methodId: 'structural-uniform-baseline',
    methodFamily: 'structural-baseline',
    outcomeSpace,
    outcomes: validatedOutcomes,
    parametricVariances: Object.freeze(parametricVariances),
    parametricIntervals: Object.freeze(parametricIntervals),
    effectiveSampleSize: 0,
    epistemologicalClaims,
    warnings,
  };

  return deepFreeze(output);
}

/* -------------------------------------------------------------------------
   8. Deterministic Method Execution Dispatcher
   ------------------------------------------------------------------------- */

/**
 * Deterministic dispatcher that validates `rawInput`, verifies registry
 * execution readiness in `registry`, and executes the corresponding
 * Stage 2A-2.2 scientific method adapter.
 *
 * Throws `UnimplementedScientificMethodError` if called for a registered
 * specification that does not yet have an executable implementation
 * (`student-t-terminal-diffusion` or `first-passage-barrier-diffusion`),
 * or `RangeError` for unregistered or malformed inputs.
 */
export function executeScientificMethod(
  rawInput: unknown,
  registry: ScientificMethodRegistry = DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
): ScientificMethodOutput {
  if (!isPlainObject(rawInput)) {
    throw new RangeError(
      'ScientificMethodExecutionInput must be a non-null object',
    );
  }
  if (
    !registry ||
    typeof registry !== 'object' ||
    typeof registry.getOrThrow !== 'function'
  ) {
    throw new RangeError(
      'executeScientificMethod requires a valid ScientificMethodRegistry instance',
    );
  }

  const methodIdRaw = rawInput.methodId;
  if (typeof methodIdRaw !== 'string' || methodIdRaw.trim().length === 0) {
    throw new RangeError(
      `ScientificMethodExecutionInput.methodId must be a non-empty string, received ${String(methodIdRaw)}`,
    );
  }

  const descriptor = registry.getOrThrow(methodIdRaw as ScientificMethodId);
  if (
    !descriptor.hasExecutableImplementation ||
    descriptor.implementationStatus !== 'implemented-and-verified'
  ) {
    throw new UnimplementedScientificMethodError(
      descriptor.methodId,
      descriptor.implementationStatus,
    );
  }

  switch (descriptor.methodId) {
    case 'beta-binomial-conjugate':
      return executeBetaBinomialConjugate(rawInput);
    case 'weighted-kish-effective-binomial':
      return executeWeightedKishEffectiveBinomial(rawInput);
    case 'poisson-gamma-hazard':
      return executePoissonGammaHazard(rawInput);
    case 'dirichlet-multinomial-symmetry':
      return executeDirichletMultinomialSymmetry(rawInput);
    case 'structural-uniform-baseline':
      return executeStructuralUniformBaseline(rawInput);
    default:
      throw new UnimplementedScientificMethodError(
        descriptor.methodId,
        descriptor.implementationStatus,
      );
  }
}
