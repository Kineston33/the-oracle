/**
 * THE ORACLE — Verified IEEE 754 `binary64` Numeric Primitives (Stage 2A-1)
 *
 * Implements the special-function, logarithmic-space, dual-channel probability,
 * and orthogonal uncertainty/entropy decomposition primitives specified in
 * Consolidated Mathematical Specification v4.4.3.
 *
 * Zero external npm dependencies; runs natively on Node.js / V8 IEEE 754 `binary64`.
 */

import {
  ABSTENTION_REASONS,
  EPISTEMOLOGICAL_TAG_BY_KIND,
  assertCalibrationHonesty,
  validateOutcomeSpaceDescriptor,
  validateParametricIntervalField,
  validateStatisticalIndependenceCertification,
  type AbstentionReason,
  type Binary64ProbabilityStatus,
  type CalibrationVerificationStatus,
  type CategoryUncertaintyDecomposition,
  type ComplementaryLogCoherenceResult,
  type DualChannelProbability,
  type EntropyDecomposition,
  type EpistemologicalClaimKind,
  type EvidentialFootingTier,
  type ForecastDistributionOutput,
  type MethodCategoryContribution,
  type NumericEvaluationOptions,
  type ParametricIntervalField,
  type ScientificMethodId,
} from './forecast-types.ts';

export {
  assertCalibrationHonesty,
  validateOutcomeSpaceDescriptor,
  validateParametricIntervalField,
  validateStatisticalIndependenceCertification,
};

/* -------------------------------------------------------------------------
   1. IEEE 754 `binary64` Constants & Error Classes
   ------------------------------------------------------------------------- */

/** Exact natural logarithm of the smallest positive normal `binary64` float (`2^-1022`). */
export const LN_MIN_NORMAL_BINARY64 = -1022 * Math.LN2; // -708.3964185322641

/** Exact natural logarithm of `Number.MIN_VALUE` (`2^-1074`, smallest positive subnormal). */
export const LN_MIN_SUBNORMAL_BINARY64 = -1074 * Math.LN2; // -744.4400719213812

/**
 * Exact natural logarithm of `2^-1075` (`-745.1332191019412`), the ideal halfway
 * threshold at or below which `Math.exp(x)` rounds to `+0.0` under IEEE 754
 * round-to-nearest-even.
 */
export const LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 = -1075 * Math.LN2; // -745.1332191019412

/**
 * Exact natural logarithm of `2^-54` (`-37.42994775023705`), at or below which
 * `1 - exp(logCompProb)` rounds to `1.0` in `binary64` while `logCompProb`
 * retains the upper-tail probability.
 */
export const LN_SATURATED_TO_ONE_THRESHOLD_BINARY64 = -54 * Math.LN2; // -37.42994775023705

/** Machler (2012) optimal branch switch `-ln(2)` for `log1mexp(x) = ln(1 - exp(x))`. */
export const LN_SWITCH_LOG1MEXP = -Math.LN2; // -0.6931471805599453

/** Maximum supported array length for `logSumExp`. */
export const MAX_LOG_SUM_EXP_LENGTH = 100_000;

/** Certified upper bound of `a, b` for `erfcxDiffPositive` where `1e-13` relative accuracy holds. */
export const MAX_CERTIFIED_ERFCX_DIFF_ARG = 1e150;

const MIN_NORMAL_BINARY64 = 2 ** -1022;
const ULP_AT_MAX_VALUE = 2 ** 971;
const HALF_LN_2PI = 0.5 * Math.log(2 * Math.PI);
const ONE_OVER_SQRT_PI = 1 / Math.sqrt(Math.PI);
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/**
 * Explicit error thrown when an iterative special function fails to satisfy
 * its mathematical truncation or convergence bound within the allowed budget.
 * Extends `RangeError` for compatibility with standard range/domain error checks.
 */
export class NumericConvergenceError extends RangeError {
  readonly functionName: string;
  readonly iterations: number;
  readonly achievedBound: number;
  readonly targetBound: number;

  constructor(
    functionName: string,
    iterations: number,
    achievedBound: number,
    targetBound: number,
    detail?: string,
  ) {
    super(
      `${functionName} failed to converge within ${iterations} iterations (achieved bound ${achievedBound.toExponential(4)} > target ${targetBound.toExponential(4)})${detail ? `: ${detail}` : ''}`,
    );
    this.name = 'NumericConvergenceError';
    this.functionName = functionName;
    this.iterations = iterations;
    this.achievedBound = achievedBound;
    this.targetBound = targetBound;
  }
}

/* -------------------------------------------------------------------------
   2. Exact IEEE 754 `binary64` Bit-Level ULP Inspection & Compensated Sum
   ------------------------------------------------------------------------- */

const sharedBuffer = new ArrayBuffer(8);
const sharedFloat64 = new Float64Array(sharedBuffer);
const sharedUint64 = new BigUint64Array(sharedBuffer);

function float64ToUint64Bits(x: number): bigint {
  sharedFloat64[0] = x === 0 ? 0 : x;
  return sharedUint64[0]!;
}

function uint64BitsToFloat64(bits: bigint): number {
  sharedUint64[0] = bits;
  return sharedFloat64[0]!;
}

/**
 * Maps an IEEE 754 `binary64` bit pattern (sign-magnitude) to a monotonically
 * ordered unsigned 64-bit integer so that adjacent representable floats differ
 * by exactly `1n` across the entire finite range (including subnormals and zero).
 */
function float64ToOrderedIndex(x: number): bigint {
  const bits = float64ToUint64Bits(x);
  const signMask = 0x8000_0000_0000_0000n;
  if ((bits & signMask) !== 0n) {
    return signMask - (bits & 0x7fff_ffff_ffff_ffffn);
  }
  return bits + signMask;
}

/**
 * Returns the exact unit in the last place (`ulp(x)`) of a finite `binary64`
 * number `x` [IME]:
 * - For `x === 0` or subnormal `|x| < 2^-1022`, returns `Number.MIN_VALUE` (`2^-1074`).
 * - For `|x| === Number.MAX_VALUE`, returns `2^971`.
 * - For normal `|x| < Number.MAX_VALUE`, returns the exact spacing to the next
 *   representable float away from zero.
 */
export function ulpBinary64(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`ulpBinary64 requires a finite number, received ${String(x)}`);
  }
  const absX = Math.abs(x);
  if (absX < MIN_NORMAL_BINARY64) {
    return Number.MIN_VALUE;
  }
  if (absX === Number.MAX_VALUE) {
    return ULP_AT_MAX_VALUE;
  }
  const bits = float64ToUint64Bits(absX);
  const nextAbs = uint64BitsToFloat64(bits + 1n);
  return nextAbs - absX;
}

/**
 * Returns the exact integer number of IEEE 754 `binary64` representable steps
 * (ULPs) between `a` and `b` [IME].
 */
export function ulpDistanceBinary64(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new RangeError('ulpDistanceBinary64 does not accept NaN');
  }
  if (a === b) {
    return 0;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.POSITIVE_INFINITY;
  }
  const idxA = float64ToOrderedIndex(a);
  const idxB = float64ToOrderedIndex(b);
  const diff = idxA > idxB ? idxA - idxB : idxB - idxA;
  return Number(diff);
}

/**
 * Neumaier's improved Kahan compensated summation [ANC].
 * Accumulates a sequence of finite numbers while bounding rounding error
 * independently of sequence length.
 */
export function kahanNeumaierSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (let i = 0; i < values.length; i++) {
    const val = values[i]!;
    if (!Number.isFinite(val)) {
      throw new RangeError(
        `kahanNeumaierSum requires finite numbers, received ${String(val)} at index ${i}`,
      );
    }
    const next = sum + val;
    if (Math.abs(sum) >= Math.abs(val)) {
      compensation += sum - next + val;
    } else {
      compensation += val - next + sum;
    }
    sum = next;
  }
  return sum + compensation;
}

/* -------------------------------------------------------------------------
   3. Logarithmic Space Primitives & Dual-Channel Probability Classification
   ------------------------------------------------------------------------- */

/**
 * Numerically stable evaluation of `ln(sum_i exp(logValues[i]))` via maximum
 * shift, separation of the pivot element, `Math.log1p`, and Neumaier compensated
 * summation [IME / ANC].
 *
 * Contracts:
 *   - Empty array or length > 100,000: throws `RangeError`.
 *   - Any `NaN`: throws `RangeError`.
 *   - Any `+Infinity`: throws `RangeError`.
 *   - Array composed exclusively of `-Infinity`: returns `-Infinity`.
 *
 * Error guarantee across the full `binary64` range (including extreme magnitudes
 * such as `[1e308, 1e308]`):
 *   `|logSumExp(x) - ln(sum_i exp(x_i))| <= max(2.5e-15, 2 * ulp(ln(sum_i exp(x_i))))`.
 */
export function logSumExp(logValues: readonly number[]): number {
  if (
    !Array.isArray(logValues) ||
    logValues.length < 1 ||
    logValues.length > MAX_LOG_SUM_EXP_LENGTH
  ) {
    throw new RangeError(
      `logSumExp requires an array of length in [1, ${MAX_LOG_SUM_EXP_LENGTH}], received length ${Array.isArray(logValues) ? logValues.length : 'non-array'}`,
    );
  }

  let xMax = Number.NEGATIVE_INFINITY;
  let maxIndex = -1;

  for (let i = 0; i < logValues.length; i++) {
    const v = logValues[i]!;
    if (typeof v !== 'number' || Number.isNaN(v) || v === Number.POSITIVE_INFINITY) {
      throw new RangeError(
        `logSumExp requires elements in [-Infinity, +Infinity), received ${String(v)} at index ${i}`,
      );
    }
    if (v > xMax) {
      xMax = v;
      maxIndex = i;
    }
  }

  if (xMax === Number.NEGATIVE_INFINITY) {
    return Number.NEGATIVE_INFINITY;
  }

  let sumOthers = 0;
  let compensation = 0;

  for (let i = 0; i < logValues.length; i++) {
    if (i === maxIndex) {
      continue;
    }
    const x = logValues[i]!;
    if (x === Number.NEGATIVE_INFINITY) {
      continue;
    }
    const term = Math.exp(x - xMax);
    if (term === 0) {
      continue;
    }
    const next = sumOthers + term;
    if (Math.abs(sumOthers) >= Math.abs(term)) {
      compensation += sumOthers - next + term;
    } else {
      compensation += term - next + sumOthers;
    }
    sumOthers = next;
  }

  const totalOthers = Math.max(0, sumOthers + compensation);
  return xMax + Math.log1p(totalOthers);
}

/**
 * Evaluates `ln(1 - exp(x))` for `x in [-Infinity, 0]` using Machler's (2012)
 * two-branch split at `-ln(2)` [IME / ANC]:
 *   - For `x < -ln(2)`: `Math.log1p(-Math.exp(x))`, which preserves normal
 *     values down to `-708.3964185322641` and subnormal values down to
 *     `-744.4400719213812` (`-Number.MIN_VALUE = -5e-324`).
 *   - For `-ln(2) <= x < 0`: `Math.log(-Math.expm1(x))`.
 *   - For `x === 0`: returns `-Infinity`.
 *   - For `x === -Infinity`: returns `0`.
 */
export function log1mexp(x: number): number {
  if (typeof x !== 'number' || Number.isNaN(x) || x > 0) {
    throw new RangeError(`log1mexp requires x in [-Infinity, 0], received ${String(x)}`);
  }
  if (x === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (x === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (x < LN_SWITCH_LOG1MEXP) {
    const res = Math.log1p(-Math.exp(x));
    return res === 0 ? 0 : res;
  }
  const res = Math.log(-Math.expm1(x));
  return res === 0 ? 0 : res;
}

/**
 * Validates whether a pair `(logProb, logCompProb)` is a coherent IEEE 754
 * `binary64` representation of `exp(logProb) + exp(logCompProb) = 1` using an
 * exact ULP-based criterion that respects normal, subnormal, and underflow-to-zero
 * regimes [ANC].
 */
export function validateComplementaryLogPair(
  logProb: number,
  logCompProb: number,
): ComplementaryLogCoherenceResult {
  if (
    typeof logProb !== 'number' ||
    typeof logCompProb !== 'number' ||
    Number.isNaN(logProb) ||
    Number.isNaN(logCompProb) ||
    logProb > 0 ||
    logCompProb > 0
  ) {
    return {
      valid: false,
      status: null,
      reason: 'logProb and logCompProb must be numbers in [-Infinity, 0]',
    };
  }

  // Exact boundary: p = 0 (logProb = -Infinity, logCompProb = 0)
  if (logProb === Number.NEGATIVE_INFINITY) {
    if (logCompProb === 0) {
      return { valid: true, status: 'exact-zero', ulpDistance: 0, maxAllowedUlps: 0 };
    }
    return {
      valid: false,
      status: null,
      reason: `When logProb is -Infinity, logCompProb must be 0, received ${String(logCompProb)}`,
    };
  }

  // Exact boundary: p = 1 (logProb = 0, logCompProb = -Infinity)
  if (logCompProb === Number.NEGATIVE_INFINITY) {
    if (logProb === 0) {
      return { valid: true, status: 'exact-one', ulpDistance: 0, maxAllowedUlps: 0 };
    }
    return {
      valid: false,
      status: null,
      reason: `When logCompProb is -Infinity, logProb must be 0, received ${String(logProb)}`,
    };
  }

  const smallLog = Math.min(logProb, logCompProb);
  const largeLog = Math.max(logProb, logCompProb);

  // Since exp(smallLog) + exp(largeLog) = 1, max(logProb, logCompProb) >= -ln(2)
  // and min(logProb, logCompProb) <= -ln(2) (within 2 ULPs of -ln(2)).
  const ln2Ulp = ulpBinary64(LN_SWITCH_LOG1MEXP);
  if (largeLog < LN_SWITCH_LOG1MEXP - 2 * ln2Ulp || smallLog > LN_SWITCH_LOG1MEXP + 2 * ln2Ulp) {
    return {
      valid: false,
      status: null,
      reason: `Incoherent pair (${logProb}, ${logCompProb}): violates partition bound around -ln(2)`,
    };
  }

  // Regime A: smallLog <= -1075 * ln(2) (~ -745.1332191019412) where exp(smallLog) rounds to +0.0
  if (smallLog <= LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 && Math.exp(smallLog) === 0) {
    if (largeLog !== 0) {
      return {
        valid: false,
        status: null,
        reason: `In underflow-to-zero regime (smallLog=${smallLog}), complementary log must be 0, received ${largeLog}`,
      };
    }
    const status: Binary64ProbabilityStatus =
      logProb <= LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 ? 'underflow-to-zero' : 'saturated-to-one';
    return { valid: true, status, ulpDistance: 0, maxAllowedUlps: 0 };
  }

  // Above -1075 * ln(2), largeLog === 0 (or -0.0) is NEVER valid because 1 - exp(smallLog) < 1
  // and -exp(smallLog) is closer to -Number.MIN_VALUE (or a larger subnormal/normal) than to 0.
  if (largeLog === 0) {
    return {
      valid: false,
      status: null,
      reason: `Complementary log cannot be 0 when smallLog (${smallLog}) > LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 (${LN_ROUND_TO_ZERO_THRESHOLD_BINARY64})`,
    };
  }

  // Regime B: Subnormal small probability (-1075 * ln(2) < smallLog < -1022 * ln(2))
  if (smallLog < LN_MIN_NORMAL_BINARY64) {
    const rawExpected = log1mexp(smallLog);
    const expectedSubnormal = rawExpected !== 0 ? rawExpected : -Number.MIN_VALUE;
    const ulpDist = ulpDistanceBinary64(largeLog, expectedSubnormal);
    const maxAllowedUlps = 4;
    if (ulpDist > maxAllowedUlps) {
      return {
        valid: false,
        status: null,
        ulpDistance: ulpDist,
        maxAllowedUlps,
        reason: `Subnormal complementary log mismatch: distance ${ulpDist} ULPs > ${maxAllowedUlps} ULPs`,
      };
    }
    const status: Binary64ProbabilityStatus =
      logProb < LN_MIN_NORMAL_BINARY64 ? 'subnormal-probability' : 'saturated-to-one';
    return { valid: true, status, ulpDistance: ulpDist, maxAllowedUlps };
  }

  // Regime C: Normal smallLog >= -1022 * ln(2)
  const expectedLarge = log1mexp(smallLog);
  const ulpDist = ulpDistanceBinary64(largeLog, expectedLarge);
  // Condition number of log1mexp(s) with respect to s is bounded by max(1, |s|);
  // allowing up to 4 * ceil(max(1, |smallLog|)) ULPs accommodates 1-ULP input rounding in smallLog
  // while strictly rejecting any non-complementary pair.
  const maxAllowedUlps = Math.max(8, 4 * Math.ceil(Math.abs(smallLog)));
  if (ulpDist > maxAllowedUlps) {
    return {
      valid: false,
      status: null,
      ulpDistance: ulpDist,
      maxAllowedUlps,
      reason: `Complementary log mismatch: distance ${ulpDist} ULPs > allowed ${maxAllowedUlps} ULPs (expected ${expectedLarge}, received ${largeLog})`,
    };
  }

  const status: Binary64ProbabilityStatus =
    logCompProb <= LN_SATURATED_TO_ONE_THRESHOLD_BINARY64 ? 'saturated-to-one' : 'interior-normal';
  return { valid: true, status, ulpDistance: ulpDist, maxAllowedUlps };
}

/**
 * Classifies a complementary logarithmic probability pair `(logProb, logCompProb)`
 * into its IEEE 754 `binary64` representation state, or throws `RangeError` if the
 * pair violates ULP coherence.
 */
export function classifyBinary64Probability(
  logProb: number,
  logCompProb: number,
): Binary64ProbabilityStatus {
  const validation = validateComplementaryLogPair(logProb, logCompProb);
  if (!validation.valid || validation.status === null) {
    throw new RangeError(
      validation.reason ?? `Invalid complementary log pair (${String(logProb)}, ${String(logCompProb)})`,
    );
  }
  return validation.status;
}

/**
 * Constructs an immutable `DualChannelProbability` from a validated pair
 * `(logProb, logCompProb)`.
 */
export function createDualChannelProbabilityFromPair(
  logProb: number,
  logCompProb: number,
): DualChannelProbability {
  const status = classifyBinary64Probability(logProb, logCompProb);
  const normLogProb = logProb === 0 ? 0 : logProb;
  const normLogComp = logCompProb === 0 ? 0 : logCompProb;
  const probability =
    status === 'exact-zero' || status === 'underflow-to-zero'
      ? 0
      : status === 'exact-one' || status === 'saturated-to-one'
        ? 1
        : logProb >= LN_SWITCH_LOG1MEXP
          ? 1 - Math.exp(normLogComp)
          : Math.exp(normLogProb);
  const complementProbability =
    status === 'exact-one'
      ? 0
      : status === 'exact-zero' || status === 'underflow-to-zero'
        ? 1
        : logCompProb >= LN_SWITCH_LOG1MEXP
          ? 1 - Math.exp(normLogProb)
          : Math.exp(normLogComp);

  return Object.freeze({
    probability,
    complementProbability,
    logProbability: normLogProb,
    logComplementProbability: normLogComp,
    status,
  });
}

/**
 * Constructs an immutable `DualChannelProbability` from `logProb = ln(p) in [-Infinity, 0]`.
 */
export function createDualChannelProbabilityFromLog(logProb: number): DualChannelProbability {
  const logCompProb = log1mexp(logProb);
  return createDualChannelProbabilityFromPair(logProb, logCompProb);
}

/**
 * Constructs an immutable `DualChannelProbability` from `logCompProb = ln(1 - p) in [-Infinity, 0]`.
 */
export function createDualChannelProbabilityFromComplementLog(
  logCompProb: number,
): DualChannelProbability {
  const logProb = log1mexp(logCompProb);
  return createDualChannelProbabilityFromPair(logProb, logCompProb);
}

/**
 * Constructs an immutable `DualChannelProbability` from a linear probability `p in [0, 1]`.
 */
export function createDualChannelProbability(probability: number): DualChannelProbability {
  if (typeof probability !== 'number' || Number.isNaN(probability) || probability < 0 || probability > 1) {
    throw new RangeError(
      `createDualChannelProbability requires p in [0, 1], received ${String(probability)}`,
    );
  }
  if (probability === 0) {
    return createDualChannelProbabilityFromPair(Number.NEGATIVE_INFINITY, 0);
  }
  if (probability === 1) {
    return createDualChannelProbabilityFromPair(0, Number.NEGATIVE_INFINITY);
  }
  if (probability <= 0.5) {
    const logProb = Math.log(probability);
    const logCompProb = Math.log1p(-probability);
    return createDualChannelProbabilityFromPair(logProb, logCompProb);
  }
  const comp = 1 - probability;
  const logCompProb = Math.log(comp);
  const logProb = Math.log1p(-comp);
  return createDualChannelProbabilityFromPair(logProb, logCompProb);
}

/* -------------------------------------------------------------------------
   4. Scaled Complementary Error Function `erfcx` & `erfcxDiffPositive`
   ------------------------------------------------------------------------- */

// Cody (1969), Mathematics of Computation 23(107):631-637 rational Chebyshev coefficients
const CODY_A = [
  3.1611237438705656e0,
  1.13864154151050156e2,
  3.77485237685302021e2,
  3.20937758913846947e3,
  1.85777706184603153e-1,
] as const;

const CODY_B = [
  2.36012909523441209e1,
  2.44024637934444173e2,
  1.28261652607737228e3,
  2.84423683343917062e3,
] as const;

const CODY_C = [
  5.64188496988670089e-1,
  8.88314979438837594e0,
  6.61191906371416295e1,
  2.98635138197400131e2,
  8.8195222124176909e2,
  1.71204761263407058e3,
  2.05107837782607147e3,
  1.23033935479799725e3,
  2.15311535474403846e-8,
] as const;

const CODY_D = [
  1.57449261107098347e1,
  1.17693950891312499e2,
  5.37181101862009858e2,
  1.62138957456669019e3,
  3.29079923573345963e3,
  4.36261909014324716e3,
  3.43936767414372164e3,
  1.23033935480374942e3,
] as const;

const CODY_P = [
  3.05326634961232344e-1,
  3.60344899949804439e-1,
  1.25781726111229246e-1,
  1.60837851487422766e-2,
  6.58749161529837803e-4,
  1.63153871373020978e-2,
] as const;

const CODY_Q = [
  2.56852019228982242e0,
  1.87295284992346047e0,
  5.27905102951428412e-1,
  6.05183413124413191e-2,
  2.33520497626869185e-3,
] as const;

/**
 * Evaluates the scaled complementary error function `erfcx(x) = exp(x^2) * erfc(x)`
 * for `x in [0, +Infinity]` using Cody's (1969) rational Chebyshev approximation [ANC].
 *
 * Relative error is `<= 5e-15` across the normal `binary64` domain.
 */
export function erfcx(x: number): number {
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0) {
    throw new RangeError(`erfcx requires x >= 0, received ${String(x)}`);
  }
  if (x === 0) {
    return 1;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return 0;
  }
  if (x <= 0.46875) {
    const y = x * x;
    let xnum = CODY_A[4] * y;
    let xden = y;
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + CODY_A[i]!) * y;
      xden = (xden + CODY_B[i]!) * y;
    }
    const erfVal = (x * (xnum + CODY_A[3])) / (xden + CODY_B[3]);
    return (1 - erfVal) * Math.exp(y);
  }
  if (x <= 4.0) {
    let xnum = CODY_C[8] * x;
    let xden = x;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + CODY_C[i]!) * x;
      xden = (xden + CODY_D[i]!) * x;
    }
    return (xnum + CODY_C[7]) / (xden + CODY_D[7]);
  }
  if (x >= 1e154) {
    return ONE_OVER_SQRT_PI / x;
  }
  const invX = 1 / x;
  const y = invX * invX;
  let xnum = CODY_P[5] * y;
  let xden = y;
  for (let i = 0; i < 4; i++) {
    xnum = (xnum + CODY_P[i]!) * y;
    xden = (xden + CODY_Q[i]!) * y;
  }
  const corr = (y * (xnum + CODY_P[4])) / (xden + CODY_Q[4]);
  return (ONE_OVER_SQRT_PI - corr) * invX;
}

/**
 * Returns a strict lower bound in IEEE 754 `binary64` for a non-negative real value `r >= 0`
 * whose round-to-nearest-even float is `x = fl(r) >= 0` [ANC]:
 *   `predNonNegativeBinary64(x) = max(0, x - ulpBinary64(x)) <= x^- <= r`.
 * Holds across normal, subnormal, and zero regimes because in IEEE 754 roundTiesToEven,
 * `|fl(r) - r| <= 0.5 * ulpBinary64(fl(r)) < ulpBinary64(fl(r))` for all `x > 0`.
 */
function predNonNegativeBinary64(x: number): number {
  if (!(x > 0)) {
    return 0;
  }
  const lowered = x - ulpBinary64(x);
  return lowered > 0 ? lowered : 0;
}

/**
 * Returns a strict upper bound in IEEE 754 `binary64` for a non-negative real value `r >= 0`
 * whose round-to-nearest-even float is `x = fl(r) >= 0` [ANC]:
 *   `succNonNegativeBinary64(x) = x + ulpBinary64(x) = x^+ >= r`.
 * Holds across normal, subnormal, and zero regimes (`0 + ulpBinary64(0) = Number.MIN_VALUE = 2^-1074`).
 */
