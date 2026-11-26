/**
 * THE ORACLE — Verified IEEE 754 `binary64` Numeric Primitives (Stage 2A-1)
 *
 * Implements the special-function, logarithmic-space, dual-channel probability,
 * and orthogonal uncertainty/entropy decomposition primitives specified in
 * Consolidated Mathematical Specification v4.4.3.
 *
 * Zero external npm dependencies; runs natively on Node.js / V8 IEEE 754 `binary64`.
 */

import type {
  Binary64ProbabilityStatus,
  CategoryUncertaintyDecomposition,
  ComplementaryLogCoherenceResult,
  DualChannelProbability,
  EntropyDecomposition,
  MethodCategoryContribution,
  NumericEvaluationOptions,
  ParametricIntervalField,
} from './forecast-types.ts';

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
 * Evaluates Laplace's Stieltjes continued fraction remainder
 * `R_CF(u) = (1/2) / (u + 1 / (u + (3/2) / (u + ...)))`
 * for `u > 0`, where `erfcx(u) = 1 / (sqrt(pi) * (u + R_CF(u)))` and
 * `-erfcx'(u) = 2 * R_CF(u) * erfcx(u) > 0` [IME / ANC].
 *
 * Because `a_k = k/2 > 0` and `b_k = u > 0`, the odd and even convergents of
 * this Stieltjes continued fraction monotonically bracket the exact value:
 * `C_{2m-1}(u) < R_CF(u) < C_{2m}(u)`.
 */
