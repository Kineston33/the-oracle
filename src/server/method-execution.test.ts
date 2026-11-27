import { describe, expect, it } from 'vitest';
import {
  NumericConvergenceError,
  inverseRegularizedGammaQ,
  inverseRegularizedIncompleteBeta,
  log1mexp,
} from './numeric-primitives.ts';
import {
  CORE_SCIENTIFIC_METHOD_IDS,
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  SCIENTIFIC_METHOD_REGISTRY_VERSION,
} from './method-registry.ts';
import {
  METHOD_APPLICABILITY_PLANNER_VERSION,
  planMethodApplicability,
} from './method-selection.ts';
import {
  DEFAULT_CREDIBLE_INTERVAL_LEVEL,
  EXECUTABLE_SCIENTIFIC_METHOD_IDS,
  MAX_CERTIFIED_SHAPE_PARAMETER,
  METHOD_EXECUTION_VERSION,
  MIN_CERTIFIED_SHAPE_PARAMETER,
  UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS,
  UnimplementedScientificMethodError,
  executeBetaBinomialConjugate,
  executeDirichletMultinomialSymmetry,
  executePoissonGammaHazard,
  executeScientificMethod,
  executeStructuralUniformBaseline,
  executeWeightedKishEffectiveBinomial,
  type BetaBinomialExecutionInput,
  type DirichletMultinomialExecutionInput,
  type PoissonGammaExecutionInput,
  type ScientificMethodExecutionInput,
  type StructuralUniformExecutionInput,
  type WeightedKishExecutionInput,
} from './method-execution.ts';
import * as serverIndex from './index.ts';

const BINARY_OUTCOME_SPACE = {
  kind: 'binary' as const,
  outcomeLabels: ['occurred', 'did_not_occur'] as const,
  horizonStartsAt: '2026-01-01T00:00:00.000Z',
  horizonEndsAt: '2026-12-31T23:59:59.000Z',
  eventDefinitionHash: 'sha256:binary-event-contract-v1',
};

const TERNARY_OUTCOME_SPACE = {
  kind: 'categorical-exhaustive' as const,
  outcomeLabels: ['scenario_a', 'scenario_b', 'scenario_c'] as const,
  horizonStartsAt: '2026-01-01T00:00:00.000Z',
  horizonEndsAt: '2026-12-31T23:59:59.000Z',
  eventDefinitionHash: 'sha256:ternary-event-contract-v1',
};

function assertDeeplyFrozen(value: unknown, visited = new Set<unknown>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return;
  }
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDeeplyFrozen(item, visited);
    }
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    assertDeeplyFrozen((value as Record<string, unknown>)[key], visited);
  }
}