function succNonNegativeBinary64(x: number): number {
  if (!Number.isFinite(x) || x < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return x + ulpBinary64(x);
}

/**
 * Returns a strict lower bound in IEEE 754 `binary64` for any real value `r`
 * whose round-to-nearest-even float is `x = fl(r)` [ANC].
 */
function predSignedBinary64(x: number): number {
  if (!Number.isFinite(x)) {
    return Number.NEGATIVE_INFINITY;
  }
  return x - ulpBinary64(x);
}

/**
 * Returns a strict upper bound in IEEE 754 `binary64` for any real value `r`
 * whose round-to-nearest-even float is `x = fl(r)` [ANC].
 */
function succSignedBinary64(x: number): number {
  if (!Number.isFinite(x)) {
    return Number.POSITIVE_INFINITY;
  }
  return x + ulpBinary64(x);
}

/**
 * Evaluates Higham's (2002, Lemma 3.1) forward rounding constant
 * `gamma_n = (n * u) / (1 - n * u)` for `u = 0.5 * Number.EPSILON = 2^-53`,
 * rounded upward via `succNonNegativeBinary64` so the returned float is a
 * strict upper bound on the exact real value `(n * u) / (1 - n * u)` [ANC].
 */
function gammaBinary64(n: number): number {
  const u = 0.5 * Number.EPSILON;
  const nu = succNonNegativeBinary64(n * u);
  const denom = predNonNegativeBinary64(1 - nu);
  if (!(denom > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  return succNonNegativeBinary64(nu / denom);
}

/** Default certified relative error tolerance for `evaluateLaplaceStieltjesEnclosure`. */
export const DEFAULT_LAPLACE_STIELTJES_CERTIFIED_REL_TOL = 1e-13;

/**
 * Diagnostic result of evaluating Laplace's Stieltjes continued fraction
 * `R_CF(u) = (1/2) / (u + 1 / (u + (3/2) / (u + ...)))` for `u > 0`
 * via the exact three-term Euler-Wallis convergent recurrence with outward-rounded
 * interval arithmetic and Higham `gamma_{4k+1}` forward error bounds [IME / ANC].
 */
export interface LaplaceStieltjesEnclosureResult {
  readonly value: number;
  readonly lowerConvergent: number;
  readonly upperConvergent: number;
  readonly certifiedLowerBound: number;
  readonly certifiedUpperBound: number;
  readonly certifiedWidth: number;
  readonly certifiedErrorBound: number;
  readonly certifiedRelativeError: number;
  readonly iterations: number;
  readonly gammaIndex: number;
  readonly gammaBound: number;
  readonly allNormalOperations: boolean;
}

/**
 * Evaluates Laplace's Stieltjes continued fraction remainder
 * `R_CF(u) = (1/2) / (u + 1 / (u + (3/2) / (u + ...)))`
 * for `u > 0`, where `erfcx(u) = 1 / (sqrt(pi) * (u + R_CF(u)))` and
 * `-erfcx'(u) = 2 * R_CF(u) * erfcx(u) > 0` [IME / ANC].
 *
 * Mathematical & Epistemological Proof of the Enclosure:
 *   1. `[IME]` (Real-arithmetic Stieltjes bracketing, Henrici Vol. 2, Theorem 12.1a):
 *      The true Euler-Wallis numerators `A_k` and denominators `B_k` satisfy:
 *        `A_{-1} = 1, B_{-1} = 0, A_0 = 0, B_0 = 1`
 *        `A_k = u * A_{k-1} + a_k * A_{k-2}, B_k = u * B_{k-1} + a_k * B_{k-2}`, where `a_k = k / 2`.
 *      Because `a_k > 0` and `u > 0`, all `A_k, B_k > 0` (`k >= 1`) are sums of strictly
 *      positive terms (zero subtraction), and the exact real-arithmetic convergents
 *      `C_k(u) = A_k(u) / B_k(u)` strictly bracket `R_CF(u)`:
 *        `0 < C_2(u) < C_4(u) < ... < C_{2m}(u) < R_CF(u) < C_{2m-1}(u) < ... < C_1(u) = 1/(2u)`.
 *   2. `[ANC]` (Complete IEEE 754 `binary64` rounding proof & certified width verification):
 *      Let `u_mach = 2^-53 = 0.5 * Number.EPSILON` be the IEEE 754 `binary64` unit roundoff.
 *      - Exactness of `a_k = 0.5 * k` (`1 <= k <= 2^53`) and base step `k = 1` (`A_1 = 0.5`, `B_1 = u`).
 *      - Outward-rounded interval arithmetic (`[A_k^lo, A_k^hi]`, `[B_k^lo, B_k^hi]`) via
 *        `predNonNegativeBinary64` and `succNonNegativeBinary64` bounds every multiplication,
 *        addition, rescaling, and division across normal, subnormal, and zero regimes.
 *      - Higham `gamma_{4k+1}` forward error bound (Higham 2002, Lemma 3.1 & §3.2) when all
 *        operations lie in the normal range (`allNormalOperations === true`).
 *      - Convergence is governed strictly by the outer certified interval
 *        `[certifiedLowerBound, certifiedUpperBound]` and `certifiedErrorBound` (never by
 *        the nominal convergent difference `algebraicWidth`): the function verifies
 *        `certifiedLowerBound <= value && value <= certifiedUpperBound`, requires
 *        `certifiedErrorBound <= max(absoluteTolerance, relativeTolerance * certifiedLowerBound)`,
 *        continues iterating while the certified interval is actively shrinking, and throws
 *        `NumericConvergenceError` if the certified error bound cannot meet the target
 *        tolerance within `maxIterations`.
 */
export function evaluateLaplaceStieltjesEnclosure(
  u: number,
  optionsOrMaxIterations: number | NumericEvaluationOptions = 120,
): LaplaceStieltjesEnclosureResult {
  if (typeof u !== 'number' || !Number.isFinite(u) || Number.isNaN(u) || u <= 0) {
    throw new RangeError(
      `evaluateLaplaceStieltjesEnclosure requires finite u > 0, received ${String(u)}`,
    );
  }

  const maxIterations =
    typeof optionsOrMaxIterations === 'number'
      ? optionsOrMaxIterations
      : (optionsOrMaxIterations.maxIterations ?? 120);
  const relativeTolerance =
    typeof optionsOrMaxIterations === 'number'
      ? DEFAULT_LAPLACE_STIELTJES_CERTIFIED_REL_TOL
      : (optionsOrMaxIterations.relativeTolerance ??
        DEFAULT_LAPLACE_STIELTJES_CERTIFIED_REL_TOL);
  const absoluteTolerance =
    typeof optionsOrMaxIterations === 'number'
      ? 0
      : (optionsOrMaxIterations.absoluteTolerance ?? 0);

  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError(
      `evaluateLaplaceStieltjesEnclosure requires integer maxIterations >= 1, received ${String(maxIterations)}`,
    );
  }
  if (
    typeof relativeTolerance !== 'number' ||
    !Number.isFinite(relativeTolerance) ||
    Number.isNaN(relativeTolerance) ||
    relativeTolerance <= 0
  ) {
    throw new RangeError(
      `evaluateLaplaceStieltjesEnclosure requires finite relativeTolerance > 0, received ${String(relativeTolerance)}`,
    );
  }
  if (
    typeof absoluteTolerance !== 'number' ||
    !Number.isFinite(absoluteTolerance) ||
    Number.isNaN(absoluteTolerance) ||
    absoluteTolerance < 0
  ) {
    throw new RangeError(
      `evaluateLaplaceStieltjesEnclosure requires finite absoluteTolerance >= 0, received ${String(absoluteTolerance)}`,
    );
  }

  const RESCALE_THRESHOLD = 2 ** 512;
  const RESCALE_FACTOR = 2 ** -512;
  // Minimum operand threshold such that multiplying by 2^-512 remains >= MIN_NORMAL_BINARY64 (2^-1022)
  const RESCALE_NORMAL_FLOOR = 2 ** -510;

  let aPrev2 = 1;
  let bPrev2 = 0;
  let aPrev1 = 0;
  let bPrev1 = 1;

  // Outward-rounded interval state [aLo, aHi] and [bLo, bHi]
  let aPrev2Lo = 1;
  let aPrev2Hi = 1;
  let bPrev2Lo = 0;
  let bPrev2Hi = 0;
  let aPrev1Lo = 0;
  let aPrev1Hi = 0;
  let bPrev1Lo = 1;
  let bPrev1Hi = 1;

  let allNormalOperations = u >= MIN_NORMAL_BINARY64;
  let bestEvenNominal = 0;
  let bestOddNominal = Number.POSITIVE_INFINITY;
  let bestCertifiedLower = 0;
  let bestCertifiedUpper = Number.POSITIVE_INFINITY;
  let prevConvergent = 0;
  let prevCertifiedWidth = Number.POSITIVE_INFINITY;
  let lastCertifiedRelativeError = Number.POSITIVE_INFINITY;

  for (let k = 1; k <= maxIterations; k++) {
    const ak = 0.5 * k;
    const pA = u * aPrev1;
    const qA = ak * aPrev2;
    const aCurr = pA + qA;

    const pB = u * bPrev1;
    const qB = ak * bPrev2;
    const bCurr = pB + qB;

    if (
      k >= 2 &&
      ((pA > 0 && pA < MIN_NORMAL_BINARY64) ||
        (qA > 0 && qA < MIN_NORMAL_BINARY64) ||
        (pB > 0 && pB < MIN_NORMAL_BINARY64) ||
        (qB > 0 && qB < MIN_NORMAL_BINARY64) ||
        aCurr < MIN_NORMAL_BINARY64 ||
        bCurr < MIN_NORMAL_BINARY64)
    ) {
      allNormalOperations = false;
    }

    let aCurrLo: number;
    let aCurrHi: number;
    let bCurrLo: number;
    let bCurrHi: number;
    if (k === 1) {
      // At k = 1: A_1 = 0.5 and B_1 = u are exact in IEEE 754 binary64
      aCurrLo = 0.5;
      aCurrHi = 0.5;
      bCurrLo = u;
      bCurrHi = u;
    } else {
      aCurrLo = predNonNegativeBinary64(
        predNonNegativeBinary64(u * aPrev1Lo) + predNonNegativeBinary64(ak * aPrev2Lo),
      );
      aCurrHi = succNonNegativeBinary64(
        succNonNegativeBinary64(u * aPrev1Hi) + succNonNegativeBinary64(ak * aPrev2Hi),
      );
      bCurrLo = predNonNegativeBinary64(
        predNonNegativeBinary64(u * bPrev1Lo) + predNonNegativeBinary64(ak * bPrev2Lo),
      );
      bCurrHi = succNonNegativeBinary64(
        succNonNegativeBinary64(u * bPrev1Hi) + succNonNegativeBinary64(ak * bPrev2Hi),
      );
    }

    const convergent = aCurr / bCurr;
    if (convergent < MIN_NORMAL_BINARY64) {
      allNormalOperations = false;
    }

    if (
      !Number.isFinite(convergent) ||
      Number.isNaN(convergent) ||
      convergent <= 0 ||
      !Number.isFinite(aCurrHi) ||
      !Number.isFinite(bCurrHi) ||
      !(bCurrLo > 0)
    ) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[LaplaceStieltjesCF]',
        k,
        Number.NaN,
        relativeTolerance,
        `non-finite Euler-Wallis convergent at u = ${u}, k = ${k}`,
      );
    }

    // 1. Outward-rounded interval enclosure of the exact convergent C_k = A_k / B_k
    const cIntLo = predNonNegativeBinary64(aCurrLo / bCurrHi);
    const cIntHi = succNonNegativeBinary64(aCurrHi / bCurrLo);

    // 2. Higham gamma_{4k+1} enclosure (when all operations are in the normal range)
    const gammaIdx = 4 * k + 1;
    const gammaVal = gammaBinary64(gammaIdx);
    let cRigorousLo = cIntLo;
    let cRigorousHi = cIntHi;
    if (allNormalOperations && Number.isFinite(gammaVal) && gammaVal < 1) {
      const cGammaLo = predNonNegativeBinary64(
        convergent * predNonNegativeBinary64(1 - gammaVal),
      );
      const cGammaHi = succNonNegativeBinary64(
        convergent * succNonNegativeBinary64(1 + gammaVal),
      );
      // Conservative outer hull of both rigorous proofs
      cRigorousLo = Math.min(cIntLo, cGammaLo);
      cRigorousHi = Math.max(cIntHi, cGammaHi);
    }

    if (k % 2 === 0) {
      // Even convergent C_{2m}(u) < R_CF(u): provides a rigorous lower bound
      if (convergent > bestEvenNominal) {
        bestEvenNominal = convergent;
      }
      if (cRigorousLo > bestCertifiedLower) {
        bestCertifiedLower = cRigorousLo;
      }
    } else {
      // Odd convergent C_{2m-1}(u) > R_CF(u): provides a rigorous upper bound
      if (convergent < bestOddNominal) {
        bestOddNominal = convergent;
      }
      if (cRigorousHi < bestCertifiedUpper) {
        bestCertifiedUpper = cRigorousHi;
      }
    }

    if (k >= 2 && bestCertifiedLower > 0 && Number.isFinite(bestCertifiedUpper)) {
      const lowerConvergent = Math.min(convergent, prevConvergent);
      const upperConvergent = Math.max(convergent, prevConvergent);
      const certifiedLowerBound = bestCertifiedLower;
      const certifiedUpperBound = bestCertifiedUpper;

      if (certifiedLowerBound <= certifiedUpperBound) {
        const midpoint = 0.5 * (certifiedLowerBound + certifiedUpperBound);
        const value = Math.min(
          certifiedUpperBound,
          Math.max(certifiedLowerBound, midpoint),
        );
        const certifiedWidth = succNonNegativeBinary64(
          certifiedUpperBound - certifiedLowerBound,
        );
        const certifiedErrorBound = succNonNegativeBinary64(
          Math.max(
            succNonNegativeBinary64(Math.abs(value - certifiedLowerBound)),
            succNonNegativeBinary64(Math.abs(certifiedUpperBound - value)),
          ),
        );
        const certifiedRelativeError = succNonNegativeBinary64(
          certifiedErrorBound / certifiedLowerBound,
        );
        lastCertifiedRelativeError = certifiedRelativeError;

        const targetAllowedError = Math.max(
          absoluteTolerance,
          predNonNegativeBinary64(relativeTolerance * certifiedLowerBound),
        );
        const meetsCertifiedTolerance =
          certifiedLowerBound <= value &&
          value <= certifiedUpperBound &&
          (certifiedErrorBound <= targetAllowedError ||
            certifiedRelativeError <= relativeTolerance);

        // Continue tightening while the certified width is still shrinking by more than
        // 4 ULPs, unless k === maxIterations (where we return immediately if certified
        // tolerance is already met):
        const certifiedWidthStabilized =
          prevCertifiedWidth - certifiedWidth <= 2 * Number.EPSILON * certifiedLowerBound ||
          k === maxIterations;

        if (meetsCertifiedTolerance && certifiedWidthStabilized) {
          return Object.freeze({
            value,
            lowerConvergent,
            upperConvergent,
            certifiedLowerBound,
            certifiedUpperBound,
            certifiedWidth,
            certifiedErrorBound,
            certifiedRelativeError,
            iterations: k,
            gammaIndex: gammaIdx,
            gammaBound: gammaVal,
            allNormalOperations,
          });
        }
        prevCertifiedWidth = certifiedWidth;
      }
    }

    prevConvergent = convergent;

    if (aCurrHi > RESCALE_THRESHOLD || bCurrHi > RESCALE_THRESHOLD) {
      const exactRescale =
        aPrev1Lo >= RESCALE_NORMAL_FLOOR &&
        bPrev1Lo >= RESCALE_NORMAL_FLOOR &&
        aCurrLo >= RESCALE_NORMAL_FLOOR &&
        bCurrLo >= RESCALE_NORMAL_FLOOR;

      aPrev2 = aPrev1 * RESCALE_FACTOR;
      bPrev2 = bPrev1 * RESCALE_FACTOR;
      aPrev1 = aCurr * RESCALE_FACTOR;
      bPrev1 = bCurr * RESCALE_FACTOR;

      if (exactRescale) {
        aPrev2Lo = aPrev1Lo * RESCALE_FACTOR;
        aPrev2Hi = aPrev1Hi * RESCALE_FACTOR;
        bPrev2Lo = bPrev1Lo * RESCALE_FACTOR;
        bPrev2Hi = bPrev1Hi * RESCALE_FACTOR;
        aPrev1Lo = aCurrLo * RESCALE_FACTOR;
        aPrev1Hi = aCurrHi * RESCALE_FACTOR;
        bPrev1Lo = bCurrLo * RESCALE_FACTOR;
        bPrev1Hi = bCurrHi * RESCALE_FACTOR;
      } else {
        allNormalOperations = false;
        aPrev2Lo = predNonNegativeBinary64(aPrev1Lo * RESCALE_FACTOR);
        aPrev2Hi = succNonNegativeBinary64(aPrev1Hi * RESCALE_FACTOR);
        bPrev2Lo = predNonNegativeBinary64(bPrev1Lo * RESCALE_FACTOR);
        bPrev2Hi = succNonNegativeBinary64(bPrev1Hi * RESCALE_FACTOR);
        aPrev1Lo = predNonNegativeBinary64(aCurrLo * RESCALE_FACTOR);
        aPrev1Hi = succNonNegativeBinary64(aCurrHi * RESCALE_FACTOR);
        bPrev1Lo = predNonNegativeBinary64(bCurrLo * RESCALE_FACTOR);
        bPrev1Hi = succNonNegativeBinary64(bCurrHi * RESCALE_FACTOR);
      }
    } else {
      aPrev2 = aPrev1;
      bPrev2 = bPrev1;
      aPrev1 = aCurr;
      bPrev1 = bCurr;

      aPrev2Lo = aPrev1Lo;
      aPrev2Hi = aPrev1Hi;
      bPrev2Lo = bPrev1Lo;
      bPrev2Hi = bPrev1Hi;
      aPrev1Lo = aCurrLo;
      aPrev1Hi = aCurrHi;
      bPrev1Lo = bCurrLo;
      bPrev1Hi = bCurrHi;
    }
  }

  throw new NumericConvergenceError(
    'erfcxDiffPositive[LaplaceStieltjesCF]',
    maxIterations,
    lastCertifiedRelativeError,
    relativeTolerance,
    `certified enclosure failed to achieve relativeTolerance=${relativeTolerance} at u = ${u}`,
  );
}

function evaluateLaplaceContinuedFractionR(u: number, maxIterations = 120): number {
  return evaluateLaplaceStieltjesEnclosure(u, maxIterations).value;
}

/**
 * Evaluates the positive derivative magnitude `D_erfcx(u) = -d/du erfcx(u) > 0`
 * without catastrophic subtraction for `u >= 0` [IME / ANC]:
 *   1. `u in [0, 1.5]`: `2/sqrt(pi) - 2*u*erfcx(u)` (amplification `A_sub(u) <= 5.8962 < 5.90`).
 *   2. `u in (1.5, 60]`: `2 * R_CF(u) * erfcx(u)` via Stieltjes continued-fraction enclosure.
 *   3. `u > 60`: Stieltjes asymptotic series in `z = 1 / (2 * u^2)` evaluated via `invU = 1 / u`
 *      (truncation error at `k = 7` is `<= 2.02e-21`).
 */
export function erfcxDerivativePositive(
  u: number,
  options?: NumericEvaluationOptions,
): number {
  if (typeof u !== 'number' || Number.isNaN(u) || u < 0) {
    throw new RangeError(`erfcxDerivativePositive requires u >= 0, received ${String(u)}`);
  }
  if (u === Number.POSITIVE_INFINITY) {
    return 0;
  }
  if (u <= 1.5) {
    return TWO_OVER_SQRT_PI - 2 * u * erfcx(u);
  }
  if (u <= 60) {
    const maxIter = options?.maxIterations ?? 120;
    const rCf = evaluateLaplaceContinuedFractionR(u, maxIter);
    return 2 * rCf * erfcx(u);
  }
  const invU = 1 / u;
  const invUSq = invU * invU;
  const z = 0.5 * invUSq;
  // Horner evaluation of 1 - 3z + 15z^2 - 105z^3 + 945z^4 - 10395z^5 + 135135z^6
  const series =
    1 - 3 * z * (1 - 5 * z * (1 - 7 * z * (1 - 9 * z * (1 - 11 * z * (1 - 13 * z)))));
  return ONE_OVER_SQRT_PI * invUSq * series;
}

/**
 * Relative condition number `kappa_x(x) = |x * erfcx'(x) / erfcx(x)| in [0, 1)`
 * for `x >= 0` [IME].
 */
export function erfcxConditionNumber(x: number): number {
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0) {
    throw new RangeError(`erfcxConditionNumber requires x >= 0, received ${String(x)}`);
  }
  if (x === 0) {
    return 0;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (x > 60) {
    const invU = 1 / x;
    const z = 0.5 * invU * invU;
    return 1 - 2 * z * (1 - 3 * z * (1 - 5 * z));
  }
  return (x * erfcxDerivativePositive(x)) / erfcx(x);
}

// 8-point Gauss-Legendre nodes and weights on [-1, 1] (symmetric positive halves)
const GL8_POSITIVE_NODES = [
  0.183434642495649804939476142360,
  0.525532409916328985817739049189,
  0.796666477413626739591553936476,
  0.960289856497536231683560868569,
] as const;

const GL8_POSITIVE_WEIGHTS = [
  0.362683783378361982965150449277,
  0.313706645877887287337962201987,
  0.222381034453374470544355994426,
  0.101228536290376259152531354310,
] as const;

// Peano-Markov remainder constants for 8-point Gauss-Legendre quadrature:
// C_8 = (8!)^4 / (17 * (16!)^3) = 1.6973620789167867e-23
// M_16(0) = 2^17 * 8! / sqrt(pi) = 2.981642466727535e9
// 17! / sqrt(pi) = 2.006810485081986e14
const PEANO_CONSTANT_GL8 = 1.6973620789167867e-23;
const ERFCX_DERIV17_AT_ZERO = 2.981642466727535e9;
const ERFCX_DERIV17_ASYMPTOTIC_PREFACTOR = 2.006810485081986e14;
const LN_PEANO_CONSTANT_GL8 = Math.log(PEANO_CONSTANT_GL8);
const LN_ERFCX_DERIV17_AT_ZERO = Math.log(ERFCX_DERIV17_AT_ZERO);
const LN_ERFCX_DERIV17_ASYMPTOTIC_PREFACTOR = Math.log(ERFCX_DERIV17_ASYMPTOTIC_PREFACTOR);

function integrateGL8SingleInterval(
  uLeft: number,
  uRight: number,
  options?: NumericEvaluationOptions,
): number {
  const actualH = uRight - uLeft;
  const mid = 0.5 * (uLeft + uRight);
  const halfH = 0.5 * actualH;
  let subSum = 0;
  for (let i = 0; i < 4; i++) {
    const offset = halfH * GL8_POSITIVE_NODES[i]!;
    const weight = GL8_POSITIVE_WEIGHTS[i]!;
    const dMinus = erfcxDerivativePositive(mid - offset, options);
    const dPlus = erfcxDerivativePositive(mid + offset, options);
    subSum += weight * (dMinus + dPlus);
  }
  return halfH * subSum;
}

/**
 * Computes `ln(B_{GL,8}(uLeft, uRight))` in logarithmic space to avoid direct
 * `actualH ** 17` or `uLeft ** 18` overflow/underflow in `binary64` [ANC].
 */
function computeLogPeanoRemainderBound(uLeft: number, actualH: number): number {
  if (!(actualH > 0) || !Number.isFinite(actualH) || !Number.isFinite(uLeft) || uLeft < 0) {
    return Number.NaN;
  }
  const logDeriv17Bound =
    uLeft <= 1.25
      ? LN_ERFCX_DERIV17_AT_ZERO
      : Math.min(
          LN_ERFCX_DERIV17_AT_ZERO,
          LN_ERFCX_DERIV17_ASYMPTOTIC_PREFACTOR - 18 * Math.log(uLeft),
        );
  const logBound = LN_PEANO_CONSTANT_GL8 + 17 * Math.log(actualH) + logDeriv17Bound;
  if (Number.isNaN(logBound) || logBound === Number.POSITIVE_INFINITY) {
    return Number.NaN;
  }
  return logBound;
}

function computeRelativePeanoRemainderBound(
  uLeft: number,
  actualH: number,
  subIntegral: number,
): number {
  if (!(subIntegral > 0) || !Number.isFinite(subIntegral)) {
    return Number.NaN;
  }
  const logBound = computeLogPeanoRemainderBound(uLeft, actualH);
  if (Number.isNaN(logBound)) {
    return Number.NaN;
  }
  const rel = Math.exp(logBound - Math.log(subIntegral));
  if (Number.isNaN(rel) || !Number.isFinite(rel)) {
    return Number.NaN;
  }
  return rel;
}