function evaluateLaplaceContinuedFractionR(u: number, maxIterations = 120): number {
  const TINY = 1e-300;
  let f = TINY;
  let c = f;
  let d = 0;
  let prevConvergent = 0;

  for (let k = 1; k <= maxIterations; k++) {
    const ak = 0.5 * k;
    const bk = u;
    d = bk + ak * d;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = bk + ak / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (k >= 2) {
      const enclosureWidth = Math.abs(f - prevConvergent);
      const minBracket = Math.min(f, prevConvergent);
      if (minBracket > 0 && enclosureWidth <= 1e-15 * minBracket) {
        return 0.5 * (f + prevConvergent);
      }
    }
    prevConvergent = f;
  }

  const finalWidth = Math.abs(f - prevConvergent);
  const finalMin = Math.max(1e-300, Math.min(f, prevConvergent));
  throw new NumericConvergenceError(
    'erfcxDiffPositive[LaplaceStieltjesCF]',
    maxIterations,
    finalWidth / finalMin,
    1e-15,
    `failed at u = ${u}`,
  );
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

/**
 * Evaluates `erfcx(a) - erfcx(b) >= 0` for `0 <= a <= b <= +Infinity` without
 * catastrophic cancellation when `a` and `b` are close [IME / ANC].
 *
 * Error bounds:
 *   1. Branch 1 (`erfcx(b) <= 0.75 * erfcx(a)`): direct subtraction has amplification
 *      `(1 + r) / (1 - r) <= 7`, giving relative error `<= 3.52e-14 < 1e-13`.
 *   2. Branch 2 (`erfcx(b) > 0.75 * erfcx(a)`): subdivides `[a, b]` into
 *      `M_sub = max(1, ceil((b - a) / (0.05 * max(1, a))))` subintervals of actual
 *      step `h_m = u_m - u_{m-1} <= 0.05 * max(1, u_{m-1})` (`h_m <= 0.075` on
 *      `[0, 1.5]`), and integrates `D_erfcx(u) = -erfcx'(u) > 0` via 8-point
 *      Gauss-Legendre quadrature.
 *      By the Peano-Markov remainder theorem and complete monotonicity of `erfcx`:
 *        - On `[0, 1.5]` (where `h_m <= 0.075` near `1.5`), the local relative
 *          quadrature remainder is `<= 3.10e-31`.
 *        - On `[1.5, +Infinity)`, the local relative quadrature remainder is `<= 1.85e-29`.
 *      Global relative tolerance `<= 1e-13` is certified on `0 <= a <= b <= 1e150`
 *      where `D_erfcx(u)` remains a normal IEEE 754 `binary64` float.
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
  const numSubintervals = Math.max(1, Math.ceil((b - a) / maxStep));
  const h = (b - a) / numSubintervals;

  let totalIntegral = 0;
  let compensation = 0;
  let totalPeanoRemainderBound = 0;

  for (let m = 0; m < numSubintervals; m++) {
    const uLeft = a + m * h;
    const uRight = m === numSubintervals - 1 ? b : a + (m + 1) * h;
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
    const subIntegral = halfH * subSum;
    const next = totalIntegral + subIntegral;
    if (Math.abs(totalIntegral) >= Math.abs(subIntegral)) {
      compensation += totalIntegral - next + subIntegral;
    } else {
      compensation += subIntegral - next + totalIntegral;
    }
    totalIntegral = next;

    // Local Peano-Markov remainder bound using actual subinterval step `actualH`
    const deriv17Bound =
      uLeft <= 1.25
        ? ERFCX_DERIV17_AT_ZERO
        : Math.min(
            ERFCX_DERIV17_AT_ZERO,
            ERFCX_DERIV17_ASYMPTOTIC_PREFACTOR / uLeft ** 18,
          );
    const localRemainder = PEANO_CONSTANT_GL8 * actualH ** 17 * deriv17Bound;
    totalPeanoRemainderBound += localRemainder;
  }

  const result = Math.max(0, totalIntegral + compensation);
  if (result > 0 && totalPeanoRemainderBound > 1e-14 * result) {
    throw new NumericConvergenceError(
      'erfcxDiffPositive[GaussLegendre8]',
      numSubintervals,
      totalPeanoRemainderBound / result,
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
      0.5 * Math.log(ab / (a * b)) -
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
    return 0.5 + Math.atan(t) / Math.PI;
  }
  if (df === 2) {
    const x = t / Math.hypot(t, Math.SQRT2);
    return 0.5 * (1 + x);
  }
  if (df === 4) {
    const x = t / Math.hypot(t, 2);
    return 0.5 + 0.25 * x * (3 - x * x);
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

/**
 * Evaluates the noncentral Student-t cumulative distribution function `F_{t_nu(delta)}(t)`
 * for `t in [-Infinity, +Infinity]`, `df in [1, 2000]`, and `|ncp| <= 50` using
 * Benton & Krishnamoorthy's (2003) modal expansion around `j_0 = floor(delta^2 / 2)` [IME / ANC]:
 *
 *   1. Exact boundary returns: `t === -Infinity -> 0`, `t === +Infinity -> 1`.
 *   2. Exact central delegation for `ncp === 0`: returns `studentTCdf(t, df)`.
 *   3. Exact origin shortcut for `t === 0`: returns `normalCdf(-ncp)`.
 *   4. Overflow-safe computation of `x = t^2 / (t^2 + df)` and `1 - x = df / (t^2 + df)`
 *      via `w = sqrt(df) / |t|` when `|t| > sqrt(df)` (preventing `Infinity / Infinity = NaN`
 *      for huge finite `t` such as `1e200`).
 *   5. Log-space initialization at `j_0 = floor(lambda)` (`lambda = delta^2 / 2`),
 *      preserving `sgn(delta)` in `q_j(delta)`.
 *   6. Upward recurrence (`j -> j + 1`) where multipliers `lambda / (j + 1) <= 1` and
 *      `lambda / (j + 3/2) < 1` are contractionary from `j_0`, and downward recurrence
 *      (`j -> j - 1`) where `p_{j-1} = p_j * (j / lambda)` has multiplier `<= 1` and
 *      `|q_{j-1}| = |q_j| * ((j + 1/2) / lambda)` can exceed `1` only on the first step
 *      `j = j_0` when `lambda - floor(lambda) < 0.5` (bounded by `<= 1.5` for `j_0 >= 1`)
 *      and is strictly `< 1` for all `j <= j_0 - 1`.
 *   7. Neumaier compensated summation of all series terms and a single strict truncation
 *      criterion `B_tail(S) <= 1e-12` within `maxIterations` (default `500`), throwing
 *      `NumericConvergenceError` if the bound is not reached.
 */
export function nonCentralStudentTCdf(
  t: number,
  df: number,
  ncp: number,
  options?: NumericEvaluationOptions,
): number {
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
      `nonCentralStudentTCdf requires t in [-Infinity, +Infinity], df in [1, 2000], |ncp| <= 50, received (${String(t)}, ${String(df)}, ${String(ncp)})`,
    );
  }
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
  if (t < 0) {
    return 1 - nonCentralStudentTCdf(-t, df, -ncp, options);
  }

  // Now t > 0 and ncp !== 0. Compute x = t^2 / (t^2 + df) and oneMinusX = df / (t^2 + df)
  // without overflowing t^2 for large finite t (such as t = 1e200).
  const sqrtDf = Math.sqrt(df);
  let x: number;
  let oneMinusX: number;
  if (t <= sqrtDf) {
    const u = (t * t) / df;
    x = u / (1 + u);
    oneMinusX = 1 / (1 + u);
  } else {
    const w = sqrtDf / t;
    const v = w * w;
    x = 1 / (1 + v);
    oneMinusX = v / (1 + v);
  }

  const lambda = 0.5 * ncp * ncp;
  const signDelta = ncp < 0 ? -1 : 1;
  const j0 = Math.floor(lambda);
  const halfDf = 0.5 * df;
  const maxSteps = options?.maxIterations ?? 500;

  const logP0 = -lambda + j0 * Math.log(lambda) - lnGamma(j0 + 1);
  const logAbsQ0 =
    Math.log(Math.abs(ncp) / Math.SQRT2) -
    lambda +
    j0 * Math.log(lambda) -
    lnGamma(j0 + 1.5);

  let pUp = Math.exp(logP0);
  let absQUp = Math.exp(logAbsQ0);
  let pDown = pUp;
  let absQDown = absQUp;

  // When oneMinusX === 0 (e.g., t = 1e200 where df / t^2 underflows below Number.MIN_VALUE),
  // use the exact complementary series 1 - 0.5 * sum_j [p_j I_{1-x}(df/2, j+1/2) + q_j I_{1-x}(df/2, j+1)]
  // so that I_0 = 0 yields exact 1.0 without residual tail offset, while still enforcing B_tail(S) <= 1e-12.
  const useComplementaryZeroTail = oneMinusX === 0;

  let sum = useComplementaryZeroTail ? 1 : normalCdf(-ncp);
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
    const iP = regularizedIncompleteBeta(x, j + 0.5, halfDf);
    const iQ = regularizedIncompleteBeta(x, j + 1, halfDf);
    return 0.5 * (pj * iP + signDelta * absQj * iQ);
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
    if (bTail <= 1e-12) {
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

/* -------------------------------------------------------------------------
   11. Orthogonal Variance & Entropy Decompositions (No Double-Counting)
   ------------------------------------------------------------------------- */

/**
 * Computes the exact three-way orthogonal variance decomposition for outcome
 * category `k` across a weighted ensemble of methods [IME]:
 *
 *   `p_bar_k * (1 - p_bar_k) = sigma^2_{aleatoric,k} + sigma^2_{within,k} + sigma^2_{between,k}`
 */
export function decomposeCategoryUncertainty(
  outcomeIndex: number,
  outcomeLabel: string,
  contributions: readonly MethodCategoryContribution[],
  parametricInterval: ParametricIntervalField,
): CategoryUncertaintyDecomposition {
  if (!Array.isArray(contributions) || contributions.length === 0) {
    throw new RangeError('decomposeCategoryUncertainty requires at least one method contribution');
  }

  const weights = contributions.map((c) => c.weight);
  const weightSum = kahanNeumaierSum(weights);
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new RangeError(
      `Method weights must sum to 1, received sum = ${weightSum}`,
    );
  }

  const logWeightedProbs: number[] = [];
  const logWeightedComps: number[] = [];

  for (let m = 0; m < contributions.length; m++) {
    const c = contributions[m]!;
    if (c.weight < 0 || c.weight > 1) {
      throw new RangeError(`Invalid method weight ${c.weight} at index ${m}`);
    }
    const p = c.predictiveProbability.probability;
    const q = c.predictiveProbability.complementProbability;
    const maxParamVar = p * q + 1e-15;
    if (c.parametricVariance < 0 || c.parametricVariance > maxParamVar) {
      throw new RangeError(
        `Invalid parametricVariance ${c.parametricVariance} for method '${c.methodId}': must lie in [0, p*(1-p)]`,
      );
    }
    if (c.weight > 0) {
      const logW = Math.log(c.weight);
      logWeightedProbs.push(logW + c.predictiveProbability.logProbability);
      logWeightedComps.push(logW + c.predictiveProbability.logComplementProbability);
    }
  }

  const logPBar = logSumExp(logWeightedProbs);
  const logQBar = logSumExp(logWeightedComps);
  const predictiveProbability = createDualChannelProbabilityFromPair(logPBar, logQBar);
  const pBar = predictiveProbability.probability;
  const qBar = predictiveProbability.complementProbability;
  const totalBernoulliVariance = pBar * qBar;

  const aleatoricTerms: number[] = [];
  const withinTerms: number[] = [];
  const betweenTerms: number[] = [];

  for (let m = 0; m < contributions.length; m++) {
    const c = contributions[m]!;
    const w = c.weight / weightSum;
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
    outcomeLabel,
    predictiveProbability,
    totalBernoulliVariance,
    aleatoricVariance,
    withinMethodParametricVariance,
    betweenMethodDisagreementVariance,
    totalEpistemicParametricVariance,
    closureResidual,
    parametricInterval,
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

/**
 * Computes the exact Shannon entropy and weighted Jensen-Shannon divergence
 * decomposition across `M` method distributions over `K` exhaustive outcomes [IME]:
 *
 *   `H(p_bar) = H_within + JSD_w`
 */
export function decomposeEnsembleEntropy(
  methodDistributions: readonly (readonly DualChannelProbability[])[],
  weights: readonly number[],
  ensembleDistribution: readonly DualChannelProbability[],
): EntropyDecomposition {
  if (
    methodDistributions.length === 0 ||
    methodDistributions.length !== weights.length ||
    ensembleDistribution.length === 0
  ) {
    throw new RangeError('Invalid arguments to decomposeEnsembleEntropy');
  }
  const weightSum = kahanNeumaierSum(weights);
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new RangeError(`Weights must sum to 1, received ${weightSum}`);
  }

  const totalPredictiveEntropyNats = shannonEntropyFromDistribution(ensembleDistribution);
  const withinTerms: number[] = [];
  const jsdTerms: number[] = [];

  for (let m = 0; m < methodDistributions.length; m++) {
    const dist = methodDistributions[m]!;
    if (dist.length !== ensembleDistribution.length) {
      throw new RangeError('All method distributions must match ensemble outcome count');
    }
    const w = weights[m]! / weightSum;
    if (w <= 0) {
      continue;
    }
    withinTerms.push(w * shannonEntropyFromDistribution(dist));

    // KL(p_m || p_bar) = sum_k p_{m,k} * (ln p_{m,k} - ln p_bar_k)
    for (let k = 0; k < dist.length; k++) {
      const pm = dist[k]!;
      const pBar = ensembleDistribution[k]!;
      if (pm.probability > 0 && Number.isFinite(pm.logProbability)) {
        jsdTerms.push(w * pm.probability * (pm.logProbability - pBar.logProbability));
      }
    }
  }

  const withinMethodExpectedEntropyNats = Math.max(0, kahanNeumaierSum(withinTerms));
  const jensenShannonDivergenceNats = Math.max(
    0,
    jsdTerms.length === 0 ? 0 : kahanNeumaierSum(jsdTerms),
  );
  const normalizedDisagreementIndex =
    methodDistributions.length >= 2
      ? Math.min(1, Math.max(0, jensenShannonDivergenceNats / Math.log(methodDistributions.length)))
      : 0;
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
