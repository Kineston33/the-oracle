import { describe, expect, it } from 'vitest';
import {
  createDualChannelProbabilityFromLog,
  createDualChannelProbabilityFromPair,
  validateForecastDistributionContract,
} from './numeric-primitives.ts';
import {
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  createScientificMethodRegistry,
  validateScientificMethodDescriptor,
} from './method-registry.ts';
import {
  planMethodApplicability,
  type MethodApplicabilityPlan,
  type MethodApplicabilityPlanningInput,
} from './method-selection.ts';
import {
  executeBetaBinomialConjugate,
  executeDirichletMultinomialSymmetry,
  executePoissonGammaHazard,
  executeStructuralUniformBaseline,
  executeWeightedKishEffectiveBinomial,
} from './method-execution.ts';
import {
  EVIDENCE_DRIVEN_FOOTING_TIERS,
  FORECAST_SYNTHESIS_VERSION,
  assertCanonicalOutcomeSpaceEquality,
  computeDependenceAwareMethodWeights,
  synthesizeForecastDistribution,
} from './forecast-synthesis.ts';
import type {
  OutcomeSpaceDescriptor,
  ScientificMethodOutput,
} from './forecast-types.ts';
import * as serverIndex from './index.ts';

const BINARY_OUTCOME_SPACE: OutcomeSpaceDescriptor = {
  kind: 'binary',
  outcomeLabels: ['occurred', 'did_not_occur'],
  horizonStartsAt: '2026-01-01T00:00:00.000Z',
  horizonEndsAt: '2026-12-31T23:59:59.000Z',
  eventDefinitionHash: 'sha256:synth-binary-contract-001',
};

const TERNARY_OUTCOME_SPACE: OutcomeSpaceDescriptor = {
  kind: 'categorical-exhaustive',
  outcomeLabels: ['outcome_a', 'outcome_b', 'outcome_c'],
  horizonStartsAt: '2026-01-01T00:00:00.000Z',
  horizonEndsAt: '2026-12-31T23:59:59.000Z',
  eventDefinitionHash: 'sha256:synth-ternary-contract-001',
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

function createAllBinaryApplicablePlanningInput(
  allowStructuralBaseline = true,
): MethodApplicabilityPlanningInput {
  return {
    questionId: 'SYNTH-GEO-2026-001',
    questionCategory: 'geopolitics',
    subdomain: 'binary-event-occurrence',
    outcomeSpace: BINARY_OUTCOME_SPACE,
    horizon: {
      startsAt: BINARY_OUTCOME_SPACE.horizonStartsAt,
      endsAt: BINARY_OUTCOME_SPACE.horizonEndsAt,
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
        ...(allowStructuralBaseline ? (['outcome-partition-symmetry'] as const) : []),
      ],
      hasVerifiableEmpiricalData: true,
      binaryTrialSuccesses: 14,
      binaryTrialFailures: 26,
      weightedSampleSize: 40,
      kishEffectiveSampleSize: 25,
      poissonEventCount: 5,
      poissonExposureDuration: 40,
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
        ...(allowStructuralBaseline
          ? (['principle-of-indifference-partition-symmetry'] as const)
          : []),
      ],
      allowStructuralBaseline,
    },
    computationalCapabilities: {
      maxAllowedCostTier: 'high',
      allowIterativeSpecialFunctions: true,
      maxMemoryKbBudget: 1024,
    },
  };
}

function executeAllFourBinaryEvidenceMethods(
  outcomeSpace: OutcomeSpaceDescriptor = BINARY_OUTCOME_SPACE,
): readonly ScientificMethodOutput[] {
  const betaOut = executeBetaBinomialConjugate({
    methodId: 'beta-binomial-conjugate',
    outcomeSpace,
    successOutcomeIndex: 0,
    prior: { alpha: 2, beta: 3 },
    observed: { successes: 14, failures: 26 },
  });
  const kishOut = executeWeightedKishEffectiveBinomial({
    methodId: 'weighted-kish-effective-binomial',
    outcomeSpace,
    successOutcomeIndex: 0,
    prior: { alpha: 1, beta: 1 },
    observed: {
      weightedSuccessMass: 35,
      weightedFailureMass: 65,
      sumSquaredWeights: 400,
      observationCount: 40,
    },
  });
  const poissonOut = executePoissonGammaHazard({
    methodId: 'poisson-gamma-hazard',
    outcomeSpace,
    eventOutcomeIndex: 0,
    prior: { shape: 2, rate: 10 },
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
  });
  const dirichletOut = executeDirichletMultinomialSymmetry({
    methodId: 'dirichlet-multinomial-symmetry',
    outcomeSpace,
    prior: { alpha: [2, 3] },
    observed: { counts: [14, 26] },
  });

  return [betaOut, kishOut, poissonOut, dirichletOut];
}