/**
 * Evaluates `erfcx(a) - erfcx(b) >= 0` for `0 <= a <= b <= MAX_CERTIFIED_ERFCX_DIFF_ARG`
 * (or `b === +Infinity` with `0 <= a <= MAX_CERTIFIED_ERFCX_DIFF_ARG`) without
 * catastrophic cancellation when `a` and `b` are close [IME / ANC].
 *
 * Domain & Error Guarantees:
 *   - Enforces `0 <= a <= MAX_CERTIFIED_ERFCX_DIFF_ARG` (`1e150`) and
 *     `a <= b <= MAX_CERTIFIED_ERFCX_DIFF_ARG` (or `b === +Infinity`), throwing
 *     `RangeError` outside this certified domain.
 *   - Branch 1 (`erfcx(b) <= 0.75 * erfcx(a)`): direct subtraction has amplification
 *     `(1 + r) / (1 - r) <= 7`, giving relative error `<= 3.52e-14 < 1e-13`.
 *   - Branch 2 (`erfcx(b) > 0.75 * erfcx(a)`): subdivides `[a, b]` into initial
 *     subintervals of step `h_m <= 0.05 * max(1, a)` (`h_m <= 0.075` on `[0, 1.5]`),
 *     and applies adaptive 8-point Gauss-Legendre quadrature, verifying both the
 *     two-half refinement indicator `|I_fine - I_coarse| / I_fine <= 1e-14` and the
 *     logarithmically evaluated relative Peano-Markov remainder bound `<= 1e-14` on
 *     each subinterval. Never accepts a subinterval whose integral or local bound is
 *     `NaN` or infinite; throws `NumericConvergenceError` on non-convergence.
 */
export function erfcxDiffPositive(
  a: number,
  b: number,
  options?: NumericEvaluationOptions,
): number {
  if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
    throw new RangeError(
      `erfcxDiffPositive requires numeric arguments, received (${String(a)}, ${String(b)})`,
    );
  }
  if (a < 0 || b < a) {
    throw new RangeError(
      `erfcxDiffPositive requires 0 <= a <= b, received a = ${a}, b = ${b}`,
    );
  }
  if (
    a > MAX_CERTIFIED_ERFCX_DIFF_ARG ||
    (b !== Number.POSITIVE_INFINITY && b > MAX_CERTIFIED_ERFCX_DIFF_ARG)
  ) {
    throw new RangeError(
      `erfcxDiffPositive requires finite arguments <= MAX_CERTIFIED_ERFCX_DIFF_ARG (${MAX_CERTIFIED_ERFCX_DIFF_ARG}), received (${a}, ${b})`,
    );
  }
  if (a === b) {
    return 0;
  }
  const erfcxA = erfcx(a);
  if (b === Number.POSITIVE_INFINITY) {
    return erfcxA;
  }
  const erfcxB = erfcx(b);
  if (erfcxB <= 0.75 * erfcxA) {
    return Math.max(0, erfcxA - erfcxB);
  }

  const maxStep = 0.05 * Math.max(1, a);
  const initialSubintervals = Math.max(1, Math.ceil((b - a) / maxStep));
  const maxSubdivisionBudget = options?.maxIterations ?? 120;
  if (initialSubintervals > maxSubdivisionBudget) {
    throw new NumericConvergenceError(
      'erfcxDiffPositive[AdaptiveGL8]',
      maxSubdivisionBudget,
      initialSubintervals,
      maxSubdivisionBudget,
      'initial subdivision count exceeds maxIterations budget',
    );
  }

  const h = (b - a) / initialSubintervals;
  const stack: Array<{ readonly left: number; readonly right: number; readonly coarse: number }> = [];
  for (let m = initialSubintervals - 1; m >= 0; m--) {
    const uLeft = a + m * h;
    const uRight = m === initialSubintervals - 1 ? b : a + (m + 1) * h;
    const coarse = integrateGL8SingleInterval(uLeft, uRight, options);
    if (!Number.isFinite(coarse) || Number.isNaN(coarse) || coarse <= 0) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[AdaptiveGL8]',
        m + 1,
        Number.NaN,
        1e-14,
        `non-finite or non-positive initial quadrature on [${uLeft}, ${uRight}]`,
      );
    }
    stack.push({
      left: uLeft,
      right: uRight,
      coarse,
    });
  }

  let totalIntegral = 0;
  let compensation = 0;
  let maxObservedRelPeano = 0;
  let evaluationsUsed = initialSubintervals;

  while (stack.length > 0) {
    const current = stack.pop()!;
    const actualH = current.right - current.left;
    const mid = 0.5 * (current.left + current.right);
    const coarseRelPeano = computeRelativePeanoRemainderBound(
      current.left,
      actualH,
      current.coarse,
    );
    if (!Number.isFinite(coarseRelPeano) || Number.isNaN(coarseRelPeano)) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[AdaptiveGL8]',
        evaluationsUsed,
        Number.NaN,
        1e-14,
        `local Peano remainder bound is NaN or infinite on [${current.left}, ${current.right}]`,
      );
    }

    // If midpoint cannot split further in binary64, require coarseRelPeano <= 1e-14
    if (mid <= current.left || mid >= current.right) {
      if (coarseRelPeano > 1e-14) {
        throw new NumericConvergenceError(
          'erfcxDiffPositive[AdaptiveGL8]',
          evaluationsUsed,
          coarseRelPeano,
          1e-14,
          'subinterval reached binary64 resolution limit before satisfying Peano bound',
        );
      }
      const next = totalIntegral + current.coarse;
      if (Math.abs(totalIntegral) >= Math.abs(current.coarse)) {
        compensation += totalIntegral - next + current.coarse;
      } else {
        compensation += current.coarse - next + totalIntegral;
      }
      totalIntegral = next;
      maxObservedRelPeano = Math.max(maxObservedRelPeano, coarseRelPeano);
      continue;
    }

    if (evaluationsUsed + 2 > maxSubdivisionBudget) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[AdaptiveGL8]',
        maxSubdivisionBudget,
        coarseRelPeano,
        1e-14,
        'adaptive quadrature subdivision budget exhausted',
      );
    }

    const leftIntegral = integrateGL8SingleInterval(current.left, mid, options);
    const rightIntegral = integrateGL8SingleInterval(mid, current.right, options);
    evaluationsUsed += 2;

    const fineIntegral = leftIntegral + rightIntegral;
    if (
      !Number.isFinite(leftIntegral) ||
      !Number.isFinite(rightIntegral) ||
      !Number.isFinite(fineIntegral) ||
      fineIntegral <= 0
    ) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[AdaptiveGL8]',
        evaluationsUsed,
        Number.NaN,
        1e-14,
        `non-finite refined quadrature on [${current.left}, ${current.right}]`,
      );
    }

    const indicatorRelDiff = Math.abs(fineIntegral - current.coarse) / fineIntegral;
    const leftRelPeano = computeRelativePeanoRemainderBound(
      current.left,
      mid - current.left,
      fineIntegral,
    );
    const rightRelPeano = computeRelativePeanoRemainderBound(
      mid,
      current.right - mid,
      fineIntegral,
    );
    const fineRelPeano = leftRelPeano + rightRelPeano;

    if (
      !Number.isFinite(indicatorRelDiff) ||
      !Number.isFinite(fineRelPeano) ||
      Number.isNaN(indicatorRelDiff) ||
      Number.isNaN(fineRelPeano)
    ) {
      throw new NumericConvergenceError(
        'erfcxDiffPositive[AdaptiveGL8]',
        evaluationsUsed,
        Number.NaN,
        1e-14,
        `non-finite convergence indicator or Peano bound on [${current.left}, ${current.right}]`,
      );
    }

    if (indicatorRelDiff <= 1e-14 && fineRelPeano <= 1e-14) {
      const next = totalIntegral + fineIntegral;
      if (Math.abs(totalIntegral) >= Math.abs(fineIntegral)) {
        compensation += totalIntegral - next + fineIntegral;
      } else {
        compensation += fineIntegral - next + totalIntegral;
      }
      totalIntegral = next;
      maxObservedRelPeano = Math.max(maxObservedRelPeano, fineRelPeano);
    } else {
      stack.push({ left: mid, right: current.right, coarse: rightIntegral });
      stack.push({ left: current.left, right: mid, coarse: leftIntegral });
    }
  }

  const result = totalIntegral + compensation;
  if (!Number.isFinite(result) || result <= 0 || maxObservedRelPeano > 1e-14) {
    throw new NumericConvergenceError(
      'erfcxDiffPositive[GaussLegendre8]',
      evaluationsUsed,
      maxObservedRelPeano,
      1e-14,
    );
  }
  return result;
}

/* -------------------------------------------------------------------------
   5. `lnGamma`, `stirlingError`, `lnBeta`, and `poissonDeviance`
   ------------------------------------------------------------------------- */

const EULER_MASCHERONI = 0.57721566490153286061;

// Riemann zeta values zeta(2), zeta(3), zeta(4), zeta(5), zeta(6) — NO zeta(1) exists.
const ZETA_2_TO_6 = [
  1.64493406684822643647, // zeta(2) = pi^2 / 6
  1.2020569031595942854, // zeta(3)
  1.08232323371113819152, // zeta(4) = pi^4 / 90
  1.03692775514336992633, // zeta(5)
  1.01734306198444913971, // zeta(6) = pi^6 / 945
] as const;

// Godfrey (2001) 15-term Lanczos approximation with g = 607 / 128
const LANCZOS_G = 607 / 128;
const LANCZOS_COEFFS = [
  0.99999999999999709182,
  57.156235665862923517,
  -59.597960355475491248,
  14.136097974741747174,
  -0.49191381609762019978,
  0.33994649984811888699e-4,
  0.46523628927048575665e-4,
  -0.98374475304879564677e-4,
  0.15808870322491248884e-3,
  -0.21026444172410488319e-3,
  0.2174396181152126432e-3,
  -0.16431810653676389022e-3,
  0.84418223983852743293e-4,
  -0.2619083840158140867e-4,
  0.36899182659531622704e-5,
] as const;

// Stirling-Bernoulli coefficients B_{2k} / (2k * (2k - 1)) for k = 1..10
const STIRLING_BERNOULLI_COEFFS = [
  1 / 12,
  -1 / 360,
  1 / 1260,
  -1 / 1680,
  1 / 1188,
  -691 / 360360,
  1 / 156,
  -3617 / 122400,
  43867 / 244188,
  -174611 / 125400,
] as const;

/**
 * Taylor series for `ln(Gamma(1 + eps))` on `|eps| <= 1e-2` [IME / ANC]:
 *   `ln(Gamma(1 + eps)) = -gamma * eps + sum_{k=2}^6 (-1)^k * (zeta(k) / k) * eps^k + R_6(eps)`
 * where `|R_6(eps)| <= (zeta(7) / 7) * |eps|^7 / (1 - |eps|) <= 1.46e-15` for both signs of `eps`.
 */
function lnGammaTaylorAroundOne(eps: number): number {
  let sum = -EULER_MASCHERONI * eps;
  let power = eps;
  for (let k = 2; k <= 6; k++) {
    power *= eps;
    const sign = k % 2 === 0 ? 1 : -1;
    sum += sign * (ZETA_2_TO_6[k - 2]! / k) * power;
  }
  return sum;
}

function stirlingAsymptoticSeries(z: number): number {
  const invZ = 1 / z;
  const invZ2 = invZ * invZ;
  let sum = STIRLING_BERNOULLI_COEFFS[9]!;
  for (let i = 8; i >= 0; i--) {
    sum = sum * invZ2 + STIRLING_BERNOULLI_COEFFS[i]!;
  }
  return sum * invZ;
}

/**
 * Evaluates `ln(Gamma(z))` for `z in (0, 1e8]` without subtraction cancellation
 * near `z = 1` or `z = 2` [IME / ANC].
 */
export function lnGamma(z: number): number {
  if (typeof z !== 'number' || Number.isNaN(z) || z <= 0 || z > 1e8) {
    throw new RangeError(`lnGamma requires z in (0, 1e8], received ${String(z)}`);
  }
  if (z === 1 || z === 2) {
    return 0;
  }
  // Exact identity for small positive integers z = n in {3, ..., 20}: ln(Gamma(n)) = ln((n - 1)!)
  if (Number.isInteger(z) && z <= 20) {
    let fact = 2;
    for (let k = 3; k < z; k++) {
      fact *= k;
    }
    return Math.log(fact);
  }
  // Exact identity for small half-integers z = n + 0.5 in [0.5, 14.5]:
  // ln(Gamma(n + 1/2)) = 0.5 * ln(pi) + ln((2n - 1)!!) - n * ln(2)
  const twiceZ = 2 * z;
  if (Number.isInteger(twiceZ) && z < 15) {
    const n = (twiceZ - 1) / 2;
    let doubleFact = 1;
    for (let k = 1; k <= 2 * n - 1; k += 2) {
      doubleFact *= k;
    }
    return 0.5 * Math.log(Math.PI) + Math.log(doubleFact) - n * Math.LN2;
  }
  if (Math.abs(z - 1) <= 1e-2) {
    return lnGammaTaylorAroundOne(z - 1);
  }
  if (Math.abs(z - 2) <= 1e-2) {
    const eps = z - 2;
    return Math.log1p(eps) + lnGammaTaylorAroundOne(eps);
  }
  if (z < 0.5) {
    return lnGamma(z + 1) - Math.log(z);
  }
  if (z < 15) {
    const zm1 = z - 1;
    let sum = LANCZOS_COEFFS[0]!;
    for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
      sum += LANCZOS_COEFFS[i]! / (zm1 + i);
    }
    const t = zm1 + LANCZOS_G + 0.5;
    return HALF_LN_2PI + (zm1 + 0.5) * Math.log(t) - t + Math.log(sum);
  }
  return (z - 0.5) * Math.log(z) - z + HALF_LN_2PI + stirlingAsymptoticSeries(z);
}

/**
 * Evaluates Stirling's remainder `delta_Stirling(z) = ln(Gamma(z)) - ((z - 0.5)*ln(z) - z + 0.5*ln(2*pi))`
 * directly without subtracting large `O(z ln z)` terms for `z >= 15` [ANC].
 */
export function stirlingError(z: number): number {
  if (typeof z !== 'number' || Number.isNaN(z) || z <= 0 || z > 1e8) {
    throw new RangeError(`stirlingError requires z in (0, 1e8], received ${String(z)}`);
  }
  if (z >= 15) {
    return stirlingAsymptoticSeries(z);
  }
  return lnGamma(z) - ((z - 0.5) * Math.log(z) - z + HALF_LN_2PI);
}

/**
 * Evaluates `ln(B(a, b)) = ln(Gamma(a)) + ln(Gamma(b)) - ln(Gamma(a + b))`
 * using the cancellation-free Stirling-error decomposition when `a >= 15` and `b >= 15` [IME / ANC].
 */
export function lnBeta(a: number, b: number): number {
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    Number.isNaN(a) ||
    Number.isNaN(b) ||
    a <= 0 ||
    b <= 0 ||
    a + b > 1e8
  ) {
    throw new RangeError(
      `lnBeta requires a > 0, b > 0 with a + b <= 1e8, received (${String(a)}, ${String(b)})`,
    );
  }
  if (a >= 15 && b >= 15) {
    const ab = a + b;
    return (
      HALF_LN_2PI +
      (a - 0.5) * Math.log(a / ab) +
      (b - 0.5) * Math.log(b / ab) -
      0.5 * Math.log(ab) +
      stirlingError(a) +
      stirlingError(b) -
      stirlingError(ab)
    );
  }
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

/**
 * Evaluates `u - ln(1 + u) >= 0` for `u > -1` without catastrophic cancellation
 * near `u = 0` via an 8-term Maclaurin expansion on `|u| <= 1e-3` [ANC].
 */
export function poissonDevianceUnit(u: number): number {
  if (typeof u !== 'number' || Number.isNaN(u) || u <= -1) {
    throw new RangeError(`poissonDevianceUnit requires u > -1, received ${String(u)}`);
  }
  if (Math.abs(u) <= 1e-3) {
    const u2 = u * u;
    return (
      u2 *
      (1 / 2 -
        u / 3 +
        u2 / 4 -
        (u2 * u) / 5 +
        (u2 * u2) / 6 -
        (u2 * u2 * u) / 7 +
        (u2 * u2 * u2) / 8)
    );
  }
  return u - Math.log1p(u);
}

/**
 * Evaluates the single-observation Poisson deviance term
 * `d(y, mu) = 2 * (y * ln(y / mu) - (y - mu)) >= 0` without cancellation when `y ~ mu` [IME / ANC].
 */
export function poissonDevianceTerm(y: number, mu: number): number {
  if (
    typeof y !== 'number' ||
    typeof mu !== 'number' ||
    Number.isNaN(y) ||
    Number.isNaN(mu) ||
    !Number.isFinite(y) ||
    !Number.isFinite(mu) ||
    y < 0 ||
    mu <= 0
  ) {
    throw new RangeError(
      `poissonDevianceTerm requires finite y >= 0 and mu > 0, received (${String(y)}, ${String(mu)})`,
    );
  }
  if (y === 0) {
    return 2 * mu;
  }
  if (y === mu) {
    return 0;
  }
  const u = (mu - y) / y;
  return 2 * y * poissonDevianceUnit(u);
}

/**
 * Evaluates the total Poisson deviance `D(y, mu) = sum_i d(y_i, mu_i)` using
 * Neumaier compensated summation [IME / ANC].
 */
export function poissonDeviance(y: readonly number[], mu: readonly number[]): number {
  if (!Array.isArray(y) || !Array.isArray(mu) || y.length === 0 || y.length !== mu.length) {
    throw new RangeError('poissonDeviance requires non-empty arrays y and mu of equal length');
  }
  const terms = new Array<number>(y.length);
  for (let i = 0; i < y.length; i++) {
    terms[i] = poissonDevianceTerm(y[i]!, mu[i]!);
  }
  return kahanNeumaierSum(terms);
}

/* -------------------------------------------------------------------------
   6. Regularized Incomplete Gamma Functions `P(a, x)`, `Q(a, x)` & Inverse
   ------------------------------------------------------------------------- */

function validateGammaShapeParam(a: number, fnName: string): void {
  if (typeof a !== 'number' || Number.isNaN(a) || a < 0.05 || a > 1e4) {
    throw new RangeError(`${fnName} requires shape parameter a in [0.05, 1e4], received ${String(a)}`);
  }
}

/**
 * Cancellation-free evaluation of `a * ln(x) - x - ln(Gamma(a))` using
 * `-a * poissonDevianceUnit((x - a)/a) - 0.5*ln(2*pi/a) - stirlingError(a)` for `a >= 10` [ANC].
 */
function logGammaKernelPrefix(a: number, x: number): number {
  if (a >= 10) {
    const u = (x - a) / a;
    return -a * poissonDevianceUnit(u) - HALF_LN_2PI + 0.5 * Math.log(a) - stirlingError(a);
  }
  return a * Math.log(x) - x - lnGamma(a);
}

function regularizedGammaSeriesLower(
  a: number,
  x: number,
  maxIterations: number,
): number {
  const prefix = Math.exp(logGammaKernelPrefix(a, x));
  if (prefix === 0) {
    return 0;
  }
  let term = prefix / a;
  let sum = term;
  let compensation = 0;

  for (let n = 1; n <= maxIterations; n++) {
    term *= x / (a + n);
    const next = sum + term;
    if (Math.abs(sum) >= Math.abs(term)) {
      compensation += sum - next + term;
    } else {
      compensation += term - next + sum;
    }
    sum = next;

    // Because x < a + 1, r = x / (a + n + 1) < 1 for every n >= 1, giving an exact geometric tail bound.
    const r = x / (a + n + 1);
    const tailBound = r < 1 ? (term * r) / (1 - r) : term;
    const currentTotal = sum + compensation;
    if (tailBound <= currentTotal * 1e-15) {
      return Math.min(1, Math.max(0, currentTotal));
    }
  }

  const rFinal = x / (a + maxIterations + 1);
  const finalTail = rFinal < 1 ? (term * rFinal) / (1 - rFinal) : term;
  throw new NumericConvergenceError(
    'regularizedGammaP[Series]',
    maxIterations,
    finalTail / Math.max(1e-300, sum + compensation),
    1e-15,
  );
}

function regularizedGammaContinuedFractionUpper(
  a: number,
  x: number,
  maxIterations: number,
): number {
  const prefix = Math.exp(logGammaKernelPrefix(a, x));
  if (prefix === 0) {
    return 0;
  }
  const TINY = 1e-300;
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= maxIterations; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = b + an / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) <= 1e-15) {
      return Math.min(1, Math.max(0, prefix * h));
    }
  }

  throw new NumericConvergenceError(
    'regularizedGammaQ[ContinuedFraction]',
    maxIterations,
    1,
    1e-15,
  );
}

/**
 * Evaluates the lower regularized incomplete gamma function `P(a, x) = gamma(a, x) / Gamma(a)`
 * for `a in [0.05, 1e4]` and `x in [0, +Infinity]` [IME / ANC].
 *
 * Exact boundary contracts:
 *   - `regularizedGammaP(a, 0) === 0`
 *   - `regularizedGammaP(a, +Infinity) === 1`
 */
export function regularizedGammaP(
  a: number,
  x: number,
  options?: NumericEvaluationOptions,
): number {
  validateGammaShapeParam(a, 'regularizedGammaP');
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0) {
    throw new RangeError(`regularizedGammaP requires x >= 0, received ${String(x)}`);
  }
  if (x === 0) {
    return 0;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return 1;
  }
  const maxIter = options?.maxIterations ?? 2000;
  if (x < a + 1) {
    return regularizedGammaSeriesLower(a, x, maxIter);
  }
  return 1 - regularizedGammaContinuedFractionUpper(a, x, maxIter);
}

/**
 * Evaluates the upper regularized incomplete gamma function `Q(a, x) = Gamma(a, x) / Gamma(a)`
 * for `a in [0.05, 1e4]` and `x in [0, +Infinity]` [IME / ANC].
 *
 * Exact boundary contracts:
 *   - `regularizedGammaQ(a, 0) === 1`
 *   - `regularizedGammaQ(a, +Infinity) === 0`
 */
export function regularizedGammaQ(
  a: number,
  x: number,
  options?: NumericEvaluationOptions,
): number {
  validateGammaShapeParam(a, 'regularizedGammaQ');
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0) {
    throw new RangeError(`regularizedGammaQ requires x >= 0, received ${String(x)}`);
  }
  if (x === 0) {
    return 1;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return 0;
  }
  const maxIter = options?.maxIterations ?? 2000;
  if (x < a + 1) {
    return 1 - regularizedGammaSeriesLower(a, x, maxIter);
  }
  return regularizedGammaContinuedFractionUpper(a, x, maxIter);
}

/* -------------------------------------------------------------------------
   7. Standard Normal CDF & Quantile Function (Acklam + Halley Refinement)
   ------------------------------------------------------------------------- */

/**
 * Evaluates the standard normal cumulative distribution function `Phi(z)`
 * for `z in [-Infinity, +Infinity]` via `erfcx` [IME / ANC].
 */
export function normalCdf(z: number): number {
  if (typeof z !== 'number' || Number.isNaN(z)) {
    throw new RangeError(`normalCdf requires a numeric argument, received ${String(z)}`);
  }
  if (z === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (z === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (z === 0) {
    return 0.5;
  }
  const u = Math.abs(z) / Math.SQRT2;
  if (u <= 0.46875) {
    const y = u * u;
    let xnum = CODY_A[4] * y;
    let xden = y;
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + CODY_A[i]!) * y;
      xden = (xden + CODY_B[i]!) * y;
    }
    const erfVal = (u * (xnum + CODY_A[3])) / (xden + CODY_B[3]);
    return z < 0 ? 0.5 - 0.5 * erfVal : 0.5 + 0.5 * erfVal;
  }
  const tail = 0.5 * Math.exp(-u * u) * erfcx(u);
  return z < 0 ? tail : 1 - tail;
}

const ACKLAM_A = [
  -3.969683028665376e1,
  2.209460984245205e2,
  -2.759285104469687e2,
  1.38357751867269e2,
  -3.066479806614716e1,
  2.506628277459239e0,
] as const;

const ACKLAM_B = [
  -5.447609879822406e1,
  1.615858368580409e2,
  -1.556989798598866e2,
  6.680131188771972e1,
  -1.328068155288572e1,
] as const;

const ACKLAM_C = [
  -7.784894002430293e-3,
  -3.223964580411365e-1,
  -2.400758277161838e0,
  -2.549732539343734e0,
  4.374664141464968e0,
  2.938163982698783e0,
] as const;

const ACKLAM_D = [
  7.784695709041462e-3,
  3.224671290700398e-1,
  2.445134137142996e0,
  3.754408661907416e0,
] as const;

/**
 * Evaluates the standard normal quantile `Phi^-1(p)` for `p in [0, 1]` using
 * Acklam's rational approximation followed by one Halley refinement step [ANC].
 */
export function inverseNormalCdf(p: number): number {
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 1) {
    throw new RangeError(`inverseNormalCdf requires p in [0, 1], received ${String(p)}`);
  }
  if (p === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (p === 1) {
    return Number.POSITIVE_INFINITY;
  }
  if (p === 0.5) {
    return 0;
  }
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let z: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    z =
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q +
        ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    z =
      ((((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) * r +
        ACKLAM_A[4]) *
        r +
        ACKLAM_A[5]) *
        q) /
      (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) * r +
        ACKLAM_B[4]) *
        r +
        1);
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    z =
      -(((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q + ACKLAM_C[3]) * q +
        ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) * q + 1);
  }

  // One Halley refinement step for full 53-bit precision
  const err = normalCdf(z) - p;
  const pdf = Math.exp(-0.5 * z * z - HALF_LN_2PI);
  if (pdf > 0) {
    const u = err / pdf;
    z -= u / (1 + 0.5 * z * u);
  }
  return z;
}

