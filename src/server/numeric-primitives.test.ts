import { describe, expect, it } from 'vitest';
import {
  EPISTEMOLOGICAL_TAG_BY_KIND,
  assertCalibrationHonesty,
  isCalibrationFootingCoherent,
} from './forecast-types.ts';
import {
  LN_MIN_NORMAL_BINARY64,
  LN_MIN_SUBNORMAL_BINARY64,
  LN_ROUND_TO_ZERO_THRESHOLD_BINARY64,
  LN_SATURATED_TO_ONE_THRESHOLD_BINARY64,
  LN_SWITCH_LOG1MEXP,
  MAX_CERTIFIED_ERFCX_DIFF_ARG,
  NumericConvergenceError,
  classifyBinary64Probability,
  computeStudentT4InverseIntermediates,
  createDualChannelProbability,
  createDualChannelProbabilityFromComplementLog,
  createDualChannelProbabilityFromLog,
  createDualChannelProbabilityFromPair,
  decomposeCategoryUncertainty,
  decomposeEnsembleEntropy,
  erfcx,
  erfcxConditionNumber,
  erfcxDerivativePositive,
  erfcxDiffPositive,
  evaluateLaplaceStieltjesEnclosure,
  inverseNormalCdf,
  inverseRegularizedGammaQ,
  inverseRegularizedIncompleteBeta,
  inverseStudentTCdf,
  kahanNeumaierSum,
  lnBeta,
  lnGamma,
  log1mexp,
  logSumExp,
  nonCentralChiSquarePower,
  nonCentralStudentTCdf,
  nonCentralStudentTDualCdf,
  normalCdf,
  poissonDeviance,
  poissonDevianceTerm,
  regularizedGammaP,
  regularizedGammaQ,
  regularizedIncompleteBeta,
  stirlingError,
  studentTCdf,
  ulpBinary64,
  ulpDistanceBinary64,
  validateCategoryUncertaintyDecomposition,
  validateComplementaryLogPair,
  validateDualChannelProbability,
  validateEntropyDecomposition,
  validateExhaustiveDistribution,
  validateForecastDistributionContract,
  validateOutcomeSpaceDescriptor,
  validateParametricIntervalField,
} from './numeric-primitives.ts';

function expectRelativeErrorWithin(actual: number, expected: number, maxRelError: number): void {
  if (expected === 0) {
    expect(actual).toBe(0);
    return;
  }
  const relError = Math.abs(actual - expected) / Math.abs(expected);
  expect(relError).toBeLessThanOrEqual(maxRelError);
}