describe('Stage 2A-2.3 — Dependence-Aware Multi-Method Aggregation & Forecast Synthesis (src/server/forecast-synthesis.ts)', () => {
  describe('Module metadata & server entrypoint re-exports', () => {
    it('exports Stage 2A-2.3 constants and synthesis functions from src/server/index.ts', () => {
      expect(FORECAST_SYNTHESIS_VERSION).toBe('2A-2.3.0');
      expect(EVIDENCE_DRIVEN_FOOTING_TIERS).toEqual([
        'empirically-calibrated-high-evidence',
        'methodologically-sound-moderate-evidence',
        'defensible-low-confidence-exploratory',
      ]);
      expect(serverIndex.FORECAST_SYNTHESIS_VERSION).toBe(
        FORECAST_SYNTHESIS_VERSION,
      );
      expect(serverIndex.synthesizeForecastDistribution).toBe(
        synthesizeForecastDistribution,
      );
      expect(serverIndex.computeDependenceAwareMethodWeights).toBe(
        computeDependenceAwareMethodWeights,
      );
      expect(serverIndex.assertCanonicalOutcomeSpaceEquality).toBe(
        assertCanonicalOutcomeSpaceEquality,
      );
    });
  });

  describe('1, 2, 7, 8, 9 & 10. Multi-method linear pool, dependence-component weighting, structural baseline exclusion & independence honesty', () => {
    it('synthesizes 4 applicable evidence-driven binary methods across 2 dependence components while keeping structural-uniform-baseline outside the ensemble as reference-only', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(true),
      );
      const evidenceOutputs = executeAllFourBinaryEvidenceMethods();
      const baselineOutput = executeStructuralUniformBaseline({
        methodId: 'structural-uniform-baseline',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale: 'Symmetric binary reference partition.',
        },
      });

      const result = synthesizeForecastDistribution({
        plan,
        methodOutputs: [...evidenceOutputs, baselineOutput],
        footingTier: 'methodologically-sound-moderate-evidence',
      });
      expect(validateForecastDistributionContract(result)).toBe(result);

      // 1. Executed vs Ensemble-Contributing vs Reference-Only separation (Requirements 5 & 10):
      expect(result.contrastReport.executedMethodIds).toEqual([
        'beta-binomial-conjugate',
        'weighted-kish-effective-binomial',
        'poisson-gamma-hazard',
        'dirichlet-multinomial-symmetry',
        'structural-uniform-baseline',
      ]);
      expect(result.contrastReport.ensembleContributingMethodIds).toEqual([
        'beta-binomial-conjugate',
        'weighted-kish-effective-binomial',
        'poisson-gamma-hazard',
        'dirichlet-multinomial-symmetry',
      ]);
      expect(result.contrastReport.referenceOnlyMethodIds).toEqual([
        'structural-uniform-baseline',
      ]);
      expect(result.contrastReport.referenceOnlyMethodOutputs).toHaveLength(1);
      expect(result.contrastReport.referenceOnlyMethodOutputs?.[0]?.methodId).toBe(
        'structural-uniform-baseline',
      );
      expect(
        Object.prototype.hasOwnProperty.call(
          result.contrastReport.weightsByMethod,
          'structural-uniform-baseline',
        ),
      ).toBe(false);

      // 2. Two-level dependence-aware weighting [HDO] (Requirement 4 & Test 7):
      // Component 1: [beta-binomial-conjugate, weighted-kish-effective-binomial, dirichlet-multinomial-symmetry] -> component weight 1/2 -> 1/6 each
      // Component 2: [poisson-gamma-hazard] (singleton unlinked) -> component weight 1/2 -> 1/2
      expect(result.contrastReport.weightingPolicy?.policyId).toBe(
        'equal-component-then-equal-within-component-hdo',
      );
      expect(result.contrastReport.weightingPolicy?.epistemologicalTag).toBe(
        'HDO',
      );
      expect(
        result.contrastReport.weightingPolicy?.evidenceConnectedComponentCount,
      ).toBe(2);
      expect(
        result.contrastReport.weightingPolicy?.componentAllocations,
      ).toHaveLength(2);

      const comp0 =
        result.contrastReport.weightingPolicy!.componentAllocations[0]!;
      const comp1 =
        result.contrastReport.weightingPolicy!.componentAllocations[1]!;
      expect(comp0.isSingletonUnlinked).toBe(false);
      expect(comp0.memberMethodIds).toEqual([
        'beta-binomial-conjugate',
        'weighted-kish-effective-binomial',
        'dirichlet-multinomial-symmetry',
      ]);
      expect(comp0.componentWeight).toBeCloseTo(0.5, 15);
      expect(comp1.isSingletonUnlinked).toBe(true);
      expect(comp1.memberMethodIds).toEqual(['poisson-gamma-hazard']);
      expect(comp1.componentWeight).toBeCloseTo(0.5, 15);

      const weights = result.contrastReport.weightsByMethod;
      expect(weights['beta-binomial-conjugate']).toBeCloseTo(1 / 6, 15);
      expect(weights['weighted-kish-effective-binomial']).toBeCloseTo(
        1 / 6,
        15,
      );
      expect(weights['dirichlet-multinomial-symmetry']).toBeCloseTo(1 / 6, 15);
      expect(weights['poisson-gamma-hazard']).toBeCloseTo(0.5, 15);

      // 3. Independent mathematical reference check for the linear pool (Test 1):
      // Beta-Binomial: alphaPost = 16, betaPost = 29 => p_1 = 16 / 45
      // Weighted-Kish: nEff = 100^2 / 400 = 25, effSucc = 8.75, effFail = 16.25 => alphaPost = 9.75, betaPost = 17.25 => p_2 = 9.75 / 27
      // Poisson-Gamma: postShape = 7, postRate = 50, H = 15 => p_3 = 1 - (50 / 65)^7
      // Dirichlet-Multinomial: alphaPost = [16, 29] => p_4 = 16 / 45
      const p1 = 16 / 45;
      const p2 = 9.75 / 27;
      const p3 = 1 - Math.pow(50 / 65, 7);
      const p4 = 16 / 45;
      const expectedPooledP0 =
        (1 / 6) * p1 + (1 / 6) * p2 + 0.5 * p3 + (1 / 6) * p4;
      const expectedPooledP1 = 1 - expectedPooledP0;

      expect(result.outcomes[0]!.probability).toBeCloseTo(
        expectedPooledP0,
        14,
      );
      expect(result.outcomes[1]!.probability).toBeCloseTo(
        expectedPooledP1,
        14,
      );
      expect(result.outcomes[0]!.logProbability).toBeCloseTo(
        Math.log(expectedPooledP0),
        14,
      );
      expect(result.outcomes[0]!.logComplementProbability).toBeCloseTo(
        Math.log(expectedPooledP1),
        14,
      );

      // 4. Unknown dependence is NEVER treated as verified independence (Requirement 7 & Test 8):
      expect(result.contrastReport.statisticalIndependenceVerified).toBe(false);
      expect(result.contrastReport.effectiveIndependentMethodCount).toBe(1);
      expect(result.contrastReport.independenceSemantics).toEqual({
        executedMethodCount: 5,
        ensembleContributingMethodCount: 4,
        referenceOnlyMethodCount: 1,
        declaredEvidenceComponentCount: 2,
        statisticalIndependenceVerified: false,
        effectiveIndependentMethodCount: 1,
        explanation: expect.stringContaining(
          'effectiveIndependentMethodCount is conservatively fixed at 1',
        ),
      });

      // 5. Binary Beta-Binomial / Dirichlet-Multinomial equivalence diagnostics preserved (Test 9):
      expect(
        result.contrastReport.dependenceDiagnostics
          ?.binaryBetaDirichletEquivalence,
      ).toBeDefined();
      expect(
        result.contrastReport.dependenceDiagnostics
          ?.binaryBetaDirichletEquivalence?.observationsMatchExactly,
      ).toBe(true);
      expect(
        result.methodologicalLimitations.some((m) =>
          m.includes(
            'Binary Beta-Binomial / Dirichlet-Multinomial dependence diagnostic',
          ),
        ),
      ).toBe(true);

      // 6. Multi-method parametric intervals are explicitly omitted, never averaged (Requirement 6 & Test 16):
      for (const decomp of result.contrastReport.categoryDecompositions) {
        expect(decomp.parametricInterval.kind).toBe('omitted');
        if (decomp.parametricInterval.kind === 'omitted') {
          expect(decomp.parametricInterval.reason).toBe(
            'multi-method-mixture-interval-not-available',
          );
        }
      }

      // 7. Discarded methods (diffusion & barrier) preserved:
      expect(
        result.contrastReport.discardedMethods.map((d) => d.methodId),
      ).toEqual([
        'student-t-terminal-diffusion',
        'first-passage-barrier-diffusion',
      ]);

      assertDeeplyFrozen(result);
    });

    it('synthesizes a multi-category (K = 3) distribution and preserves single-method credible intervals when M = 1', () => {
      const plan = planMethodApplicability({
        questionId: 'SYNTH-ECON-TERNARY-001',
        questionCategory: 'economy',
        subdomain: 'multi-outcome-categorical-events',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        horizon: {
          startsAt: TERNARY_OUTCOME_SPACE.horizonStartsAt,
          endsAt: TERNARY_OUTCOME_SPACE.horizonEndsAt,
          hasPositiveExposureScaling: true,
        },
        availableEvidence: {
          availableChannels: ['multinomial-category-counts'],
          hasVerifiableEmpiricalData: true,
          multinomialOutcomeCounts: [12, 18, 30],
        },
        assumptions: {
          verifiedAssumptions: [
            'exchangeable-multinomial-trials',
            'exhaustive-mutually-exclusive-categories',
          ],
          allowStructuralBaseline: false,
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
        },
      });

      const dirichletOut = executeDirichletMultinomialSymmetry({
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        prior: { alpha: [2, 2, 2] },
        observed: { counts: [12, 18, 30] },
      });

      const result = synthesizeForecastDistribution({
        plan,
        methodOutputs: [dirichletOut],
        footingTier: 'methodologically-sound-moderate-evidence',
      });

      // Posterior alpha = [14, 20, 32], total = 66
      expect(result.outcomes).toHaveLength(3);
      expect(result.outcomes[0]!.probability).toBeCloseTo(14 / 66, 15);
      expect(result.outcomes[1]!.probability).toBeCloseTo(20 / 66, 15);
      expect(result.outcomes[2]!.probability).toBeCloseTo(32 / 66, 15);

      // Single-method forecast (M = 1) preserves the method's original valid parametric intervals!
      for (let k = 0; k < 3; k++) {
        const decomp = result.contrastReport.categoryDecompositions[k]!;
        expect(decomp.betweenMethodDisagreementVariance).toBe(0);
        expect(decomp.parametricInterval).toEqual(
          dirichletOut.parametricIntervals[k],
        );
        expect(decomp.parametricInterval.kind).toBe('available');
      }
      expect(
        result.contrastReport.entropyDecomposition?.jensenShannonDivergenceNats,
      ).toBe(0);
      expect(
        result.contrastReport.entropyDecomposition?.normalizedDisagreementIndex,
      ).toBe(0);
    });
  });

  describe('3, 4, 5 & 6. Completeness, duplicate rejection, inapplicable/unknown rejection, and outcome-space validation', () => {
    it('rejects missing applicable executable method outputs (never silently omits an eligible method)', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
      );
      const allFour = executeAllFourBinaryEvidenceMethods();

      // Omit poisson-gamma-hazard (only pass 3 of the 4 applicable executable methods):
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [allFour[0]!, allFour[1]!, allFour[3]!],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/Missing ScientificMethodOutput for applicable executable method 'poisson-gamma-hazard'/);

      // Also rejects when structural-uniform-baseline is applicable in the plan but omitted from methodOutputs:
      const planWithBaseline = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(true),
      );
      expect(() =>
        synthesizeForecastDistribution({
          plan: planWithBaseline,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/Missing ScientificMethodOutput for applicable executable method 'structural-uniform-baseline'/);
    });

    it('rejects duplicate method identifiers, inapplicable methods, deferred methods, unknown methods, and fabricated outputs for unimplemented methods', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
      );
      const allFour = executeAllFourBinaryEvidenceMethods();

      // 1. Duplicate methodId
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [...allFour, allFour[0]!],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/Duplicate ScientificMethodOutput for methodId 'beta-binomial-conjugate'/);

      // 2. Inapplicable method output (structural-uniform-baseline when allowStructuralBaseline: false)
      const baselineOut = executeStructuralUniformBaseline({
        methodId: 'structural-uniform-baseline',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale: 'Symmetric binary partition.',
        },
      });
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [...allFour, baselineOut],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/is not applicable according to the plan/);

      // 3. Unknown methodId not in plan.evaluatedMethods
      const unknownOut: ScientificMethodOutput = {
        ...allFour[0]!,
        methodId: 'custom:unknown-method',
      };
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [...allFour, unknownOut],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/is not present in plan\.evaluatedMethods/);

      // 4. Deferred method output rejected
      const deferredPlan = planMethodApplicability({
        ...createAllBinaryApplicablePlanningInput(false),
        assumptions: {
          verifiedAssumptions: [
            'exchangeable-bernoulli-trials',
            'stationary-success-probability',
            'non-negative-importance-weights',
            'kish-effective-sample-adequacy',
            'conditionally-independent-poisson-increments',
            // omit 'homogeneous-or-known-exposure-intensity' with requireExplicitAssumptionVerification: true
            // so poisson-gamma-hazard is deferred
            'exchangeable-multinomial-trials',
            'exhaustive-mutually-exclusive-categories',
          ],
          allowStructuralBaseline: false,
          requireExplicitAssumptionVerification: true,
        },
      });
      expect(deferredPlan.deferredMethodIds).toEqual(['poisson-gamma-hazard']);
      expect(() =>
        synthesizeForecastDistribution({
          plan: deferredPlan,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/Supplied methodOutput 'poisson-gamma-hazard' is not applicable according to the plan \(disposition: 'deferred'/);

      // And succeeds when only the 3 applicable methods are passed on deferredPlan, preserving deferredMethods:
      const validDeferredSynthesis = synthesizeForecastDistribution({
        plan: deferredPlan,
        methodOutputs: [allFour[0]!, allFour[1]!, allFour[3]!],
        footingTier: 'methodologically-sound-moderate-evidence',
      });
      expect(
        validDeferredSynthesis.contrastReport.deferredMethods?.map(
          (d) => d.methodId,
        ),
      ).toEqual(['poisson-gamma-hazard']);
    });

    it('rejects outcome-space mismatches across kind, reordered labels, horizons, eventDefinitionHash, and thresholds', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
      );
      const allFour = executeAllFourBinaryEvidenceMethods();

      // Reordered labels: ['did_not_occur', 'occurred'] instead of ['occurred', 'did_not_occur']
      const reorderedSpace: OutcomeSpaceDescriptor = {
        ...BINARY_OUTCOME_SPACE,
        outcomeLabels: ['did_not_occur', 'occurred'],
      };
      const reorderedBeta = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: reorderedSpace,
        successOutcomeIndex: 1,
        prior: { alpha: 2, beta: 3 },
        observed: { successes: 14, failures: 26 },
      });
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [reorderedBeta, allFour[1]!, allFour[2]!, allFour[3]!],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/outcomeSpace\.outcomeLabels\[0\] mismatch/);

      // Mismatched horizonEndsAt
      const differentHorizonBeta = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: {
          ...BINARY_OUTCOME_SPACE,
          horizonEndsAt: '2027-06-30T23:59:59.000Z',
        },
        successOutcomeIndex: 0,
        prior: { alpha: 2, beta: 3 },
        observed: { successes: 14, failures: 26 },
      });
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [
            differentHorizonBeta,
            allFour[1]!,
            allFour[2]!,
            allFour[3]!,
          ],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/outcomeSpace\.horizonEndsAt mismatch/);

      // Mismatched eventDefinitionHash
      const differentHashBeta = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: {
          ...BINARY_OUTCOME_SPACE,
          eventDefinitionHash: 'sha256:different-event-hash-999',
        },
        successOutcomeIndex: 0,
        prior: { alpha: 2, beta: 3 },
        observed: { successes: 14, failures: 26 },
      });
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: [
            differentHashBeta,
            allFour[1]!,
            allFour[2]!,
            allFour[3]!,
          ],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/outcomeSpace\.eventDefinitionHash mismatch/);
    });
  });

  describe('11 & 12. Structural-only fallback and genuine abstention without fabricated probabilities', () => {
    it('produces a standalone structural forecast with footingTier structural-symmetry-baseline-only and effectiveIndependentMethodCount = 0 when no evidence-driven method is applicable', () => {
      const structuralOnlyPlan = planMethodApplicability({
        questionId: 'SYNTH-COLD-START-001',
        questionCategory: 'society',
        subdomain: 'cold-start-ignorance-prior-benchmark',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        horizon: {
          startsAt: TERNARY_OUTCOME_SPACE.horizonStartsAt,
          endsAt: TERNARY_OUTCOME_SPACE.horizonEndsAt,
          hasPositiveExposureScaling: true,
        },
        availableEvidence: {
          availableChannels: ['outcome-partition-symmetry'],
          hasVerifiableEmpiricalData: false,
        },
        assumptions: {
          verifiedAssumptions: [
            'exhaustive-mutually-exclusive-categories',
            'principle-of-indifference-partition-symmetry',
          ],
          allowStructuralBaseline: true,
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
        },
      });

      const baselineOut = executeStructuralUniformBaseline({
        methodId: 'structural-uniform-baseline',
        outcomeSpace: TERNARY_OUTCOME_SPACE,
        symmetryPremise: {
          partitionSymmetryVerified: true,
          exhaustiveMutuallyExclusiveVerified: true,
          symmetryRationale: 'Symmetric 3-way partition with zero empirical observations.',
        },
      });

      const result = synthesizeForecastDistribution({
        plan: structuralOnlyPlan,
        methodOutputs: [baselineOut],
      });

      expect(result.footingTier).toBe('structural-symmetry-baseline-only');
      expect(result.contrastReport.executedMethodIds).toEqual([
        'structural-uniform-baseline',
      ]);
      expect(result.contrastReport.ensembleContributingMethodIds).toEqual([
        'structural-uniform-baseline',
      ]);
      expect(result.contrastReport.referenceOnlyMethodIds).toEqual([]);
      expect(result.contrastReport.weightsByMethod).toEqual({
        'structural-uniform-baseline': 1,
      });
      expect(result.contrastReport.effectiveIndependentMethodCount).toBe(0);
      expect(
        result.contrastReport.independenceSemantics
          ?.effectiveIndependentMethodCount,
      ).toBe(0);

      for (let k = 0; k < 3; k++) {
        expect(result.outcomes[k]!.probability).toBeCloseTo(1 / 3, 15);
        const decomp = result.contrastReport.categoryDecompositions[k]!;
        expect(decomp.withinMethodParametricVariance).toBe(0);
        expect(decomp.betweenMethodDisagreementVariance).toBe(0);
        expect(decomp.totalEpistemicParametricVariance).toBe(0);
        expect(decomp.parametricInterval.kind).toBe('omitted');
        if (decomp.parametricInterval.kind === 'omitted') {
          expect(decomp.parametricInterval.reason).toBe(
            'point-mass-structural-baseline',
          );
        }
      }

      // Rejects any attempt to label a structural-only forecast as evidence-driven:
      expect(() =>
        synthesizeForecastDistribution({
          plan: structuralOnlyPlan,
          methodOutputs: [baselineOut],
          footingTier: 'defensible-low-confidence-exploratory',
        }),
      ).toThrow(/Cannot claim footingTier 'defensible-low-confidence-exploratory' when only structural-uniform-baseline is executable/);

      assertDeeplyFrozen(result);
    });

    it('abstains honestly without fabricating probabilities when no executable method is applicable (including when unimplemented diffusion/barrier methods are applicable)', () => {
      const barrierSpace: OutcomeSpaceDescriptor = {
        kind: 'first-passage-before-horizon',
        outcomeLabels: ['barrier_breached', 'barrier_not_breached'],
        horizonStartsAt: '2026-01-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-31T23:59:59.000Z',
        eventDefinitionHash: 'sha256:barrier-crossing-001',
        barrierLevel: 120,
        barrierDirection: 'up-and-in',
      };

      const barrierPlan = planMethodApplicability({
        questionId: 'SYNTH-BARRIER-001',
        questionCategory: 'economy',
        subdomain: 'threshold-breach-before-deadline',
        outcomeSpace: barrierSpace,
        horizon: {
          startsAt: barrierSpace.horizonStartsAt,
          endsAt: barrierSpace.horizonEndsAt,
          hasPositiveExposureScaling: true,
        },
        availableEvidence: {
          availableChannels: [
            'continuous-state-trajectory',
            'drift-and-scale-estimates',
            'absorbing-barrier-specification',
          ],
          hasVerifiableEmpiricalData: true,
          continuousTrajectoryObservations: 50,
          estimatedDrift: 0.02,
          estimatedScaleOrVolatility: 0.15,
          initialStateLevel: 100,
        },
        assumptions: {
          verifiedAssumptions: [
            'continuous-sample-path-no-jump-overshoot',
            'constant-drift-and-volatility-to-horizon',
            'reflection-principle-absorbing-barrier',
          ],
          allowStructuralBaseline: false,
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
        },
      });

      // first-passage-barrier-diffusion is applicable in the plan, but unimplemented in Stage 2A-2.2/2A-2.3:
      expect(barrierPlan.applicableMethods.map((m) => m.methodId)).toEqual([
        'first-passage-barrier-diffusion',
      ]);

      const abstained = synthesizeForecastDistribution({
        plan: barrierPlan,
        methodOutputs: [],
      });

      expect(abstained.footingTier).toBe('insufficient-basis-abstain');
      expect(abstained.abstentionReason).toBe(
        'no-defensible-theoretical-or-empirical-basis',
      );
      expect(abstained.outcomes).toEqual([]);
      expect(abstained.contrastReport.executedMethodIds).toEqual([]);
      expect(abstained.contrastReport.ensembleContributingMethodIds).toEqual([]);
      expect(abstained.contrastReport.referenceOnlyMethodIds).toEqual([]);
      expect(abstained.contrastReport.weightsByMethod).toEqual({});
      expect(abstained.contrastReport.effectiveIndependentMethodCount).toBe(0);
      expect(abstained.contrastReport.categoryDecompositions).toEqual([]);
      expect(abstained.contrastReport.entropyDecomposition).toBeNull();
      expect(abstained.contrastReport.unexecutedApplicableMethods).toEqual([
        {
          methodId: 'first-passage-barrier-diffusion',
          disposition: 'applicable',
          implementationStatus: 'registered-specification-only',
          reason: expect.stringContaining('registered-specification-only'),
        },
      ]);

      // Rejects fabricating an output for the unimplemented method:
      const pHalf = createDualChannelProbabilityFromLog(-Math.LN2);
      expect(() =>
        synthesizeForecastDistribution({
          plan: barrierPlan,
          methodOutputs: [
            {
              methodId: 'first-passage-barrier-diffusion',
              methodFamily: 'first-passage-boundary',
              outcomeSpace: barrierSpace,
              outcomes: [pHalf, pHalf],
              parametricVariances: [0.01, 0.01],
              parametricIntervals: [
                {
                  kind: 'omitted',
                  reason: 'method-produces-point-estimate-only',
                  explanation: 'test',
                },
                {
                  kind: 'omitted',
                  reason: 'method-produces-point-estimate-only',
                  explanation: 'test',
                },
              ],
              effectiveSampleSize: 50,
              epistemologicalClaims: [
                {
                  kind: 'exact-under-explicit-model',
                  tag: 'EBM',
                  statement: 'Fake output',
                },
              ],
              warnings: [],
            },
          ],
          footingTier: 'methodologically-sound-moderate-evidence',
        }),
      ).toThrow(/is marked unimplemented in the plan/);

      assertDeeplyFrozen(abstained);
    });
  });

  describe('13, 14 & 15. Extreme probability tails, orthogonal variance closure, and entropy/JSD closure', () => {
    it('preserves dual-channel accuracy in extreme probability tails and satisfies exact variance and entropy closure identities', () => {
      // Plan where only poisson-gamma-hazard and beta-binomial-conjugate are applicable:
      const twoMethodPlan = planMethodApplicability({
        questionId: 'SYNTH-TAIL-001',
        questionCategory: 'science',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        horizon: {
          startsAt: BINARY_OUTCOME_SPACE.horizonStartsAt,
          endsAt: BINARY_OUTCOME_SPACE.horizonEndsAt,
          hasPositiveExposureScaling: true,
        },
        availableEvidence: {
          availableChannels: [
            'binary-trial-counts',
            'poisson-event-counts',
            'continuous-exposure-duration',
          ],
          hasVerifiableEmpiricalData: true,
          binaryTrialSuccesses: 0,
          binaryTrialFailures: 5000,
          poissonEventCount: 0,
          poissonExposureDuration: 1_000_000,
        },
        assumptions: {
          verifiedAssumptions: [
            'exchangeable-bernoulli-trials',
            'stationary-success-probability',
            'conditionally-independent-poisson-increments',
            'homogeneous-or-known-exposure-intensity',
          ],
          allowStructuralBaseline: false,
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
        },
      });

      const betaRare = executeBetaBinomialConjugate({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        successOutcomeIndex: 0,
        prior: { alpha: 1, beta: 100 },
        observed: { successes: 0, failures: 900 },
      });
      const poissonRare = executePoissonGammaHazard({
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
        exposureUnit: 'hours',
      });

      const result = synthesizeForecastDistribution({
        plan: twoMethodPlan,
        methodOutputs: [betaRare, poissonRare],
        footingTier: 'defensible-low-confidence-exploratory',
      });

      // Weights are 0.5 and 0.5 (two singleton components)
      expect(result.contrastReport.weightsByMethod).toEqual({
        'beta-binomial-conjugate': 0.5,
        'poisson-gamma-hazard': 0.5,
      });

      // Independent verification of variance decomposition closure:
      for (let k = 0; k < 2; k++) {
        const d = result.contrastReport.categoryDecompositions[k]!;
        const pBar = result.outcomes[k]!.probability;
        const qBar = result.outcomes[k]!.complementProbability;
        const expectedTotalBernoulli = pBar * qBar;

        const p1 = betaRare.outcomes[k]!.probability;
        const q1 = betaRare.outcomes[k]!.complementProbability;
        const v1 = betaRare.parametricVariances[k]!;
        const p2 = poissonRare.outcomes[k]!.probability;
        const q2 = poissonRare.outcomes[k]!.complementProbability;
        const v2 = poissonRare.parametricVariances[k]!;

        const expectedAleatoric = 0.5 * (p1 * q1 - v1) + 0.5 * (p2 * q2 - v2);
        const expectedWithin = 0.5 * v1 + 0.5 * v2;
        const expectedBetween =
          0.5 * (p1 - pBar) * (p1 - pBar) + 0.5 * (p2 - pBar) * (p2 - pBar);

        expect(d.totalBernoulliVariance).toBeCloseTo(expectedTotalBernoulli, 14);
        expect(d.aleatoricVariance).toBeCloseTo(expectedAleatoric, 14);
        expect(d.withinMethodParametricVariance).toBeCloseTo(expectedWithin, 14);
        expect(d.betweenMethodDisagreementVariance).toBeCloseTo(
          expectedBetween,
          14,
        );
        expect(d.totalEpistemicParametricVariance).toBeCloseTo(
          expectedWithin + expectedBetween,
          14,
        );
        expect(d.closureResidual).toBeLessThanOrEqual(1e-12);
      }

      // Independent verification of entropy & JSD closure:
      const ent = result.contrastReport.entropyDecomposition!;
      expect(ent).not.toBeNull();
      expect(ent.closureResidualNats).toBeLessThanOrEqual(1e-12);
      expect(ent.totalPredictiveEntropyNats).toBeCloseTo(
        ent.withinMethodExpectedEntropyNats + ent.jensenShannonDivergenceNats,
        14,
      );
      expect(ent.normalizedDisagreementIndex).toBeCloseTo(
        ent.jensenShannonDivergenceNats / Math.LN2,
        14,
      );

      // Extreme subnormal / saturated-to-one probability tail synthesis test:
      const subP1 = createDualChannelProbabilityFromLog(-720);
      const subQ1 = createDualChannelProbabilityFromPair(
        subP1.logComplementProbability,
        subP1.logProbability,
      );
      const subP2 = createDualChannelProbabilityFromLog(-730);
      const subQ2 = createDualChannelProbabilityFromPair(
        subP2.logComplementProbability,
        subP2.logProbability,
      );
      const customSubOut1: ScientificMethodOutput = {
        ...betaRare,
        outcomes: [subP1, subQ1],
        parametricVariances: [0, 0],
        parametricIntervals: [
          {
            kind: 'omitted',
            reason: 'unidentifiable-concentration-parameter',
            explanation: 'subnormal tail test',
          },
          {
            kind: 'omitted',
            reason: 'unidentifiable-concentration-parameter',
            explanation: 'subnormal tail test',
          },
        ],
      };
      const customSubOut2: ScientificMethodOutput = {
        ...poissonRare,
        outcomes: [subP2, subQ2],
        parametricVariances: [0, 0],
        parametricIntervals: [
          {
            kind: 'omitted',
            reason: 'unidentifiable-concentration-parameter',
            explanation: 'subnormal tail test',
          },
          {
            kind: 'omitted',
            reason: 'unidentifiable-concentration-parameter',
            explanation: 'subnormal tail test',
          },
        ],
      };

      const extremeResult = synthesizeForecastDistribution({
        plan: twoMethodPlan,
        methodOutputs: [customSubOut1, customSubOut2],
        footingTier: 'defensible-low-confidence-exploratory',
      });
      expect(extremeResult.outcomes[0]!.status).toBe('subnormal-probability');
      expect(extremeResult.outcomes[1]!.status).toBe('saturated-to-one');
      expect(extremeResult.outcomes[1]!.logComplementProbability).toBeCloseTo(
        extremeResult.outcomes[0]!.logProbability,
        14,
      );
    });
  });

  describe('17, 18 & 19. Calibration honesty, custom weight validation, immutability, and determinism', () => {
    it('enforces calibration honesty, requires explicit footingTier for evidence-driven synthesis, and keeps high-disagreement/low-confidence forecasts non-abstaining', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
      );
      const allFour = executeAllFourBinaryEvidenceMethods();

      // 1. Missing footingTier for evidence-driven forecast is rejected:
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
        }),
      ).toThrow(/ForecastSynthesisInput\.footingTier is required when evidence-driven methods participate/);

      // 2. Claiming empirically-calibrated-high-evidence without empirically-verified-out-of-sample is rejected:
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'empirically-calibrated-high-evidence',
          calibrationStatus: 'unverified-no-out-of-sample-evaluation',
        }),
      ).toThrow(/Calibration honesty violation/);

      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'empirically-calibrated-high-evidence',
          calibrationStatus: 'out-of-sample-evaluatable-not-calibrated',
        }),
      ).toThrow(/Calibration honesty violation/);

      // 3. Succeeds when calibrationStatus === 'empirically-verified-out-of-sample':
      const verifiedCalibrated = synthesizeForecastDistribution({
        plan,
        methodOutputs: allFour,
        footingTier: 'empirically-calibrated-high-evidence',
        calibrationStatus: 'empirically-verified-out-of-sample',
      });
      expect(verifiedCalibrated.footingTier).toBe(
        'empirically-calibrated-high-evidence',
      );
      expect(verifiedCalibrated.calibrationStatus).toBe(
        'empirically-verified-out-of-sample',
      );

      // 4. Low-confidence / high-disagreement forecast remains a valid non-abstaining forecast:
      const lowConfidence = synthesizeForecastDistribution({
        plan,
        methodOutputs: allFour,
        footingTier: 'defensible-low-confidence-exploratory',
      });
      expect(lowConfidence.footingTier).toBe(
        'defensible-low-confidence-exploratory',
      );
      expect(lowConfidence.calibrationStatus).toBe(
        'unverified-no-out-of-sample-evaluation',
      );
      expect(lowConfidence.outcomes).toHaveLength(2);
      expect(lowConfidence.abstentionReason).toBeUndefined();
    });

    it('validates customWeightsByMethod, rejects malformed inputs, enforces deep immutability, and produces identical deterministic outputs across repeated calls', () => {
      const plan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
      );
      const allFour = executeAllFourBinaryEvidenceMethods();

      // Rejects negative, zero, or unnormalized custom weights:
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
          customWeightsByMethod: {
            'beta-binomial-conjugate': 0.5,
            'weighted-kish-effective-binomial': 0.5,
            'poisson-gamma-hazard': 0.5,
            'dirichlet-multinomial-symmetry': 0.5,
          },
        }),
      ).toThrow(/customWeightsByMethod must sum to 1/);

      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
          customWeightsByMethod: {
            'beta-binomial-conjugate': 0,
            'weighted-kish-effective-binomial': 0.3,
            'poisson-gamma-hazard': 0.4,
            'dirichlet-multinomial-symmetry': 0.3,
          },
        }),
      ).toThrow(/must be a finite positive number in \(0, 1\]/);

      // Rejects unverified statistical independence count > 1:
      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
          verifiedIndependentMethodCount: 2,
        }),
      ).toThrow(/verifiedIndependentMethodCount cannot be supplied unless statisticalIndependenceVerified === true/);

      expect(() =>
        synthesizeForecastDistribution({
          plan,
          methodOutputs: allFour,
          footingTier: 'methodologically-sound-moderate-evidence',
          statisticalIndependenceVerified: true,
          verifiedIndependentMethodCount: 3, // > 2 active components!
        }),
      ).toThrow(/verifiedIndependentMethodCount \(3\) must lie in \[1, 2\]/);

      // Rejects null / non-object input:
      expect(() => synthesizeForecastDistribution(null)).toThrow(RangeError);

      // Determinism across repeated runs:
      const run1 = synthesizeForecastDistribution({
        plan,
        methodOutputs: allFour,
        footingTier: 'methodologically-sound-moderate-evidence',
      });
      const run2 = synthesizeForecastDistribution({
        plan,
        methodOutputs: [...allFour],
        footingTier: 'methodologically-sound-moderate-evidence',
      });
      expect(run1).toEqual(run2);
      assertDeeplyFrozen(run1);

      // Also verify custom registry with an applicable unimplemented method alongside applicable executable methods:
      const basePoisson = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
        'poisson-gamma-hazard',
      );
      const customUnimplemented = validateScientificMethodDescriptor({
        ...basePoisson,
        methodId: 'custom:inhomogeneous-hawkes-hazard',
        methodFamily: 'custom-scientific-method',
        hasExecutableImplementation: false,
        implementationStatus: 'registered-specification-only',
        dependenceProfile: {
          ...basePoisson.dependenceProfile,
          correlatedWithMethodIds: [],
        },
      });
      const customRegistry = createScientificMethodRegistry([
        ...DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll(),
        customUnimplemented,
      ]);
      const customPlan: MethodApplicabilityPlan = planMethodApplicability(
        createAllBinaryApplicablePlanningInput(false),
        customRegistry,
      );
      const customSynthesis = synthesizeForecastDistribution({
        plan: customPlan,
        methodOutputs: allFour,
        footingTier: 'methodologically-sound-moderate-evidence',
      });
      expect(
        customSynthesis.contrastReport.unexecutedApplicableMethods,
      ).toEqual([
        {
          methodId: 'custom:inhomogeneous-hawkes-hazard',
          disposition: 'applicable',
          implementationStatus: 'registered-specification-only',
          reason: expect.stringContaining('custom:inhomogeneous-hawkes-hazard'),
        },
      ]);
    });
  });
});