/**
 * Evaluates the inverse upper regularized incomplete gamma function `Q^-1(a, q)`
 * for `a in [0.05, 1e4]` and `q in [0, 1]` using a Wilson-Hilferty / power-series
 * initial estimate followed by safeguarded Halley iterations [ANC].
 *
 * Exact boundary contracts:
 *   - `inverseRegularizedGammaQ(a, 1) === 0`
 *   - `inverseRegularizedGammaQ(a, 0) === +Infinity`
 */
export function inverseRegularizedGammaQ(
  a: number,
  q: number,
  options?: NumericEvaluationOptions,
): number {
  validateGammaShapeParam(a, 'inverseRegularizedGammaQ');
  if (typeof q !== 'number' || Number.isNaN(q) || q < 0 || q > 1) {
    throw new RangeError(`inverseRegularizedGammaQ requires q in [0, 1], received ${String(q)}`);
  }
  if (q === 1) {
    return 0;
  }
  if (q === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const p = 1 - q;
  const maxIter = options?.maxIterations ?? 100;

  let x: number;
  if (a > 0.2) {
    const z = -inverseNormalCdf(q);
    const w = 1 - 1 / (9 * a) + z / (3 * Math.sqrt(a));
    x = w > 0.01 ? a * w * w * w : Math.max(1e-12, a * 1e-4);
  } else {
    x = Math.max(1e-20, Math.pow(p * Math.exp(lnGamma(a + 1)), 1 / a));
  }

  let low = 0;
  let high = Number.POSITIVE_INFINITY;

  for (let iter = 1; iter <= maxIter; iter++) {
    const err = p <= 0.5 ? regularizedGammaP(a, x) - p : q - regularizedGammaQ(a, x);
    if (err === 0) {
      return x;
    }
    if (err < 0) {
      low = Math.max(low, x);
    } else {
      high = Math.min(high, x);
    }

    const logPdf = logGammaKernelPrefix(a, x) - Math.log(x);
    const pdf = Math.exp(logPdf);
    let step = 0;
    if (pdf > 0) {
      const newton = err / pdf;
      const ratio = (a - 1) / x - 1;
      const denom = 1 - 0.5 * newton * ratio;
      step = Math.abs(denom) > 0.2 ? newton / denom : newton;
      if (Math.abs(step) <= 1e-13 * Math.max(1e-100, x)) {
        return Math.max(0, x - step);
      }
    }

    let nextX = x - step;
    if (!(nextX > low && nextX < high)) {
      nextX = Number.isFinite(high) ? 0.5 * (low + high) : err < 0 ? x * 2 : x * 0.5;
    }
    if (
      Math.abs(nextX - x) <= 1e-13 * Math.max(1e-100, x) ||
      (Number.isFinite(high) && high - low <= 1e-13 * Math.max(1e-100, x))
    ) {
      return nextX;
    }
    x = nextX;
  }

  throw new NumericConvergenceError(
    'inverseRegularizedGammaQ',
    maxIter,
    Number.isFinite(high) ? (high - low) / Math.max(1e-100, x) : 1,
    1e-13,
  );
}

/* -------------------------------------------------------------------------
   8. Regularized Incomplete Beta `I_x(a, b)` & Inverse `I_p^-1(a, b)`
   ------------------------------------------------------------------------- */

function validateBetaShapeParams(a: number, b: number, fnName: string): void {
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    Number.isNaN(a) ||
    Number.isNaN(b) ||
    a < 0.05 ||
    a > 1e4 ||
    b < 0.05 ||
    b > 1e4
  ) {
    throw new RangeError(
      `${fnName} requires shape parameters a, b in [0.05, 1e4], received (${String(a)}, ${String(b)})`,
    );
  }
}

/**
 * Cancellation-free evaluation of `a*ln(x) + b*ln(1 - x) - ln(B(a, b))`
 * using the binomial deviance decomposition when `a >= 15` and `b >= 15` [IME / ANC].
 */
function logBetaKernelPrefix(x: number, a: number, b: number): number {
  if (a >= 15 && b >= 15) {
    const ab = a + b;
    const p0 = a / ab;
    const q0 = b / ab;
    return (
      -a * poissonDevianceUnit((x - p0) / p0) -
      b * poissonDevianceUnit((p0 - x) / q0) -
      HALF_LN_2PI +
      0.5 * Math.log((a * b) / ab) -
      stirlingError(a) -
      stirlingError(b) +
      stirlingError(ab)
    );
  }
  return a * Math.log(x) + b * Math.log1p(-x) - lnBeta(a, b);
}

function betaContinuedFractionLentz(
  x: number,
  a: number,
  b: number,
  maxIterations: number,
): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) {
    d = TINY;
  }
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) <= 1e-15) {
      return h;
    }
  }

  throw new NumericConvergenceError(
    'regularizedIncompleteBeta[LentzCF]',
    maxIterations,
    1,
    1e-15,
  );
}

/**
 * Evaluates the regularized incomplete beta function `I_x(a, b)` for `x in [0, 1]`
 * and `a, b in [0.05, 1e4]` via Lentz-Thompson continued fraction with symmetry
 * reflection `I_x(a, b) = 1 - I_{1-x}(b, a)` at `(a + 1) / (a + b + 2)` [IME / ANC].
 *
 * Exact boundary contracts:
 *   - `regularizedIncompleteBeta(0, a, b) === 0`
 *   - `regularizedIncompleteBeta(1, a, b) === 1`
 */
export function regularizedIncompleteBeta(
  x: number,
  a: number,
  b: number,
  options?: NumericEvaluationOptions,
): number {
  validateBetaShapeParams(a, b, 'regularizedIncompleteBeta');
  if (typeof x !== 'number' || Number.isNaN(x) || x < 0 || x > 1) {
    throw new RangeError(`regularizedIncompleteBeta requires x in [0, 1], received ${String(x)}`);
  }
  if (x === 0) {
    return 0;
  }
  if (x === 1) {
    return 1;
  }
  const maxIter = options?.maxIterations ?? 600;
  const bt = Math.exp(logBetaKernelPrefix(x, a, b));
  if (x < (a + 1) / (a + b + 2)) {
    return Math.min(1, Math.max(0, (bt * betaContinuedFractionLentz(x, a, b, maxIter)) / a));
  }
  return Math.min(
    1,
    Math.max(0, 1 - (bt * betaContinuedFractionLentz(1 - x, b, a, maxIter)) / b),
  );
}

/**
 * Evaluates the inverse regularized incomplete beta function `I_p^-1(a, b)`
 * for `p in [0, 1]` and `a, b in [0.05, 1e4]` using symmetry reduction for `p > 0.5`,
 * Carter / AS 109 initial approximation, and safeguarded Halley iterations [ANC].
 *
 * Exact boundary contracts:
 *   - `inverseRegularizedIncompleteBeta(0, a, b) === 0`
 *   - `inverseRegularizedIncompleteBeta(1, a, b) === 1`
 */
export function inverseRegularizedIncompleteBeta(
  p: number,
  a: number,
  b: number,
  options?: NumericEvaluationOptions,
): number {
  validateBetaShapeParams(a, b, 'inverseRegularizedIncompleteBeta');
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 1) {
    throw new RangeError(
      `inverseRegularizedIncompleteBeta requires p in [0, 1], received ${String(p)}`,
    );
  }
  if (p === 0) {
    return 0;
  }
  if (p === 1) {
    return 1;
  }
  if (a === b && p === 0.5) {
    return 0.5;
  }
  if (p > 0.5) {
    return 1 - inverseRegularizedIncompleteBeta(1 - p, b, a, options);
  }

  const maxIter = options?.maxIterations ?? 100;
  let x: number;
  if (a >= 1 && b >= 1) {
    const z = -inverseNormalCdf(p);
    const al = (z * z - 3) / 6;
    const h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w =
      (z * Math.sqrt(al + h)) / h -
      (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const lna = Math.log(a / (a + b));
    const lnb = Math.log(b / (a + b));
    const t1 = Math.exp(a * lna) / a;
    const t2 = Math.exp(b * lnb) / b;
    const w = t1 + t2;
    if (p < t1 / w) {
      x = Math.pow(a * w * p, 1 / a);
    } else {
      x = 1 - Math.pow(b * w * (1 - p), 1 / b);
    }
  }
  x = Math.min(1 - 1e-15, Math.max(1e-15, x));

  let low = 0;
  let high = 1;

  for (let iter = 1; iter <= maxIter; iter++) {
    const fx = regularizedIncompleteBeta(x, a, b) - p;
    if (fx === 0) {
      return x;
    }
    if (fx < 0) {
      low = Math.max(low, x);
    } else {
      high = Math.min(high, x);
    }

    const pdf = Math.exp(logBetaKernelPrefix(x, a, b) - Math.log(x * (1 - x)));
    let nextX: number;
    if (pdf > 0) {
      const newton = fx / pdf;
      const ratio = (a - 1) / x - (b - 1) / (1 - x);
      const denom = 1 - 0.5 * newton * ratio;
      const step = Math.abs(denom) > 0.2 ? newton / denom : newton;
      if (Math.abs(step) <= 1e-13 * Math.max(1e-100, x)) {
        return Math.min(1, Math.max(0, x - step));
      }
      nextX = x - step;
    } else {
      nextX = 0.5 * (low + high);
    }

    if (!(nextX > low && nextX < high)) {
      nextX = 0.5 * (low + high);
    }
    if (
      Math.abs(nextX - x) <= 1e-13 * Math.max(1e-100, x) ||
      high - low <= 1e-13 * Math.max(1e-100, x)
    ) {
      return nextX;
    }
    x = nextX;
  }

  throw new NumericConvergenceError(
    'inverseRegularizedIncompleteBeta',
    maxIter,
    (high - low) / Math.max(1e-100, x),
    1e-13,
  );
}

/* -------------------------------------------------------------------------
   9. Central Student-t CDF & Quantile Function (Including Exact df = 1, 2, 4)
   ------------------------------------------------------------------------- */

function validateStudentTDf(df: number, fnName: string): void {
  if (typeof df !== 'number' || Number.isNaN(df) || df < 1 || df > 20_000) {
    throw new RangeError(`${fnName} requires df in [1, 20000], received ${String(df)}`);
  }
}

export interface StudentT4InverseIntermediates {
  readonly alpha: number;
  readonly theta: number;
  readonly x: number;
  readonly t: number;
}

/**
 * Exact trigonometric closed-form quantile decomposition for Student-t with `df = 4`
 * (`nu = 4`) [IME]:
 *   - `alpha = 4 * p * (1 - p)`
 *   - `theta = (1 / 3) * arccos(sqrt(alpha))`
 *   - `x = 2 * sin(theta) = |t| / sqrt(t^2 + 4)`
 *   - `t = sgn(p - 0.5) * 2 * x / sqrt(1 - x^2)`
 */
export function computeStudentT4InverseIntermediates(p: number): StudentT4InverseIntermediates {
  if (typeof p !== 'number' || Number.isNaN(p) || p <= 0 || p >= 1) {
    throw new RangeError(
      `computeStudentT4InverseIntermediates requires p in (0, 1), received ${String(p)}`,
    );
  }
  if (p === 0.5) {
    return Object.freeze({ alpha: 1, theta: 0, x: 0, t: 0 });
  }
  const sgn = p > 0.5 ? 1 : -1;
  const alpha = 4 * p * (1 - p);
  const theta = Math.acos(Math.sqrt(alpha)) / 3;
  const x = 2 * Math.sin(theta);
  const t = (sgn * 2 * x) / Math.sqrt(1 - x * x);
  return Object.freeze({ alpha, theta, x, t });
}

/**
 * Evaluates the central Student-t cumulative distribution function `F_{t_nu}(t)`
 * for `t in [-Infinity, +Infinity]` and `df in [1, 20000]` [IME / ANC].
 *
 * Uses exact closed-form expressions for `df in {1, 2, 4}` and overflow-safe
 * `z = df / (df + t^2)` with `regularizedIncompleteBeta` for general `df`.
 *
 * Exact boundary contracts:
 *   - `studentTCdf(-Infinity, df) === 0`
 *   - `studentTCdf(+Infinity, df) === 1`
 */