describe('Stage 2A-2.2 — Foundational Executable Scientific Method Adapters (src/server/method-execution.ts)', () => {
  describe('Module metadata, server entrypoint re-exports, and registry readiness alignment', () => {
    it('exports Stage 2A-2.2 constants, adapters, and dispatcher from src/server/index.ts', () => {
      expect(METHOD_EXECUTION_VERSION).toBe('2A-2.2.0');
      expect(DEFAULT_CREDIBLE_INTERVAL_LEVEL).toBe(0.95);
      expect(MIN_CERTIFIED_SHAPE_PARAMETER).toBe(0.05);
      expect(MAX_CERTIFIED_SHAPE_PARAMETER).toBe(1e4);
      expect(EXECUTABLE_SCIENTIFIC_METHOD_IDS).toEqual([
        'beta-binomial-conjugate',
        'weighted-kish-effective-binomial',
        'poisson-gamma-hazard',
        'dirichlet-multinomial-symmetry',
        'structural-uniform-baseline',
      ]);
      expect(UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS).toEqual([
        'student-t-terminal-diffusion',
        'first-passage-barrier-diffusion',
      ]);

      expect(serverIndex.METHOD_EXECUTION_VERSION).toBe(
        METHOD_EXECUTION_VERSION,
      );
      expect(serverIndex.executeBetaBinomialConjugate).toBe(
        executeBetaBinomialConjugate,
      );
      expect(serverIndex.executeWeightedKishEffectiveBinomial).toBe(
        executeWeightedKishEffectiveBinomial,
      );
      expect(serverIndex.executePoissonGammaHazard).toBe(
        executePoissonGammaHazard,
      );
      expect(serverIndex.executeDirichletMultinomialSymmetry).toBe(
        executeDirichletMultinomialSymmetry,
      );
      expect(serverIndex.executeStructuralUniformBaseline).toBe(
        executeStructuralUniformBaseline,
      );
      expect(serverIndex.executeScientificMethod).toBe(executeScientificMethod);
      expect(serverIndex.UnimplementedScientificMethodError).toBe(
        UnimplementedScientificMethodError,
      );
    });

    it('synchronizes DEFAULT_SCIENTIFIC_METHOD_REGISTRY and applicability planner readiness with Stage 2A-2.2', () => {
      expect(SCIENTIFIC_METHOD_REGISTRY_VERSION).toBe('2A-2.2.0');
      expect(METHOD_APPLICABILITY_PLANNER_VERSION).toBe('2A-2.1.0');

      const executedSet = new Set<string>(EXECUTABLE_SCIENTIFIC_METHOD_IDS);
      for (const methodId of CORE_SCIENTIFIC_METHOD_IDS) {
        const desc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(methodId);
        if (executedSet.has(methodId)) {
          expect(desc.hasExecutableImplementation).toBe(true);
          expect(desc.implementationStatus).toBe('implemented-and-verified');
        } else {
          expect(desc.hasExecutableImplementation).toBe(false);
          expect(desc.implementationStatus).toBe('registered-specification-only');
        }
      }

      const plan = planMethodApplicability({
        questionId: 'SYNTH-GEO-2026-001',
        questionCategory: 'geopolitics',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        horizon: {
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-12-31T23:59:59.000Z',
          referenceTime: '2026-01-01T00:00:00.000Z',
          hasPositiveExposureScaling: true,
        },
        availableEvidence: {
          availableChannels: [
            'binary-trial-counts',
            'weighted-binary-trials',
            'kish-effective-sample-size',
            'poisson-event-counts',
            'continuous-exposure-duration',
            'multinomial-category-counts',
            'outcome-partition-symmetry',
          ],
          hasVerifiableEmpiricalData: true,
          binaryTrialSuccesses: 14,
          binaryTrialFailures: 26,
          weightedSampleSize: 40,
          kishEffectiveSampleSize: 28.5,
          poissonEventCount: 14,
          poissonExposureDuration: 10.0,
          multinomialOutcomeCounts: [14, 26],
        },
        assumptions: {
          verifiedAssumptions: [
            'exchangeable-bernoulli-trials',
            'stationary-success-probability',
            'non-negative-importance-weights',
            'kish-effective-sample-adequacy',
            'conditionally-independent-poisson-increments',
            'homogeneous-or-known-exposure-intensity',
            'exchangeable-multinomial-trials',
            'exhaustive-mutually-exclusive-categories',
            'principle-of-indifference-partition-symmetry',
          ],
          allowStructuralBaseline: true,
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
          maxMemoryKbBudget: 1024,
        },
      });

      for (const rec of plan.evaluatedMethods) {
        if (executedSet.has(rec.methodId)) {
          expect(rec.hasExecutableImplementation).toBe(true);
          expect(rec.implementationStatus).toBe('implemented-and-verified');
        } else {
          expect(rec.hasExecutableImplementation).toBe(false);
          expect(rec.implementationStatus).toBe('registered-specification-only');
        }
      }
    });
  });

  describe('A. Beta-Binomial Conjugate (executeBetaBinomialConjugate)', () => {
    it('computes exact posterior parameters, predictive distribution, variance, and equal-tailed credible intervals', () => {
      const input: BetaBinomialExecutionInput = {
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 2, beta: 3 },
        observed: { successes: 14, failures: 26 },
      };
      const out = executeBetaBinomialConjugate(input);

      // Posterior: alphaPost = 16, betaPost = 29, total = 45
      const alphaPost = 16;
      const betaPost = 29;
      const totalPost = 45;
      const expectedSuccessProb = alphaPost / totalPost;
      const expectedFailureProb = betaPost / totalPost;
      const expectedVariance =
        (alphaPost * betaPost) / (totalPost * totalPost * (totalPost + 1));

      expect(out.methodId).toBe('beta-binomial-conjugate');
      expect(out.methodFamily).toBe('conjugate-discrete-frequency');
      expect(out.outcomeSpace).toEqual(BINARY_OUTCOME_SPACE);

      expect(out.outcomes).toHaveLength(2);
      expect(out.outcomes[0]!.probability).toBeCloseTo(
        expectedSuccessProb,
        15,
      );
      expect(out.outcomes[1]!.probability).toBeCloseTo(
        expectedFailureProb,
        15,
      );
      expect(out.outcomes[0]!.logProbability).toBeCloseTo(
        Math.log(expectedSuccessProb),
        15,
      );
      expect(out.outcomes[0]!.logComplementProbability).toBeCloseTo(
        Math.log(expectedFailureProb),
        15,
      );

      expect(out.parametricVariances).toHaveLength(2);
      expect(out.parametricVariances[0]).toBeCloseTo(expectedVariance, 15);
      expect(out.parametricVariances[1]).toBeCloseTo(expectedVariance, 15);

      expect(out.parametricIntervals).toHaveLength(2);
      const [successCi, failureCi] = out.parametricIntervals;
      expect(successCi!.kind).toBe('available');
      expect(failureCi!.kind).toBe('available');
      if (successCi!.kind === 'available' && failureCi!.kind === 'available') {
        expect(successCi.interval.level).toBe(0.95);
        const expectedLower = inverseRegularizedIncompleteBeta(
          0.025,
          alphaPost,
          betaPost,
        );
        const expectedMedian = inverseRegularizedIncompleteBeta(
          0.5,
          alphaPost,
          betaPost,
        );
        const expectedUpper = inverseRegularizedIncompleteBeta(
          0.975,
          alphaPost,
          betaPost,
        );
        expect(successCi.interval.lower).toBeCloseTo(expectedLower, 14);
        expect(successCi.interval.median).toBeCloseTo(expectedMedian, 14);
        expect(successCi.interval.upper).toBeCloseTo(expectedUpper, 14);
        expect(failureCi.interval.lower).toBeCloseTo(1 - expectedUpper, 14);
        expect(failureCi.interval.median).toBeCloseTo(1 - expectedMedian, 14);
        expect(failureCi.interval.upper).toBeCloseTo(1 - expectedLower, 14);
      }

      expect(out.effectiveSampleSize).toBe(40);
      expect(out.epistemologicalClaims.some((c) => c.tag === 'EBM')).toBe(true);
      expect(out.epistemologicalClaims.some((c) => c.tag === 'ANC')).toBe(true);
      assertDeeplyFrozen(out);
    });

    it('handles zero observations, single-sided counts, symmetric counts, large finite counts, custom interval levels, and inverted label ordering', () => {
      // 1. Zero observations (successes = 0, failures = 0) with Beta(1, 1) prior
      const zeroObs = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: { successes: 0, failures: 0 },
        credibleIntervalLevel: 0.9,
      });
      expect(zeroObs.outcomes[0]!.probability).toBeCloseTo(0.5, 15);
      expect(zeroObs.outcomes[1]!.probability).toBeCloseTo(0.5, 15);
      expect(zeroObs.parametricVariances[0]).toBeCloseTo(1 / 12, 15);
      expect(zeroObs.effectiveSampleSize).toBe(0);
      expect(zeroObs.warnings.length).toBeGreaterThan(0);
      const zeroCi0 = zeroObs.parametricIntervals[0]!;
      expect(zeroCi0.kind).toBe('available');
      if (zeroCi0.kind === 'available') {
        expect(zeroCi0.interval.level).toBe(0.9);
        expect(zeroCi0.interval.lower).toBeCloseTo(0.05, 12);
        expect(zeroCi0.interval.upper).toBeCloseTo(0.95, 12);
      }

      // 2. Single-sided observations (successes > 0, failures = 0) and inverted successOutcomeIndex: 1
      const invertedSpace = {
        kind: 'binary' as const,
        outcomeLabels: ['no', 'yes'] as const,
        horizonStartsAt: '2026-01-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-31T23:59:59.000Z',
        eventDefinitionHash: 'sha256:inverted-binary-contract',
      };
      const singleSided = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: invertedSpace,
        successOutcomeIndex: 1,
        prior: { alpha: 1, beta: 1 },
        observed: { successes: 10, failures: 0 },
      });
      // Index 0 is 'no' (failure = 1/12), Index 1 is 'yes' (success = 11/12)
      expect(singleSided.outcomes[0]!.probability).toBeCloseTo(1 / 12, 15);
      expect(singleSided.outcomes[1]!.probability).toBeCloseTo(11 / 12, 15);
      const [noCi, yesCi] = singleSided.parametricIntervals;
      if (noCi!.kind === 'available' && yesCi!.kind === 'available') {
        expect(yesCi.interval.lower).toBeGreaterThan(0.65);
        expect(noCi.interval.upper).toBeCloseTo(1 - yesCi.interval.lower, 14);
      }

      // 3. Large finite counts within certified domain [0.05, 1e4]
      const largeCounts = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: { successes: 4000, failures: 6000 },
      });
      expect(largeCounts.outcomes[0]!.probability).toBeCloseTo(4001 / 10002, 15);
      expect(largeCounts.effectiveSampleSize).toBe(10000);
    });

    it('rejects invalid priors, negative/non-integer counts, non-binary spaces, and invalid credibleIntervalLevel', () => {
      const base: BetaBinomialExecutionInput = {
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: { successes: 5, failures: 5 },
      };

      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          outcomeSpace: TERNARY_OUTCOME_SPACE,
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          successOutcomeIndex: 2 as unknown as 0,
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          prior: { alpha: 0, beta: 1 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          prior: { alpha: 1, beta: -1 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          prior: { alpha: 0.01, beta: 1 },
          observed: { successes: 0, failures: 5 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          observed: { successes: 15_000, failures: 5 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          observed: { successes: -1, failures: 5 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          observed: { successes: 5, failures: 2.5 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({ ...base, credibleIntervalLevel: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({ ...base, credibleIntervalLevel: 1 }),
      ).toThrow(RangeError);
      expect(() =>
        executeBetaBinomialConjugate({
          ...base,
          credibleIntervalLevel: Number.NaN,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('B. Weighted Kish Effective Binomial (executeWeightedKishEffectiveBinomial)', () => {
    it('recovers the exact unweighted Beta-Binomial update when all observation weights are equal', () => {
      const successes = 14;
      const failures = 26;
      const totalN = successes + failures;
      const commonWeight = 2.5;

      const unweighted = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1.5, beta: 2.5 },
        observed: { successes, failures },
      });

      const weightedEqual = executeWeightedKishEffectiveBinomial({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1.5, beta: 2.5 },
        observed: {
          weightedSuccessMass: successes * commonWeight,
          weightedFailureMass: failures * commonWeight,
          sumSquaredWeights: totalN * commonWeight * commonWeight,
          observationCount: totalN,
        },
      });

      expect(weightedEqual.effectiveSampleSize).toBeCloseTo(totalN, 14);
      expect(weightedEqual.outcomes[0]!.probability).toBeCloseTo(
        unweighted.outcomes[0]!.probability,
        15,
      );
      expect(weightedEqual.outcomes[1]!.probability).toBeCloseTo(
        unweighted.outcomes[1]!.probability,
        15,
      );
      expect(weightedEqual.parametricVariances[0]).toBeCloseTo(
        unweighted.parametricVariances[0]!,
        15,
      );

      const wCi = weightedEqual.parametricIntervals[0]!;
      const uCi = unweighted.parametricIntervals[0]!;
      if (wCi.kind === 'available' && uCi.kind === 'available') {
        expect(wCi.interval.lower).toBeCloseTo(uCi.interval.lower, 14);
        expect(wCi.interval.median).toBeCloseTo(uCi.interval.median, 14);
        expect(wCi.interval.upper).toBeCloseTo(uCi.interval.upper, 14);
      }
      assertDeeplyFrozen(weightedEqual);
    });

    it('reduces effectiveSampleSize and widens uncertainty under concentrated weights while classifying Kish scaling as [HDO] and coverage as [HEN]', () => {
      // 40 observations with the same weighted success rate 14/40 = 0.35,
      // but concentrated weights yielding nEffective = 10 < 40:
      // sumWeights = 100, weightedSuccessMass = 35, weightedFailureMass = 65,
      // sumSquaredWeights = 1000 => nEffective = 100^2 / 1000 = 10.
      const concentrated = executeWeightedKishEffectiveBinomial({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: {
          weightedSuccessMass: 35,
          weightedFailureMass: 65,
          sumSquaredWeights: 1000,
          observationCount: 40,
        },
      });

      const unweightedSameRate = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: { successes: 14, failures: 26 },
      });

      expect(concentrated.effectiveSampleSize).toBeCloseTo(10, 14);
      // Posterior under nEff=10 is Beta(1 + 3.5, 1 + 6.5) = Beta(4.5, 7.5)
      expect(concentrated.outcomes[0]!.probability).toBeCloseTo(4.5 / 12, 15);
      expect(concentrated.parametricVariances[0]!).toBeGreaterThan(
        unweightedSameRate.parametricVariances[0]!,
      );

      const cCi = concentrated.parametricIntervals[0]!;
      const uCi = unweightedSameRate.parametricIntervals[0]!;
      if (cCi.kind === 'available' && uCi.kind === 'available') {
        const concWidth = cCi.interval.upper - cCi.interval.lower;
        const unwWidth = uCi.interval.upper - uCi.interval.lower;
        expect(concWidth).toBeGreaterThan(unwWidth);
      }

      // Epistemological discipline:
      // - Kish identity is [IME]
      // - Pseudo-count Beta scaling is [HDO], NOT [EBM]
      // - Interval coverage is [HEN]
      const claimTags = concentrated.epistemologicalClaims.map((c) => c.tag);
      expect(claimTags).toContain('IME');
      expect(claimTags).toContain('HDO');
      expect(claimTags).toContain('HEN');
      expect(claimTags).not.toContain('EBM');

      // Warns about shared evidence with beta-binomial-conjugate without implying independent votes
      expect(
        concentrated.warnings.some(
          (w) =>
            w.includes('beta-binomial-conjugate') &&
            w.includes('NEVER be treated as independent votes'),
        ),
      ).toBe(true);
    });

    it('handles boundary all-success / all-failure weighted masses and tolerates tiny floating-point rounding at nEffective == observationCount', () => {
      const allSuccess = executeWeightedKishEffectiveBinomial({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: {
          weightedSuccessMass: 12,
          weightedFailureMass: 0,
          sumSquaredWeights: 36,
          observationCount: 4,
        },
      });
      // nEffective = 144 / 36 = 4, posterior = Beta(5, 1)
      expect(allSuccess.effectiveSampleSize).toBeCloseTo(4, 14);
      expect(allSuccess.outcomes[0]!.probability).toBeCloseTo(5 / 6, 15);

      // Tiny ULP overshoot on sumWeights^2 / sumSquaredWeights <= observationCount * (1 + 64 * EPSILON)
      const n = 7;
      const tinyOvershootSumSq = (n * n) / (n * (1 + 8 * Number.EPSILON));
      const withinTolerance = executeWeightedKishEffectiveBinomial({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: {
          weightedSuccessMass: 3,
          weightedFailureMass: 4,
          sumSquaredWeights: tinyOvershootSumSq,
          observationCount: n,
        },
      });
      expect(withinTolerance.effectiveSampleSize).toBeCloseTo(n, 13);
    });

    it('rejects negative masses, zero total mass, non-positive sumSquaredWeights, and genuine nEffective > observationCount', () => {
      const base: WeightedKishExecutionInput = {
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: {
          weightedSuccessMass: 4,
          weightedFailureMass: 6,
          sumSquaredWeights: 20,
          observationCount: 10,
        },
      };

      expect(() =>
        executeWeightedKishEffectiveBinomial({
          ...base,
          observed: { ...base.observed, weightedSuccessMass: -0.1 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeWeightedKishEffectiveBinomial({
          ...base,
          observed: {
            ...base.observed,
            weightedSuccessMass: 0,
            weightedFailureMass: 0,
          },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeWeightedKishEffectiveBinomial({
          ...base,
          observed: { ...base.observed, sumSquaredWeights: 0 },
        }),
      ).toThrow(RangeError);
      expect(() =>
        executeWeightedKishEffectiveBinomial({
          ...base,
          observed: { ...base.observed, observationCount: 0 },
        }),
      ).toThrow(RangeError);
      // nEffective = 100 / 5 = 20 > observationCount = 10
      expect(() =>
        executeWeightedKishEffectiveBinomial({
          ...base,
          observed: {
            ...base.observed,
            sumSquaredWeights: 5,
            observationCount: 10,
          },
        }),
      ).toThrow(RangeError);
    });
  });

  describe('C. Poisson-Gamma Hazard (executePoissonGammaHazard)', () => {
    it('computes exact Negative-Binomial survival L(H), event occurrence 1 - L(H), exact variance L(2H) - L(H)^2, and monotone Gamma quantile intervals under shape-rate parameterization', () => {
      const input: PoissonGammaExecutionInput = {
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: {
          shape: 2,
          rate: 10,
          parameterization: 'shape-rate',
        },
        observed: {
          eventCount: 5,
          exposureDuration: 40,
          exposureUnit: 'days',
        },
        forecast: {
          exposureDuration: 15,
          exposureUnit: 'days',
        },
        exposureUnit: 'days',
      };

      const out = executePoissonGammaHazard(input);

      // Posterior shape = 2 + 5 = 7, posterior rate = 10 + 40 = 50, H = 15
      const postShape = 7;
      const postRate = 50;
      const H = 15;
      const lH = Math.pow(postRate / (postRate + H), postShape);
      const l2H = Math.pow(postRate / (postRate + 2 * H), postShape);
      const expectedEventProb = 1 - lH;
      const expectedNoEventProb = lH;
      const expectedVariance = l2H - lH * lH;

      expect(out.methodId).toBe('poisson-gamma-hazard');
      expect(out.methodFamily).toBe('continuous-time-hazard');
      expect(out.outcomes[0]!.probability).toBeCloseTo(expectedEventProb, 15);
      expect(out.outcomes[1]!.probability).toBeCloseTo(expectedNoEventProb, 15);
      expect(out.parametricVariances[0]).toBeCloseTo(expectedVariance, 15);
      expect(out.parametricVariances[1]).toBeCloseTo(expectedVariance, 15);

      const [eventCi, noEventCi] = out.parametricIntervals;
      expect(eventCi!.kind).toBe('available');
      expect(noEventCi!.kind).toBe('available');
      if (eventCi!.kind === 'available' && noEventCi!.kind === 'available') {
        // Gamma quantile: X = lambda * postRate ~ Gamma(postShape, 1)
        const lambdaLower =
          inverseRegularizedGammaQ(postShape, 0.975) / postRate;
        const lambdaUpper =
          inverseRegularizedGammaQ(postShape, 0.025) / postRate;
        const expectedEventLower = -Math.expm1(-lambdaLower * H);
        const expectedEventUpper = -Math.expm1(-lambdaUpper * H);
        const expectedNoEventLower = Math.exp(-lambdaUpper * H);
        const expectedNoEventUpper = Math.exp(-lambdaLower * H);

        expect(eventCi.interval.lower).toBeCloseTo(expectedEventLower, 14);
        expect(eventCi.interval.upper).toBeCloseTo(expectedEventUpper, 14);
        expect(noEventCi.interval.lower).toBeCloseTo(expectedNoEventLower, 14);
        expect(noEventCi.interval.upper).toBeCloseTo(expectedNoEventUpper, 14);
      }

      expect(out.effectiveSampleSize).toBe(5);
      assertDeeplyFrozen(out);
    });

    it('preserves high relative accuracy in the extreme small-hazard regime via log-space + log1mexp without catastrophic cancellation', () => {
      // Very small hazard exposure: postShape = 2, postRate = 1e6, H = 1e-8
      // Exact logZeroEvent = -2 * log1p(1e-14) ≈ -2e-14
      // Event probability ≈ 2e-14 (where naive 1 - Math.exp(logZeroEvent) loses significant digits)
      const out = executePoissonGammaHazard({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: { shape: 2, rate: 500_000 },
        observed: {
          eventCount: 0,
          exposureDuration: 500_000,
          exposureUnit: 'hours',
        },
        forecast: {
          exposureDuration: 1e-8,
          exposureUnit: 'hours',
        },
      });

      const postShape = 2;
      const postRate = 1_000_000;
      const H = 1e-8;
      const exactLogSurvival = -postShape * Math.log1p(H / postRate);
      const exactLogEvent = log1mexp(exactLogSurvival);
      const expectedEventProb = Math.exp(exactLogEvent);

      expect(out.outcomes[0]!.logProbability).toBeCloseTo(exactLogEvent, 14);
      expect(out.outcomes[0]!.probability).toBeCloseTo(expectedEventProb, 27);
      // Relative error against asymptotic 2 * 1e-14 = 2e-14
      const relError =
        Math.abs(out.outcomes[0]!.probability - 2e-14) / 2e-14;
      expect(relError).toBeLessThan(1e-12);
    });

    it('handles large-hazard regimes and inverted outcome-label ordering without NaN or collapse', () => {
      const invertedSpace = {
        kind: 'binary' as const,
        outcomeLabels: ['no_incident', 'incident'] as const,
        horizonStartsAt: '2026-01-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-31T23:59:59.000Z',
        eventDefinitionHash: 'sha256:inverted-hazard-contract',
      };
      const out = executePoissonGammaHazard({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: invertedSpace,
        eventOutcomeIndex: 1,
        prior: { shape: 10, rate: 1 },
        observed: {
          eventCount: 20,
          exposureDuration: 2,
          exposureUnit: 'years',
        },
        forecast: {
          exposureDuration: 50,
          exposureUnit: 'years',
        },
      });

      // Index 0 is 'no_incident', Index 1 is 'incident'
      expect(out.outcomes[0]!.probability).toBeGreaterThanOrEqual(0);
      expect(out.outcomes[0]!.probability).toBeLessThan(1e-20);
      expect(out.outcomes[1]!.probability).toBeCloseTo(1, 15);
      expect(Number.isFinite(out.outcomes[0]!.logProbability)).toBe(true);
      expect(Number.isFinite(out.outcomes[1]!.logComplementProbability)).toBe(
        true,
      );
      expect(
        out.warnings.some((w) => w.includes('Forecast exposure duration')),
      ).toBe(true);
    });

    it('computes finite positive conditional event-probability variance without 2 * x overflow at extreme forecast exposure (H = 1e308)', () => {
      const priorShape = 0.05;
      const priorRate = 1;
      const observedEventCount = 0;
      const observedExposure = 1e-300;
      const forecastExposure = 1e308;

      const out = executePoissonGammaHazard({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: { shape: priorShape, rate: priorRate },
        observed: {
          eventCount: observedEventCount,
          exposureDuration: observedExposure,
          exposureUnit: 'years',
        },
        forecast: {
          exposureDuration: forecastExposure,
          exposureUnit: 'years',
        },
        exposureUnit: 'years',
      });

      const posteriorShape = priorShape + observedEventCount;
      const posteriorRate = priorRate + observedExposure;
      expect(posteriorRate).toBe(1);

      const exposureRatio = forecastExposure / posteriorRate;
      expect(Number.isFinite(exposureRatio)).toBe(true);
      expect(exposureRatio).toBe(1e308);

      // Independent stable reference without 2 * x overflow:
      // ln(1 + 2x) = ln(x) + ln(2) + ln(1 + 0.5 / x)
      // x^2 / (1 + 2x) = x / (2 + 1 / x)
      const refLogL2H =
        -posteriorShape *
        (Math.log(exposureRatio) + Math.LN2 + Math.log1p(0.5 / exposureRatio));
      const refRatioDiffArg = exposureRatio / (2 + 1 / exposureRatio);
      const refLogOnePlusRatioDiff =
        Math.log(refRatioDiffArg) + Math.log1p(1 / refRatioDiffArg);
      const expectedVariance =
        Math.exp(refLogL2H) *
        -Math.expm1(-posteriorShape * refLogOnePlusRatioDiff);

      expect(expectedVariance).toBeCloseTo(3.8454617884310206e-16, 30);

      for (const outcome of out.outcomes) {
        expect(Number.isFinite(outcome.probability)).toBe(true);
        expect(Number.isFinite(outcome.complementProbability)).toBe(true);
        expect(Number.isFinite(outcome.logProbability)).toBe(true);
        expect(Number.isFinite(outcome.logComplementProbability)).toBe(true);
        expect(Number.isNaN(outcome.probability)).toBe(false);
      }

      for (const variance of out.parametricVariances) {
        expect(Number.isFinite(variance)).toBe(true);
        expect(Number.isNaN(variance)).toBe(false);
        expect(variance).toBeGreaterThan(0);
        const relErr =
          Math.abs(variance - expectedVariance) / expectedVariance;
        expect(relErr).toBeLessThan(1e-13);
      }
    });

    it('preserves exact x^2 / (1 + 2x) variance identity immediately above the 1e8 exposureRatio threshold without x / 2 truncation error', () => {
      const priorShape = 0.05;
      const priorRate = 0.5;
      const observedEventCount = 0;
      const observedExposure = 0.5;
      const forecastExposure = 1.000001e8;

      const out = executePoissonGammaHazard({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: { shape: priorShape, rate: priorRate },
        observed: {
          eventCount: observedEventCount,
          exposureDuration: observedExposure,
          exposureUnit: 'days',
        },
        forecast: {
          exposureDuration: forecastExposure,
          exposureUnit: 'days',
        },
        exposureUnit: 'days',
      });

      const a = priorShape + observedEventCount;
      const posteriorRate = priorRate + observedExposure;
      const x = forecastExposure / posteriorRate;
      expect(x).toBeGreaterThan(1e8);

      const logL2H = -a * Math.log1p(2 * x);
      const ratioDiffArg = (x * x) / (1 + 2 * x);
      const expectedVariance =
        Math.exp(logL2H) * -Math.expm1(-a * Math.log1p(ratioDiffArg));

      // Verify that the naive x / 2 approximation violates the 1e-13 relative error bound:
      const truncatedApproxVariance =
        Math.exp(logL2H) * -Math.expm1(-a * Math.log1p(0.5 * x));
      expect(
        Math.abs(truncatedApproxVariance - expectedVariance) / expectedVariance,
      ).toBeGreaterThan(1e-10);

      for (const variance of out.parametricVariances) {
        const relErr =
          Math.abs(variance - expectedVariance) / expectedVariance;
        expect(relErr).toBeLessThan(1e-13);
      }
    });

    it('rejects mismatched or missing exposure units, shape-scale parameterization, non-positive exposures, and invalid event counts', () => {
      const base: PoissonGammaExecutionInput = {
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: { shape: 1, rate: 1 },
        observed: {
          eventCount: 3,
          exposureDuration: 10,
          exposureUnit: 'days',
        },
        forecast: {
          exposureDuration: 5,
          exposureUnit: 'days',
        },
      };

      // Mismatched units (must never implicitly convert or derive from timestamps)
      expect(() =>
        executePoissonGammaHazard({
          ...base,
          observed: { ...base.observed, exposureUnit: 'days' },
          forecast: { ...base.forecast, exposureUnit: 'hours' },
        }),
      ).toThrow(RangeError);

      // Missing exposure unit altogether
      expect(() =>
        executePoissonGammaHazard({
          ...base,
          observed: { eventCount: 3, exposureDuration: 10 },
          forecast: { exposureDuration: 5 },
        }),
      ).toThrow(RangeError);

      // Forbidden shape-scale parameterization
      expect(() =>
        executePoissonGammaHazard({
          ...base,
          prior: { shape: 1, rate: 1, scale: 1 } as unknown as {
            shape: number;
            rate: number;
          },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          observed: { ...base.observed, exposureDuration: 0 },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          forecast: { ...base.forecast, exposureDuration: -1 },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          observed: { ...base.observed, eventCount: -1 },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          observed: { ...base.observed, eventCount: 1.5 },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          prior: { shape: 0.01, rate: 1 },
          observed: { ...base.observed, eventCount: 0 },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executePoissonGammaHazard({
          ...base,
          prior: { shape: 1, rate: 0 },
        }),
      ).toThrow(RangeError);
    });
  });

  describe('D. Dirichlet-Multinomial Symmetry (executeDirichletMultinomialSymmetry)', () => {
    it('computes exact K-category Dirichlet posterior probabilities, marginal Beta variances, and marginal credible intervals', () => {
      const input: DirichletMultinomialExecutionInput = {
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        prior: { alpha: [1, 2, 3] },
        observed: { counts: [10, 20, 30] },
      };

      const out = executeDirichletMultinomialSymmetry(input);

      // Posterior alpha = [11, 22, 33], sum = 66
      const postAlpha = [11, 22, 33];
      const totalAlpha = 66;

      expect(out.methodId).toBe('dirichlet-multinomial-symmetry');
      expect(out.methodFamily).toBe('categorical-exchangeable-symmetry');
      expect(out.outcomes).toHaveLength(3);

      for (let k = 0; k < 3; k += 1) {
        const aK = postAlpha[k]!;
        const bK = totalAlpha - aK;
        const expectedProb = aK / totalAlpha;
        const expectedVar =
          (aK * bK) / (totalAlpha * totalAlpha * (totalAlpha + 1));

        expect(out.outcomes[k]!.probability).toBeCloseTo(expectedProb, 15);
        expect(out.parametricVariances[k]).toBeCloseTo(expectedVar, 15);

        const ci = out.parametricIntervals[k]!;
        expect(ci.kind).toBe('available');
        if (ci.kind === 'available') {
          expect(ci.interval.lower).toBeCloseTo(
            inverseRegularizedIncompleteBeta(0.025, aK, bK),
            14,
          );
          expect(ci.interval.upper).toBeCloseTo(
            inverseRegularizedIncompleteBeta(0.975, aK, bK),
            14,
          );
        }
      }

      expect(out.effectiveSampleSize).toBe(60);
      assertDeeplyFrozen(out);
    });

    it('preserves exact mathematical equivalence with Beta-Binomial on binary outcome spaces (K = 2) when priors and counts align', () => {
      const betaBinomialOut = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 2.5, beta: 4.5 },
        observed: { successes: 18, failures: 32 },
        credibleIntervalLevel: 0.95,
      });

      const dirichletBinaryOut = executeDirichletMultinomialSymmetry({
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        prior: { alpha: [2.5, 4.5] },
        observed: { counts: [18, 32] },
        credibleIntervalLevel: 0.95,
      });

      expect(dirichletBinaryOut.effectiveSampleSize).toBe(
        betaBinomialOut.effectiveSampleSize,
      );

      for (let k = 0; k < 2; k += 1) {
        expect(dirichletBinaryOut.outcomes[k]!.probability).toBeCloseTo(
          betaBinomialOut.outcomes[k]!.probability,
          15,
        );
        expect(dirichletBinaryOut.outcomes[k]!.logProbability).toBeCloseTo(
          betaBinomialOut.outcomes[k]!.logProbability,
          15,
        );
        expect(
          dirichletBinaryOut.outcomes[k]!.logComplementProbability,
        ).toBeCloseTo(
          betaBinomialOut.outcomes[k]!.logComplementProbability,
          15,
        );
        expect(dirichletBinaryOut.parametricVariances[k]).toBeCloseTo(
          betaBinomialOut.parametricVariances[k]!,
          15,
        );

        const dCi = dirichletBinaryOut.parametricIntervals[k]!;
        const bCi = betaBinomialOut.parametricIntervals[k]!;
        if (dCi.kind === 'available' && bCi.kind === 'available') {
          expect(dCi.interval.lower).toBeCloseTo(bCi.interval.lower, 15);
          expect(dCi.interval.median).toBeCloseTo(bCi.interval.median, 15);
          expect(dCi.interval.upper).toBeCloseTo(bCi.interval.upper, 15);
        }
      }

      // Emits explicit warning on K=2 about equivalence with beta-binomial-conjugate
      expect(
        dirichletBinaryOut.warnings.some((w) =>
          w.includes('beta-binomial-conjugate'),
        ),
      ).toBe(true);
    });

    it('rejects mismatched vector lengths, negative/non-integer counts, and out-of-domain concentration parameters', () => {
      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 1] },
          observed: { counts: [5, 5, 5] },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 1, 1] },
          observed: { counts: [5, 5] },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 0, 1] },
          observed: { counts: [5, 5, 5] },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 1, 1] },
          observed: { counts: [5, -1, 5] },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 1, 1] },
          observed: { counts: [5, 2.5, 5] },
        }),
      ).toThrow(RangeError);

      expect(() =>
        executeDirichletMultinomialSymmetry({
          methodId: 'dirichlet-multinomial-symmetry',
          outcomeSpace: TERNARY_OUTCOME_SPACE,
          prior: { alpha: [1, 1, 1] },
          observed: { counts: [5000, 5000, 5000] },
        }),
      ).toThrow(RangeError);
    });
  });

  describe('E. Structural Uniform Baseline (executeStructuralUniformBaseline)', () => {
    it('assigns P(k) = 1/K with effectiveSampleSize = 0, zero parametric variance, and point-mass-structural-baseline interval omission when partition symmetry is verified', () => {
      const input: StructuralUniformExecutionInput = {
        methodId: 'structural-uniform-baseline',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale:
            'Symmetric 3-outcome tournament draw before any match evidence is observed.',
        },
      };

      const out = executeStructuralUniformBaseline(input);

      expect(out.methodId).toBe('structural-uniform-baseline');
      expect(out.methodFamily).toBe('structural-baseline');
      expect(out.outcomes).toHaveLength(3);

      for (let k = 0; k < 3; k += 1) {
        expect(out.outcomes[k]!.probability).toBeCloseTo(1 / 3, 15);
        expect(out.outcomes[k]!.logProbability).toBeCloseTo(-Math.log(3), 15);
        expect(out.outcomes[k]!.logComplementProbability).toBeCloseTo(
          Math.log(2 / 3),
          15,
        );
        expect(out.parametricVariances[k]).toBe(0);

        const intervalField = out.parametricIntervals[k]!;
        expect(intervalField.kind).toBe('omitted');
        if (intervalField.kind === 'omitted') {
          expect(intervalField.reason).toBe('point-mass-structural-baseline');
        }
      }

      expect(out.effectiveSampleSize).toBe(0);
      expect(out.epistemologicalClaims.some((c) => c.tag === 'IME')).toBe(true);
      expect(out.epistemologicalClaims.some((c) => c.tag === 'HDO')).toBe(true);
      expect(
        out.warnings.some((w) =>
          w.includes('never be presented as an empirically calibrated'),
        ),
      ).toBe(true);
      assertDeeplyFrozen(out);
    });

    it('refuses execution when partitionSymmetryVerified is false, symmetryPremise is missing, or outcome space is continuous/barrier', () => {
      const validBase: StructuralUniformExecutionInput = {
        methodId: 'structural-uniform-baseline',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale: 'Symmetric binary coin-flip partition.',
        },
      };

      // Refuses when partitionSymmetryVerified is false
      expect(() =>
        executeStructuralUniformBaseline({
          ...validBase,
          symmetryPremise: {
            ...validBase.symmetryPremise,
            partitionSymmetryVerified: false,
          },
        }),
      ).toThrow(RangeError);

      // Refuses when exhaustiveMutuallyExclusiveVerified is false
      expect(() =>
        executeStructuralUniformBaseline({
          ...validBase,
          symmetryPremise: {
            ...validBase.symmetryPremise,
            exhaustiveMutuallyExclusiveVerified: false,
          },
        }),
      ).toThrow(RangeError);

      // Refuses when symmetryRationale is empty
      expect(() =>
        executeStructuralUniformBaseline({
          ...validBase,
          symmetryPremise: {
            ...validBase.symmetryPremise,
            symmetryRationale: '   ',
          },
        }),
      ).toThrow(RangeError);

      // Refuses on discretized-continuous-partition
      expect(() =>
        executeStructuralUniformBaseline({
          ...validBase,
          outcomeSpace: {
            kind: 'discretized-continuous-partition',
            outcomeLabels: ['low', 'mid', 'high'],
            partitionThresholds: [0, 10],
            horizonStartsAt: '2026-01-01T00:00:00.000Z',
            horizonEndsAt: '2026-12-31T23:59:59.000Z',
            eventDefinitionHash: 'sha256:continuous-partition-contract',
          },
        }),
      ).toThrow(RangeError);

      // Refuses on first-passage-before-horizon
      expect(() =>
        executeStructuralUniformBaseline({
          ...validBase,
          outcomeSpace: {
            kind: 'first-passage-before-horizon',
            outcomeLabels: ['hit', 'not_hit'],
            barrierLevel: 100,
            barrierDirection: 'upper-absorbing',
            horizonStartsAt: '2026-01-01T00:00:00.000Z',
            horizonEndsAt: '2026-12-31T23:59:59.000Z',
            eventDefinitionHash: 'sha256:barrier-contract',
          },
        }),
      ).toThrow(RangeError);
    });
  });

  describe('F. Deterministic Dispatcher, Unimplemented Methods, Immutability & Convergence Propagation', () => {
    it('routes all 5 implemented methods deterministically through executeScientificMethod and defends against caller input mutation', () => {
      const mutableLabels = ['occurred', 'did_not_occur'];
      const betaInput: BetaBinomialExecutionInput = {
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: {
          kind: 'binary',
          outcomeLabels: mutableLabels,
          horizonStartsAt: '2026-01-01T00:00:00.000Z',
          horizonEndsAt: '2026-12-31T23:59:59.000Z',
          eventDefinitionHash: 'sha256:mutable-test-contract',
        },
        successOutcomeIndex: 0,
        prior: { alpha: 2, beta: 3 },
        observed: { successes: 10, failures: 15 },
      };

      const run1 = executeScientificMethod(betaInput);
      const run2 = executeScientificMethod(betaInput);
      expect(run1).toEqual(run2);

      // Mutating caller's array after execution does not affect returned output
      mutableLabels[0] = 'mutated_label';
      expect(run1.outcomeSpace.outcomeLabels).toEqual([
        'occurred',
        'did_not_occur',
      ]);

      // Dispatch the remaining 4 implemented methods
      const kishOut = executeScientificMethod({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 1 },
        observed: {
          weightedSuccessMass: 8,
          weightedFailureMass: 12,
          sumSquaredWeights: 40,
          observationCount: 15,
        },
      });
      expect(kishOut.methodId).toBe('weighted-kish-effective-binomial');

      const poissonOut = executeScientificMethod({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        eventOutcomeIndex: 0,
        prior: { shape: 1, rate: 2 },
        observed: {
          eventCount: 4,
          exposureDuration: 10,
          exposureUnit: 'days',
        },
        forecast: {
          exposureDuration: 3,
          exposureUnit: 'days',
        },
      });
      expect(poissonOut.methodId).toBe('poisson-gamma-hazard');

      const dirichletOut = executeScientificMethod({
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        prior: { alpha: [1, 1, 1] },
        observed: { counts: [3, 4, 5] },
      });
      expect(dirichletOut.methodId).toBe('dirichlet-multinomial-symmetry');

      const baselineOut = executeScientificMethod({
        methodId: 'structural-uniform-baseline',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale: 'Symmetric 3-outcome reference partition.',
        },
      });
      expect(baselineOut.methodId).toBe('structural-uniform-baseline');
    });

    it('throws UnimplementedScientificMethodError for student-t-terminal-diffusion and first-passage-barrier-diffusion and RangeError for unknown methodIds', () => {
      for (const unimplementedId of UNIMPLEMENTED_SCIENTIFIC_METHOD_IDS) {
        expect(() =>
          executeScientificMethod({
            methodId: unimplementedId,
            outcomeSpace: BINARY_OUTCOME_SPACE,
          }),
        ).toThrow(UnimplementedScientificMethodError);

        try {
          executeScientificMethod({
            methodId: unimplementedId,
            outcomeSpace: BINARY_OUTCOME_SPACE,
          });
        } catch (err) {
          expect(err).toBeInstanceOf(UnimplementedScientificMethodError);
          expect((err as UnimplementedScientificMethodError).methodId).toBe(
            unimplementedId,
          );
          expect(
            (err as UnimplementedScientificMethodError).implementationStatus,
          ).toBe('registered-specification-only');
        }
      }

      expect(() =>
        executeScientificMethod({
          methodId:
            'custom:unregistered-method' as unknown as 'beta-binomial-conjugate',
          outcomeSpace: BINARY_OUTCOME_SPACE,
        } as unknown as ScientificMethodExecutionInput),
      ).toThrow(RangeError);

      expect(() =>
        executeScientificMethod(
          null as unknown as ScientificMethodExecutionInput,
        ),
      ).toThrow(RangeError);
    });

    it('propagates NumericConvergenceError explicitly without silent fallback when special-function iteration budget is exhausted', () => {
      expect(() =>
        executeBetaBinomialConjugate({
          methodId: 'beta-binomial-conjugate',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          successOutcomeIndex: 0,
          prior: { alpha: 12, beta: 19 },
          observed: { successes: 30, failures: 45 },
          numericOptions: {
            maxIterations: 1,
            relativeTolerance: 1e-15,
          },
        }),
      ).toThrow(NumericConvergenceError);

      expect(() =>
        executePoissonGammaHazard({
          methodId: 'poisson-gamma-hazard',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          eventOutcomeIndex: 0,
          prior: { shape: 5, rate: 10 },
          observed: {
            eventCount: 12,
            exposureDuration: 25,
            exposureUnit: 'days',
          },
          forecast: {
            exposureDuration: 5,
            exposureUnit: 'days',
          },
          numericOptions: {
            maxIterations: 1,
            relativeTolerance: 1e-15,
          },
        }),
      ).toThrow(NumericConvergenceError);
    });
  });
});
