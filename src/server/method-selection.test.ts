import { describe, expect, it, vi } from 'vitest';
import {
  CORE_SCIENTIFIC_METHOD_IDS,
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  SCIENTIFIC_METHOD_REGISTRY_VERSION,
  createScientificMethodRegistry,
  validateScientificMethodDescriptor,
  type MethodAssumptionId,
} from './method-registry.ts';
import {
  METHOD_APPLICABILITY_PLANNER_VERSION,
  METHOD_GATE_IDS,
  planMethodApplicability,
  validateMethodApplicabilityPlanningInput,
  type MethodApplicabilityPlanningInput,
} from './method-selection.ts';

/**
 * Synthetic test fixtures representing distinct forecasting domains and
 * outcome-space structures. All numerical values below are synthetic test
 * fixtures for deterministic planner verification, not real empirical data.
 */
function createSyntheticBinaryGeopoliticsInput(): MethodApplicabilityPlanningInput {
  return {
    questionId: 'SYNTH-GEO-2026-001',
    questionCategory: 'geopolitics',
    subdomain: 'bilateral-treaty-ratification',
    outcomeSpace: {
      kind: 'binary',
      outcomeLabels: ['Ratified before deadline', 'Not ratified before deadline'],
      horizonStartsAt: '2026-01-01T00:00:00.000Z',
      horizonEndsAt: '2026-12-31T23:59:59.000Z',
      eventDefinitionHash: 'synth_geo_binary_001',
    },
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
  };
}