export function studentTCdf(t: number, df: number): number {
  validateStudentTDf(df, 'studentTCdf');
  if (typeof t !== 'number' || Number.isNaN(t)) {
    throw new RangeError(`studentTCdf requires numeric t, received ${String(t)}`);
  }
  if (t === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (t === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (t === 0) {
    return 0.5;
  }

  const absT = Math.abs(t);
  const sqrtDf = Math.sqrt(df);
  // Compute z = df / (df + t^2) safely without t^2 overflow for huge finite |t| (e.g. 1e200)
  let z: number;
  if (absT <= sqrtDf) {
    const u = (absT * absT) / df;
    z = 1 / (1 + u);
  } else {
    const w = sqrtDf / absT;
    const v = w * w;
    z = v / (1 + v);
  }

  if (z === 0) {
    return t < 0 ? 0 : 1;
  }

  if (df === 1) {
    // Avoid 0.5 + atan(t)/pi cancellation in the deep lower tail t < -1 via atan(-1/t)/pi [IME]
    if (t < -1) {
      return Math.atan(-1 / t) / Math.PI;
    }
    return 0.5 + Math.atan(t) / Math.PI;
  }
  if (df === 2) {
    const absX = absT / Math.hypot(absT, Math.SQRT2);
    // For t < 0, 0.5 * (1 - absX) = 0.5 * (1 - absX^2) / (1 + absX) = 0.5 * z / (1 + absX) [IME]
    if (t < 0) {
      return (0.5 * z) / (1 + absX);
    }
    return 0.5 * (1 + absX);
  }
  if (df === 4) {
    const absX = absT / Math.hypot(absT, 2);
    // For t < 0, 0.5 - 0.25 * absX * (3 - absX^2) = 0.25 * (1 - absX)^2 * (2 + absX)
    // and 1 - absX = (1 - absX^2) / (1 + absX) = z / (1 + absX) [IME]
    if (t < 0) {
      const oneMinusAbsX = z / (1 + absX);
      return 0.25 * oneMinusAbsX * oneMinusAbsX * (2 + absX);
    }
    return 0.5 + 0.25 * absX * (3 - absX * absX);
  }

  const halfTail = 0.5 * regularizedIncompleteBeta(z, 0.5 * df, 0.5);
  return t < 0 ? halfTail : 1 - halfTail;
}

/**
 * Evaluates the inverse central Student-t quantile `F_{t_nu}^-1(p)` for
 * `p in [0, 1]` and `df in [1, 20000]` [IME / ANC].
 *
 * Uses exact closed-form formulas for `df = 1`, `df = 2`, and `df = 4`, and
 * `inverseRegularizedIncompleteBeta` for general `df`.
 *
 * Exact boundary contracts:
 *   - `inverseStudentTCdf(0, df) === -Infinity`
 *   - `inverseStudentTCdf(1, df) === +Infinity`
 */
export function inverseStudentTCdf(p: number, df: number): number {
  validateStudentTDf(df, 'inverseStudentTCdf');
  if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 1) {
    throw new RangeError(`inverseStudentTCdf requires p in [0, 1], received ${String(p)}`);
  }
  if (p === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (p === 1) {
    return Number.POSITIVE_INFINITY;
  }
  if (p === 0.5) {
    return 0;
  }
  if (df === 1) {
    return Math.tan(Math.PI * (p - 0.5));
  }
  if (df === 2) {
    return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
  }
  if (df === 4) {
    return computeStudentT4InverseIntermediates(p).t;
  }
  const sgn = p > 0.5 ? 1 : -1;
  const twoTail = 2 * Math.min(p, 1 - p);
  const z = inverseRegularizedIncompleteBeta(twoTail, 0.5 * df, 0.5);
  return sgn * Math.sqrt((df * (1 - z)) / z);
}

/* -------------------------------------------------------------------------
   10. Noncentral Chi-Square Power & Noncentral Student-t CDF
   ------------------------------------------------------------------------- */

/**
 * Evaluates the statistical power `P(Chi^2_{df}(ncp) > Chi^2_{df, 1-alpha})`
 * of a noncentral chi-square test with noncentrality parameter `ncp in [0, 2000]`,
 * degrees of freedom `df in [1, 1e4]`, and significance level `alpha in [1e-6, 0.5]`
 * via bidirectional summation from the Poisson mode `j_0 = floor(ncp / 2)` with
 * Neumaier compensated summation and an exact geometric tail bound `<= 1e-13` [EBM / ANC].
 */
export function nonCentralChiSquarePower(
  ncp: number,
  df: number,
  alpha: number,
  options?: NumericEvaluationOptions,
): number {
  if (
    typeof ncp !== 'number' ||
    typeof df !== 'number' ||
    typeof alpha !== 'number' ||
    Number.isNaN(ncp) ||
    Number.isNaN(df) ||
    Number.isNaN(alpha) ||
    ncp < 0 ||
    ncp > 2000 ||
    df < 1 ||
    df > 1e4 ||
    alpha < 1e-6 ||
    alpha > 0.5
  ) {
    throw new RangeError(
      `nonCentralChiSquarePower requires ncp in [0, 2000], df in [1, 1e4], alpha in [1e-6, 0.5], received (${String(ncp)}, ${String(df)}, ${String(alpha)})`,
    );
  }
  if (ncp === 0) {
    return alpha;
  }

  const halfDf = 0.5 * df;
  const critHalf = inverseRegularizedGammaQ(halfDf, alpha);
  const lambda = 0.5 * ncp;
  const j0 = Math.floor(lambda);
  const maxSteps = options?.maxIterations ?? 500;

  const logP0 = -lambda + j0 * Math.log(lambda) - lnGamma(j0 + 1);
  let pUp = Math.exp(logP0);
  let pDown = pUp;

  let sum = pUp * regularizedGammaQ(halfDf + j0, critHalf);
  let compensation = 0;

  function addTerm(val: number): void {
    const next = sum + val;
    if (Math.abs(sum) >= Math.abs(val)) {
      compensation += sum - next + val;
    } else {
      compensation += val - next + sum;
    }
    sum = next;
  }

  for (let s = 0; s <= maxSteps; s++) {
    if (s > 0) {
      const jPrevUp = j0 + s - 1;
      pUp *= lambda / (jPrevUp + 1);
      addTerm(pUp * regularizedGammaQ(halfDf + j0 + s, critHalf));

      const jMinus = j0 - s;
      if (jMinus >= 0) {
        pDown *= (jMinus + 1) / lambda;
        addTerm(pDown * regularizedGammaQ(halfDf + jMinus, critHalf));
      }
    }

    const jPlus = j0 + s;
    const jMinus = Math.max(0, j0 - s);
    const uPlus = (pUp * lambda) / (jPlus + 1 - lambda);
    const lMinus = jMinus >= 1 ? (s === 0 ? 1 : (pDown * jMinus) / (lambda - jMinus)) : 0;
    const tailBound = uPlus + lMinus;

    if (tailBound <= 1e-13) {
      return Math.min(1, Math.max(0, sum + compensation));
    }
  }

  const finalJPlus = j0 + maxSteps;
  const finalJMinus = Math.max(0, j0 - maxSteps);
  const finalUPlus = (pUp * lambda) / (finalJPlus + 1 - lambda);
  const finalLMinus =
    finalJMinus >= 1
      ? maxSteps === 0
        ? 1
        : (pDown * finalJMinus) / (lambda - finalJMinus)
      : 0;
  throw new NumericConvergenceError(
    'nonCentralChiSquarePower',
    maxSteps,
    finalUPlus + finalLMinus,
    1e-13,
  );
}

function logStandardNormalCdf(w: number): number {
  if (w <= 0) {
    const y = -w * Math.SQRT1_2;
    if (y >= 1e150) {
      return -Math.LN2 - 0.5 * w * w - 0.5 * Math.log(Math.PI) - Math.log(y);
    }
    return -Math.LN2 - 0.5 * w * w + Math.log(erfcx(y));
  }
  const y = w * Math.SQRT1_2;
  const upperTail = 0.5 * Math.exp(-0.5 * w * w) * erfcx(y);
  return Math.log1p(-upperTail);
}

function dLogStandardNormalCdf(w: number): number {
  if (w <= 0) {
    const y = -w * Math.SQRT1_2;
    if (y >= 1e150) {
      return -w;
    }
    return Math.SQRT2 * ONE_OVER_SQRT_PI / erfcx(y);
  }
  const pdf = Math.exp(-0.5 * w * w) / Math.sqrt(2 * Math.PI);
  return pdf / normalCdf(w);
}

/**
 * Evaluates Benton & Krishnamoorthy's (2003) modal expansion around
 * `j_0 = floor(delta^2 / 2)` when summing the Poisson-weighted incomplete beta
 * series, enforcing its analytical Poisson-Beta truncation bound
 * `B_tail(S) <= 1e-12` within `maxSteps` iterations [IME / ANC].
 *
 * Note: This function is used exclusively when the Benton-Krishnamoorthy series
 * itself is evaluated (`quadrant1-positive` or `complementary-small-ncp`) and is
 * never used as a substitute for quadrature error control.
 */
function evaluateBentonKrishnamoorthyModalSeries(
  absT: number,
  df: number,
  ncp: number,
  maxSteps: number,
  mode: 'quadrant1-positive' | 'complementary-small-ncp',
): number {
  const sqrtDf = Math.sqrt(df);
  let x = 0;
  let oneMinusX = 1;
  if (absT <= sqrtDf) {
    const u = (absT * absT) / df;
    x = u / (1 + u);
    oneMinusX = 1 / (1 + u);
  } else {
    const w = sqrtDf / absT;
    const v = w * w;
    x = 1 / (1 + v);
    oneMinusX = v / (1 + v);
  }

  const lambda = 0.5 * ncp * ncp;
  const signDelta = ncp < 0 ? -1 : 1;
  const j0 = Math.floor(lambda);
  const halfDf = 0.5 * df;

  let pUp: number;
  let absQUp: number;
  if (j0 === 0) {
    const expNegLambda = Math.exp(-lambda);
    pUp = expNegLambda;
    absQUp = Math.abs(ncp) * Math.SQRT2 * ONE_OVER_SQRT_PI * expNegLambda;
  } else {
    const logLambda = Math.log(lambda);
    const logP0 = -lambda + j0 * logLambda - lnGamma(j0 + 1);
    const logAbsQ0 =
      Math.log(Math.abs(ncp) / Math.SQRT2) -
      lambda +
      j0 * logLambda -
      lnGamma(j0 + 1.5);
    pUp = Math.exp(logP0);
    absQUp = Math.exp(logAbsQ0);
  }
  let pDown = pUp;
  let absQDown = absQUp;

  const useComplementaryZeroTail = oneMinusX === 0;
  let sum =
    mode === 'quadrant1-positive'
      ? useComplementaryZeroTail
        ? 1
        : normalCdf(-ncp)
      : 0;
  let compensation = 0;

  function addCompensated(val: number): void {
    const next = sum + val;
    if (Math.abs(sum) >= Math.abs(val)) {
      compensation += sum - next + val;
    } else {
      compensation += val - next + sum;
    }
    sum = next;
  }

  function evaluateSeriesTerm(pj: number, absQj: number, j: number): number {
    if (useComplementaryZeroTail) {
      return 0;
    }
    if (mode === 'quadrant1-positive') {
      const iP = regularizedIncompleteBeta(x, j + 0.5, halfDf);
      const iQ = regularizedIncompleteBeta(x, j + 1, halfDf);
      return 0.5 * (pj * iP + absQj * iQ);
    }
    // mode === 'complementary-small-ncp' for t < 0 with tiny |ncp| <= 1e-4:
    // F(t; df, ncp) = 0.5 * sum_j [p_j I_{1-x}(df/2, j+1/2) - q_j(ncp) I_{1-x}(df/2, j+1)]
    const iPComp = regularizedIncompleteBeta(oneMinusX, halfDf, j + 0.5);
    const iQComp = regularizedIncompleteBeta(oneMinusX, halfDf, j + 1);
    return 0.5 * (pj * iPComp - signDelta * absQj * iQComp);
  }

  addCompensated(evaluateSeriesTerm(pUp, absQUp, j0));

  for (let s = 0; s <= maxSteps; s++) {
    if (s > 0) {
      const jPrevUp = j0 + s - 1;
      pUp *= lambda / (jPrevUp + 1);
      absQUp *= lambda / (jPrevUp + 1.5);
      addCompensated(evaluateSeriesTerm(pUp, absQUp, j0 + s));

      const jMinus = j0 - s;
      if (jMinus >= 0) {
        const jPrevDown = jMinus + 1;
        pDown *= jPrevDown / lambda;
        absQDown *= (jPrevDown + 0.5) / lambda;
        addCompensated(evaluateSeriesTerm(pDown, absQDown, jMinus));
      }
    }

    const jPlus = j0 + s;
    const jMinus = Math.max(0, j0 - s);
    const uPPlus = (pUp * lambda) / (jPlus + 1 - lambda);
    const uQPlus = (absQUp * lambda) / (jPlus + 1.5 - lambda);
    let lPMinus = 0;
    let lQMinus = 0;
    if (jMinus >= 1) {
      if (s === 0) {
        lPMinus = 1;
        lQMinus = 1;
      } else {
        lPMinus = (pDown * jMinus) / (lambda - jMinus);
        lQMinus = (absQDown * (jMinus + 0.5)) / (lambda - (jMinus + 0.5));
      }
    }

    const bTail = 0.5 * (uPPlus + uQPlus + lPMinus + lQMinus);
    if (bTail <= 1e-15 || (s === maxSteps && bTail <= 1e-12)) {
      const total = sum + compensation;
      return Math.min(1, Math.max(0, total));
    }
  }

  const finalJPlus = j0 + maxSteps;
  const finalJMinus = Math.max(0, j0 - maxSteps);
  const finalUP = (pUp * lambda) / (finalJPlus + 1 - lambda);
  const finalUQ = (absQUp * lambda) / (finalJPlus + 1.5 - lambda);
  const finalLP =
    finalJMinus >= 1
      ? maxSteps === 0
        ? 1
        : (pDown * finalJMinus) / (lambda - finalJMinus)
      : 0;
  const finalLQ =
    finalJMinus >= 1
      ? maxSteps === 0
        ? 1
        : (absQDown * (finalJMinus + 0.5)) / (lambda - (finalJMinus + 0.5))
      : 0;
  const finalBTail = 0.5 * (finalUP + finalUQ + finalLP + finalLQ);

  throw new NumericConvergenceError('nonCentralStudentTCdf', maxSteps, finalBTail, 1e-12);
}

const HALF_LN_HALF_PI = 0.5 * Math.log(0.5 * Math.PI);

/** Default unified total relative error budget tolerance for `evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics`. */
export const DEFAULT_NONCENTRAL_T_INTEGRAL_REL_TOL = 1e-12;

/**
 * Converts a logarithmic tail bound estimate `logBound` into a conservative non-negative
 * `binary64` linear value without turning a mathematically positive tail
 * (`logBound > -Infinity`) into `0` upon `binary64` underflow [EBM]:
 *   - `logBound === -Infinity` (empty integration interval `(0, 0)`) -> `0` (exact)
 *   - `logBound > -Infinity` with `Math.exp(logBound) === 0` (underflow) -> `Number.MIN_VALUE` (`2^-1074 > 0`)
 *   - `logBound > -Infinity` with `Math.exp(logBound) > 0` -> `succNonNegativeBinary64(Math.exp(logBound))`
 * Note: Because `logBound` and `Math.exp(logBound)` rely on ECMAScript `Math.*` transcendental
 * functions and rational approximations (`erfcx`) without a 1-ULP or directed-rounding specification,
 * the resulting linear value is an empirical bound estimate (`[EBM]`), not a certified `[ANC]` bound.
 */
function conservativePositiveLinearUpperBoundFromLog(logBound: number): number {
  if (logBound === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (!Number.isFinite(logBound) || Number.isNaN(logBound)) {
    return Number.POSITIVE_INFINITY;
  }
  const rawExp = Math.exp(logBound);
  return rawExp === 0 ? Number.MIN_VALUE : succNonNegativeBinary64(rawExp);
}

/**
 * Computes `ln Phi(w) - ln Phi(wStar)` where `deltaW = w - wStar` without
 * `-0.5 * w^2` subtraction cancellation when `w <= 0` and `wStar <= 0` [IME / EBM].
 */
function diffLogStandardNormalCdf(w: number, wStar: number, deltaW: number): number {
  if (w <= 0 && wStar <= 0) {
    const y = -w * Math.SQRT1_2;
    const yStar = -wStar * Math.SQRT1_2;
    const quadDiff = -0.5 * deltaW * (w + wStar);
    if (y >= 1e150 || yStar >= 1e150) {
      return quadDiff - Math.log(y / yStar);
    }
    const erfcxY = erfcx(y);
    const erfcxYStar = erfcx(yStar);
    return quadDiff + Math.log1p((erfcxY - erfcxYStar) / erfcxYStar);
  }
  return logStandardNormalCdf(w) - logStandardNormalCdf(wStar);
}

/**
 * Diagnostic breakdown of the error controls in `evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics`,
 * strictly separating the certified IEEE 754 summation bound (`rigorousRelativeBound`, `[ANC]`)
 * from empirically evaluated analytical-tail, quadrature, and transcendental conditioning
 * estimates (`empiricalRelativeEstimate`, `[EBM]`):
 *
 *   1. Certified IEEE 754 basic-operation bound (`rigorousRelativeBound`, `[ANC]`):
 *      - `kahanSummationRelativeBound` (`[ANC]`): Higham `gamma_2 + M * u^2` bound for Kahan-Neumaier
 *        accumulation of the `M` positive `binary64` panel integrals using only IEEE 754 `+` and `-`.
 *      - `rigorousRelativeBound` equals `kahanSummationRelativeBound` and excludes `leftTailRelativeBound`
 *        and `rightTailRelativeBound`.
 *
 *   2. Empirically validated numerical estimates (`empiricalRelativeEstimate`, `[EBM]`):
 *      - `leftTailLogRelativeBound` & `leftTailRelativeBound` (analytical inequality: `[IME]`;
 *        numerical evaluation: `[EBM]`): while the log-concavity inequality from `psi''(z) <= -1`
 *        holds in exact real arithmetic (`[IME]`), its floating-point evaluation in
 *        `computeLeftTailLogUpperBound` and `conservativePositiveLinearUpperBoundFromLog` invokes
 *        `dPsi`, `deltaPsi`, `diffLogStandardNormalCdf`, `erfcx`, `Math.log`, `Math.log1p`,
 *        `Math.exp`, `Math.sqrt`, the numerical root `z_*`, and `scaledIntegral`. Because ECMAScript
 *        does not guarantee 1-ULP or directed rounding for `Math.*` and `erfcx` is a rational
 *        approximation, `succSignedBinary64` does not certify the transcendental evaluation; the
 *        evaluated tail bound is therefore classified as `[EBM]` and included in `empiricalRelativeEstimate`.
 *      - `rightTailLogRelativeBound` & `rightTailRelativeBound` (analytical inequality: `[IME]`;
 *        numerical evaluation: `[EBM]`): same distinction between the exact real-arithmetic log-concavity
 *        inequality (`[IME]`) and its floating-point transcendental evaluation (`[EBM]`).
 *      - `quadratureRelativeErrorEstimate` (`[EBM]`): a posteriori two-level 8-point Gauss-Legendre
 *        refinement discrepancy `sum_p |I_{fine,p} - I_{coarse,p}| / I_mid`.
 *      - `evaluationRoundingRelativeEstimate` (`[EBM]`): conditioning estimate for ECMAScript
 *        `Math.exp`, `Math.log`, `Math.log1p`, `erfcx`, `lnGamma`, and numerical `z_*` location.
 *
 *   3. Combined error budget (`totalRelativeErrorBudget`, `totalLogErrorBudget`, `[EBM]`):
 *      - Accumulated via `kahanNeumaierSum` over `rigorousRelativeBound` and all four components of
 *        `empiricalRelativeEstimate`, checked against the unified `targetRelativeTolerance` (default `1e-12`).
 */
export interface NonCentralStudentTIntegralDiagnostics {
  readonly logProbability: number;
  readonly zStar: number;
  readonly leftBound: number;
  readonly rightBound: number;
  readonly scaledIntegral: number;
  readonly leftTailDeltaPsi: number;
  readonly rightTailDeltaPsi: number;
  readonly leftTailLogRelativeBound: number;
  readonly rightTailLogRelativeBound: number;
  readonly leftTailRelativeBound: number;
  readonly rightTailRelativeBound: number;
  readonly kahanSummationRelativeBound: number;
  readonly evaluationRoundingRelativeEstimate: number;
  readonly quadratureRelativeErrorEstimate: number;
  readonly roundingRelativeBound: number;
  readonly rigorousRelativeBound: number;
  readonly empiricalRelativeEstimate: number;
  readonly totalRelativeErrorBudget: number;
  readonly totalLogErrorBudget: number;
  readonly targetRelativeTolerance: number;
  readonly tailInequalityClassification: 'IME-exact-real-arithmetic-inequality';
  readonly tailEvaluationClassification: 'EBM-empirical-transcendental-evaluation';
  readonly errorGuaranteeClassification: 'summation-only-rigorous-tails-quadrature-and-eval-empirical';
  readonly panelEvaluations: number;
}

/**
 * Evaluates `ln F_{t_nu(delta)}(t)` directly from the strictly positive
 * conditional-normal chi-distribution integral:
 *
 *   `F_{t_nu(delta)}(t) = int_0^inf Phi((t / sqrt(nu)) * z - delta) * (2^(1 - nu/2) / Gamma(nu/2)) * z^(nu - 1) * exp(-z^2 / 2) dz`
 *
 * combining analytical log-concavity tail inequalities (`[IME]`) whose floating-point
 * transcendental evaluation is classified as empirical (`[EBM]`), a certified Kahan-Neumaier
 * panel summation bound (`[ANC]`), and empirically validated adaptive 8-point Gauss-Legendre
 * quadrature and transcendental evaluation error estimates (`[EBM]`).
 */
export function evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics(
  t: number,
  df: number,
  ncp: number,
  options?: NumericEvaluationOptions,
): NonCentralStudentTIntegralDiagnostics {
  validateNonCentralStudentTParams(
    t,
    df,
    ncp,
    'evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics',
  );
  const targetRelativeTolerance =
    options?.relativeTolerance ?? DEFAULT_NONCENTRAL_T_INTEGRAL_REL_TOL;
  if (
    typeof targetRelativeTolerance !== 'number' ||
    !Number.isFinite(targetRelativeTolerance) ||
    Number.isNaN(targetRelativeTolerance) ||
    targetRelativeTolerance <= 0
  ) {
    throw new RangeError(
      `evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics requires finite relativeTolerance > 0, received ${String(targetRelativeTolerance)}`,
    );
  }

  const a = t / Math.sqrt(df);
  if (!Number.isFinite(a) || Math.abs(a) > 1e140) {
    return Object.freeze({
      logProbability: t < 0 ? Number.NEGATIVE_INFINITY : 0,
      zStar: 0,
      leftBound: 0,
      rightBound: 0,
      scaledIntegral: 0,
      leftTailDeltaPsi: Number.NEGATIVE_INFINITY,
      rightTailDeltaPsi: Number.NEGATIVE_INFINITY,
      leftTailLogRelativeBound: Number.NEGATIVE_INFINITY,
      rightTailLogRelativeBound: Number.NEGATIVE_INFINITY,
      leftTailRelativeBound: 0,
      rightTailRelativeBound: 0,
      kahanSummationRelativeBound: 0,
      evaluationRoundingRelativeEstimate: 0,
      quadratureRelativeErrorEstimate: 0,
      roundingRelativeBound: 0,
      rigorousRelativeBound: 0,
      empiricalRelativeEstimate: 0,
      totalRelativeErrorBudget: 0,
      totalLogErrorBudget: 0,
      targetRelativeTolerance,
      tailInequalityClassification: 'IME-exact-real-arithmetic-inequality',
      tailEvaluationClassification: 'EBM-empirical-transcendental-evaluation',
      errorGuaranteeClassification:
        'summation-only-rigorous-tails-quadrature-and-eval-empirical',
      panelEvaluations: 0,
    });
  }

  function dPsi(z: number): number {
    const w = a * z - ncp;
    return a * dLogStandardNormalCdf(w) + (df - 1) / z - z;
  }

  let zStar = 0;
  if (df === 1 && a * dLogStandardNormalCdf(-ncp) <= 0) {
    zStar = 0;
  } else {
    const bQuad = a * ncp;
    const cQuad = df - 1;
    const aQuad = 1 + a * a;
    const zGuess =
      cQuad > 0
        ? bQuad <= 0
          ? (2 * cQuad) / (Math.sqrt(bQuad * bQuad + 4 * aQuad * cQuad) - bQuad)
          : (bQuad + Math.sqrt(bQuad * bQuad + 4 * aQuad * cQuad)) / (2 * aQuad)
        : Math.max(1e-6, Math.sqrt(df));
    let lo = Math.max(1e-150, 0.1 * zGuess);
    let hi = Math.max(1e-140, 10 * zGuess + Math.sqrt(df) + Math.abs(ncp) + 10);
    while (dPsi(lo) < 0 && lo > 1e-300) {
      hi = lo;
      lo *= 0.1;
    }
    while (dPsi(hi) > 0 && hi < 1e150) {
      lo = hi;
      hi *= 2;
    }
    for (let i = 0; i < 120; i++) {
      const mid = 0.5 * (lo + hi);
      if (mid <= lo || mid >= hi || hi - lo <= 1e-15 * mid) {
        zStar = mid;
        break;
      }
      const val = dPsi(mid);
      if (val === 0) {
        zStar = mid;
        break;
      }
      if (val > 0) {
        lo = mid;
      } else {
        hi = mid;
      }
      zStar = mid;
    }
  }

  const wStar = a * zStar - ncp;
  const logPhiStar = logStandardNormalCdf(wStar);
  const logPref = (1 - 0.5 * df) * Math.LN2 - lnGamma(0.5 * df);
  const maxPsi = kahanNeumaierSum([
    logPref,
    logPhiStar,
    zStar > 0 && df !== 1 ? (df - 1) * Math.log(zStar) : 0,
    zStar > 0 ? -0.5 * zStar * zStar : 0,
  ]);

  if (!Number.isFinite(maxPsi)) {
    return Object.freeze({
      logProbability: maxPsi,
      zStar,
      leftBound: 0,
      rightBound: 0,
      scaledIntegral: 0,
      leftTailDeltaPsi: Number.NEGATIVE_INFINITY,
      rightTailDeltaPsi: Number.NEGATIVE_INFINITY,
      leftTailLogRelativeBound: Number.NEGATIVE_INFINITY,
      rightTailLogRelativeBound: Number.NEGATIVE_INFINITY,
      leftTailRelativeBound: 0,
      rightTailRelativeBound: 0,
      kahanSummationRelativeBound: 0,
      evaluationRoundingRelativeEstimate: 0,
      quadratureRelativeErrorEstimate: 0,
      roundingRelativeBound: 0,
      rigorousRelativeBound: 0,
      empiricalRelativeEstimate: 0,
      totalRelativeErrorBudget: 0,
      totalLogErrorBudget: 0,
      targetRelativeTolerance,
      tailInequalityClassification: 'IME-exact-real-arithmetic-inequality',
      tailEvaluationClassification: 'EBM-empirical-transcendental-evaluation',
      errorGuaranteeClassification:
        'summation-only-rigorous-tails-quadrature-and-eval-empirical',
      panelEvaluations: 0,
    });
  }

  // Cancellation-free incremental evaluation of deltaPsi(z) = psi(z) - psi(zStar) [IME / EBM]
  function deltaPsi(z: number): number {
    if (z <= 0) {
      return df === 1
        ? logStandardNormalCdf(-ncp) - logPhiStar + 0.5 * zStar * zStar
        : Number.NEGATIVE_INFINITY;
    }
    const dz = z - zStar;
    const deltaW = a * dz;
    const w = wStar + deltaW;
    const dLogPhi = diffLogStandardNormalCdf(w, wStar, deltaW);
    const dQuad = -0.5 * dz * (z + zStar);
    if (df === 1) {
      return dLogPhi + dQuad;
    }
    const dLogZ =
      Math.abs(dz) <= 0.5 * zStar
        ? (df - 1) * Math.log1p(dz / zStar)
        : (df - 1) * Math.log(z / zStar);
    return dLogPhi + dLogZ + dQuad;
  }

  const lambdaStar = dLogStandardNormalCdf(wStar);
  const dLambdaStar = -lambdaStar * (wStar + lambdaStar);
  const negD2PsiStar =
    1 -
    a * a * dLambdaStar +
    (zStar > 0 && df > 1 ? (df - 1) / (zStar * zStar) : 0);
  const boundarySlopeStar = zStar === 0 && df === 1 ? Math.abs(a * lambdaStar) : 0;
  const sigmaStar = 1 / (boundarySlopeStar + Math.sqrt(Math.max(1, negD2PsiStar)));

  // B. Logarithmic right-tail bound formula on ln(int_{zR}^inf exp(deltaPsi(z)) dz) [IME formula / EBM evaluation]:
  //    - Mathematical inequality [IME]: in exact real arithmetic, psi''(z) <= -1 implies
  //      int_{zR}^inf exp(psi(z)-psi(z_*)) dz <= exp(psi(zR)-psi(z_*)) * min(1/sR, sqrt(pi/2)*erfcx(sR/sqrt(2))).
  //    - Numerical evaluation [EBM]: evaluates dPsi, deltaPsi, erfcx, and Math.log in binary64;
  //      because ECMAScript does not guarantee 1-ULP or directed rounding for Math.* and erfcx is a
  //      rational approximation, succSignedBinary64 only prevents 1-ULP loss in the final additions
  //      and does not make the evaluated float a certified [ANC] bound.
  function computeRightTailLogUpperBound(zR: number): number {
    const sR = -dPsi(zR);
    if (!(sR > 0) || !Number.isFinite(sR)) {
      return Number.POSITIVE_INFINITY;
    }
    const dP = deltaPsi(zR);
    if (!Number.isFinite(dP) || Number.isNaN(dP)) {
      return Number.POSITIVE_INFINITY;
    }
    const erfcxArg = sR * Math.SQRT1_2;
    const logErfcxFactor =
      erfcxArg < 1e150
        ? HALF_LN_HALF_PI + Math.log(erfcx(erfcxArg))
        : -Math.log(sR);
    const logDecay = Math.min(-Math.log(sR), logErfcxFactor);
    return succSignedBinary64(dP + succSignedBinary64(logDecay));
  }

  // A. Logarithmic left-tail bound formula on ln(int_0^{zL} exp(deltaPsi(z)) dz) [IME formula / EBM evaluation]:
  //    - Mathematical inequality [IME]: in exact real arithmetic, psi''(z) <= -1 implies
  //      int_0^{zL} exp(psi(z)-psi(z_*)) dz <= exp(psi(zL)-psi(z_*)) * min(zL, 1/sL, sqrt(pi/2)*erfcx(sL/sqrt(2))).
  //    - Numerical evaluation [EBM]: returns -Infinity ONLY when zL <= 0 (empty interval (0, 0)),
  //      and a finite logarithmic bound estimate for all 0 < zL < zStar even when Math.exp(dP) === 0.
  function computeLeftTailLogUpperBound(zL: number): number {
    if (zL <= 0) {
      return Number.NEGATIVE_INFINITY;
    }
    const sL = dPsi(zL);
    if (!(sL > 0) || !Number.isFinite(sL)) {
      return Number.POSITIVE_INFINITY;
    }
    const dP = deltaPsi(zL);
    if (!Number.isFinite(dP) || Number.isNaN(dP)) {
      return Number.POSITIVE_INFINITY;
    }
    const erfcxArg = sL * Math.SQRT1_2;
    const logErfcxFactor =
      erfcxArg < 1e150
        ? HALF_LN_HALF_PI + Math.log(erfcx(erfcxArg))
        : -Math.log(sL);
    const logDecay = Math.min(Math.log(zL), -Math.log(sL), logErfcxFactor);
    return succSignedBinary64(dP + succSignedBinary64(logDecay));
  }

  // Target log-space tail bound relative to sigmaStar:
  const logTailScaleTarget =
    Math.log(Math.min(1e-16, 0.05 * targetRelativeTolerance)) + Math.log(sigmaStar);

  let rightBound: number;
  if (options?.rightTailCutoff !== undefined) {
    if (
      typeof options.rightTailCutoff !== 'number' ||
      !Number.isFinite(options.rightTailCutoff) ||
      Number.isNaN(options.rightTailCutoff) ||
      options.rightTailCutoff <= zStar
    ) {
      throw new RangeError(
        `evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics requires finite rightTailCutoff > zStar (${zStar}), received ${String(options.rightTailCutoff)}`,
      );
    }
    rightBound = options.rightTailCutoff;
  } else {
    let rightStep = 2 * sigmaStar;
    let rightTailConverged = false;
    for (let iter = 0; iter < 120; iter++) {
      if (computeRightTailLogUpperBound(zStar + rightStep) <= logTailScaleTarget) {
        rightTailConverged = true;
        break;
      }
      rightStep *= 1.5;
    }
    rightBound = zStar + rightStep;
    if (!rightTailConverged) {
      throw new NumericConvergenceError(
        'nonCentralStudentTCdf[RightTailTruncation]',
        120,
        conservativePositiveLinearUpperBoundFromLog(
          computeRightTailLogUpperBound(rightBound) - Math.log(sigmaStar),
        ),
        targetRelativeTolerance,
        `failed to bound right tail in log-space at zR=${rightBound}`,
      );
    }
  }

  let leftBound = 0;
  if (options?.leftTailCutoff !== undefined) {
    if (
      typeof options.leftTailCutoff !== 'number' ||
      !Number.isFinite(options.leftTailCutoff) ||
      Number.isNaN(options.leftTailCutoff) ||
      options.leftTailCutoff < 0 ||
      (zStar > 0 ? options.leftTailCutoff >= zStar : options.leftTailCutoff > 0)
    ) {
      throw new RangeError(
        `evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics requires finite leftTailCutoff in [0, zStar) (zStar=${zStar}), received ${String(options.leftTailCutoff)}`,
      );
    }
    leftBound = options.leftTailCutoff;
  } else if (zStar > 4 * sigmaStar) {
    let leftStep = 2 * sigmaStar;
    for (let iter = 0; iter < 120; iter++) {
      const candidateLeft = zStar - leftStep;
      if (candidateLeft <= 0) {
        leftBound = 0;
        break;
      }
      if (computeLeftTailLogUpperBound(candidateLeft) <= logTailScaleTarget) {
        leftBound = candidateLeft;
        break;
      }
      leftStep *= 1.5;
    }
  }

  // Smooth quartic substitution z = u^4 (dz = 4 u^3 du) when leftBound === 0 and 1 < df < 4
  const useQuarticSub = leftBound === 0 && df > 1 && df < 4;

  function evalNormalizedIntegrand(u: number): number {
    if (useQuarticSub) {
      if (u <= 0) {
        return 0;
      }
      const u2 = u * u;
      const z = u2 * u2;
      const dz = z - zStar;
      const deltaW = a * dz;
      const w = wStar + deltaW;
      const dLogPhi = diffLogStandardNormalCdf(w, wStar, deltaW);
      const dQuad = -0.5 * dz * (z + zStar);
      const logJacAndZ = (4 * df - 1) * Math.log(u) - (df - 1) * Math.log(zStar);
      return 4 * Math.exp(dLogPhi + logJacAndZ + dQuad);
    }
    return Math.exp(deltaPsi(u));
  }

  function gl8Panel(uL: number, uR: number): number {
    const mid = 0.5 * (uL + uR);
    const halfH = 0.5 * (uR - uL);
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const off = halfH * GL8_POSITIVE_NODES[i]!;
      s +=
        GL8_POSITIVE_WEIGHTS[i]! *
        (evalNormalizedIntegrand(mid - off) + evalNormalizedIntegrand(mid + off));
    }
    return halfH * s;
  }

  const domLeft = useQuarticSub ? 0 : leftBound;
  const domMid = useQuarticSub ? Math.sqrt(Math.sqrt(zStar)) : zStar;
  const domRight = useQuarticSub ? Math.sqrt(Math.sqrt(rightBound)) : rightBound;

  const userMaxIterations = options?.maxIterations ?? 500;
  // Minimum 16 initial panels + 32 child panels = 48 panel evaluations required for 2-level verification
  const maxPanelEvaluations = userMaxIterations * 4;

  const stack: Array<{
    readonly left: number;
    readonly right: number;
    readonly coarse: number;
    readonly depth: number;
  }> = [];

  const nLeft = domMid > domLeft ? 8 : 0;
  const nRight = 8;
  const initialPanels = nLeft + nRight;
  let coarseTotalEstimate = 0;

  if (nLeft > 0) {
    const hL = (domMid - domLeft) / nLeft;
    for (let m = nLeft - 1; m >= 0; m--) {
      const uL = domLeft + m * hL;
      const uR = m === nLeft - 1 ? domMid : domLeft + (m + 1) * hL;
      const c = gl8Panel(uL, uR);
      coarseTotalEstimate += c;
      stack.push({ left: uL, right: uR, coarse: c, depth: 0 });
    }
  }
  const hR = (domRight - domMid) / nRight;
  for (let m = nRight - 1; m >= 0; m--) {
    const uL = domMid + m * hR;
    const uR = m === nRight - 1 ? domRight : domMid + (m + 1) * hR;
    const c = gl8Panel(uL, uR);
    coarseTotalEstimate += c;
    stack.push({ left: uL, right: uR, coarse: c, depth: 0 });
  }

  let panelEvaluations = initialPanels;
  if (panelEvaluations + 2 * initialPanels > maxPanelEvaluations) {
    throw new NumericConvergenceError(
      'nonCentralStudentTCdf[AdaptiveGL8]',
      panelEvaluations,
      1,
      targetRelativeTolerance,
      `iteration budget maxIterations=${userMaxIterations} insufficient for initial 2-level Gauss-Legendre verification`,
    );
  }

  const acceptedPanels: number[] = [];
  const panelErrors: number[] = [];
  const panelConditioningTerms: number[] = [];
  const MAX_DEPTH = 24;
  const localRelTol = Math.min(1e-14, 0.1 * targetRelativeTolerance);

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const mid = 0.5 * (cur.left + cur.right);
    if (mid <= cur.left || mid >= cur.right) {
      throw new NumericConvergenceError(
        'nonCentralStudentTCdf[AdaptiveGL8]',
        panelEvaluations,
        Math.abs(cur.coarse) / Math.max(1e-300, coarseTotalEstimate),
        localRelTol,
        'subinterval collapsed to zero binary64 width before meeting quadrature tolerance',
      );
    }

    const leftVal = gl8Panel(cur.left, mid);
    const rightVal = gl8Panel(mid, cur.right);
    panelEvaluations += 2;
    const fine = leftVal + rightVal;
    const diff = Math.abs(fine - cur.coarse);
    const panelTolerance = localRelTol * Math.max(coarseTotalEstimate / initialPanels, fine);

    if (diff <= panelTolerance) {
      acceptedPanels.push(fine);
      panelErrors.push(diff);
      const zMid = useQuarticSub ? mid * mid * mid * mid : mid;
      const absDeltaPsiMid = zMid > 0 ? Math.abs(deltaPsi(zMid)) : 0;
      panelConditioningTerms.push(
        fine * (Number.isFinite(absDeltaPsiMid) ? absDeltaPsiMid : 0),
      );
    } else {
      if (cur.depth >= MAX_DEPTH || panelEvaluations + 2 > maxPanelEvaluations) {
        throw new NumericConvergenceError(
          'nonCentralStudentTCdf[AdaptiveGL8]',
          panelEvaluations,
          diff / Math.max(1e-300, coarseTotalEstimate),
          localRelTol,
          `failed to converge at depth=${cur.depth}`,
        );
      }
      stack.push({ left: mid, right: cur.right, coarse: rightVal, depth: cur.depth + 1 });
      stack.push({ left: cur.left, right: mid, coarse: leftVal, depth: cur.depth + 1 });
    }
  }

  const scaledIntegral = kahanNeumaierSum(acceptedPanels);
  if (!(scaledIntegral > 0) || !Number.isFinite(scaledIntegral)) {
    throw new NumericConvergenceError(
      'nonCentralStudentTCdf[AdaptiveGL8]',
      panelEvaluations,
      1,
      targetRelativeTolerance,
      'scaled integral evaluated to non-positive or non-finite value',
    );
  }

  const logScaledIntegral = Math.log(scaledIntegral);
  const leftTailDeltaPsi = leftBound <= 0 ? Number.NEGATIVE_INFINITY : deltaPsi(leftBound);
  const rightTailDeltaPsi = deltaPsi(rightBound);
  const leftTailLogAbsBound = computeLeftTailLogUpperBound(leftBound);
  const rightTailLogAbsBound = computeRightTailLogUpperBound(rightBound);

  // Compare and maintain tail bounds in logarithmic space before converting to linear space:
  const leftTailLogRelativeBound =
    leftTailLogAbsBound === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : succSignedBinary64(leftTailLogAbsBound - predSignedBinary64(logScaledIntegral));
  const rightTailLogRelativeBound = succSignedBinary64(
    rightTailLogAbsBound - predSignedBinary64(logScaledIntegral),
  );

  // Convert to conservative positive linear bounds (never 0 when logBound > -Infinity):
  const leftTailRelativeBound =
    conservativePositiveLinearUpperBoundFromLog(leftTailLogRelativeBound);
  const rightTailRelativeBound =
    conservativePositiveLinearUpperBoundFromLog(rightTailLogRelativeBound);

  const quadratureAbsError = kahanNeumaierSum(panelErrors);
  const quadratureRelativeErrorEstimate = succNonNegativeBinary64(
    quadratureAbsError / scaledIntegral,
  );

  // D1. Rigorous Kahan-Neumaier summation rounding bound for M positive binary64 panels [ANC]:
  const numAcceptedPanels = acceptedPanels.length;
  const uMach = 0.5 * Number.EPSILON;
  const kahanSummationRelativeBound = succNonNegativeBinary64(
    gammaBinary64(2) + numAcceptedPanels * uMach * uMach,
  );

  // D2. Empirical conditioning estimate for ECMAScript Math.* & special functions in scaledIntegral [EBM]:
  const meanAbsDeltaPsi = kahanNeumaierSum(panelConditioningTerms) / scaledIntegral;
  const evaluationRoundingRelativeEstimate = succNonNegativeBinary64(
    16 * uMach * (1 + meanAbsDeltaPsi),
  );

  const roundingRelativeBound = succNonNegativeBinary64(
    kahanNeumaierSum([kahanSummationRelativeBound, evaluationRoundingRelativeEstimate]),
  );

  // Strict separation between the IEEE 754 basic-operation Kahan-Neumaier summation bound ([ANC])
  // and empirically evaluated tail-bound, quadrature, and transcendental conditioning estimates ([EBM]):
  //   - rigorousRelativeBound ([ANC]): ONLY kahanSummationRelativeBound (gamma_2 + M * u^2).
  //   - empiricalRelativeEstimate ([EBM]): leftTailRelativeBound + rightTailRelativeBound +
  //     quadratureRelativeErrorEstimate + evaluationRoundingRelativeEstimate (because the
  //     numerical evaluation of the [IME] tail inequalities relies on Math.* and erfcx).
  const rigorousRelativeBound = kahanSummationRelativeBound;
  const empiricalRelativeEstimate = succNonNegativeBinary64(
    kahanNeumaierSum([
      leftTailRelativeBound,
      rightTailRelativeBound,
      quadratureRelativeErrorEstimate,
      evaluationRoundingRelativeEstimate,
    ]),
  );

  // Combined total relative error budget accumulated via Kahan-Neumaier summation ([EBM]):
  const totalRelativeErrorBudget = succNonNegativeBinary64(
    kahanNeumaierSum([
      rigorousRelativeBound,
      leftTailRelativeBound,
      rightTailRelativeBound,
      quadratureRelativeErrorEstimate,
      evaluationRoundingRelativeEstimate,
    ]),
  );

  const logTargetTolerance = Math.log(targetRelativeTolerance);
  if (
    leftTailLogRelativeBound > logTargetTolerance ||
    rightTailLogRelativeBound > logTargetTolerance ||
    leftTailRelativeBound > targetRelativeTolerance ||
    rightTailRelativeBound > targetRelativeTolerance ||
    quadratureRelativeErrorEstimate > targetRelativeTolerance ||
    rigorousRelativeBound > targetRelativeTolerance ||
    empiricalRelativeEstimate > targetRelativeTolerance ||
    totalRelativeErrorBudget > targetRelativeTolerance
  ) {
    throw new NumericConvergenceError(
      'nonCentralStudentTCdf[ErrorBudget]',
      panelEvaluations,
      totalRelativeErrorBudget,
      targetRelativeTolerance,
      `error budget ${totalRelativeErrorBudget} exceeded targetRelativeTolerance ${targetRelativeTolerance} (leftLog=${leftTailLogRelativeBound}, rightLog=${rightTailLogRelativeBound}, rigorous=${rigorousRelativeBound}, empirical=${empiricalRelativeEstimate})`,
    );
  }

  const logProbabilityRaw = kahanNeumaierSum([
    logPref,
    logPhiStar,
    zStar > 0 && df !== 1 ? (df - 1) * Math.log(zStar) : 0,
    zStar > 0 ? -0.5 * zStar * zStar : 0,
    logScaledIntegral,
  ]);
  const logProbability = Math.min(0, logProbabilityRaw);
  const logSumConditioning = 6 * uMach * Math.abs(logProbability);
  const totalLogErrorBudget = succNonNegativeBinary64(
    kahanNeumaierSum([
      -Math.log1p(-Math.min(0.5, totalRelativeErrorBudget)),
      logSumConditioning,
    ]),
  );

  return Object.freeze({
    logProbability,
    zStar,
    leftBound,
    rightBound,
    scaledIntegral,
    leftTailDeltaPsi,
    rightTailDeltaPsi,
    leftTailLogRelativeBound,
    rightTailLogRelativeBound,
    leftTailRelativeBound,
    rightTailRelativeBound,
    kahanSummationRelativeBound,
    evaluationRoundingRelativeEstimate,
    quadratureRelativeErrorEstimate,
    roundingRelativeBound,
    rigorousRelativeBound,
    empiricalRelativeEstimate,
    totalRelativeErrorBudget,
    totalLogErrorBudget,
    targetRelativeTolerance,
    tailInequalityClassification: 'IME-exact-real-arithmetic-inequality',
    tailEvaluationClassification: 'EBM-empirical-transcendental-evaluation',
    errorGuaranteeClassification:
      'summation-only-rigorous-tails-quadrature-and-eval-empirical',
    panelEvaluations,
  });
}

function evaluateLogNonCentralStudentTCdfIntegral(
  t: number,
  df: number,
  ncp: number,
  options?: NumericEvaluationOptions,
): number {
  return evaluateLogNonCentralStudentTCdfIntegralWithDiagnostics(t, df, ncp, options)
    .logProbability;
}

function validateNonCentralStudentTParams(
  t: number,
  df: number,
  ncp: number,
  fnName: string,
): void {
  if (
    typeof t !== 'number' ||
    typeof df !== 'number' ||
    typeof ncp !== 'number' ||
    Number.isNaN(t) ||
    Number.isNaN(df) ||
    Number.isNaN(ncp) ||
    df < 1 ||
    df > 2000 ||
    Math.abs(ncp) > 50
  ) {
    throw new RangeError(
      `${fnName} requires t in [-Infinity, +Infinity], df in [1, 2000], |ncp| <= 50, received (${String(t)}, ${String(df)}, ${String(ncp)})`,
    );
  }
}

/**
 * Evaluates both the lower-tail CDF `F_{t_nu(delta)}(t)` and the upper-tail
 * survival probability `1 - F_{t_nu(delta)}(t) = F_{t_nu(-delta)}(-t)` as a
 * coherent `DualChannelProbability` without catastrophic `1 - CDF` reflection
 * cancellation in either tail [IME / EBM].
 *
 * Epistemological classification:
 *   - `[IME]`: Exact distributional reflection `1 - F_{t_nu(delta)}(t) = F_{t_nu(-delta)}(-t)`
 *     and exact real-arithmetic log-concavity tail inequalities from `psi''(z) <= -1`.
 *   - `[EBM]`: Numerical evaluation of the tail bounds (via `Math.*` and `erfcx`), interior
 *     adaptive two-level 8-point Gauss-Legendre quadrature, and host transcendental conditioning
 *     estimates, empirically validated against 80-to-120-digit arbitrary-precision references
 *     (with `[ANC]` applicable strictly to the Kahan-Neumaier summation step and dual-channel ULP representation).
 */
export function nonCentralStudentTDualCdf(
  t: number,
  df: number,
  ncp: number,
  options?: NumericEvaluationOptions,
): DualChannelProbability {
  validateNonCentralStudentTParams(t, df, ncp, 'nonCentralStudentTDualCdf');
  if (t === Number.NEGATIVE_INFINITY) {
    return createDualChannelProbability(0);
  }
  if (t === Number.POSITIVE_INFINITY) {
    return createDualChannelProbability(1);
  }
  if (ncp === 0) {
    if (t === 0) {
      return createDualChannelProbability(0.5);
    }
    const lowerTail = studentTCdf(-Math.abs(t), df);
    if (lowerTail === 0) {
      return t < 0 ? createDualChannelProbability(0) : createDualChannelProbability(1);
    }
    const logLower = Math.log(lowerTail);
    return t < 0
      ? createDualChannelProbabilityFromLog(logLower)
      : createDualChannelProbabilityFromComplementLog(logLower);
  }
  if (t === 0) {
    const absNcp = Math.abs(ncp);
    const logSmallTail = logStandardNormalCdf(-absNcp);
    return ncp > 0
      ? createDualChannelProbabilityFromLog(logSmallTail)
      : createDualChannelProbabilityFromComplementLog(logSmallTail);
  }

  // By exact distributional symmetry T_nu(delta) =^d -T_nu(-delta),
  // 1 - F_{t_nu(delta)}(t) = F_{t_nu(-delta)}(-t).
  // Evaluate whichever tail is smaller (<= 0.5) directly in log-space without subtraction:
  if (t <= ncp) {
    const logF = evaluateLogNonCentralStudentTCdfIntegral(t, df, ncp, options);
    if (logF <= LN_SWITCH_LOG1MEXP) {
      return createDualChannelProbabilityFromLog(logF);
    }
    const logS = evaluateLogNonCentralStudentTCdfIntegral(-t, df, -ncp, options);
    return createDualChannelProbabilityFromComplementLog(logS);
  } else {
    const logS = evaluateLogNonCentralStudentTCdfIntegral(-t, df, -ncp, options);
    if (logS <= LN_SWITCH_LOG1MEXP) {
      return createDualChannelProbabilityFromComplementLog(logS);
    }
    const logF = evaluateLogNonCentralStudentTCdfIntegral(t, df, ncp, options);
    return createDualChannelProbabilityFromLog(logF);
  }
}

/**
 * Evaluates the noncentral Student-t cumulative distribution function `F_{t_nu(delta)}(t)`
 * for `t in [-Infinity, +Infinity]`, `df in [1, 2000]`, and `|ncp| <= 50` without
 * catastrophic `1 - CDF` reflection cancellation in the tails [IME / ANC / EBM]:
 *
 *   1. Exact boundary returns: `t === -Infinity -> 0`, `t === +Infinity -> 1`.
 *   2. Exact central delegation for `ncp === 0`: returns `studentTCdf(t, df)`.
 *   3. Exact origin shortcut for `t === 0`: returns `normalCdf(-ncp)`.
 *   4. Eliminates the naive reflection `1 - nonCentralStudentTCdf(-t, df, -ncp)` for `t < 0`:
 *      - For `t < 0` with tiny `|ncp| <= 1e-4`, evaluates the direct complementary
 *        Benton-Krishnamoorthy series `0.5 * sum_j [p_j I_{1-x}(df/2, j+1/2) - q_j I_{1-x}(df/2, j+1)]`
 *        under the analytical Poisson-Beta truncation bound `B_tail(S) <= 1e-12` (`[IME / ANC]`).
 *      - For `t > 0` and `ncp > 0` outside the deep lower tail (`bkVal >= 1e-3`), evaluates
 *        the all-positive Quadrant-I Benton-Krishnamoorthy series under `B_tail(S) <= 1e-12` (`[IME / ANC]`).
 *      - For all opposite-sign (`t < 0, ncp > 0` and `t > 0, ncp < 0`), Quadrant-III (`t < 0, ncp < 0`),
 *        and deep lower-tail cases (such as `F_{t_10(10)}(-20) = 3.8869760048338704e-39`),
 *        evaluates the smaller tail directly in log-space via `nonCentralStudentTDualCdf`,
 *        combining analytical log-concavity tail inequalities (`[IME]`) whose numerical
 *        evaluation is classified as empirical (`[EBM]`), Kahan-Neumaier panel summation
 *        bounds (`[ANC]`), and empirically validated adaptive two-level 8-point
 *        Gauss-Legendre interior quadrature and transcendental evaluation error estimates (`[EBM]`).
 */
export function nonCentralStudentTCdf(
  t: number,
  df: number,
  ncp: number,
  options?: NumericEvaluationOptions,
): number {
  validateNonCentralStudentTParams(t, df, ncp, 'nonCentralStudentTCdf');
  if (t === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (t === Number.POSITIVE_INFINITY) {
    return 1;
  }
  if (ncp === 0) {
    return studentTCdf(t, df);
  }
  if (t === 0) {
    return normalCdf(-ncp);
  }

  const maxSteps = options?.maxIterations ?? 500;
  if (t < 0 && Math.abs(ncp) <= 1e-4) {
    return evaluateBentonKrishnamoorthyModalSeries(
      -t,
      df,
      ncp,
      maxSteps,
      'complementary-small-ncp',
    );
  }
  if (t > 0 && ncp > 0) {
    const bkVal = evaluateBentonKrishnamoorthyModalSeries(
      t,
      df,
      ncp,
      maxSteps,
      'quadrant1-positive',
    );
    if (bkVal >= 1e-3) {
      return bkVal;
    }
  }
  return nonCentralStudentTDualCdf(t, df, ncp, options).probability;
}

/* -------------------------------------------------------------------------
   11. Runtime Contract Validators & Orthogonal Variance/Entropy Decompositions
   ------------------------------------------------------------------------- */

function isLinearChannelCoherentWithLog(
  linearVal: number,
  refLinearVal: number,
  logVal: number,
): boolean {
  if (refLinearVal === 0) {
    return linearVal === 0;
  }
  if (refLinearVal === 1) {
    return linearVal === 1;
  }
  if (refLinearVal < MIN_NORMAL_BINARY64) {
    return (
      linearVal > 0 &&
      linearVal < MIN_NORMAL_BINARY64 &&
      ulpDistanceBinary64(linearVal, refLinearVal) <= 2
    );
  }
  if (linearVal < MIN_NORMAL_BINARY64 || linearVal >= 1) {
    return false;
  }
  if (ulpDistanceBinary64(linearVal, refLinearVal) > 4) {
    return false;
  }
  if (refLinearVal <= 0.5 && ulpDistanceBinary64(Math.log(linearVal), logVal) > 4) {
    return false;
  }
  return true;
}

/**
 * Validates at runtime that an object conforms to `DualChannelProbability`,
 * checking channel finiteness/range, exact status classification via
 * `classifyBinary64Probability(logProbability, logComplementProbability)`,
 * and regime-aware ULP coherence between `(probability, complementProbability)` and
 * `(exp(logProbability), exp(logComplementProbability))` across normal, subnormal,
 * underflow-to-zero, and saturated-to-one states.
 */
export function validateDualChannelProbability(value: unknown): DualChannelProbability {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('DualChannelProbability must be a non-null object');
  }
  const cand = value as Record<string, unknown>;
  const probability = cand.probability;
  const complementProbability = cand.complementProbability;
  const logProbability = cand.logProbability;
  const logComplementProbability = cand.logComplementProbability;
  const status = cand.status;

  if (
    typeof probability !== 'number' ||
    typeof complementProbability !== 'number' ||
    typeof logProbability !== 'number' ||
    typeof logComplementProbability !== 'number' ||
    Number.isNaN(probability) ||
    Number.isNaN(complementProbability) ||
    Number.isNaN(logProbability) ||
    Number.isNaN(logComplementProbability) ||
    probability < 0 ||
    probability > 1 ||
    complementProbability < 0 ||
    complementProbability > 1 ||
    logProbability > 0 ||
    logComplementProbability > 0
  ) {
    throw new RangeError('DualChannelProbability contains non-numeric or out-of-range fields');
  }

  const expectedStatus = classifyBinary64Probability(
    logProbability,
    logComplementProbability,
  );
  if (status !== expectedStatus) {
    throw new RangeError(
      `DualChannelProbability status '${String(status)}' does not match classified status '${expectedStatus}'`,
    );
  }

  const reference = createDualChannelProbabilityFromPair(
    logProbability,
    logComplementProbability,
  );
  if (
    !isLinearChannelCoherentWithLog(
      probability,
      reference.probability,
      reference.logProbability,
    ) ||
    !isLinearChannelCoherentWithLog(
      complementProbability,
      reference.complementProbability,
      reference.logComplementProbability,
    ) ||
    Math.abs(probability + complementProbability - 1) > Number.EPSILON
  ) {
    throw new RangeError(
      `DualChannelProbability linear channels (${probability}, ${complementProbability}) are incoherent with log channels (${logProbability}, ${logComplementProbability}) and status '${expectedStatus}'`,
    );
  }

  return Object.freeze({
    probability: probability === 0 ? 0 : probability,
    complementProbability: complementProbability === 0 ? 0 : complementProbability,
    logProbability: logProbability === 0 ? 0 : logProbability,
    logComplementProbability: logComplementProbability === 0 ? 0 : logComplementProbability,
    status: expectedStatus,
  });
}

/**
 * Validates at runtime that an array of `DualChannelProbability` entries forms
 * a normalized, mutually exclusive, and collectively exhaustive distribution
 * over `K >= 2` categories (`sum_k p_k = 1` and `logSumExp(logProb_k) = 0`).
 */
export function validateExhaustiveDistribution(
  outcomes: unknown,
  expectedCount?: number,
): readonly DualChannelProbability[] {
  if (!Array.isArray(outcomes) || outcomes.length < 2) {
    throw new RangeError(
      'Exhaustive distribution requires an array of at least 2 DualChannelProbability entries',
    );
  }
  if (expectedCount !== undefined && outcomes.length !== expectedCount) {
    throw new RangeError(
      `Exhaustive distribution length ${outcomes.length} does not match expected outcome count ${expectedCount}`,
    );
  }

  const validated: DualChannelProbability[] = [];
  const linearProbs: number[] = [];
  const logProbs: number[] = [];

  for (let k = 0; k < outcomes.length; k++) {
    const entry = validateDualChannelProbability(outcomes[k]);
    validated.push(entry);
    linearProbs.push(entry.probability);
    logProbs.push(entry.logProbability);
  }

  const linearSum = kahanNeumaierSum(linearProbs);
  if (!Number.isFinite(linearSum) || Math.abs(linearSum - 1) > 1e-12) {
    throw new RangeError(
      `Exhaustive distribution probabilities must sum to 1 within 1e-12, received ${linearSum}`,
    );
  }

  const logTotal = logSumExp(logProbs);
  if (!Number.isFinite(logTotal) || Math.abs(logTotal) > 1e-12) {
    throw new RangeError(
      `Exhaustive distribution log-probabilities must satisfy logSumExp = 0 within 1e-12, received ${logTotal}`,
    );
  }

  // For binary (K = 2) distributions, enforce exact complement symmetry between outcomes 0 and 1
  if (validated.length === 2) {
    const o0 = validated[0]!;
    const o1 = validated[1]!;
    if (
      Math.abs(o0.probability - o1.complementProbability) > 1e-12 ||
      Math.abs(o1.probability - o0.complementProbability) > 1e-12
    ) {
      throw new RangeError(
        'Binary exhaustive distribution outcomes must have mutually coherent probability and complementProbability channels',
      );
    }
  }

  return validated;
}

function validateAndNormalizeEnsembleWeights(
  weights: readonly number[],
  callerName: string,
): number[] {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new RangeError(`${callerName} requires a non-empty weights array`);
  }
  for (let m = 0; m < weights.length; m++) {
    const w = weights[m]!;
    if (typeof w !== 'number' || !Number.isFinite(w) || Number.isNaN(w) || w < 0 || w > 1) {
      throw new RangeError(
        `${callerName}: invalid weight ${String(w)} at index ${m} (must be finite in [0, 1])`,
      );
    }
  }
  const weightSum = kahanNeumaierSum(weights);
  if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-12) {
    throw new RangeError(
      `${callerName}: weights must sum to 1 within 1e-12, received sum = ${weightSum}`,
    );
  }
  const normalized = new Array<number>(weights.length);
  for (let m = 0; m < weights.length; m++) {
    normalized[m] = weights[m]! / weightSum;
  }
  return normalized;
}