describe('Stage 2A-1 — Numeric Primitives & Forecast Contracts (v4.4.3)', () => {
  describe('1. Epistemological & Calibration Honesty Contracts (forecast-types.ts)', () => {
    it('maps every EpistemologicalClaimKind to its normative tag (IME, EBM, ANC, AA, HDO, HEN)', () => {
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['exact-mathematical-identity']).toBe('IME');
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['exact-under-explicit-model']).toBe('EBM');
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['controlled-numerical-approximation']).toBe('ANC');
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['asymptotic-approximation']).toBe('AA');
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['operational-design-heuristic']).toBe('HDO');
      expect(EPISTEMOLOGICAL_TAG_BY_KIND['unverified-empirical-hypothesis']).toBe('HEN');
    });

    it('forbids declaring empirically-calibrated-high-evidence without out-of-sample verification', () => {
      expect(
        isCalibrationFootingCoherent(
          'empirically-calibrated-high-evidence',
          'empirically-verified-out-of-sample',
        ),
      ).toBe(true);

      for (const uncalibratedStatus of [
        'unverified-no-out-of-sample-evaluation',
        'insufficient-resolved-history',
        'out-of-sample-evaluatable-not-calibrated',
      ] as const) {
        expect(
          isCalibrationFootingCoherent('empirically-calibrated-high-evidence', uncalibratedStatus),
        ).toBe(false);
        expect(() =>
          assertCalibrationHonesty('empirically-calibrated-high-evidence', uncalibratedStatus),
        ).toThrow(RangeError);
      }

      // Lower evidential tiers are permitted before out-of-sample calibration is achieved
      expect(() =>
        assertCalibrationHonesty(
          'methodologically-sound-moderate-evidence',
          'unverified-no-out-of-sample-evaluation',
        ),
      ).not.toThrow();
      expect(() =>
        assertCalibrationHonesty(
          'defensible-low-confidence-exploratory',
          'insufficient-resolved-history',
        ),
      ).not.toThrow();
      expect(() =>
        assertCalibrationHonesty(
          'structural-symmetry-baseline-only',
          'unverified-no-out-of-sample-evaluation',
        ),
      ).not.toThrow();
    });
  });

  describe('2. IEEE 754 binary64 ULP Inspection & Kahan-Neumaier Summation', () => {
    it('computes exact binary64 ULP spacing across normal, subnormal, zero, and MAX_VALUE', () => {
      expect(ulpBinary64(0)).toBe(Number.MIN_VALUE);
      expect(ulpBinary64(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
      expect(ulpBinary64(2 ** -1023)).toBe(Number.MIN_VALUE);
      expect(ulpBinary64(2 ** -1022)).toBe(Number.MIN_VALUE);
      expect(ulpBinary64(1)).toBe(Number.EPSILON);
      expect(ulpBinary64(-1)).toBe(Number.EPSILON);
      expect(ulpBinary64(2)).toBe(2 * Number.EPSILON);
      expect(ulpBinary64(Number.MAX_VALUE)).toBe(2 ** 971);
      expect(() => ulpBinary64(Number.NaN)).toThrow(RangeError);
      expect(() => ulpBinary64(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('computes exact integer ULP distances between adjacent floats', () => {
      expect(ulpDistanceBinary64(1, 1 + Number.EPSILON)).toBe(1);
      expect(ulpDistanceBinary64(1, 1 + 3 * Number.EPSILON)).toBe(3);
      expect(ulpDistanceBinary64(0, Number.MIN_VALUE)).toBe(1);
      expect(ulpDistanceBinary64(-0, 0)).toBe(0);
      expect(ulpDistanceBinary64(1, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
      expect(() => ulpDistanceBinary64(Number.NaN, 1)).toThrow(RangeError);
    });

    it('accumulates ill-conditioned alternating series via kahanNeumaierSum without loss', () => {
      const values = [1.0, 1e16, 1.0, -1e16, 1.0];
      expect(kahanNeumaierSum(values)).toBe(3.0);
      expect(() => kahanNeumaierSum([1, Number.NaN])).toThrow(RangeError);
      expect(() => kahanNeumaierSum([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
    });
  });

  describe('3. logSumExp — Shift by Maximum, Compensated Summation & Extreme Binary64 Range', () => {
    it('returns -Infinity when all entries are -Infinity', () => {
      expect(logSumExp([Number.NEGATIVE_INFINITY])).toBe(Number.NEGATIVE_INFINITY);
      expect(
        logSumExp([
          Number.NEGATIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
        ]),
      ).toBe(Number.NEGATIVE_INFINITY);
    });

    it('ignores -Infinity terms when at least one finite entry is present', () => {
      expect(logSumExp([Number.NEGATIVE_INFINITY, -3.5, Number.NEGATIVE_INFINITY])).toBe(-3.5);
      expect(logSumExp([Number.NEGATIVE_INFINITY, 0, 0])).toBeCloseTo(Math.LN2, 15);
    });

    it('evaluates extreme negative and positive magnitudes without underflow or overflow, including [1e308, 1e308]', () => {
      // Deep negative regime where naive exp(-1000) === 0
      const neg1000 = logSumExp([-1000, -1000, -1000]);
      const expectedNeg1000 = -1000 + Math.log(3);
      expect(ulpDistanceBinary64(neg1000, expectedNeg1000)).toBeLessThanOrEqual(2);

      // Extreme positive magnitude [1e308, 1e308]:
      // ulp(1e308) = 2^970 ~ 9.98e291 >> ln(2), so fl(1e308 + ln(2)) === 1e308 within 0.5 ULP
      const extremePos = logSumExp([1e308, 1e308]);
      expect(Number.isFinite(extremePos)).toBe(true);
      expect(extremePos).toBe(1e308);
      expect(ulpDistanceBinary64(extremePos, 1e308 + Math.LN2)).toBeLessThanOrEqual(1);

      // Extreme negative magnitude [-1e308, -1e308]
      const extremeNeg = logSumExp([-1e308, -1e308]);
      expect(Number.isFinite(extremeNeg)).toBe(true);
      expect(ulpDistanceBinary64(extremeNeg, -1e308 + Math.LN2)).toBeLessThanOrEqual(1);

      // Wide dynamic range [1e308, -1e308]
      expect(logSumExp([1e308, -1e308])).toBe(1e308);

      // Single element is exact to 0 ULP across all magnitudes
      for (const x of [-1e308, -745, -1, 0, 1, 709, 1e308]) {
        expect(logSumExp([x])).toBe(x);
      }
    });

    it('satisfies the relative / ULP error bound across large arrays of 10,000 elements', () => {
      const n = 10_000;
      const val = -250.5;
      const arr = new Array<number>(n).fill(val);
      const actual = logSumExp(arr);
      const expected = val + Math.log(n);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        Math.max(2.5e-15, 2 * ulpBinary64(expected)),
      );
    });

    it('rejects empty arrays, NaN, and +Infinity at any index with RangeError', () => {
      expect(() => logSumExp([])).toThrow(RangeError);
      expect(() => logSumExp([Number.NaN])).toThrow(RangeError);
      expect(() => logSumExp([Number.NEGATIVE_INFINITY, Number.NaN])).toThrow(RangeError);
      expect(() => logSumExp([1, 2, Number.NaN])).toThrow(RangeError);
      expect(() => logSumExp([Number.POSITIVE_INFINITY])).toThrow(RangeError);
      expect(() => logSumExp([-10, Number.POSITIVE_INFINITY])).toThrow(RangeError);
      expect(() =>
        logSumExp([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]),
      ).toThrow(RangeError);
    });
  });

  describe('4. log1mexp & IEEE 754 binary64 Probability Regimes & ULP Validation', () => {
    it('verifies exact IEEE 754 binary64 threshold constants', () => {
      expect(LN_MIN_NORMAL_BINARY64).toBeCloseTo(-708.3964185322641, 12);
      expect(LN_MIN_SUBNORMAL_BINARY64).toBeCloseTo(-744.4400719213812, 12);
      expect(LN_ROUND_TO_ZERO_THRESHOLD_BINARY64).toBeCloseTo(-745.1332191019412, 12);
      expect(LN_SATURATED_TO_ONE_THRESHOLD_BINARY64).toBeCloseTo(-37.42994775023705, 13);
      expect(LN_SWITCH_LOG1MEXP).toBeCloseTo(-0.6931471805599453, 15);
    });

    it('evaluates log1mexp accurately across near-zero, switch point, normal, subnormal, and underflow regimes', () => {
      // Near 0 (x = -1e-12): reference -27.631021115929048208
      expectRelativeErrorWithin(log1mexp(-1e-12), -27.631021115929048208, 1e-15);

      // At switch point -ln(2): ln(1 - 0.5) = -ln(2)
      expect(ulpDistanceBinary64(log1mexp(-Math.LN2), -Math.LN2)).toBeLessThanOrEqual(1);

      // At x = -40: must NOT return 0; returns -exp(-40) ~ -4.248354255291589e-18
      const l40 = log1mexp(-40);
      expect(l40).not.toBe(0);
      expectRelativeErrorWithin(l40, -4.2483542552915889953e-18, 1e-15);

      // Normal boundary -1022 * ln(2) ~ -708.3964185322641
      const lNormalMin = log1mexp(LN_MIN_NORMAL_BINARY64);
      expect(lNormalMin).toBeLessThan(0);
      expect(Math.abs(lNormalMin)).toBeGreaterThanOrEqual(2 ** -1022);

      // Subnormal regime (-720): -exp(-720) is non-zero subnormal
      const lSub = log1mexp(-720);
      expect(lSub).toBeLessThan(0);
      expect(Math.abs(lSub)).toBeLessThan(2 ** -1022);
      expect(Math.abs(lSub)).toBeGreaterThanOrEqual(Number.MIN_VALUE);

      // Smallest subnormal -1074 * ln(2) ~ -744.4400719213812
      expect(log1mexp(LN_MIN_SUBNORMAL_BINARY64)).toBe(-Number.MIN_VALUE);

      // Round-to-zero boundary -1075 * ln(2) ~ -745.1332191019412
      expect(Math.exp(LN_ROUND_TO_ZERO_THRESHOLD_BINARY64)).toBe(0);
      expect(log1mexp(LN_ROUND_TO_ZERO_THRESHOLD_BINARY64)).toBe(0);

      // Exact endpoints and invalid inputs
      expect(log1mexp(0)).toBe(Number.NEGATIVE_INFINITY);
      expect(log1mexp(-0)).toBe(Number.NEGATIVE_INFINITY);
      expect(log1mexp(Number.NEGATIVE_INFINITY)).toBe(0);
      expect(() => log1mexp(1e-10)).toThrow(RangeError);
      expect(() => log1mexp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => log1mexp(Number.NaN)).toThrow(RangeError);
    });

    it('classifies all 6 binary64 probability states and enforces ULP complementary log coherence', () => {
      // 1. exact-zero
      expect(classifyBinary64Probability(Number.NEGATIVE_INFINITY, 0)).toBe('exact-zero');
      // 2. exact-one
      expect(classifyBinary64Probability(0, Number.NEGATIVE_INFINITY)).toBe('exact-one');
      // 3. underflow-to-zero at -745.1332191019412
      expect(classifyBinary64Probability(-745.1332191019412, -0.0)).toBe('underflow-to-zero');
      expect(classifyBinary64Probability(-800, 0)).toBe('underflow-to-zero');
      // 4. subnormal-probability in (-745.1332191019412, -708.3964185322641)
      expect(classifyBinary64Probability(-720, log1mexp(-720))).toBe('subnormal-probability');
      expect(
        classifyBinary64Probability(LN_MIN_SUBNORMAL_BINARY64, -Number.MIN_VALUE),
      ).toBe('subnormal-probability');
      // 5. interior-normal
      expect(classifyBinary64Probability(-40, log1mexp(-40))).toBe('interior-normal');
      expect(classifyBinary64Probability(Math.log(0.25), Math.log(0.75))).toBe('interior-normal');
      // 6. saturated-to-one when logCompProb <= -54 * ln(2)
      expect(classifyBinary64Probability(log1mexp(-40), -40)).toBe('saturated-to-one');
      expect(
        classifyBinary64Probability(
          log1mexp(LN_SATURATED_TO_ONE_THRESHOLD_BINARY64),
          LN_SATURATED_TO_ONE_THRESHOLD_BINARY64,
        ),
      ).toBe('saturated-to-one');

      // Mandatory rejections from v4.4.1–v4.4.3 specification:
      expect(() => classifyBinary64Probability(-708.3964185322641, -0.0)).toThrow(RangeError);
      expect(() => classifyBinary64Probability(-708.3964185322642, -0.0)).toThrow(RangeError);
      expect(() => classifyBinary64Probability(-745.1332191019411, -0.0)).toThrow(RangeError);

      // Additional incoherent pairs
      expect(() => classifyBinary64Probability(-1, -1)).toThrow(RangeError);
      expect(() => classifyBinary64Probability(-20, -1e-6)).toThrow(RangeError);
      expect(() => classifyBinary64Probability(Number.NEGATIVE_INFINITY, -1)).toThrow(RangeError);
      expect(() => classifyBinary64Probability(-1, Number.NEGATIVE_INFINITY)).toThrow(RangeError);
      expect(validateComplementaryLogPair(0.5, -1).valid).toBe(false);
    });

    it('constructs immutable DualChannelProbability instances preserving tail precision', () => {
      const sat = createDualChannelProbabilityFromComplementLog(-45);
      expect(sat.status).toBe('saturated-to-one');
      expect(sat.probability).toBe(1);
      expect(sat.logComplementProbability).toBe(-45);
      expect(sat.complementProbability).toBe(Math.exp(-45));

      const sub = createDualChannelProbabilityFromLog(-725);
      expect(sub.status).toBe('subnormal-probability');
      expect(sub.probability).toBe(Math.exp(-725));
      expect(sub.probability).toBeGreaterThan(0);
      expect(sub.probability).toBeLessThan(2 ** -1022);

      const pHalf = createDualChannelProbability(0.5);
      expect(pHalf.status).toBe('interior-normal');
      expect(pHalf.probability).toBe(0.5);
      expect(pHalf.complementProbability).toBe(0.5);
      expect(Object.isFrozen(pHalf)).toBe(true);

      const pPair = createDualChannelProbabilityFromPair(Math.log(0.25), Math.log(0.75));
      expect(pPair.status).toBe('interior-normal');
      expect(pPair.probability).toBeCloseTo(0.25, 15);
      expect(pPair.complementProbability).toBeCloseTo(0.75, 15);

      const pZero = createDualChannelProbability(0);
      expect(pZero.status).toBe('exact-zero');
      const pOne = createDualChannelProbability(1);
      expect(pOne.status).toBe('exact-one');
    });
  });

  describe('5. erfcx, erfcxConditionNumber, & erfcxDiffPositive (Peano-Markov & Stieltjes Bounds)', () => {
    it('matches 20-digit reference values for erfcx across [0, 100] and +Infinity', () => {
      const references: ReadonlyArray<readonly [number, number]> = [
        [0.0, 1.0],
        [0.1, 0.89645697996912663972],
        [0.25, 0.77034654773099673818],
        [0.46875, 0.6320696892495560662],
        [1.0, 0.42758357615580695976],
        [1.5, 0.3215854164543173237],
        [2.0, 0.25539567631050468468],
        [4.0, 0.13699945762506139256],
        [5.0, 0.11070463773306862853],
        [10.0, 0.056140992743822586952],
        [50.0, 0.01128153626532377272],
        [100.0, 0.0056416137829894330135],
      ];

      for (const [x, expected] of references) {
        expectRelativeErrorWithin(erfcx(x), expected, 5e-15);
      }
      expect(erfcx(Number.POSITIVE_INFINITY)).toBe(0);
      expect(() => erfcx(-0.1)).toThrow(RangeError);
      expect(() => erfcx(Number.NaN)).toThrow(RangeError);
    });

    it('verifies erfcxConditionNumber is strictly increasing in [0, 1) for finite x >= 0', () => {
      expect(erfcxConditionNumber(0)).toBe(0);
      expect(erfcxConditionNumber(Number.POSITIVE_INFINITY)).toBe(1);
      let prev = 0;
      for (const x of [0.1, 0.5, 1.0, 1.5, 2.0, 5.0, 10.0, 50.0, 100.0]) {
        const kappa = erfcxConditionNumber(x);
        expect(kappa).toBeGreaterThan(prev);
        expect(kappa).toBeLessThan(1);
        prev = kappa;
      }
    });

    it('evaluates Euler-Wallis Stieltjes convergents and certified enclosures in evaluateLaplaceStieltjesEnclosure and erfcxDerivativePositive across (1.5, 60]', () => {
      // 25-digit independent Decimal(80) reference values for (u, R_CF(u), D_erfcx(u))
      const stieltjesReferences: ReadonlyArray<readonly [number, number, number]> = [
        [1.500001, 2.544002935301332038551633e-1, 1.636227654305791485407763e-1],
        [1.6, 2.440400904728857946626332e-1, 1.493295918285011707874553e-1],
        [2.0, 2.090804029972070989864449e-1, 1.067964618534895984358046e-1],
        [3.0, 1.518768445016172124848946e-1, 5.437226000717287138039001e-2],
        [5.0, 9.635002743184075330852912e-2, 2.133278976482631019403804e-2],
        [10.0, 4.951205836730211477222544e-2, 5.559312219060856745811159e-3],
        [30.0, 1.664819937811420283776863e-2, 6.258354105074840686391602e-4],
        [60.0, 8.331020124378828964583477e-3, 1.566540743459432434058823e-4],
      ];

      for (const [u, exactRCf, exactDErfcx] of stieltjesReferences) {
        const enc = evaluateLaplaceStieltjesEnclosure(u);
        expect(enc.lowerConvergent).toBeLessThanOrEqual(enc.upperConvergent);
        expect(enc.certifiedLowerBound).toBeLessThanOrEqual(exactRCf);
        expect(enc.certifiedUpperBound).toBeGreaterThanOrEqual(exactRCf);
        expect(Math.abs(enc.value - exactRCf)).toBeLessThanOrEqual(enc.certifiedErrorBound);
        expectRelativeErrorWithin(enc.value, exactRCf, 2e-15);
        expectRelativeErrorWithin(erfcxDerivativePositive(u), exactDErfcx, 5e-15);
      }

      expect(() => evaluateLaplaceStieltjesEnclosure(0)).toThrow(RangeError);
      expect(() => evaluateLaplaceStieltjesEnclosure(-1)).toThrow(RangeError);
      expect(() => evaluateLaplaceStieltjesEnclosure(2.0, 2)).toThrow(NumericConvergenceError);
    });

    it('evaluates erfcxDiffPositive with relative error <= 1e-13 across direct, Stieltjes CF, and asymptotic regimes', () => {
      // Exact zero and infinite upper bound
      expect(erfcxDiffPositive(2.5, 2.5)).toBe(0);
      expect(erfcxDiffPositive(1.0, Number.POSITIVE_INFINITY)).toBe(erfcx(1.0));

      // Direct subtraction regime (erfcx(b) <= 0.75 * erfcx(a))
      expectRelativeErrorWithin(
        erfcxDiffPositive(0.0, 1.0),
        1.0 - 0.42758357615580695976,
        1e-13,
      );

      // Counterexample from v4.4.2 where erfcx(b) > 0.75 * erfcx(a) and (b - a) / max(1, a) = 0.5055 > 0.35
      expectRelativeErrorWithin(
        erfcxDiffPositive(1.0, 1.50550065356),
        1.0689589403857435242e-1,
        1e-13,
      );

      // Branch transitions in erfcxDiffPositive:
      // 1. Just inside quadrature branch (r = erfcx(1.5055)/erfcx(1.0) = 0.7500002488 > 0.75)
      expectRelativeErrorWithin(
        erfcxDiffPositive(1.0, 1.5055),
        1.0689578764672721402e-1,
        1e-13,
      );
      // 2. Just inside direct subtraction branch (r = erfcx(1.5056)/erfcx(1.0) = 0.7499621789 <= 0.75)
      expectRelativeErrorWithin(
        erfcxDiffPositive(1.0, 1.5056),
        1.0691206571424832271e-1,
        1e-13,
      );
      // 3. Straddling derivative branch switch u = 1.5
      expectRelativeErrorWithin(
        erfcxDiffPositive(1.49, 1.51),
        3.272524217491019279e-3,
        1e-13,
      );
      // 4. Straddling derivative branch switch u = 60.0 (Stieltjes CF to asymptotic series)
      expectRelativeErrorWithin(
        erfcxDiffPositive(59.95, 60.05),
        1.566541830279402072e-5,
        1e-13,
      );
      // 5. Extreme large asymptotic u = 500
      expectRelativeErrorWithin(
        erfcxDiffPositive(500.0, 500.001),
        2.2567402802695787705e-9,
        1e-13,
      );

      // Subinterval crossing u = 1.5 (where local max step h_m <= 0.075 gives Peano bound <= 3.10e-31)
      expectRelativeErrorWithin(
        erfcxDiffPositive(1.4, 1.6),
        3.2790548408793598978e-2,
        1e-13,
      );

      // Close intervals: verify against the exact mathematical difference of the represented binary64 floats
      expectRelativeErrorWithin(
        erfcxDiffPositive(0.5, 0.5 + 1e-8),
        5.1268882188526531095e-9,
        1e-13,
      );
      expectRelativeErrorWithin(
        erfcxDiffPositive(10.0, 10.0 + 1e-8),
        5.5593126735617059257e-11,
        1e-13,
      );
      expectRelativeErrorWithin(
        erfcxDiffPositive(100.0, 100.0 + 1e-6),
        5.6410496919549989106e-11,
        1e-13,
      );

      // Exact upper domain boundary MAX_CERTIFIED_ERFCX_DIFF_ARG = 1e150:
      // Verifies logarithmic Peano-Markov remainder evaluation without uLeft**18 or actualH**17
      // overflow/underflow or Infinity * 0 = NaN, achieving relative error <= 1e-13:
      const upperA = MAX_CERTIFIED_ERFCX_DIFF_ARG * (1 - 1e-6);
      const upperB = MAX_CERTIFIED_ERFCX_DIFF_ARG;
      const upperVal = erfcxDiffPositive(upperA, upperB);
      expect(Number.isNaN(upperVal)).toBe(false);
      expect(Number.isFinite(upperVal)).toBe(true);
      expectRelativeErrorWithin(upperVal, 5.6419014770520466e-157, 1e-13);

      // Infinite upper bound at the exact upper limit a = MAX_CERTIFIED_ERFCX_DIFF_ARG
      expect(
        erfcxDiffPositive(MAX_CERTIFIED_ERFCX_DIFF_ARG, Number.POSITIVE_INFINITY),
      ).toBe(erfcx(MAX_CERTIFIED_ERFCX_DIFF_ARG));

      // First representable binary64 float strictly above MAX_CERTIFIED_ERFCX_DIFF_ARG is rejected:
      const firstRejectedAboveMax =
        MAX_CERTIFIED_ERFCX_DIFF_ARG + ulpBinary64(MAX_CERTIFIED_ERFCX_DIFF_ARG);
      expect(firstRejectedAboveMax).toBeGreaterThan(MAX_CERTIFIED_ERFCX_DIFF_ARG);
      expect(() =>
        erfcxDiffPositive(MAX_CERTIFIED_ERFCX_DIFF_ARG, firstRejectedAboveMax),
      ).toThrow(RangeError);
      expect(() =>
        erfcxDiffPositive(firstRejectedAboveMax, firstRejectedAboveMax),
      ).toThrow(RangeError);
      expect(() =>
        erfcxDiffPositive(firstRejectedAboveMax, Number.POSITIVE_INFINITY),
      ).toThrow(RangeError);

      // Also verify against the decimal-ideal references of v4.4.3 within the exact binary64 input-rounding bound
      expectRelativeErrorWithin(
        erfcxDiffPositive(0.5, 0.5 + 1e-8),
        5.1268881930912739381e-9,
        1e-8,
      );
      expectRelativeErrorWithin(
        erfcxDiffPositive(10.0, 10.0 + 1e-8),
        5.559312213582151219e-11,
        1e-7,
      );
      expectRelativeErrorWithin(
        erfcxDiffPositive(100.0, 100.0 + 1e-6),
        5.6410497061972800392e-11,
        1e-8,
      );
    });

    it('throws NumericConvergenceError when Stieltjes CF or adaptive GL8 iteration budget is insufficient and rejects invalid domains', () => {
      expect(() => erfcxDiffPositive(2.0, 2.01, { maxIterations: 3 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => erfcxDiffPositive(1.0, 1.5055, { maxIterations: 2 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => erfcxDerivativePositive(2.0, { maxIterations: 3 })).toThrow(RangeError);
      expect(() => erfcxDiffPositive(-1, 1)).toThrow(RangeError);
      expect(() => erfcxDiffPositive(2, 1)).toThrow(RangeError);
      expect(() => erfcxDiffPositive(Number.NaN, 1)).toThrow(RangeError);
    });
  });

  describe('6. lnGamma, stirlingError, lnBeta, & poissonDeviance', () => {
    it('evaluates lnGamma near 1 and 2 without cancellation and without zeta(1), matching represented and decimal references', () => {
      expect(lnGamma(1.0)).toBe(0);
      expect(lnGamma(2.0)).toBe(0);

      // Verify against the exact mathematical value at the represented binary64 float (<= 1e-20 abs error)
      expect(Math.abs(lnGamma(1.0 + 1e-5) - -5.7720744027504826216e-6)).toBeLessThanOrEqual(
        1e-20,
      );
      expect(Math.abs(lnGamma(1.0 - 1e-5) - 5.7722388960930893727e-6)).toBeLessThanOrEqual(
        1e-20,
      );
      expect(Math.abs(lnGamma(2.0 + 1e-5) - 4.2278755976483595969e-6)).toBeLessThanOrEqual(
        1e-20,
      );
      expect(Math.abs(lnGamma(2.0 - 1e-5) - -4.2278111042416735176e-6)).toBeLessThanOrEqual(
        1e-20,
      );

      // Also verify against the v4.4.3 decimal-ideal references within the 5e-15 absolute tolerance
      expect(Math.abs(lnGamma(1.0 + 1e-5) - -5.7720744027126691233e-6)).toBeLessThanOrEqual(
        5e-15,
      );
      expect(Math.abs(lnGamma(1.0 - 1e-5) - 5.7722388961193593576e-6)).toBeLessThanOrEqual(
        5e-15,
      );
      expect(Math.abs(lnGamma(2.0 + 1e-5) - 4.22787559762066171e-6)).toBeLessThanOrEqual(
        5e-15,
      );
      expect(Math.abs(lnGamma(2.0 - 1e-5) - -4.2278111042139764758e-6)).toBeLessThanOrEqual(
        5e-15,
      );
    });

    it('matches high-precision references for lnGamma, stirlingError, and lnBeta(2.5, 4.5) = ln(7*pi/1024)', () => {
      expectRelativeErrorWithin(lnGamma(0.1), 2.2527126517342059599, 5e-15);
      expectRelativeErrorWithin(lnGamma(0.5), 0.5 * Math.log(Math.PI), 5e-15);
      expectRelativeErrorWithin(lnGamma(1.5), Math.log(0.5 * Math.sqrt(Math.PI)), 5e-15);
      expectRelativeErrorWithin(lnGamma(10.0), Math.log(362880), 5e-15);
      expectRelativeErrorWithin(lnGamma(50.0), 144.56574394634488607, 5e-15);

      // Exact identity B(5/2, 9/2) = 7 * pi / 1024 = 0.021475731030398977216
      const expectedLnBeta = Math.log((7 * Math.PI) / 1024);
      expect(Math.abs(lnBeta(2.5, 4.5) - expectedLnBeta)).toBeLessThanOrEqual(1e-15);

      // Large parameters a = 1000, b = 1000 via stirlingError decomposition
      expectRelativeErrorWithin(
        stirlingError(20),
        1 / (12 * 20) - 1 / (360 * 8000) + 1 / (1260 * 3_200_000) - 1 / (1680 * 1_280_000_000),
        1e-12,
      );
      expect(lnBeta(1000, 1000)).toBeLessThan(0);

      expect(() => lnGamma(0)).toThrow(RangeError);
      expect(() => lnGamma(-2)).toThrow(RangeError);
      expect(() => lnGamma(1e9)).toThrow(RangeError);
    });

    it('evaluates poissonDeviance without catastrophic cancellation when y ~ mu', () => {
      expect(poissonDevianceTerm(0, 3.5)).toBe(7.0);
      expect(poissonDevianceTerm(4.2, 4.2)).toBe(0);
      // Exact dyadic perturbation y = 1024, u = 2^-24 where mu = y * (1 + u) has zero input rounding
      const y = 1024;
      const u = 2 ** -24;
      const mu = y * (1 + u);
      const dev = poissonDeviance([y], [mu]);
      const expected = 2 * y * (u * u * (0.5 - u / 3 + (u * u) / 4));
      expectRelativeErrorWithin(dev, expected, 1e-14);
    });
  });

  describe('7. Regularized Incomplete Gamma P, Q & inverseRegularizedGammaQ', () => {
    it('enforces exact boundary contracts at x = 0, x = +Infinity, q = 1, and q = 0', () => {
      for (const a of [0.05, 0.5, 1.0, 2.5, 100.0, 4999.5, 10000.0]) {
        expect(regularizedGammaP(a, 0)).toBe(0);
        expect(regularizedGammaQ(a, 0)).toBe(1);
        expect(regularizedGammaP(a, Number.POSITIVE_INFINITY)).toBe(1);
        expect(regularizedGammaQ(a, Number.POSITIVE_INFINITY)).toBe(0);
        expect(inverseRegularizedGammaQ(a, 1)).toBe(0);
        expect(inverseRegularizedGammaQ(a, 0)).toBe(Number.POSITIVE_INFINITY);
      }
    });

    it('matches inverseRegularizedGammaQ(4999.5, 0.50) = 4999.1666706179675725 and round-trips P + Q = 1', () => {
      const xMed = inverseRegularizedGammaQ(4999.5, 0.5);
      expectRelativeErrorWithin(xMed, 4999.1666706179675725, 1e-13);
      expect(Math.abs(regularizedGammaQ(4999.5, xMed) - 0.5)).toBeLessThanOrEqual(1e-13);
      expect(Math.abs(regularizedGammaP(4999.5, xMed) - 0.5)).toBeLessThanOrEqual(1e-13);

      for (const [a, q] of [
        [0.5, 0.05],
        [1.0, 0.1],
        [2.5, 0.25],
        [10.0, 0.01],
        [250.0, 0.9],
      ] as const) {
        const x = inverseRegularizedGammaQ(a, q);
        const qBack = regularizedGammaQ(a, x);
        const pBack = regularizedGammaP(a, x);
        expect(Math.abs(pBack + qBack - 1)).toBeLessThanOrEqual(1e-15);
        expectRelativeErrorWithin(qBack, q, 1e-11);
      }
    });

    it('throws NumericConvergenceError when iteration budget is exhausted and rejects invalid parameters', () => {
      expect(() => regularizedGammaP(50, 45, { maxIterations: 2 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => regularizedGammaQ(50, 55, { maxIterations: 2 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => regularizedGammaP(0.01, 1)).toThrow(RangeError);
      expect(() => regularizedGammaQ(1, -0.1)).toThrow(RangeError);
      expect(() => inverseRegularizedGammaQ(1, 1.1)).toThrow(RangeError);
    });
  });

  describe('8. Regularized Incomplete Beta & inverseRegularizedIncompleteBeta', () => {
    it('enforces exact boundary contracts at x in {0, 1} and p in {0, 1}', () => {
      for (const [a, b] of [
        [0.05, 0.05],
        [2.5, 4.5],
        [10.5, 10.5],
        [1000, 1000],
      ] as const) {
        expect(regularizedIncompleteBeta(0, a, b)).toBe(0);
        expect(regularizedIncompleteBeta(1, a, b)).toBe(1);
        expect(inverseRegularizedIncompleteBeta(0, a, b)).toBe(0);
        expect(inverseRegularizedIncompleteBeta(1, a, b)).toBe(1);
      }
    });

    it('matches the corrected v4.4.2 reference I_0.3(2.5, 4.5) = 0.40653901668245927373', () => {
      // B(5/2, 9/2) = 7*pi/1024 = 0.021475731030398977216
      // int_0^0.3 t^(3/2)*(1-t)^(7/2) dt = 0.0087307225756353780867
      // Ratio = 0.40653901668245927373
      const actual = regularizedIncompleteBeta(0.3, 2.5, 4.5);
      expect(Math.abs(actual - 0.40653901668245927373)).toBeLessThanOrEqual(1e-14);
    });

    it('matches inverseRegularizedIncompleteBeta references at (0.05, 10.5, 10.5) and (0.95, 10.5, 10.5) with exact symmetry', () => {
      const q05 = inverseRegularizedIncompleteBeta(0.05, 10.5, 10.5);
      const q95 = inverseRegularizedIncompleteBeta(0.95, 10.5, 10.5);
      expect(Math.abs(q05 - 0.32423438452823023898)).toBeLessThanOrEqual(1e-13);
      expect(Math.abs(q95 - 0.67576561547176976102)).toBeLessThanOrEqual(1e-13);
      expect(Math.abs(q05 + q95 - 1)).toBeLessThanOrEqual(5e-16);
      // Exact dyadic complement 0.0625 + 0.9375 === 1 has 0-ULP reflection identity
      const qDyadicLow = inverseRegularizedIncompleteBeta(0.0625, 10.5, 10.5);
      const qDyadicHigh = inverseRegularizedIncompleteBeta(0.9375, 10.5, 10.5);
      expect(1 - qDyadicLow).toBe(qDyadicHigh);
      expect(inverseRegularizedIncompleteBeta(0.5, 10.5, 10.5)).toBe(0.5);
    });

    it('throws NumericConvergenceError on insufficient iteration budget and rejects out-of-range inputs', () => {
      expect(() => regularizedIncompleteBeta(0.5, 500, 500, { maxIterations: 2 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => regularizedIncompleteBeta(-0.1, 2, 2)).toThrow(RangeError);
      expect(() => regularizedIncompleteBeta(1.1, 2, 2)).toThrow(RangeError);
      expect(() => inverseRegularizedIncompleteBeta(-0.01, 2, 2)).toThrow(RangeError);
    });
  });

  describe('9. Central Student-t CDF & Quantile Function (Including Exact df = 1, 2, 4)', () => {
    it('enforces exact boundary contracts at +/-Infinity and p in {0, 1}, and handles huge finite t = +/-1e200', () => {
      for (const df of [1, 2, 4, 10, 60, 120, 20000]) {
        expect(studentTCdf(Number.NEGATIVE_INFINITY, df)).toBe(0);
        expect(studentTCdf(Number.POSITIVE_INFINITY, df)).toBe(1);
        expect(studentTCdf(0, df)).toBe(0.5);
        expect(studentTCdf(1e200, df)).toBe(1);
        expect(studentTCdf(-1e200, df)).toBe(0);
        expect(inverseStudentTCdf(0, df)).toBe(Number.NEGATIVE_INFINITY);
        expect(inverseStudentTCdf(1, df)).toBe(Number.POSITIVE_INFINITY);
        expect(inverseStudentTCdf(0.5, df)).toBe(0);
      }
    });

    it('verifies exact df = 4 CDF and intermediate quantile values (theta, x, t) at p = 0.975', () => {
      expect(Math.abs(studentTCdf(3.0, 4) - 0.98002901596414058636)).toBeLessThanOrEqual(1e-15);

      const details = computeStudentT4InverseIntermediates(0.975);
      expect(Math.abs(details.theta - 0.41774529916779175291)).toBeLessThanOrEqual(1e-15);
      expect(Math.abs(details.x - 0.81140135189950784672)).toBeLessThanOrEqual(1e-15);
      expect(Math.abs(details.t - 2.7764451051977943578)).toBeLessThanOrEqual(1e-14);
      expect(Math.abs(inverseStudentTCdf(0.975, 4) - 2.7764451051977943578)).toBeLessThanOrEqual(
        1e-14,
      );
      expect(Math.abs(inverseStudentTCdf(0.025, 4) - -2.7764451051977943578)).toBeLessThanOrEqual(
        1e-14,
      );
    });

    it('matches 20-digit quantile references for df = 1, 2, 60, and 120', () => {
      expectRelativeErrorWithin(inverseStudentTCdf(0.975, 1), 12.706204736174704646, 1e-14);
      expectRelativeErrorWithin(inverseStudentTCdf(0.975, 2), 4.3026527297494638523, 1e-14);
      expectRelativeErrorWithin(inverseStudentTCdf(0.995, 60), 2.6602830288550371871, 1e-13);
      expectRelativeErrorWithin(inverseStudentTCdf(0.975, 120), 1.9799304050824408467, 1e-13);

      // Normal quantile round-trip
      expect(Math.abs(normalCdf(inverseNormalCdf(0.999)) - 0.999)).toBeLessThanOrEqual(1e-15);
    });
  });

  describe('10. nonCentralChiSquarePower & nonCentralStudentTCdf (Benton-Krishnamoorthy)', () => {
    it('evaluates nonCentralChiSquarePower accurately at (4.0, 1, 0.05) and ncp = 0', () => {
      expect(nonCentralChiSquarePower(0, 5, 0.05)).toBe(0.05);
      expect(
        Math.abs(nonCentralChiSquarePower(4.0, 1, 0.05) - 0.51600527397617473718),
      ).toBeLessThanOrEqual(1e-12);
      expect(() => nonCentralChiSquarePower(500, 10, 0.05, { maxIterations: 2 })).toThrow(
        NumericConvergenceError,
      );
    });

    it('evaluates nonCentralStudentTCdf across all 4 sign quadrants of (t, delta)', () => {
      // Quadrant I: t > 0, delta > 0
      expect(
        Math.abs(nonCentralStudentTCdf(1.0, 10, 2.0) - 0.15851505953771169513),
      ).toBeLessThanOrEqual(1e-13);
      // Quadrant IV: t > 0, delta < 0
      expect(
        Math.abs(nonCentralStudentTCdf(1.0, 10, -2.0) - 0.99818356658957035093),
      ).toBeLessThanOrEqual(1e-13);
      // Quadrant II: t < 0, delta > 0
      expect(
        Math.abs(nonCentralStudentTCdf(-1.0, 10, 2.0) - 0.0018164334104296490679),
      ).toBeLessThanOrEqual(1e-13);
      // Quadrant III: t < 0, delta < 0
      expect(
        Math.abs(nonCentralStudentTCdf(-1.0, 10, -2.0) - 0.84148494046228830487),
      ).toBeLessThanOrEqual(1e-13);

      // Exact reflection symmetry F(t; nu, delta) + F(-t; nu, -delta) === 1
      expect(
        Math.abs(
          nonCentralStudentTCdf(1.0, 10, 2.0) + nonCentralStudentTCdf(-1.0, 10, -2.0) - 1,
        ),
      ).toBeLessThanOrEqual(1e-15);
      expect(
        Math.abs(
          nonCentralStudentTCdf(1.0, 10, -2.0) + nonCentralStudentTCdf(-1.0, 10, 2.0) - 1,
        ),
      ).toBeLessThanOrEqual(1e-15);
    });

    it('delegates delta === 0 to central studentTCdf, handles t === 0, and evaluates extreme noncentrality |delta| = 50', () => {
      // delta === 0
      for (const t of [-3.5, -0.5, 0, 0.5, 2.75, 1e200]) {
        expect(nonCentralStudentTCdf(t, 12, 0)).toBe(studentTCdf(t, 12));
      }

      // t === 0 -> Phi(-delta)
      expect(nonCentralStudentTCdf(0, 15, 2.0)).toBeCloseTo(normalCdf(-2.0), 15);
      expect(nonCentralStudentTCdf(0, 15, -2.0)).toBeCloseTo(normalCdf(2.0), 15);

      // High noncentrality reference points from v4.4–v4.4.3
      expect(
        Math.abs(nonCentralStudentTCdf(2.2281388519649385, 10, 2.0) - 0.56044793641770942754),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(nonCentralStudentTCdf(2.0859634472658364, 20, 3.0) - 0.18583062138230143021),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(nonCentralStudentTCdf(55.0, 20, 50.0) - 0.68228248261497954098),
      ).toBeLessThanOrEqual(1e-9);
      expect(
        Math.abs(nonCentralStudentTCdf(-55.0, 20, -50.0) - 0.31771751738502045902),
      ).toBeLessThanOrEqual(1e-9);
    });

    it('handles huge finite t (including 1e200 with df = 20, ncp = 2) and tiny non-zero ncp whose square underflows', () => {
      expect(nonCentralStudentTCdf(Number.NEGATIVE_INFINITY, 10, 2.0)).toBe(0);
      expect(nonCentralStudentTCdf(Number.POSITIVE_INFINITY, 10, 2.0)).toBe(1);
      expect(nonCentralStudentTCdf(1e200, 20, 2.0)).toBe(1);
      expect(nonCentralStudentTCdf(-1e200, 20, 2.0)).toBe(0);
      expect(nonCentralStudentTCdf(1e200, 10, 2.0)).toBe(1);
      expect(nonCentralStudentTCdf(-1e200, 10, 2.0)).toBe(0);
      expect(nonCentralStudentTCdf(1e200, 10, -2.0)).toBe(1);
      expect(nonCentralStudentTCdf(-1e200, 10, -2.0)).toBe(0);
      expect(nonCentralStudentTCdf(1e200, 20, 50.0)).toBe(1);
      expect(nonCentralStudentTCdf(-1e200, 20, 50.0)).toBe(0);

      // Tiny non-zero ncp where 0.5 * ncp^2 underflows to +0.0 in binary64 (must never produce 0 * ln(0) = NaN)
      const centralRef = studentTCdf(1.5, 10);
      for (const tinyNcp of [
        1e-100,
        -1e-100,
        1e-162,
        -1e-162,
        1e-200,
        -1e-200,
        1e-300,
        -1e-300,
        Number.MIN_VALUE,
        -Number.MIN_VALUE,
      ]) {
        const valPosT = nonCentralStudentTCdf(1.5, 10, tinyNcp);
        const valNegT = nonCentralStudentTCdf(-1.5, 10, tinyNcp);
        expect(Number.isNaN(valPosT)).toBe(false);
        expect(Number.isNaN(valNegT)).toBe(false);
        expect(Math.abs(valPosT - centralRef)).toBeLessThanOrEqual(1e-15);
        expect(Math.abs(valNegT - (1 - centralRef))).toBeLessThanOrEqual(1e-15);
      }

      // Small non-underflowing ncp = +/-1e-8 shifts the CDF in the right direction relative to central t
      const pPlusSmall = nonCentralStudentTCdf(1.0, 10, 1e-8);
      const pMinusSmall = nonCentralStudentTCdf(1.0, 10, -1e-8);
      expect(pPlusSmall).toBeLessThan(studentTCdf(1.0, 10));
      expect(pMinusSmall).toBeGreaterThan(studentTCdf(1.0, 10));
    });

    it('preserves deep lower-tail and upper-tail accuracy without 1 - CDF reflection cancellation, including F_t(10, ncp=10)(-20)', () => {
      // 1. Independent 30-digit reference: F_t(10, ncp=10)(-20) = 3.886976004833870417352570567389e-39
      const exactTailRef = 3.88697600483387041735e-39;
      const lowerTailVal = nonCentralStudentTCdf(-20, 10, 10);
      expectRelativeErrorWithin(lowerTailVal, exactTailRef, 1e-13);

      // Dual-channel representation at (-20, 10, 10)
      const lowerDual = nonCentralStudentTDualCdf(-20, 10, 10);
      expect(validateDualChannelProbability(lowerDual)).toEqual(lowerDual);
      expectRelativeErrorWithin(lowerDual.probability, exactTailRef, 1e-13);
      expect(lowerDual.complementProbability).toBe(1);
      expect(lowerDual.status).toBe('interior-normal');
      expectRelativeErrorWithin(lowerDual.logProbability, Math.log(exactTailRef), 1e-14);

      // 2. Equivalent upper tail at (t = +20, df = 10, ncp = -10):
      // By exact distributional symmetry T_nu(delta) =^d -T_nu(-delta),
      // 1 - F_t(10, ncp=-10)(20) = F_t(10, ncp=10)(-20) = 3.88697600483387041735e-39
      const upperDual = nonCentralStudentTDualCdf(20, 10, -10);
      expect(validateDualChannelProbability(upperDual)).toEqual(upperDual);
      expect(upperDual.probability).toBe(1);
      expect(upperDual.status).toBe('saturated-to-one');
      expectRelativeErrorWithin(upperDual.complementProbability, exactTailRef, 1e-13);
      expectRelativeErrorWithin(
        upperDual.logComplementProbability,
        Math.log(exactTailRef),
        1e-14,
      );
      expect(upperDual.complementProbability).toBe(lowerDual.probability);
      expect(upperDual.logComplementProbability).toBe(lowerDual.logProbability);

      // 3. Additional high-precision tail & negative-ncp references across all 4 quadrants:
      const tailReferences: ReadonlyArray<readonly [number, number, number, number]> = [
        [-20, 10, -10, 1.15500900422341051806e-2],
        [20, 10, 10, 9.88449909957765894819e-1],
        [-5, 10, 3, 2.664337922210245957e-9],
        [2, 10, 10, 2.26612742368488211297e-13],
        [-2.5, 10, 1.5, 2.33802064033990057128e-4],
        [2.5, 10, -1.5, 9.99766197935966009943e-1],
        [-2.5, 10, -1.5, 2.06060890963816505812e-1],
        [2.5, 10, 1.5, 7.93939109036183494188e-1],
      ];

      for (const [t, df, ncp, expected] of tailReferences) {
        const cdfVal = nonCentralStudentTCdf(t, df, ncp);
        expectRelativeErrorWithin(cdfVal, expected, 1e-13);
        const dual = nonCentralStudentTDualCdf(t, df, ncp);
        const dualMirror = nonCentralStudentTDualCdf(-t, df, -ncp);
        expect(validateDualChannelProbability(dual)).toEqual(dual);
        expect(validateDualChannelProbability(dualMirror)).toEqual(dualMirror);
        expectRelativeErrorWithin(dual.probability, expected, 1e-13);
        expectRelativeErrorWithin(dual.complementProbability, dualMirror.probability, 1e-14);
        expectRelativeErrorWithin(
          dual.logComplementProbability,
          dualMirror.logProbability,
          1e-14,
        );
      }

      // 4. Central symmetry (ncp = 0) in deep lower/upper tails across df = 1, 2, 4, 10:
      for (const df of [1, 2, 4, 10]) {
        const dLower = nonCentralStudentTDualCdf(-50, df, 0);
        const dUpper = nonCentralStudentTDualCdf(50, df, 0);
        expect(dLower.probability).toBeGreaterThan(0);
        expect(dLower.probability).toBe(dUpper.complementProbability);
        expect(dLower.logProbability).toBe(dUpper.logComplementProbability);
      }
    });

    it('throws NumericConvergenceError when truncation bound B_tail(S) <= 1e-12 is not reached within maxIterations', () => {
      expect(() => nonCentralStudentTCdf(55.0, 20, 50.0, { maxIterations: 5 })).toThrow(
        NumericConvergenceError,
      );
      expect(() => nonCentralStudentTCdf(55.0, 20, 50.0, { maxIterations: 5 })).toThrow(
        RangeError,
      );
      expect(() => nonCentralStudentTCdf(1.0, 10, 55.0)).toThrow(RangeError);
      expect(() => nonCentralStudentTCdf(1.0, 0.5, 2.0)).toThrow(RangeError);
      expect(() => nonCentralStudentTCdf(Number.NaN, 10, 2.0)).toThrow(RangeError);
    });
  });

  describe('11. Orthogonal Variance & Entropy Decompositions', () => {
    it('satisfies exact three-way variance closure p_bar*(1 - p_bar) = aleatoric + within + between', () => {
      const m1 = createDualChannelProbability(0.25);
      const m2 = createDualChannelProbability(0.65);
      const m3 = createDualChannelProbability(0.45);

      const decomp = decomposeCategoryUncertainty(
        0,
        'outcome-yes',
        [
          {
            methodId: 'beta-binomial-conjugate',
            weight: 0.5,
            predictiveProbability: m1,
            parametricVariance: 0.015,
          },
          {
            methodId: 'poisson-gamma-hazard',
            weight: 0.3,
            predictiveProbability: m2,
            parametricVariance: 0.02,
          },
          {
            methodId: 'structural-uniform-baseline',
            weight: 0.2,
            predictiveProbability: m3,
            parametricVariance: 0,
          },
        ],
        {
          kind: 'available',
          interval: {
            level: 0.9,
            lower: 0.18,
            upper: 0.68,
            median: 0.41,
            parameterName: 'theta_yes',
            interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
          },
        },
      );

      expect(decomp.predictiveProbability.probability).toBeCloseTo(
        0.5 * 0.25 + 0.3 * 0.65 + 0.2 * 0.45,
        15,
      );
      expect(decomp.aleatoricVariance).toBeGreaterThan(0);
      expect(decomp.withinMethodParametricVariance).toBeCloseTo(0.5 * 0.015 + 0.3 * 0.02, 15);
      expect(decomp.betweenMethodDisagreementVariance).toBeGreaterThan(0);
      expect(decomp.closureResidual).toBeLessThanOrEqual(1e-15);
    });

    it('satisfies exact Shannon entropy & Jensen-Shannon divergence closure H(p_bar) = H_within + JSD_w', () => {
      const dist1 = [
        createDualChannelProbability(0.7),
        createDualChannelProbability(0.2),
        createDualChannelProbability(0.1),
      ];
      const dist2 = [
        createDualChannelProbability(0.2),
        createDualChannelProbability(0.5),
        createDualChannelProbability(0.3),
      ];
      const weights = [0.6, 0.4];
      const ensemble = [
        createDualChannelProbability(0.6 * 0.7 + 0.4 * 0.2),
        createDualChannelProbability(0.6 * 0.2 + 0.4 * 0.5),
        createDualChannelProbability(0.6 * 0.1 + 0.4 * 0.3),
      ];

      const entropyDecomp = decomposeEnsembleEntropy([dist1, dist2], weights, ensemble);
      expect(entropyDecomp.jensenShannonDivergenceNats).toBeGreaterThan(0);
      expect(entropyDecomp.normalizedDisagreementIndex).toBeGreaterThan(0);
      expect(entropyDecomp.normalizedDisagreementIndex).toBeLessThanOrEqual(1);
      expect(entropyDecomp.closureResidualNats).toBeLessThanOrEqual(1e-15);

      // Also works identically when ensembleDistribution is omitted (computed from mixture)
      const autoDecomp = decomposeEnsembleEntropy([dist1, dist2], weights);
      expect(autoDecomp.totalPredictiveEntropyNats).toBeCloseTo(
        entropyDecomp.totalPredictiveEntropyNats,
        15,
      );
      expect(autoDecomp.jensenShannonDivergenceNats).toBeCloseTo(
        entropyDecomp.jensenShannonDivergenceNats,
        15,
      );
      expect(autoDecomp.closureResidualNats).toBeLessThanOrEqual(1e-15);
    });

    it('normalizes weights once up front in decomposeCategoryUncertainty and rejects negative, non-unit-sum, or invalid inputs', () => {
      const m1 = createDualChannelProbability(0.2);
      const m2 = createDualChannelProbability(0.8);
      const m3 = createDualChannelProbability(0.5);
      const validInterval = {
        kind: 'omitted' as const,
        reason: 'method-produces-point-estimate-only' as const,
        explanation: 'Point-estimate ensemble test',
      };

      // Weights within 1e-12 of 1 (e.g., 1/3 + 1/3 + 1/3 + 5e-13) are normalized once up front
      // so both logarithmic channels and variance components use identical normalized weights:
      const slightDriftWeights = [1 / 3, 1 / 3, 1 / 3 + 5e-13];
      const decomp = decomposeCategoryUncertainty(
        0,
        'outcome-yes',
        [
          {
            methodId: 'beta-binomial-conjugate',
            weight: slightDriftWeights[0]!,
            predictiveProbability: m1,
            parametricVariance: 0.01,
          },
          {
            methodId: 'poisson-gamma-hazard',
            weight: slightDriftWeights[1]!,
            predictiveProbability: m2,
            parametricVariance: 0.01,
          },
          {
            methodId: 'structural-uniform-baseline',
            weight: slightDriftWeights[2]!,
            predictiveProbability: m3,
            parametricVariance: 0.01,
          },
        ],
        validInterval,
      );
      expect(decomp.closureResidual).toBeLessThanOrEqual(1e-15);

      // Reject negative weights, weights > 1, and weights not summing to 1
      expect(() =>
        decomposeCategoryUncertainty(
          0,
          'outcome-yes',
          [
            {
              methodId: 'beta-binomial-conjugate',
              weight: -0.2,
              predictiveProbability: m1,
              parametricVariance: 0,
            },
            {
              methodId: 'poisson-gamma-hazard',
              weight: 1.2,
              predictiveProbability: m2,
              parametricVariance: 0,
            },
          ],
          validInterval,
        ),
      ).toThrow(RangeError);

      expect(() =>
        decomposeCategoryUncertainty(
          0,
          'outcome-yes',
          [
            {
              methodId: 'beta-binomial-conjugate',
              weight: 0.4,
              predictiveProbability: m1,
              parametricVariance: 0,
            },
            {
              methodId: 'poisson-gamma-hazard',
              weight: 0.4,
              predictiveProbability: m2,
              parametricVariance: 0,
            },
          ],
          validInterval,
        ),
      ).toThrow(RangeError);

      expect(() =>
        decomposeCategoryUncertainty(
          0,
          'outcome-yes',
          [
            {
              methodId: 'beta-binomial-conjugate',
              weight: Number.NaN,
              predictiveProbability: m1,
              parametricVariance: 0,
            },
          ],
          validInterval,
        ),
      ).toThrow(RangeError);
    });

    it('rejects negative weights, non-unit-sum weights, invalid distributions, and incompatible mixtures in decomposeEnsembleEntropy', () => {
      const dist1 = [
        createDualChannelProbability(0.7),
        createDualChannelProbability(0.2),
        createDualChannelProbability(0.1),
      ];
      const dist2 = [
        createDualChannelProbability(0.2),
        createDualChannelProbability(0.5),
        createDualChannelProbability(0.3),
      ];
      const validEnsemble = [
        createDualChannelProbability(0.6 * 0.7 + 0.4 * 0.2),
        createDualChannelProbability(0.6 * 0.2 + 0.4 * 0.5),
        createDualChannelProbability(0.6 * 0.1 + 0.4 * 0.3),
      ];

      // 1. Negative weight or weight > 1
      expect(() =>
        decomposeEnsembleEntropy([dist1, dist2], [-0.1, 1.1], validEnsemble),
      ).toThrow(RangeError);
      expect(() =>
        decomposeEnsembleEntropy([dist1, dist2], [1.5, -0.5], validEnsemble),
      ).toThrow(RangeError);

      // 2. Weights that do not sum to 1
      expect(() =>
        decomposeEnsembleEntropy([dist1, dist2], [0.3, 0.3], validEnsemble),
      ).toThrow(RangeError);
      expect(() =>
        decomposeEnsembleEntropy([dist1, dist2], [0.6, 0.4 + 1e-6], validEnsemble),
      ).toThrow(RangeError);

      // 3. Incompatible ensembleDistribution (not matching weighted mixture of methodDistributions)
      const incompatibleEnsemble = [
        createDualChannelProbability(0.5),
        createDualChannelProbability(0.3),
        createDualChannelProbability(0.2),
      ];
      expect(() =>
        decomposeEnsembleEntropy([dist1, dist2], [0.6, 0.4], incompatibleEnsemble),
      ).toThrow(RangeError);

      // 4. Unnormalized method distribution (categories do not sum to 1)
      const unnormalizedDist = [
        createDualChannelProbability(0.5),
        createDualChannelProbability(0.2),
        createDualChannelProbability(0.1),
      ];
      expect(() =>
        decomposeEnsembleEntropy([unnormalizedDist, dist2], [0.6, 0.4]),
      ).toThrow(RangeError);

      // 5. Mismatched category counts between methods
      const binaryDist = [
        createDualChannelProbability(0.6),
        createDualChannelProbability(0.4),
      ];
      expect(() =>
        decomposeEnsembleEntropy([dist1, binaryDist], [0.6, 0.4]),
      ).toThrow(RangeError);
    });

    it('enforces runtime contract validation for OutcomeSpaceDescriptor, DualChannelProbability, ExhaustiveDistribution, ParametricIntervalField, and ForecastDistributionOutput', () => {
      // 1. validateOutcomeSpaceDescriptor
      const validBinarySpace = validateOutcomeSpaceDescriptor({
        kind: 'binary',
        outcomeLabels: ['Yes', 'No'],
        horizonStartsAt: '2026-01-01T00:00:00Z',
        horizonEndsAt: '2026-12-31T23:59:59Z',
        eventDefinitionHash: 'sha256:735acb14oracle2a1',
      });
      expect(validBinarySpace.outcomeLabels).toHaveLength(2);

      const validPartitionSpace = validateOutcomeSpaceDescriptor({
        kind: 'discretized-continuous-partition',
        outcomeLabels: ['(-inf, 2.0)', '[2.0, 4.0)', '[4.0, +inf)'],
        horizonStartsAt: '2026-01-01T00:00:00Z',
        horizonEndsAt: '2026-12-31T23:59:59Z',
        eventDefinitionHash: 'sha256:cpi-bins-2026',
        partitionThresholds: [2.0, 4.0],
      });
      expect(validPartitionSpace.outcomeLabels).toHaveLength(3);

      // Reject invalid outcome spaces (wrong binary count, duplicate labels, non-monotonic partitionThresholds, inverted horizon)
      expect(() =>
        validateOutcomeSpaceDescriptor({
          kind: 'binary',
          outcomeLabels: ['A', 'B', 'C'],
          horizonStartsAt: '2026-01-01T00:00:00Z',
          horizonEndsAt: '2026-12-31T23:59:59Z',
          eventDefinitionHash: 'sha256:bad-binary',
        }),
      ).toThrow(RangeError);

      expect(() =>
        validateOutcomeSpaceDescriptor({
          kind: 'categorical-exhaustive',
          outcomeLabels: ['Same', 'Same'],
          horizonStartsAt: '2026-01-01T00:00:00Z',
          horizonEndsAt: '2026-12-31T23:59:59Z',
          eventDefinitionHash: 'sha256:dup-labels',
        }),
      ).toThrow(RangeError);

      expect(() =>
        validateOutcomeSpaceDescriptor({
          kind: 'discretized-continuous-partition',
          outcomeLabels: ['Low', 'Mid', 'High'],
          horizonStartsAt: '2026-01-01T00:00:00Z',
          horizonEndsAt: '2026-12-31T23:59:59Z',
          eventDefinitionHash: 'sha256:bad-thresholds',
          partitionThresholds: [5.0, 2.0], // non-increasing
        }),
      ).toThrow(RangeError);

      expect(() =>
        validateOutcomeSpaceDescriptor({
          kind: 'binary',
          outcomeLabels: ['Yes', 'No'],
          horizonStartsAt: '2026-12-31T23:59:59Z',
          horizonEndsAt: '2026-01-01T00:00:00Z', // inverted horizon
          eventDefinitionHash: 'sha256:bad-horizon',
        }),
      ).toThrow(RangeError);

      // 2. validateDualChannelProbability & validateExhaustiveDistribution
      const pYes = createDualChannelProbability(0.65);
      const pNo = createDualChannelProbability(0.35);
      expect(validateDualChannelProbability(pYes)).toEqual(pYes);
      expect(validateExhaustiveDistribution([pYes, pNo], 2)).toHaveLength(2);

      // Valid boundary, underflow, subnormal, and saturated-to-one DualChannelProbability states are preserved:
      const pSubnormal = createDualChannelProbabilityFromLog(-720);
      const pSaturated = createDualChannelProbabilityFromComplementLog(-45);
      const pUnderflow = createDualChannelProbabilityFromLog(-800);
      const pExactZero = createDualChannelProbability(0);
      const pExactOne = createDualChannelProbability(1);
      expect(validateDualChannelProbability(pSubnormal).status).toBe('subnormal-probability');
      expect(validateDualChannelProbability(pSaturated).status).toBe('saturated-to-one');
      expect(validateDualChannelProbability(pUnderflow).status).toBe('underflow-to-zero');
      expect(validateDualChannelProbability(pExactZero).status).toBe('exact-zero');
      expect(validateDualChannelProbability(pExactOne).status).toBe('exact-one');

      // Mandatory rejections: linear channels that differ from exp(logChannel) by << 4 * Number.EPSILON
      // must still be rejected by ULP / regime validation:
      // Case A: logProbability = -720 accompanied by probability = 1e-16
      expect(() =>
        validateDualChannelProbability({
          ...pSubnormal,
          probability: 1e-16,
        }),
      ).toThrow(RangeError);

      // Case B: logComplementProbability = -45 accompanied by complementProbability = 1e-16
      expect(() =>
        validateDualChannelProbability({
          ...pSaturated,
          complementProbability: 1e-16,
        }),
      ).toThrow(RangeError);

      // Case C: underflow-to-zero accompanied by non-zero probability (1e-16 or Number.MIN_VALUE)
      expect(() =>
        validateDualChannelProbability({
          ...pUnderflow,
          probability: 1e-16,
        }),
      ).toThrow(RangeError);
      expect(() =>
        validateDualChannelProbability({
          ...pUnderflow,
          probability: Number.MIN_VALUE,
        }),
      ).toThrow(RangeError);

      // Tampered status or incoherent linear/log channels must be rejected
      expect(() =>
        validateDualChannelProbability({
          ...pYes,
          status: 'saturated-to-one',
        }),
      ).toThrow(RangeError);

      expect(() =>
        validateDualChannelProbability({
          ...pYes,
          probability: 0.9,
        }),
      ).toThrow(RangeError);

      expect(() => validateExhaustiveDistribution([pYes, pYes], 2)).toThrow(RangeError);

      // 3. validateParametricIntervalField coherence & skewed posterior support
      expect(() =>
        validateParametricIntervalField(
          {
            kind: 'available',
            interval: {
              level: 0.9,
              lower: 0,
              upper: 0.1,
              median: 0.02,
              parameterName: 'theta',
              interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
            },
          },
          pExactZero,
        ),
      ).toThrow(RangeError);

      // Zero-width available interval on interior-normal probability is rejected (must use kind: 'omitted')
      expect(() =>
        validateParametricIntervalField(
          {
            kind: 'available',
            interval: {
              level: 0.9,
              lower: 0.65,
              upper: 0.65,
              median: 0.65,
              parameterName: 'theta',
              interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
            },
          },
          pYes,
        ),
      ).toThrow(RangeError);

      // Strongly skewed posterior (e.g. Beta(0.05, 5), where posterior mean ~ 0.0099 > 50% upper quantile)
      // is valid as long as 0 <= lower <= median <= upper <= 1 and lower < upper:
      const pSkewedMean = createDualChannelProbability(0.0099);
      const skewedInterval = validateParametricIntervalField(
        {
          kind: 'available',
          interval: {
            level: 0.5,
            lower: 1e-12,
            median: 1e-6,
            upper: 0.002,
            parameterName: '  theta_skewed  ',
            interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
          },
        },
        pSkewedMean,
      );
      expect(skewedInterval.kind).toBe('available');
      if (skewedInterval.kind === 'available') {
        expect(skewedInterval.interval.parameterName).toBe('theta_skewed');
      }

      // Verify decomposeCategoryUncertainty preserves and returns the normalized/frozen ParametricIntervalField:
      const decompWithNormalizedInterval = decomposeCategoryUncertainty(
        0,
        '  Yes  ',
        [
          {
            methodId: 'beta-binomial-conjugate',
            weight: 1,
            predictiveProbability: pSkewedMean,
            parametricVariance: 0.0005,
          },
        ],
        {
          kind: 'omitted',
          reason: 'point-mass-structural-baseline',
          explanation: '  padded explanation text  ',
        },
      );
      expect(decompWithNormalizedInterval.outcomeLabel).toBe('Yes');
      expect(Object.isFrozen(decompWithNormalizedInterval.parametricInterval)).toBe(true);
      if (decompWithNormalizedInterval.parametricInterval.kind === 'omitted') {
        expect(decompWithNormalizedInterval.parametricInterval.explanation).toBe(
          'padded explanation text',
        );
      }

      // 4. validateForecastDistributionContract end-to-end & independent residual recomputation
      const decompYes = decomposeCategoryUncertainty(
        0,
        'Yes',
        [
          {
            methodId: 'beta-binomial-conjugate',
            weight: 1,
            predictiveProbability: pYes,
            parametricVariance: 0.01,
          },
        ],
        {
          kind: 'available',
          interval: {
            level: 0.9,
            lower: 0.5,
            upper: 0.8,
            median: 0.65,
            parameterName: 'p_yes',
            interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
          },
        },
      );
      const decompNo = decomposeCategoryUncertainty(
        1,
        'No',
        [
          {
            methodId: 'beta-binomial-conjugate',
            weight: 1,
            predictiveProbability: pNo,
            parametricVariance: 0.01,
          },
        ],
        {
          kind: 'available',
          interval: {
            level: 0.9,
            lower: 0.2,
            upper: 0.5,
            median: 0.35,
            parameterName: 'p_no',
            interpretation: 'epistemic-parameter-uncertainty-not-outcome-frequency',
          },
        },
      );
      const entropyDecomp = decomposeEnsembleEntropy([[pYes, pNo]], [1]);

      const validForecastContract = validateForecastDistributionContract({
        questionCategory: 'geopolitics',
        outcomeSpace: validBinarySpace,
        footingTier: 'methodologically-sound-moderate-evidence',
        calibrationStatus: 'unverified-no-out-of-sample-evaluation',
        outcomes: [pYes, pNo],
        contrastReport: {
          executedMethodIds: ['beta-binomial-conjugate'],
          discardedMethods: [],
          weightsByMethod: { 'beta-binomial-conjugate': 1 },
          effectiveIndependentMethodCount: 1,
          entropyDecomposition: entropyDecomp,
          categoryDecompositions: [decompYes, decompNo],
        },
        epistemologicalClaims: [
          {
            kind: 'exact-mathematical-identity',
            tag: 'IME',
            statement: 'Three-way orthogonal Bernoulli variance decomposition',
          },
        ],
        methodologicalLimitations: ['Single-method conjugate baseline'],
      });
      expect(validForecastContract.outcomes).toHaveLength(2);

      // Negative tests for validateCategoryUncertaintyDecomposition & validateForecastDistributionContract:
      // (a) Falsified closureResidual: 0 when variance components do not sum to p*(1-p)
      expect(() =>
        validateForecastDistributionContract({
          ...validForecastContract,
          contrastReport: {
            ...validForecastContract.contrastReport,
            categoryDecompositions: [
              {
                ...decompYes,
                aleatoricVariance: decompYes.aleatoricVariance + 0.05,
                closureResidual: 0, // falsified residual!
              },
              decompNo,
            ],
          },
        }),
      ).toThrow(RangeError);

      // (b) Negative variance component (even if compensated so sum equals totalBernoulliVariance)
      expect(() =>
        validateCategoryUncertaintyDecomposition({
          ...decompYes,
          withinMethodParametricVariance: -0.01,
          aleatoricVariance: decompYes.aleatoricVariance + 0.01,
          totalEpistemicParametricVariance: -0.01,
          closureResidual: 0,
        }),
      ).toThrow(RangeError);

      // (c) Inconsistent totalEpistemicParametricVariance != within + between
      expect(() =>
        validateCategoryUncertaintyDecomposition({
          ...decompYes,
          totalEpistemicParametricVariance: decompYes.withinMethodParametricVariance + 0.02,
          closureResidual: 0,
        }),
      ).toThrow(RangeError);

      // (d) Non-finite (NaN or +Infinity) variance component
      expect(() =>
        validateCategoryUncertaintyDecomposition({
          ...decompYes,
          aleatoricVariance: Number.NaN,
        }),
      ).toThrow(RangeError);
      expect(() =>
        validateCategoryUncertaintyDecomposition({
          ...decompYes,
          withinMethodParametricVariance: Number.POSITIVE_INFINITY,
        }),
      ).toThrow(RangeError);

      // (e) Falsified entropy closureResidualNats: 0 when H(p_bar) != H_within + JSD_w
      expect(() =>
        validateForecastDistributionContract({
          ...validForecastContract,
          contrastReport: {
            ...validForecastContract.contrastReport,
            entropyDecomposition: {
              ...entropyDecomp,
              withinMethodExpectedEntropyNats:
                entropyDecomp.withinMethodExpectedEntropyNats * 0.5,
              closureResidualNats: 0, // falsified residual!
            },
          },
        }),
      ).toThrow(RangeError);

      // (f) Negative or non-finite entropy component
      expect(() =>
        validateEntropyDecomposition(
          {
            ...entropyDecomp,
            jensenShannonDivergenceNats: -1e-6,
          },
          [pYes, pNo],
          1,
        ),
      ).toThrow(RangeError);
      expect(() =>
        validateEntropyDecomposition(
          {
            ...entropyDecomp,
            totalPredictiveEntropyNats: Number.NaN,
          },
          [pYes, pNo],
          1,
        ),
      ).toThrow(RangeError);

      // (g) Inconsistent totalPredictiveEntropyNats vs actual Shannon entropy of outcomes
      expect(() =>
        validateEntropyDecomposition(
          {
            ...entropyDecomp,
            totalPredictiveEntropyNats: 0.1,
            withinMethodExpectedEntropyNats: 0.1,
            jensenShannonDivergenceNats: 0,
            closureResidualNats: 0,
          },
          [pYes, pNo],
          1,
        ),
      ).toThrow(RangeError);

      // (h) Invalid contrastReport weightsByMethod or effectiveIndependentMethodCount
      expect(() =>
        validateForecastDistributionContract({
          ...validForecastContract,
          contrastReport: {
            ...validForecastContract.contrastReport,
            weightsByMethod: { 'beta-binomial-conjugate': 0.8 },
          },
        }),
      ).toThrow(RangeError);
      expect(() =>
        validateForecastDistributionContract({
          ...validForecastContract,
          contrastReport: {
            ...validForecastContract.contrastReport,
            effectiveIndependentMethodCount: 2, // > executedMethodIds.length (1)
          },
        }),
      ).toThrow(RangeError);

      // (i) Reject forecast contract that falsely claims empirical calibration without out-of-sample verification
      expect(() =>
        validateForecastDistributionContract({
          ...validForecastContract,
          footingTier: 'empirically-calibrated-high-evidence',
          calibrationStatus: 'unverified-no-out-of-sample-evaluation',
        }),
      ).toThrow(RangeError);
    });
  });
});