describe('Stage 2A-2.1 — Applicability Planner (src/server/method-selection.ts)', () => {
  it('evaluates every registered method on every planning request and selects multiple simultaneously applicable methods (Principle A)', () => {
    const input = createSyntheticBinaryGeopoliticsInput();
    const plan = planMethodApplicability(input);

    expect(plan.registryVersion).toBe(SCIENTIFIC_METHOD_REGISTRY_VERSION);
    expect(plan.plannerVersion).toBe(METHOD_APPLICABILITY_PLANNER_VERSION);
    expect(plan.evaluatedMethods).toHaveLength(7);
    expect(plan.evaluatedMethods.map((m) => m.methodId)).toEqual(
      CORE_SCIENTIFIC_METHOD_IDS,
    );

    // Every method evaluation contains all 6 gates in canonical order
    for (const rec of plan.evaluatedMethods) {
      expect(rec.gates.map((g) => g.gateId)).toEqual(METHOD_GATE_IDS);
      expect(rec.hasExecutableImplementation).toBe(false);
      expect(rec.implementationStatus).toBe('registered-specification-only');
    }

    // 4 evidence-driven methods are simultaneously strictly applicable:
    expect(plan.strictlyApplicableMethods.map((m) => m.methodId)).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(plan.evidenceDrivenApplicableMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);

    // Structural baseline is applicable-with-limitations and separated from evidence-driven methods (Principle C):
    expect(plan.applicableWithLimitationsMethods.map((m) => m.methodId)).toEqual([
      'structural-uniform-baseline',
    ]);
    expect(plan.structuralBaselineMethodIds).toEqual(['structural-uniform-baseline']);
    expect(
      plan.evidenceDrivenApplicableMethodIds.includes('structural-uniform-baseline'),
    ).toBe(false);

    // Diffusion and first-passage barrier methods are inapplicable on a binary space without continuous thresholds or barriers:
    expect(plan.inapplicableMethodIds).toEqual([
      'student-t-terminal-diffusion',
      'first-passage-barrier-diffusion',
    ]);
    expect(plan.deferredMethodIds).toEqual([]);
  });

  it('identifies correlated method groups when multiple methods from the same family are applicable (Principle E)', () => {
    const input = createSyntheticBinaryGeopoliticsInput();
    const plan = planMethodApplicability(input);

    expect(plan.correlatedMethodGroups).toHaveLength(1);
    const group = plan.correlatedMethodGroups[0]!;
    expect(group.correlationGroupId).toBe('bernoulli-frequency-family');
    expect(group.applicableMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
    ]);
    expect(group.sharedInformationChannels).toContain('binary-trial-counts');
    expect(group.warning).toContain('bernoulli-frequency-family');
  });

  it('evaluates discretized continuous partition scenarios (synthetic economy/climate scenario) where both Student-t terminal diffusion and Dirichlet-Multinomial are simultaneously applicable', () => {
    const syntheticEconomyInput: MethodApplicabilityPlanningInput = {
      questionId: 'SYNTH-ECON-2026-002',
      questionCategory: 'economy',
      subdomain: 'annual-inflation-rate-brackets',
      outcomeSpace: {
        kind: 'discretized-continuous-partition',
        outcomeLabels: ['Below 2.0%', '2.0% to 4.0%', 'Above 4.0%'],
        partitionThresholds: [2.0, 4.0],
        horizonStartsAt: '2026-01-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-31T23:59:59.000Z',
        eventDefinitionHash: 'synth_econ_partition_002',
      },
      horizon: {
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-12-31T23:59:59.000Z',
      },
      availableEvidence: {
        availableChannels: [
          'multinomial-category-counts',
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
          'tail-degrees-of-freedom',
        ],
        hasVerifiableEmpiricalData: true,
        multinomialOutcomeCounts: [12, 18, 6],
        continuousTrajectoryObservations: 48,
        estimatedDrift: 2.6,
        estimatedScaleOrVolatility: 0.85,
        degreesOfFreedom: 6.5,
      },
      assumptions: {
        verifiedAssumptions: [
          'exchangeable-multinomial-trials',
          'exhaustive-mutually-exclusive-categories',
          'stationary-heavy-tailed-increments',
          'student-t-terminal-innovation-law',
          'constant-drift-and-volatility-to-horizon',
        ],
      },
      computationalCapabilities: {
        maxAllowedCostTier: 'high',
        allowIterativeSpecialFunctions: true,
      },
    };

    const plan = planMethodApplicability(syntheticEconomyInput);
    expect(plan.evaluatedMethods).toHaveLength(7);
    expect(plan.strictlyApplicableMethods.map((m) => m.methodId)).toEqual([
      'dirichlet-multinomial-symmetry',
      'student-t-terminal-diffusion',
    ]);
    expect(plan.structuralBaselineMethodIds).toEqual([]);

    // Structural uniform baseline is rejected on discretized-continuous-partition
    const baselineEval = plan.evaluatedMethods.find(
      (m) => m.methodId === 'structural-uniform-baseline',
    )!;
    expect(baselineEval.disposition).toBe('inapplicable');
    expect(baselineEval.failedGateIds).toContain('outcome-space-compatibility');
    expect(baselineEval.reasonCodes).toContain('OUTCOME_SPACE_KIND_INCOMPATIBLE');
  });

  it('evaluates first-passage absorbing barrier scenarios (synthetic climate/space threshold breach) and rejects terminal-only or initial-state-crossed configurations', () => {
    const syntheticBarrierInput: MethodApplicabilityPlanningInput = {
      questionId: 'SYNTH-CLIM-2026-003',
      questionCategory: 'climate',
      subdomain: 'anomaly-barrier-exceedance',
      outcomeSpace: {
        kind: 'first-passage-before-horizon',
        outcomeLabels: ['Crosses +1.7C barrier before end of 2026', 'Remains below +1.7C'],
        barrierLevel: 1.7,
        barrierDirection: 'up-and-in',
        horizonStartsAt: '2026-01-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-31T23:59:59.000Z',
        eventDefinitionHash: 'synth_clim_barrier_003',
      },
      horizon: {
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-12-31T23:59:59.000Z',
      },
      availableEvidence: {
        availableChannels: [
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
          'absorbing-barrier-specification',
        ],
        hasVerifiableEmpiricalData: true,
        continuousTrajectoryObservations: 60,
        estimatedDrift: 0.03,
        estimatedScaleOrVolatility: 0.12,
        initialStateLevel: 1.42,
      },
      assumptions: {
        verifiedAssumptions: [
          'continuous-sample-path-no-jump-overshoot',
          'constant-drift-and-volatility-to-horizon',
          'reflection-principle-absorbing-barrier',
        ],
      },
      computationalCapabilities: {
        maxAllowedCostTier: 'high',
        allowIterativeSpecialFunctions: true,
      },
    };

    const plan = planMethodApplicability(syntheticBarrierInput);
    expect(plan.strictlyApplicableMethods.map((m) => m.methodId)).toEqual([
      'first-passage-barrier-diffusion',
    ]);
    expect(plan.inapplicableMethodIds).toHaveLength(6);

    // If initialStateLevel is already at or above the up-and-in barrier (1.75 >= 1.7),
    // first-passage-barrier-diffusion fails required-data-availability with INITIAL_STATE_ALREADY_AT_OR_BEYOND_BARRIER:
    const planCrossed = planMethodApplicability({
      ...syntheticBarrierInput,
      availableEvidence: {
        ...syntheticBarrierInput.availableEvidence,
        initialStateLevel: 1.75,
      },
    });
    const fpEval = planCrossed.evaluatedMethods.find(
      (m) => m.methodId === 'first-passage-barrier-diffusion',
    )!;
    expect(fpEval.disposition).toBe('inapplicable');
    expect(fpEval.reasonCodes).toContain(
      'INITIAL_STATE_ALREADY_AT_OR_BEYOND_BARRIER',
    );
  });

  it('distinguishes applicable, applicable-with-limitations, deferred, and inapplicable states (Principle D)', () => {
    const baseInput = createSyntheticBinaryGeopoliticsInput();

    // Cold-start scenario: only outcome-partition-symmetry channel is available, no empirical data yet
    const coldStartInput: MethodApplicabilityPlanningInput = {
      ...baseInput,
      availableEvidence: {
        availableChannels: ['outcome-partition-symmetry'],
        hasVerifiableEmpiricalData: false,
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
      },
    };

    const coldPlan = planMethodApplicability(coldStartInput);
    // 1. Structural baseline is applicable-with-limitations
    expect(coldPlan.applicableWithLimitationsMethods.map((m) => m.methodId)).toEqual([
      'structural-uniform-baseline',
    ]);
    // 2. The 4 binary-compatible evidence-driven methods are deferred due to missing empirical data
    expect(coldPlan.deferredMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);
    for (const defId of coldPlan.deferredMethodIds) {
      expect(coldPlan.missingDataByMethod[defId]!.length).toBeGreaterThan(0);
    }
    // 3. The 2 continuous diffusion/barrier methods are inapplicable due to outcome space incompatibility
    expect(coldPlan.inapplicableMethodIds).toEqual([
      'student-t-terminal-diffusion',
      'first-passage-barrier-diffusion',
    ]);

    // Small-sample & unverified-assumption scenario:
    const smallSampleInput: MethodApplicabilityPlanningInput = {
      ...baseInput,
      availableEvidence: {
        availableChannels: ['binary-trial-counts', 'outcome-partition-symmetry'],
        hasVerifiableEmpiricalData: true,
        binaryTrialSuccesses: 2,
        binaryTrialFailures: 3, // total = 5 < recommended 10
        lowConfidenceEvidence: true,
        missingOptionalCovariates: ['regime-type-index'],
      },
      assumptions: {
        verifiedAssumptions: [
          'exchangeable-bernoulli-trials',
          'exhaustive-mutually-exclusive-categories',
          'principle-of-indifference-partition-symmetry',
        ],
        unverifiedButPlausibleAssumptions: ['stationary-success-probability'],
      },
    };

    const smallSamplePlan = planMethodApplicability(smallSampleInput);
    const betaEval = smallSamplePlan.evaluatedMethods.find(
      (m) => m.methodId === 'beta-binomial-conjugate',
    )!;
    expect(betaEval.disposition).toBe('applicable-with-limitations');
    expect(betaEval.applicable).toBe(true);
    expect(betaEval.unverifiedAssumptions).toEqual(['stationary-success-probability']);
    expect(betaEval.activeLimitations.length).toBeGreaterThanOrEqual(2);
    expect(
      smallSamplePlan.unverifiedAssumptionsByMethod['beta-binomial-conjugate'],
    ).toEqual(['stationary-success-probability']);
  });

  it('rejects methods when mandatory scientific assumptions are violated and defers when computational capabilities are exceeded', () => {
    const baseInput = createSyntheticBinaryGeopoliticsInput();

    // Violate stationary-success-probability and conditionally-independent-poisson-increments:
    const violatedAssumptions: readonly MethodAssumptionId[] = [
      'stationary-success-probability',
      'conditionally-independent-poisson-increments',
    ];
    const planViolated = planMethodApplicability({
      ...baseInput,
      assumptions: {
        verifiedAssumptions: [
          'exchangeable-bernoulli-trials',
          'non-negative-importance-weights',
          'kish-effective-sample-adequacy',
          'homogeneous-or-known-exposure-intensity',
          'exchangeable-multinomial-trials',
          'exhaustive-mutually-exclusive-categories',
          'principle-of-indifference-partition-symmetry',
        ],
        violatedAssumptions,
      },
    });

    // beta-binomial-conjugate, weighted-kish-effective-binomial, and poisson-gamma-hazard must be inapplicable:
    for (const id of [
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
    ] as const) {
      const rec = planViolated.evaluatedMethods.find((m) => m.methodId === id)!;
      expect(rec.disposition).toBe('inapplicable');
      expect(rec.failedGateIds).toContain('scientific-assumptions');
      expect(rec.reasonCodes).toContain('MANDATORY_ASSUMPTION_VIOLATED');
      expect(rec.violatedAssumptions.length).toBeGreaterThan(0);
    }

    // dirichlet-multinomial-symmetry remains strictly applicable:
    expect(planViolated.strictlyApplicableMethods.map((m) => m.methodId)).toEqual([
      'dirichlet-multinomial-symmetry',
    ]);

    // Disable iterative special functions -> all evidence-driven methods require iterative special functions and become deferred,
    // while structural-uniform-baseline (O(1) closed-form) remains applicable-with-limitations:
    const planLowCompute = planMethodApplicability({
      ...baseInput,
      computationalCapabilities: {
        maxAllowedCostTier: 'low',
        allowIterativeSpecialFunctions: false,
      },
    });
    expect(planLowCompute.applicableMethods.map((m) => m.methodId)).toEqual([
      'structural-uniform-baseline',
    ]);
    expect(planLowCompute.deferredMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);
    for (const id of planLowCompute.deferredMethodIds) {
      const rec = planLowCompute.evaluatedMethods.find((m) => m.methodId === id)!;
      expect(rec.reasonCodes).toContain('ITERATIVE_SPECIAL_FUNCTIONS_DISABLED');
    }
  });

  it('enforces scientifically justified horizon constraints on custom descriptors without imposing arbitrary cutoffs on core methods (Principle F)', () => {
    const baseDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'poisson-gamma-hazard',
    );
    const shortWindowCustom = validateScientificMethodDescriptor({
      ...baseDesc,
      methodId: 'custom:short-horizon-hazard',
      methodFamily: 'custom-scientific-method',
      horizonConstraints: {
        constrained: true,
        minHorizonMs: 1_000,
        maxHorizonMs: 86_400_000 * 30, // 30 days max validated operating window
        requiresPositiveExposureRateScaling: true,
        scientificJustification:
          'Empirical hazard lookup table calibrated only for horizons up to 30 days.',
      },
    });
    const customRegistry = createScientificMethodRegistry([
      ...DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll(),
      shortWindowCustom,
    ]);

    // 1-year horizon (365 days > 30 days): core poisson-gamma-hazard passes, custom:short-horizon-hazard fails horizon-compatibility
    const input = createSyntheticBinaryGeopoliticsInput();
    const plan = planMethodApplicability(input, customRegistry);
    expect(plan.evaluatedMethods).toHaveLength(8);

    const corePoisson = plan.evaluatedMethods.find(
      (m) => m.methodId === 'poisson-gamma-hazard',
    )!;
    const customPoisson = plan.evaluatedMethods.find(
      (m) => m.methodId === 'custom:short-horizon-hazard',
    )!;
    expect(corePoisson.disposition).toBe('applicable');
    expect(customPoisson.disposition).toBe('inapplicable');
    expect(customPoisson.failedGateIds).toContain('horizon-compatibility');
    expect(customPoisson.reasonCodes).toContain('HORIZON_OUTSIDE_VALIDATED_DOMAIN');
  });

  it('produces identical deterministic outputs for identical inputs and prevents mutation of inputs, registry, and outputs', () => {
    const input1 = createSyntheticBinaryGeopoliticsInput();
    const inputSnapshot = JSON.stringify(input1);
    const input2 = createSyntheticBinaryGeopoliticsInput();

    const plan1 = planMethodApplicability(input1);
    const plan2 = planMethodApplicability(input2);

    expect(JSON.stringify(input1)).toBe(inputSnapshot);
    expect(plan1).toEqual(plan2);
    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));

    expect(Object.isFrozen(plan1)).toBe(true);
    expect(Object.isFrozen(plan1.evaluatedMethods)).toBe(true);
    expect(Object.isFrozen(plan1.evaluatedMethods[0])).toBe(true);
    expect(Object.isFrozen(plan1.evaluatedMethods[0]?.gates)).toBe(true);
    expect(Object.isFrozen(plan1.correlatedMethodGroups)).toBe(true);
    expect(Object.isFrozen(plan1.missingDataByMethod)).toBe(true);

    expect(() => {
      (plan1 as unknown as { plannerVersion: string }).plannerVersion = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (plan1.evaluatedMethods as unknown as unknown[]).pop();
    }).toThrow(TypeError);
  });

  it('rejects malformed inputs, invalid dates, contradictory horizons, invalid numbers, and contradictory data/assumption declarations', () => {
    const valid = createSyntheticBinaryGeopoliticsInput();
    expect(validateMethodApplicabilityPlanningInput(valid)).toEqual(valid);

    // 1. Untrimmed strings are rejected rather than silently normalized
    expect(() =>
      planMethodApplicability({
        ...valid,
        questionId: '  padded-id  ',
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        outcomeSpace: {
          ...valid.outcomeSpace,
          outcomeLabels: ['  Yes  ', 'No'],
        },
      }),
    ).toThrow(RangeError);

    // 2. Contradictory horizon vs outcomeSpace dates or inverted horizon
    expect(() =>
      planMethodApplicability({
        ...valid,
        horizon: {
          ...valid.horizon,
          endsAt: '2026-06-01T00:00:00.000Z',
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        horizon: {
          startsAt: '2026-12-31T23:59:59.000Z',
          endsAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    ).toThrow(RangeError);

    // 3. Impossible Kish effective sample size (n_eff > n) or negative counts
    expect(() =>
      planMethodApplicability({
        ...valid,
        availableEvidence: {
          ...valid.availableEvidence,
          weightedSampleSize: 20,
          kishEffectiveSampleSize: 25,
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        availableEvidence: {
          ...valid.availableEvidence,
          binaryTrialSuccesses: -1,
        },
      }),
    ).toThrow(RangeError);

    // 4. Contradictory hasVerifiableEmpiricalData vs channels
    expect(() =>
      planMethodApplicability({
        ...valid,
        availableEvidence: {
          ...valid.availableEvidence,
          hasVerifiableEmpiricalData: false,
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        availableEvidence: {
          availableChannels: ['outcome-partition-symmetry'],
          hasVerifiableEmpiricalData: true,
        },
      }),
    ).toThrow(RangeError);

    // 5. Contradictory assumption sets (simultaneously verified and violated)
    expect(() =>
      planMethodApplicability({
        ...valid,
        assumptions: {
          verifiedAssumptions: ['exchangeable-bernoulli-trials'],
          violatedAssumptions: ['exchangeable-bernoulli-trials'],
        },
      }),
    ).toThrow(RangeError);
  });

  it('executes with zero network requests', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => {
        throw new Error('Network calls are forbidden in Stage 2A-2.1');
      });
    try {
      const plan = planMethodApplicability(createSyntheticBinaryGeopoliticsInput());
      expect(plan.evaluatedMethods).toHaveLength(7);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