function createWeightedMixtureDualChannelProbability(
  logWeightedProbs: readonly number[],
  logWeightedComps: readonly number[],
): DualChannelProbability {
  const rawLogPBar = logSumExp(logWeightedProbs);
  const rawLogQBar = logSumExp(logWeightedComps);
  // In a linear pool p_bar = sum_m w_m p_m, evaluating logSumExp(log w_m + log(1 - p_m))
  // when p_bar < 0.5 cancels O(1) log(w_m) against +log(sum w_m) near 0 (losing ~|log w| / p_bar ULPs).
  // Conversely, whichever of (rawLogPBar, rawLogQBar) is smaller lies in [-Infinity, -ln(2)]
  // and is free of near-zero cancellation, so deriving the larger channel via log1mexp(smallLog)
  // preserves full 53-bit precision and 0-ULP complementary coherence [IME / ANC].
  let logPBar: number;
  let logQBar: number;
  if (rawLogPBar <= rawLogQBar) {
    logPBar = Math.min(-Math.LN2, rawLogPBar);
    logQBar = log1mexp(logPBar);
    if (
      logQBar === 0 &&
      logPBar > LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 &&
      Math.exp(logPBar) > 0
    ) {
      logQBar = -Number.MIN_VALUE;
    }
  } else {
    logQBar = Math.min(-Math.LN2, rawLogQBar);
    logPBar = log1mexp(logQBar);
    if (
      logPBar === 0 &&
      logQBar > LN_ROUND_TO_ZERO_THRESHOLD_BINARY64 &&
      Math.exp(logQBar) > 0
    ) {
      logPBar = -Number.MIN_VALUE;
    }
  }
  return createDualChannelProbabilityFromPair(logPBar, logQBar);
}

/**
 * Computes the exact three-way orthogonal variance decomposition for outcome
 * category `k` across a weighted ensemble of methods [IME]:
 *
 *   `p_bar_k * (1 - p_bar_k) = sigma^2_{aleatoric,k} + sigma^2_{within,k} + sigma^2_{between,k}`
 *
 * Validates and normalizes the method weights once up front so that both the
 * logarithmic mixture channels (`logPBar`, `logQBar`) and the three variance
 * components (`aleatoric`, `within`, `between`) use the exact same normalized
 * weights `w_m`.
 */
export function decomposeCategoryUncertainty(
  outcomeIndex: number,
  outcomeLabel: string,
  contributions: readonly MethodCategoryContribution[],
  parametricInterval: ParametricIntervalField,
): CategoryUncertaintyDecomposition {
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
    throw new RangeError(
      `decomposeCategoryUncertainty requires a non-negative integer outcomeIndex, received ${String(outcomeIndex)}`,
    );
  }
  if (typeof outcomeLabel !== 'string' || outcomeLabel.trim().length === 0) {
    throw new RangeError('decomposeCategoryUncertainty requires a non-empty outcomeLabel');
  }
  if (!Array.isArray(contributions) || contributions.length === 0) {
    throw new RangeError('decomposeCategoryUncertainty requires at least one method contribution');
  }

  const rawWeights = contributions.map((c) => c.weight);
  const normalizedWeights = validateAndNormalizeEnsembleWeights(
    rawWeights,
    'decomposeCategoryUncertainty',
  );

  const logWeightedProbs: number[] = [];
  const logWeightedComps: number[] = [];

  for (let m = 0; m < contributions.length; m++) {
    const c = contributions[m]!;
    if (typeof c.methodId !== 'string' || c.methodId.trim().length === 0) {
      throw new RangeError(`Invalid methodId at index ${m}`);
    }
    const pred = validateDualChannelProbability(c.predictiveProbability);
    const p = pred.probability;
    const q = pred.complementProbability;
    const maxParamVar = p * q + 1e-15;
    if (
      typeof c.parametricVariance !== 'number' ||
      !Number.isFinite(c.parametricVariance) ||
      Number.isNaN(c.parametricVariance) ||
      c.parametricVariance < 0 ||
      c.parametricVariance > maxParamVar
    ) {
      throw new RangeError(
        `Invalid parametricVariance ${String(c.parametricVariance)} for method '${c.methodId}': must lie in [0, p*(1-p)]`,
      );
    }

    const w = normalizedWeights[m]!;
    if (w > 0) {
      const logW = Math.log(w);
      logWeightedProbs.push(logW + pred.logProbability);
      logWeightedComps.push(logW + pred.logComplementProbability);
    }
  }

  const predictiveProbability = createWeightedMixtureDualChannelProbability(
    logWeightedProbs,
    logWeightedComps,
  );
  const validatedParametricInterval = validateParametricIntervalField(
    parametricInterval,
    predictiveProbability,
  );

  const pBar = predictiveProbability.probability;
  const qBar = predictiveProbability.complementProbability;
  const totalBernoulliVariance = pBar * qBar;

  const aleatoricTerms: number[] = [];
  const withinTerms: number[] = [];
  const betweenTerms: number[] = [];

  for (let m = 0; m < contributions.length; m++) {
    const c = contributions[m]!;
    const w = normalizedWeights[m]!;
    const pm = c.predictiveProbability.probability;
    const qm = c.predictiveProbability.complementProbability;
    const bernoulliM = pm * qm;
    const paramVarM = Math.min(bernoulliM, Math.max(0, c.parametricVariance));
    aleatoricTerms.push(w * (bernoulliM - paramVarM));
    withinTerms.push(w * paramVarM);
    const diff = pm - pBar;
    betweenTerms.push(w * diff * diff);
  }

  const aleatoricVariance = Math.max(0, kahanNeumaierSum(aleatoricTerms));
  const withinMethodParametricVariance = Math.max(0, kahanNeumaierSum(withinTerms));
  const betweenMethodDisagreementVariance = Math.max(0, kahanNeumaierSum(betweenTerms));
  const totalEpistemicParametricVariance =
    withinMethodParametricVariance + betweenMethodDisagreementVariance;
  const reconstructedTotal = aleatoricVariance + totalEpistemicParametricVariance;
  const closureResidual = Math.abs(totalBernoulliVariance - reconstructedTotal);

  return Object.freeze({
    outcomeIndex,
    outcomeLabel: outcomeLabel.trim(),
    predictiveProbability,
    totalBernoulliVariance,
    aleatoricVariance,
    withinMethodParametricVariance,
    betweenMethodDisagreementVariance,
    totalEpistemicParametricVariance,
    closureResidual,
    parametricInterval: validatedParametricInterval,
  });
}

function shannonEntropyFromDistribution(outcomes: readonly DualChannelProbability[]): number {
  const terms: number[] = [];
  for (let k = 0; k < outcomes.length; k++) {
    const o = outcomes[k]!;
    if (o.probability > 0 && Number.isFinite(o.logProbability)) {
      terms.push(-o.probability * o.logProbability);
    }
  }
  return terms.length === 0 ? 0 : Math.max(0, kahanNeumaierSum(terms));
}

function uMinusLog1p(u: number): number {
  if (Math.abs(u) <= 1e-4) {
    return u * u * (0.5 - u * (1 / 3 - u * (0.25 - u * (0.2 - u / 6))));
  }
  return u - Math.log1p(u);
}

function shannonEntropyFromWeights(normalizedWeights: readonly number[]): {
  readonly weightEntropyNats: number;
  readonly positiveWeightCount: number;
  readonly dominantWeightIndex: number;
  readonly restWeightSum: number;
} {
  let positiveWeightCount = 0;
  let dominantWeightIndex = -1;
  let maxW = -1;
  for (let m = 0; m < normalizedWeights.length; m++) {
    const w = normalizedWeights[m]!;
    if (w > 0) {
      positiveWeightCount += 1;
      if (w > maxW) {
        maxW = w;
        dominantWeightIndex = m;
      }
    }
  }

  if (positiveWeightCount <= 1) {
    return {
      weightEntropyNats: 0,
      positiveWeightCount,
      dominantWeightIndex,
      restWeightSum: 0,
    };
  }

  const restWeights: number[] = [];
  for (let m = 0; m < normalizedWeights.length; m++) {
    if (m !== dominantWeightIndex && normalizedWeights[m]! > 0) {
      restWeights.push(normalizedWeights[m]!);
    }
  }
  const restWeightSum = restWeights.length === 0 ? 0 : kahanNeumaierSum(restWeights);

  const terms: number[] = [];
  for (let m = 0; m < normalizedWeights.length; m++) {
    const w = normalizedWeights[m]!;
    if (w <= 0) {
      continue;
    }
    if (m === dominantWeightIndex && restWeightSum > 0 && restWeightSum <= 0.5) {
      // Preserve full 53-bit precision when the dominant weight w_max = 1 - s_rest
      // is near 1 (including when 1 - s_rest rounds to 1.0 in binary64 for s_rest < 2^-53):
      const wMax = 1 - restWeightSum;
      const logWMax = Math.log1p(-restWeightSum);
      terms.push(-wMax * logWMax);
    } else {
      const logW = Math.log(w);
      if (logW < 0) {
        terms.push(-w * logW);
      }
    }
  }

  const rawEntropy = terms.length === 0 ? 0 : kahanNeumaierSum(terms);
  if (
    !Number.isFinite(rawEntropy) ||
    Number.isNaN(rawEntropy) ||
    rawEntropy < -1e-15
  ) {
    throw new RangeError(
      `Invalid Shannon weight entropy H(w) = ${String(rawEntropy)}`,
    );
  }
  return {
    weightEntropyNats: rawEntropy <= 0 ? 0 : rawEntropy,
    positiveWeightCount,
    dominantWeightIndex,
    restWeightSum,
  };
}

const JSD_BOUND_TOLERANCE_NATS = 1e-12;

function computeNormalizedWeightedJsdIndex(
  jensenShannonDivergenceNats: number,
  weightEntropyNats: number,
  positiveWeightCount: number,
  callerName: string,
): number {
  if (
    !Number.isFinite(jensenShannonDivergenceNats) ||
    Number.isNaN(jensenShannonDivergenceNats) ||
    jensenShannonDivergenceNats < 0
  ) {
    throw new RangeError(
      `${callerName}: jensenShannonDivergenceNats must be finite and non-negative, received ${String(jensenShannonDivergenceNats)}`,
    );
  }
  if (
    !Number.isFinite(weightEntropyNats) ||
    Number.isNaN(weightEntropyNats) ||
    weightEntropyNats < 0
  ) {
    throw new RangeError(
      `${callerName}: weightEntropyNats H(w) must be finite and non-negative, received ${String(weightEntropyNats)}`,
    );
  }

  // Single participating method (or at most one positive weight -> H(w) = 0):
  if (positiveWeightCount <= 1 || weightEntropyNats === 0) {
    if (jensenShannonDivergenceNats > JSD_BOUND_TOLERANCE_NATS) {
      throw new RangeError(
        `${callerName}: jensenShannonDivergenceNats (${jensenShannonDivergenceNats}) must be 0 when positiveWeightCount (${positiveWeightCount}) <= 1`,
      );
    }
    return 0;
  }

  // General weighted ensemble with positiveWeightCount >= 2 and H(w) > 0:
  // Theoretical upper bound is H(w). The upper-bound tolerance scales with H(w)
  // and IEEE 754 binary64 ULP spacing so a JSD materially exceeding H(w) is
  // rejected even when both JSD_w and H(w) are below 1e-15.
  const scaledBoundTolerance = Math.max(
    1e-12 * weightEntropyNats,
    64 * ulpBinary64(weightEntropyNats),
  );
  if (jensenShannonDivergenceNats > weightEntropyNats + scaledBoundTolerance) {
    throw new RangeError(
      `${callerName}: jensenShannonDivergenceNats (${jensenShannonDivergenceNats}) exceeds theoretical upper bound H(w) (${weightEntropyNats}) beyond numerical tolerance (${scaledBoundTolerance})`,
    );
  }

  if (jensenShannonDivergenceNats === 0) {
    return 0;
  }

  const rawRatio = jensenShannonDivergenceNats / weightEntropyNats;
  if (
    !Number.isFinite(rawRatio) ||
    Number.isNaN(rawRatio) ||
    rawRatio < -1e-12 ||
    rawRatio > 1 + 1e-12
  ) {
    throw new RangeError(
      `${callerName}: normalized disagreement ratio JSD_w / H(w) (${String(rawRatio)}) is outside valid [0, 1] bounds`,
    );
  }

  if (rawRatio >= 1) {
    return 1;
  }
  if (rawRatio <= 0) {
    return 0;
  }
  return rawRatio;
}

/**
 * Computes the exact Shannon entropy and weighted Jensen-Shannon divergence
 * decomposition across `M` method distributions over `K >= 2` exhaustive outcomes [IME]:
 *
 *   `H(p_bar) = H_within + JSD_w`
 *   `normalizedDisagreementIndex = JSD_w / H(w)` where `H(w) = -sum_m w_m ln(w_m)`
 *
 * Validates that:
 *   1. All weights are finite, non-negative, `<= 1`, and sum to `1` within `1e-12`.
 *   2. Every method distribution has the same category count `K >= 2` and is a
 *      valid, normalized exhaustive distribution (`validateExhaustiveDistribution`).
 *   3. The exact log-space mixture `p_bar_k = sum_m w_m p_{m,k}` is computed from
 *      `methodDistributions` and the normalized weights `w_m`, and if
 *      `ensembleDistribution` is supplied, every category matches `p_bar_k`
 *      within `1e-12` (never returning a JSD claimed to be exact when
 *      `ensembleDistribution` is incompatible with the weighted mixture).
 */
export function decomposeEnsembleEntropy(
  methodDistributions: readonly (readonly DualChannelProbability[])[],
  weights: readonly number[],
  ensembleDistribution?: readonly DualChannelProbability[],
): EntropyDecomposition {
  if (
    !Array.isArray(methodDistributions) ||
    methodDistributions.length === 0 ||
    !Array.isArray(weights) ||
    methodDistributions.length !== weights.length
  ) {
    throw new RangeError('Invalid arguments to decomposeEnsembleEntropy');
  }

  const normalizedWeights = validateAndNormalizeEnsembleWeights(
    weights,
    'decomposeEnsembleEntropy',
  );

  const firstDist = validateExhaustiveDistribution(methodDistributions[0]);
  const outcomeCount = firstDist.length;

  const validatedMethods: Array<readonly DualChannelProbability[]> = [firstDist];
  for (let m = 1; m < methodDistributions.length; m++) {
    validatedMethods.push(
      validateExhaustiveDistribution(methodDistributions[m], outcomeCount),
    );
  }

  const {
    weightEntropyNats,
    positiveWeightCount,
    dominantWeightIndex,
    restWeightSum,
  } = shannonEntropyFromWeights(normalizedWeights);

  // Compute the exact log-space mixture distribution from the individual distributions and normalized weights
  const computedMixture: DualChannelProbability[] = new Array<DualChannelProbability>(
    outcomeCount,
  );
  for (let k = 0; k < outcomeCount; k++) {
    const logProbsK: number[] = [];
    const logCompsK: number[] = [];
    let firstPositiveEntry: DualChannelProbability | undefined;
    let allIdenticalForK = true;
    for (let m = 0; m < validatedMethods.length; m++) {
      const w = normalizedWeights[m]!;
      if (w > 0) {
        const entry = validatedMethods[m]![k]!;
        if (firstPositiveEntry === undefined) {
          firstPositiveEntry = entry;
        } else if (
          entry.logProbability !== firstPositiveEntry.logProbability ||
          entry.logComplementProbability !==
            firstPositiveEntry.logComplementProbability
        ) {
          allIdenticalForK = false;
        }
        const logW =
          positiveWeightCount >= 2 &&
          m === dominantWeightIndex &&
          restWeightSum > 0 &&
          restWeightSum <= 0.5
            ? Math.log1p(-restWeightSum)
            : Math.log(w);
        logProbsK.push(logW + entry.logProbability);
        logCompsK.push(logW + entry.logComplementProbability);
      }
    }
    computedMixture[k] =
      allIdenticalForK && firstPositiveEntry !== undefined
        ? firstPositiveEntry
        : createWeightedMixtureDualChannelProbability(logProbsK, logCompsK);
  }

  if (ensembleDistribution !== undefined) {
    const validatedEnsemble = validateExhaustiveDistribution(
      ensembleDistribution,
      outcomeCount,
    );
    for (let k = 0; k < outcomeCount; k++) {
      const provided = validatedEnsemble[k]!;
      const expected = computedMixture[k]!;
      const probDiff = Math.abs(provided.probability - expected.probability);
      const compDiff = Math.abs(
        provided.complementProbability - expected.complementProbability,
      );
      if (probDiff > 1e-12 || compDiff > 1e-12) {
        throw new RangeError(
          `decomposeEnsembleEntropy: ensembleDistribution[${k}] (p=${provided.probability}) is incompatible with weighted mixture of methodDistributions (expected p=${expected.probability}, diff=${probDiff})`,
        );
      }
      if (
        Number.isFinite(provided.logProbability) &&
        Number.isFinite(expected.logProbability) &&
        Math.abs(provided.logProbability - expected.logProbability) > 1e-11
      ) {
        throw new RangeError(
          `decomposeEnsembleEntropy: ensembleDistribution[${k}] logProbability (${provided.logProbability}) is incompatible with weighted mixture (${expected.logProbability})`,
        );
      }
    }
  }

  const totalPredictiveEntropyNats = shannonEntropyFromDistribution(computedMixture);
  const withinTerms: number[] = [];
  const jsdTerms: number[] = [];

  for (let m = 0; m < validatedMethods.length; m++) {
    const dist = validatedMethods[m]!;
    const rawW = normalizedWeights[m]!;
    if (rawW <= 0) {
      continue;
    }
    const w =
      positiveWeightCount >= 2 &&
      m === dominantWeightIndex &&
      restWeightSum > 0 &&
      restWeightSum <= 0.5
        ? 1 - restWeightSum
        : rawW;
    withinTerms.push(w * shannonEntropyFromDistribution(dist));

    // When one weight dominates (restWeightSum < 1e-6), evaluating
    // pm * (ln pm - ln pBar) directly for the dominant method suffers O(1)
    // ULP cancellation because pBar ≈ pm. Using the non-negative Bregman
    // divergence b_{m,k} = (pBar_k - p_{m,k}) + p_{m,k}*(ln p_{m,k} - ln pBar_k)
    // = p_{m,k}*(u_{m,k} - log1p(u_{m,k})) where u_{m,k} = (pBar_k - p_{m,k}) / p_{m,k}
    // eliminates first-order cancellation while summing to KL(p_m || pBar) [IME / ANC].
    const useBregmanForDominant =
      positiveWeightCount >= 2 &&
      m === dominantWeightIndex &&
      restWeightSum > 0 &&
      restWeightSum < 1e-6;

    for (let k = 0; k < outcomeCount; k++) {
      const pm = dist[k]!;
      const pBar = computedMixture[k]!;
      if (useBregmanForDominant) {
        let delta = 0;
        for (let j = 0; j < validatedMethods.length; j++) {
          if (j === m || normalizedWeights[j]! <= 0) {
            continue;
          }
          delta += normalizedWeights[j]! * (validatedMethods[j]![k]!.probability - pm.probability);
        }
        if (pm.probability === 0) {
          if (delta > 0) {
            jsdTerms.push(w * delta);
          }
        } else {
          const u = delta / pm.probability;
          if (Math.abs(u) <= 0.5) {
            jsdTerms.push(w * pm.probability * uMinusLog1p(u));
          } else if (Number.isFinite(pm.logProbability)) {
            jsdTerms.push(
              w * (delta + pm.probability * (pm.logProbability - pBar.logProbability)),
            );
          }
        }
      } else if (pm.probability > 0 && Number.isFinite(pm.logProbability)) {
        jsdTerms.push(w * pm.probability * (pm.logProbability - pBar.logProbability));
      }
    }
  }

  const rawWithin = withinTerms.length === 0 ? 0 : kahanNeumaierSum(withinTerms);
  if (!Number.isFinite(rawWithin) || Number.isNaN(rawWithin) || rawWithin < -JSD_BOUND_TOLERANCE_NATS) {
    throw new RangeError(
      `decomposeEnsembleEntropy: computed withinMethodExpectedEntropyNats (${String(rawWithin)}) is invalid`,
    );
  }
  const withinMethodExpectedEntropyNats = rawWithin <= 0 ? 0 : rawWithin;

  const rawJsd = jsdTerms.length === 0 ? 0 : kahanNeumaierSum(jsdTerms);
  if (!Number.isFinite(rawJsd) || Number.isNaN(rawJsd) || rawJsd < -JSD_BOUND_TOLERANCE_NATS) {
    throw new RangeError(
      `decomposeEnsembleEntropy: computed JSD_w (${String(rawJsd)}) is negative beyond numerical rounding tolerance`,
    );
  }
  const jensenShannonDivergenceNats = rawJsd <= 0 ? 0 : rawJsd;

  const normalizedDisagreementIndex = computeNormalizedWeightedJsdIndex(
    jensenShannonDivergenceNats,
    weightEntropyNats,
    positiveWeightCount,
    'decomposeEnsembleEntropy',
  );
  const closureResidualNats = Math.abs(
    totalPredictiveEntropyNats - (withinMethodExpectedEntropyNats + jensenShannonDivergenceNats),
  );

  return Object.freeze({
    totalPredictiveEntropyNats,
    withinMethodExpectedEntropyNats,
    jensenShannonDivergenceNats,
    normalizedDisagreementIndex,
    closureResidualNats,
  });
}

function isFiniteNonNegativeNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && !Number.isNaN(x) && x >= 0;
}

/**
 * Validates at runtime a `CategoryUncertaintyDecomposition`, independently
 * recomputing the total Bernoulli variance `p_bar * (1 - p_bar)`, the total
 * epistemic parametric variance `within + between`, and the true closure
 * residual without trusting the declared `closureResidual` field [IME].
 */
export function validateCategoryUncertaintyDecomposition(
  value: unknown,
  expectedOutcomeIndex?: number,
  expectedOutcomeLabel?: string,
  expectedOutcomeProbability?: DualChannelProbability,
  executedMethodCount?: number,
): CategoryUncertaintyDecomposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('CategoryUncertaintyDecomposition must be a non-null object');
  }
  const cand = value as Record<string, unknown>;
  const outcomeIndex = cand.outcomeIndex;
  const outcomeLabel = cand.outcomeLabel;

  if (
    typeof outcomeIndex !== 'number' ||
    !Number.isInteger(outcomeIndex) ||
    outcomeIndex < 0
  ) {
    throw new RangeError(
      `CategoryUncertaintyDecomposition.outcomeIndex must be a non-negative integer, received ${String(outcomeIndex)}`,
    );
  }
  if (expectedOutcomeIndex !== undefined && outcomeIndex !== expectedOutcomeIndex) {
    throw new RangeError(
      `CategoryUncertaintyDecomposition.outcomeIndex (${outcomeIndex}) does not match expected index ${expectedOutcomeIndex}`,
    );
  }

  if (typeof outcomeLabel !== 'string' || outcomeLabel.trim().length === 0) {
    throw new RangeError('CategoryUncertaintyDecomposition.outcomeLabel must be a non-empty string');
  }
  if (
    expectedOutcomeLabel !== undefined &&
    outcomeLabel.trim() !== expectedOutcomeLabel.trim()
  ) {
    throw new RangeError(
      `CategoryUncertaintyDecomposition.outcomeLabel ('${outcomeLabel}') does not match expected label '${expectedOutcomeLabel}'`,
    );
  }

  const pred = validateDualChannelProbability(cand.predictiveProbability);
  if (expectedOutcomeProbability !== undefined) {
    if (
      pred.status !== expectedOutcomeProbability.status ||
      !isLinearChannelCoherentWithLog(
        pred.probability,
        expectedOutcomeProbability.probability,
        expectedOutcomeProbability.logProbability,
      ) ||
      !isLinearChannelCoherentWithLog(
        pred.complementProbability,
        expectedOutcomeProbability.complementProbability,
        expectedOutcomeProbability.logComplementProbability,
      )
    ) {
      throw new RangeError(
        `categoryDecompositions[${outcomeIndex}].predictiveProbability does not match outcomes[${outcomeIndex}]`,
      );
    }
  }

  const validatedInterval = validateParametricIntervalField(cand.parametricInterval, pred);

  const totalBernoulliVariance = cand.totalBernoulliVariance;
  const aleatoricVariance = cand.aleatoricVariance;
  const withinMethodParametricVariance = cand.withinMethodParametricVariance;
  const betweenMethodDisagreementVariance = cand.betweenMethodDisagreementVariance;
  const totalEpistemicParametricVariance = cand.totalEpistemicParametricVariance;
  const declaredResidual = cand.closureResidual;

  if (
    !isFiniteNonNegativeNumber(totalBernoulliVariance) ||
    !isFiniteNonNegativeNumber(aleatoricVariance) ||
    !isFiniteNonNegativeNumber(withinMethodParametricVariance) ||
    !isFiniteNonNegativeNumber(betweenMethodDisagreementVariance) ||
    !isFiniteNonNegativeNumber(totalEpistemicParametricVariance) ||
    !isFiniteNonNegativeNumber(declaredResidual)
  ) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}] contains negative, NaN, or non-finite variance components`,
    );
  }

  // 1. Independently recompute total Bernoulli variance p * (1 - p)
  const expectedBernoulli = pred.probability * pred.complementProbability;
  if (Math.abs(totalBernoulliVariance - expectedBernoulli) > 1e-12) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}].totalBernoulliVariance (${totalBernoulliVariance}) is inconsistent with p*(1-p) (${expectedBernoulli})`,
    );
  }

  // 2. Verify each component lies within [0, p*(1-p) + 1e-12]
  if (
    aleatoricVariance > expectedBernoulli + 1e-12 ||
    withinMethodParametricVariance > expectedBernoulli + 1e-12 ||
    betweenMethodDisagreementVariance > expectedBernoulli + 1e-12 ||
    totalEpistemicParametricVariance > expectedBernoulli + 1e-12
  ) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}] has a variance component exceeding total Bernoulli variance (${expectedBernoulli})`,
    );
  }

  if (executedMethodCount === 1 && betweenMethodDisagreementVariance > 1e-12) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}].betweenMethodDisagreementVariance (${betweenMethodDisagreementVariance}) must be 0 when only 1 method was executed`,
    );
  }

  // 3. Independently recompute total epistemic parametric variance = within + between
  const recomputedEpistemic =
    withinMethodParametricVariance + betweenMethodDisagreementVariance;
  if (Math.abs(totalEpistemicParametricVariance - recomputedEpistemic) > 1e-12) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}].totalEpistemicParametricVariance (${totalEpistemicParametricVariance}) is inconsistent with within + between (${recomputedEpistemic})`,
    );
  }

  // 4. Independently recompute the true three-way closure residual and verify both
  //    trueResidual <= 1e-12 and |declaredResidual - trueResidual| <= 1e-12
  const recomputedTotal = aleatoricVariance + recomputedEpistemic;
  const trueResidual = Math.abs(expectedBernoulli - recomputedTotal);
  if (trueResidual > 1e-12) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}] violates three-way variance closure: true residual ${trueResidual} > 1e-12`,
    );
  }
  if (Math.abs(declaredResidual - trueResidual) > 1e-12) {
    throw new RangeError(
      `categoryDecompositions[${outcomeIndex}].closureResidual (${declaredResidual}) is falsified or inconsistent with recomputed residual (${trueResidual})`,
    );
  }

  return Object.freeze({
    outcomeIndex,
    outcomeLabel: outcomeLabel.trim(),
    predictiveProbability: pred,
    totalBernoulliVariance,
    aleatoricVariance,
    withinMethodParametricVariance,
    betweenMethodDisagreementVariance,
    totalEpistemicParametricVariance,
    closureResidual: declaredResidual,
    parametricInterval: validatedInterval,
  });
}

/**
 * Validates at runtime an `EntropyDecomposition`, autonomously verifying:
 *   1. `outcomes` is a valid exhaustive distribution (`validateExhaustiveDistribution`)
 *      with coherent dual-channel probabilities, normalized linear and log sums,
 *      and length matching `expectedOutcomeCount` (when provided, or `>= 2` otherwise).
 *   2. `executedMethodCount` (when provided) is a positive safe integer `>= 1`.
 *   3. All entropy and divergence components are finite, non-negative, and within
 *      their theoretical `[0, ln(K)]` / `[0, H(w)]` / `[0, 1]` ranges.
 *   4. Independent recomputation of the Shannon entropy `H(p_bar)` of `outcomes`,
 *      the closure residual `|H(p_bar) - (H_within + JSD_w)| <= 1e-12`, and the
 *      normalized disagreement index `JSD_w / H(w)` without trusting the declared
 *      `closureResidualNats` field [IME].
 */
export function validateEntropyDecomposition(
  value: unknown,
  outcomes: unknown,
  executedMethodCount?: number,
  expectedOutcomeCount?: number,
  weights?: readonly number[],
): EntropyDecomposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('EntropyDecomposition must be a non-null object');
  }
  if (expectedOutcomeCount !== undefined) {
    if (!Number.isSafeInteger(expectedOutcomeCount) || expectedOutcomeCount < 2) {
      throw new RangeError(
        `validateEntropyDecomposition requires expectedOutcomeCount to be an integer >= 2, received ${String(expectedOutcomeCount)}`,
      );
    }
  }
  const targetOutcomeCount =
    expectedOutcomeCount ??
    (Array.isArray(outcomes) && outcomes.length >= 2 ? outcomes.length : 2);
  const validatedOutcomes = validateExhaustiveDistribution(outcomes, targetOutcomeCount);

  if (executedMethodCount !== undefined) {
    if (!Number.isSafeInteger(executedMethodCount) || executedMethodCount < 1) {
      throw new RangeError(
        `validateEntropyDecomposition requires executedMethodCount to be an integer >= 1, received ${String(executedMethodCount)}`,
      );
    }
  }

  const cand = value as Record<string, unknown>;
  const totalPredictiveEntropyNats = cand.totalPredictiveEntropyNats;
  const withinMethodExpectedEntropyNats = cand.withinMethodExpectedEntropyNats;
  const jensenShannonDivergenceNats = cand.jensenShannonDivergenceNats;
  const normalizedDisagreementIndex = cand.normalizedDisagreementIndex;
  const declaredResidualNats = cand.closureResidualNats;

  if (
    !isFiniteNonNegativeNumber(totalPredictiveEntropyNats) ||
    !isFiniteNonNegativeNumber(withinMethodExpectedEntropyNats) ||
    !isFiniteNonNegativeNumber(jensenShannonDivergenceNats) ||
    !isFiniteNonNegativeNumber(normalizedDisagreementIndex) ||
    !isFiniteNonNegativeNumber(declaredResidualNats)
  ) {
    throw new RangeError(
      'EntropyDecomposition contains negative, NaN, or non-finite components',
    );
  }

  const maxEntropyNats = Math.log(validatedOutcomes.length);
  if (
    totalPredictiveEntropyNats > maxEntropyNats + 1e-12 ||
    withinMethodExpectedEntropyNats > maxEntropyNats + 1e-12 ||
    jensenShannonDivergenceNats > maxEntropyNats + 1e-12 ||
    normalizedDisagreementIndex > 1 + 1e-12
  ) {
    throw new RangeError(
      `EntropyDecomposition components exceed mathematical upper bounds (ln(K) = ${maxEntropyNats})`,
    );
  }

  // 1. Independently recompute H(p_bar) from the validated ensemble outcomes
  const expectedTotalEntropyNats = shannonEntropyFromDistribution(validatedOutcomes);
  if (Math.abs(totalPredictiveEntropyNats - expectedTotalEntropyNats) > 1e-12) {
    throw new RangeError(
      `EntropyDecomposition.totalPredictiveEntropyNats (${totalPredictiveEntropyNats}) does not match Shannon entropy of outcomes (${expectedTotalEntropyNats})`,
    );
  }

  // 2. Independently recompute true closure residual |H(p_bar) - (H_within + JSD_w)|
  const recomputedSumNats =
    withinMethodExpectedEntropyNats + jensenShannonDivergenceNats;
  const trueResidualNats = Math.abs(expectedTotalEntropyNats - recomputedSumNats);
  if (trueResidualNats > 1e-12) {
    throw new RangeError(
      `EntropyDecomposition violates H(p_bar) = H_within + JSD_w: true residual ${trueResidualNats} > 1e-12`,
    );
  }
  if (Math.abs(declaredResidualNats - trueResidualNats) > 1e-12) {
    throw new RangeError(
      `EntropyDecomposition.closureResidualNats (${declaredResidualNats}) is falsified or inconsistent with recomputed residual (${trueResidualNats})`,
    );
  }

  // 3. Check JSD_w and normalizedDisagreementIndex against weights H(w) or executedMethodCount
  if (jensenShannonDivergenceNats === 0 && normalizedDisagreementIndex > 1e-12) {
    throw new RangeError(
      `EntropyDecomposition.normalizedDisagreementIndex (${normalizedDisagreementIndex}) must be 0 when jensenShannonDivergenceNats is 0`,
    );
  }
  if (weights !== undefined) {
    if (!Array.isArray(weights) || weights.length === 0) {
      throw new RangeError('validateEntropyDecomposition requires a non-empty weights array');
    }
    if (executedMethodCount !== undefined && weights.length !== executedMethodCount) {
      throw new RangeError(
        `validateEntropyDecomposition weights length (${weights.length}) does not match executedMethodCount (${executedMethodCount})`,
      );
    }
    const normalizedWeights = validateAndNormalizeEnsembleWeights(
      weights,
      'validateEntropyDecomposition',
    );
    const { weightEntropyNats, positiveWeightCount } =
      shannonEntropyFromWeights(normalizedWeights);
    const expectedNormalizedIndex = computeNormalizedWeightedJsdIndex(
      jensenShannonDivergenceNats,
      weightEntropyNats,
      positiveWeightCount,
      'validateEntropyDecomposition',
    );
    if (Math.abs(normalizedDisagreementIndex - expectedNormalizedIndex) > 1e-12) {
      throw new RangeError(
        `EntropyDecomposition.normalizedDisagreementIndex (${normalizedDisagreementIndex}) does not match JSD_w / H(w) (${expectedNormalizedIndex})`,
      );
    }
  } else if (executedMethodCount !== undefined) {
    if (executedMethodCount === 1) {
      if (jensenShannonDivergenceNats > 1e-12 || normalizedDisagreementIndex > 1e-12) {
        throw new RangeError(
          'EntropyDecomposition with 1 executed method must have JSD = 0 and normalizedDisagreementIndex = 0',
        );
      }
    } else if (executedMethodCount >= 2) {
      const logM = Math.log(executedMethodCount);
      if (jensenShannonDivergenceNats > logM + 1e-12) {
        throw new RangeError(
          `EntropyDecomposition.jensenShannonDivergenceNats (${jensenShannonDivergenceNats}) exceeds ln(M) (${logM})`,
        );
      }
      // Since 0 < H(w) <= ln(M) for any weight distribution over M methods,
      // JSD_w / ln(M) <= JSD_w / H(w) <= 1.
      const minNormalizedIndex = Math.min(
        1,
        Math.max(0, jensenShannonDivergenceNats / logM),
      );
      if (normalizedDisagreementIndex + 1e-12 < minNormalizedIndex) {
        throw new RangeError(
          `EntropyDecomposition.normalizedDisagreementIndex (${normalizedDisagreementIndex}) is below lower bound JSD_w / ln(M) (${minNormalizedIndex})`,
        );
      }
    }
  }

  return Object.freeze({
    totalPredictiveEntropyNats,
    withinMethodExpectedEntropyNats,
    jensenShannonDivergenceNats,
    normalizedDisagreementIndex,
    closureResidualNats: declaredResidualNats,
  });
}

/**
 * Validates a complete `ForecastDistributionOutput` object at runtime, verifying:
 *   1. `questionCategory`, `outcomeSpace`, and `outcomes` (`validateExhaustiveDistribution`)
 *   2. `footingTier`, `calibrationStatus`, and `abstentionReason` (`assertCalibrationHonesty`)
 *   3. `epistemologicalClaims` and `methodologicalLimitations`
 *   4. `contrastReport` (`executedMethodIds`, `discardedMethods`, `weightsByMethod`,
 *      `effectiveIndependentMethodCount`)
 *   5. Independent recomputation of every `categoryDecompositions[k]` and
 *      `entropyDecomposition` without trusting declared closure residuals.
 */
export function validateForecastDistributionContract(
  value: unknown,
): ForecastDistributionOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('ForecastDistributionOutput must be a non-null object');
  }
  const cand = value as Record<string, unknown>;
  if (typeof cand.questionCategory !== 'string' || cand.questionCategory.trim().length === 0) {
    throw new RangeError('ForecastDistributionOutput.questionCategory must be a non-empty string');
  }

  const outcomeSpace = validateOutcomeSpaceDescriptor(cand.outcomeSpace);
  const outcomeCount = outcomeSpace.outcomeLabels.length;

  const footingTier = cand.footingTier as EvidentialFootingTier;
  const calibrationStatus = cand.calibrationStatus as CalibrationVerificationStatus;
  assertCalibrationHonesty(footingTier, calibrationStatus);

  const isAbstaining = footingTier === 'insufficient-basis-abstain';

  if (cand.abstentionReason !== undefined) {
    if (!isAbstaining) {
      throw new RangeError(
        `ForecastDistributionOutput with non-abstaining footingTier '${footingTier}' must not include abstentionReason ('${String(cand.abstentionReason)}')`,
      );
    }
    if (
      typeof cand.abstentionReason !== 'string' ||
      !ABSTENTION_REASONS.includes(cand.abstentionReason as AbstentionReason)
    ) {
      throw new RangeError(
        `Invalid ForecastDistributionOutput.abstentionReason: ${String(cand.abstentionReason)}`,
      );
    }
  } else if (isAbstaining) {
    throw new RangeError(
      "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' requires an abstentionReason",
    );
  }

  if (!Array.isArray(cand.epistemologicalClaims)) {
    throw new RangeError('ForecastDistributionOutput.epistemologicalClaims must be an array');
  }
  for (let i = 0; i < cand.epistemologicalClaims.length; i++) {
    const claim = cand.epistemologicalClaims[i] as Record<string, unknown> | undefined;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      throw new RangeError(`epistemologicalClaims[${i}] must be a non-null object`);
    }
    const kind = claim.kind as EpistemologicalClaimKind;
    const expectedTag = EPISTEMOLOGICAL_TAG_BY_KIND[kind];
    if (!expectedTag || claim.tag !== expectedTag) {
      throw new RangeError(
        `epistemologicalClaims[${i}] has incoherent (kind='${String(claim.kind)}', tag='${String(claim.tag)}')`,
      );
    }
    if (typeof claim.statement !== 'string' || claim.statement.trim().length === 0) {
      throw new RangeError(`epistemologicalClaims[${i}].statement must be a non-empty string`);
    }
  }

  if (!Array.isArray(cand.methodologicalLimitations)) {
    throw new RangeError('ForecastDistributionOutput.methodologicalLimitations must be an array');
  }
  for (let i = 0; i < cand.methodologicalLimitations.length; i++) {
    const lim = cand.methodologicalLimitations[i];
    if (typeof lim !== 'string' || lim.trim().length === 0) {
      throw new RangeError(`methodologicalLimitations[${i}] must be a non-empty string`);
    }
  }

  const contrastReport = cand.contrastReport as Record<string, unknown> | undefined;
  if (!contrastReport || typeof contrastReport !== 'object' || Array.isArray(contrastReport)) {
    throw new RangeError('ForecastDistributionOutput.contrastReport must be a non-null object');
  }

  const executedMethodIds = contrastReport.executedMethodIds;
  if (!Array.isArray(executedMethodIds)) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.executedMethodIds must be an array',
    );
  }
  const executedSet = new Set<string>();
  for (let m = 0; m < executedMethodIds.length; m++) {
    const id = executedMethodIds[m];
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new RangeError(`executedMethodIds[${m}] must be a non-empty string`);
    }
    if (executedSet.has(id)) {
      throw new RangeError(`executedMethodIds contains duplicate methodId '${id}'`);
    }
    executedSet.add(id);
  }

  const discardedMethods = contrastReport.discardedMethods;
  if (!Array.isArray(discardedMethods)) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.discardedMethods must be an array',
    );
  }
  for (let i = 0; i < discardedMethods.length; i++) {
    const dm = discardedMethods[i] as Record<string, unknown> | undefined;
    if (
      !dm ||
      typeof dm !== 'object' ||
      typeof dm.methodId !== 'string' ||
      dm.methodId.trim().length === 0 ||
      dm.applicable !== false ||
      typeof dm.rationale !== 'string' ||
      dm.rationale.trim().length === 0 ||
      !Array.isArray(dm.failedGateIds) ||
      executedSet.has(dm.methodId)
    ) {
      throw new RangeError(
        `contrastReport.discardedMethods[${i}] is invalid or overlaps with executedMethodIds`,
      );
    }
  }

  const weightsByMethod = contrastReport.weightsByMethod as Record<string, unknown> | undefined;
  if (
    !weightsByMethod ||
    typeof weightsByMethod !== 'object' ||
    Array.isArray(weightsByMethod)
  ) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.weightsByMethod must be a non-null object',
    );
  }

  const effectiveIndependentMethodCount = contrastReport.effectiveIndependentMethodCount;
  if (
    typeof effectiveIndependentMethodCount !== 'number' ||
    !Number.isFinite(effectiveIndependentMethodCount) ||
    Number.isNaN(effectiveIndependentMethodCount)
  ) {
    throw new RangeError(
      `contrastReport.effectiveIndependentMethodCount must be a finite number, received ${String(effectiveIndependentMethodCount)}`,
    );
  }

  const categoryDecompositions = contrastReport.categoryDecompositions as
    | readonly CategoryUncertaintyDecomposition[]
    | undefined;
  if (!Array.isArray(categoryDecompositions)) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.categoryDecompositions must be an array',
    );
  }

  if (isAbstaining) {
    if (!Array.isArray(cand.outcomes) || cand.outcomes.length !== 0) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have an empty outcomes array [] (never fabricate a distribution on abstention)",
      );
    }
    if (executedSet.size !== 0) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have executedMethodIds = []",
      );
    }
    if (
      contrastReport.ensembleContributingMethodIds !== undefined &&
      (!Array.isArray(contrastReport.ensembleContributingMethodIds) ||
        contrastReport.ensembleContributingMethodIds.length !== 0)
    ) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have ensembleContributingMethodIds = []",
      );
    }
    if (
      contrastReport.referenceOnlyMethodIds !== undefined &&
      (!Array.isArray(contrastReport.referenceOnlyMethodIds) ||
        contrastReport.referenceOnlyMethodIds.length !== 0)
    ) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have referenceOnlyMethodIds = []",
      );
    }
    if (Object.keys(weightsByMethod).length !== 0) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have empty weightsByMethod = {}",
      );
    }
    if (effectiveIndependentMethodCount !== 0) {
      throw new RangeError(
        `ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have effectiveIndependentMethodCount === 0, received ${effectiveIndependentMethodCount}`,
      );
    }
    if (contrastReport.statisticalIndependenceVerified === true) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' cannot have statisticalIndependenceVerified === true",
      );
    }
    if (
      contrastReport.independenceCertification !== undefined ||
      (contrastReport.independenceSemantics as Record<string, unknown> | undefined)
        ?.independenceCertification !== undefined
    ) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' cannot include an independenceCertification",
      );
    }
    if (categoryDecompositions.length !== 0) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have empty categoryDecompositions = []",
      );
    }
    if (contrastReport.entropyDecomposition !== null) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'insufficient-basis-abstain' must have entropyDecomposition === null",
      );
    }
    return value as ForecastDistributionOutput;
  }

  const outcomes = validateExhaustiveDistribution(cand.outcomes, outcomeCount);

  if (executedSet.size === 0) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.executedMethodIds must be a non-empty array for non-abstaining forecasts',
    );
  }

  let ensembleSet = executedSet;
  if (
    contrastReport.ensembleContributingMethodIds !== undefined ||
    contrastReport.referenceOnlyMethodIds !== undefined
  ) {
    const rawEnsemble = contrastReport.ensembleContributingMethodIds;
    const rawRefOnly = contrastReport.referenceOnlyMethodIds ?? [];
    if (!Array.isArray(rawEnsemble) || rawEnsemble.length === 0) {
      throw new RangeError(
        'contrastReport.ensembleContributingMethodIds must be a non-empty array for non-abstaining forecasts',
      );
    }
    if (!Array.isArray(rawRefOnly)) {
      throw new RangeError(
        'contrastReport.referenceOnlyMethodIds must be an array when provided',
      );
    }
    const ensSet = new Set<string>();
    for (let i = 0; i < rawEnsemble.length; i++) {
      const id = rawEnsemble[i];
      if (typeof id !== 'string' || !executedSet.has(id) || ensSet.has(id)) {
        throw new RangeError(
          `contrastReport.ensembleContributingMethodIds[${i}] ('${String(id)}') must be a unique member of executedMethodIds`,
        );
      }
      ensSet.add(id);
    }
    const refSet = new Set<string>();
    for (let i = 0; i < rawRefOnly.length; i++) {
      const id = rawRefOnly[i];
      if (
        typeof id !== 'string' ||
        !executedSet.has(id) ||
        ensSet.has(id) ||
        refSet.has(id)
      ) {
        throw new RangeError(
          `contrastReport.referenceOnlyMethodIds[${i}] ('${String(id)}') must be a unique member of executedMethodIds disjoint from ensembleContributingMethodIds`,
        );
      }
      refSet.add(id);
    }
    if (ensSet.size + refSet.size !== executedSet.size) {
      throw new RangeError(
        `ensembleContributingMethodIds (${ensSet.size}) and referenceOnlyMethodIds (${refSet.size}) must partition executedMethodIds (${executedSet.size})`,
      );
    }
    ensembleSet = ensSet;
  }

  const weightKeys = Object.keys(weightsByMethod);
  if (weightKeys.length !== ensembleSet.size) {
    throw new RangeError(
      `weightsByMethod key count (${weightKeys.length}) must match participating ensemble method count (${ensembleSet.size})`,
    );
  }
  const orderedWeights: number[] = [];
  for (const id of ensembleSet) {
    if (!Object.prototype.hasOwnProperty.call(weightsByMethod, id)) {
      throw new RangeError(`weightsByMethod is missing weight for participating method '${id}'`);
    }
    const w = weightsByMethod[id] as number;
    if (typeof w !== 'number' || !Number.isFinite(w) || Number.isNaN(w) || w <= 0 || w > 1) {
      throw new RangeError(
        `weightsByMethod['${id}'] must be a strictly positive finite weight in (0, 1], received ${String(w)}`,
      );
    }
    orderedWeights.push(w);
  }
  validateAndNormalizeEnsembleWeights(
    orderedWeights,
    'validateForecastDistributionContract[weightsByMethod]',
  );

  const rawSemantics = contrastReport.independenceSemantics as
    | Record<string, unknown>
    | undefined;
  const rawCert =
    contrastReport.independenceCertification ??
    rawSemantics?.independenceCertification;

  if (footingTier === 'structural-symmetry-baseline-only') {
    if (effectiveIndependentMethodCount !== 0) {
      throw new RangeError(
        `ForecastDistributionOutput with footingTier 'structural-symmetry-baseline-only' must have effectiveIndependentMethodCount === 0 (zero empirical evidence), received ${effectiveIndependentMethodCount}`,
      );
    }
    if (contrastReport.statisticalIndependenceVerified === true) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'structural-symmetry-baseline-only' cannot have statisticalIndependenceVerified === true",
      );
    }
    if (rawCert !== undefined) {
      throw new RangeError(
        "ForecastDistributionOutput with footingTier 'structural-symmetry-baseline-only' cannot include an independenceCertification",
      );
    }
  } else {
    if (contrastReport.statisticalIndependenceVerified === true) {
      throw new RangeError(
        "contrastReport.statisticalIndependenceVerified cannot be true in Stage 2A-2.3: no trusted verification mechanism exists to authenticate external independence references; certifications must remain 'declared' with statisticalIndependenceVerified = false",
      );
    }
    if (Math.abs(effectiveIndependentMethodCount - 1) > 1e-12) {
      throw new RangeError(
        `contrastReport.effectiveIndependentMethodCount (${String(effectiveIndependentMethodCount)}) must equal 1 for evidence-driven forecasts when no trusted verification authority has verified cross-method independence`,
      );
    }

    if (rawCert !== undefined) {
      const correlatedMethodSets: Array<readonly ScientificMethodId[]> = [];
      const depDiag = contrastReport.dependenceDiagnostics as
        | {
            readonly connectedComponents?: readonly {
              readonly applicableMethodIds: readonly ScientificMethodId[];
            }[];
            readonly binaryBetaDirichletEquivalence?: unknown;
          }
        | undefined;
      if (depDiag !== undefined) {
        if (Array.isArray(depDiag.connectedComponents)) {
          for (const g of depDiag.connectedComponents) {
            if (Array.isArray(g.applicableMethodIds)) {
              correlatedMethodSets.push(g.applicableMethodIds);
            }
          }
        }
        if (depDiag.binaryBetaDirichletEquivalence !== undefined) {
          correlatedMethodSets.push([
            'beta-binomial-conjugate',
            'dirichlet-multinomial-symmetry',
          ]);
        }
      }
      const wPolicy = contrastReport.weightingPolicy as
        | {
            readonly evidenceConnectedComponentCount?: number;
            readonly componentAllocations?: readonly {
              readonly memberMethodIds: readonly ScientificMethodId[];
            }[];
          }
        | undefined;
      if (wPolicy !== undefined && Array.isArray(wPolicy.componentAllocations)) {
        for (const comp of wPolicy.componentAllocations) {
          if (Array.isArray(comp.memberMethodIds)) {
            correlatedMethodSets.push(comp.memberMethodIds);
          }
        }
      }

      const validatedCert = validateStatisticalIndependenceCertification(rawCert, {
        expectedParticipatingMethodIds: [...ensembleSet] as ScientificMethodId[],
        correlatedMethodSets,
        ...(typeof wPolicy?.evidenceConnectedComponentCount === 'number'
          ? { maxIndependentComponents: wPolicy.evidenceConnectedComponentCount }
          : {}),
      });

      if (rawSemantics !== undefined) {
        if (
          rawSemantics.certificationTier !== undefined &&
          rawSemantics.certificationTier !== 'declared'
        ) {
          throw new RangeError(
            `contrastReport.independenceSemantics.certificationTier must be 'declared' when a declared independenceCertification is present, received '${String(rawSemantics.certificationTier)}'`,
          );
        }
        if (
          rawSemantics.declaredIndependentGroupCount !== undefined &&
          rawSemantics.declaredIndependentGroupCount !==
            validatedCert.certifiedIndependentGroups.length
        ) {
          throw new RangeError(
            `contrastReport.independenceSemantics.declaredIndependentGroupCount (${String(rawSemantics.declaredIndependentGroupCount)}) does not match certifiedIndependentGroups.length (${validatedCert.certifiedIndependentGroups.length})`,
          );
        }
      }
    } else if (
      rawSemantics !== undefined &&
      rawSemantics.certificationTier !== undefined &&
      rawSemantics.certificationTier !== 'none'
    ) {
      throw new RangeError(
        `contrastReport.independenceSemantics.certificationTier must be 'none' when no independenceCertification is present, received '${String(rawSemantics.certificationTier)}'`,
      );
    }
  }

  if (rawSemantics !== undefined) {
    if (
      rawSemantics.statisticalIndependenceVerified !==
      (contrastReport.statisticalIndependenceVerified === true)
    ) {
      throw new RangeError(
        'contrastReport.independenceSemantics.statisticalIndependenceVerified is inconsistent with contrastReport.statisticalIndependenceVerified',
      );
    }
    if (
      rawSemantics.effectiveIndependentMethodCount !==
      effectiveIndependentMethodCount
    ) {
      throw new RangeError(
        'contrastReport.independenceSemantics.effectiveIndependentMethodCount is inconsistent with contrastReport.effectiveIndependentMethodCount',
      );
    }
  }

  if (categoryDecompositions.length !== outcomeCount) {
    throw new RangeError(
      'ForecastDistributionOutput.contrastReport.categoryDecompositions must match outcomeSpace.outcomeLabels.length',
    );
  }

  for (let k = 0; k < outcomeCount; k++) {
    validateCategoryUncertaintyDecomposition(
      categoryDecompositions[k],
      k,
      outcomeSpace.outcomeLabels[k]!,
      outcomes[k]!,
      ensembleSet.size,
    );
  }

  validateEntropyDecomposition(
    contrastReport.entropyDecomposition,
    outcomes,
    ensembleSet.size,
    outcomeCount,
    orderedWeights,
  );

  return value as ForecastDistributionOutput;
}
