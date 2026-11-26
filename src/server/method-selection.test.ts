import { describe, expect, it, vi } from 'vitest';
import {
  CORE_SCIENTIFIC_METHOD_IDS,
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  SCIENTIFIC_METHOD_REGISTRY_VERSION,
  UNIVERSAL_SUBDOMAIN_TOKEN,
  createScientificMethodRegistry,
  validateScientificMethodDescriptor,
  type MethodAssumptionId,
  type ScientificMethodRegistry,
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
    subdomain: 'binary-event-occurrence',
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

  it('identifies connected correlation components across shared correlationGroupId and explicit correlatedWithMethodIds, including binary Beta-Binomial / Dirichlet-Multinomial equivalence (Principle E)', () => {
    const input = createSyntheticBinaryGeopoliticsInput();
    expect(input.availableEvidence.binaryTrialSuccesses).toBe(14);
    expect(input.availableEvidence.binaryTrialFailures).toBe(26);
    expect(input.availableEvidence.multinomialOutcomeCounts).toEqual([14, 26]);

    const plan = planMethodApplicability(input);

    // Beta-Binomial, Weighted-Kish, and Dirichlet-Multinomial form a single
    // deterministic connected component with zero duplicate/overlapping reports:
    expect(plan.correlatedMethodGroups).toHaveLength(1);
    const group = plan.correlatedMethodGroups[0]!;
    expect(group.correlationGroupId).toBe('bernoulli-frequency-family');
    expect(group.correlationGroupIds).toEqual([
      'bernoulli-frequency-family',
      'dirichlet-categorical-family',
    ]);
    expect(group.applicableMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(group.relationshipSources).toEqual([
      'shared-correlation-group',
      'explicit-correlated-method-declaration',
      'binary-conjugate-simplex-reduction',
    ]);
    // Component sharedInformationChannels aggregates actual pairwise edge intersections
    // and never falsely includes Weighted-Kish-exclusive 'weighted-binary-trials':
    expect(group.sharedInformationChannels).toEqual([
      'binary-trial-counts',
      'multinomial-category-counts',
    ]);
    expect(group.sharedInformationChannels).not.toContain(
      'weighted-binary-trials',
    );
    expect(group.sharedInformationChannels).not.toContain(
      'kish-effective-sample-size',
    );

    // 'stationary-success-probability' is shared on the Beta-Binomial / Weighted-Kish edge,
    // so it appears in group.sharedAssumptions, but NOT in group.commonRequiredAssumptions
    // for the 3-method component because Dirichlet-Multinomial does not require it:
    expect(group.sharedAssumptions).toEqual(['stationary-success-probability']);
    expect(group.commonRequiredAssumptions).toEqual([]);
    expect(group.treatAsIndependentVotes).toBe(false);
    expect(group.warning).toContain('bernoulli-frequency-family');
    expect(group.warning).toContain('dirichlet-categorical-family');
    expect(group.warning).toContain('never be counted as two independent votes');

    // Pairwise edges within the component:
    expect(group.pairwiseRelationships).toHaveLength(2);
    expect(group.pairwiseRelationships[0]?.methodPair).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
    ]);
    expect(group.pairwiseRelationships[0]?.relationshipSources).toEqual([
      'shared-correlation-group',
      'explicit-correlated-method-declaration',
    ]);
    expect(group.pairwiseRelationships[0]?.sharedInformationChannels).toEqual([
      'binary-trial-counts',
    ]);
    expect(group.pairwiseRelationships[0]?.sharedAssumptions).toEqual([
      'stationary-success-probability',
    ]);

    expect(group.pairwiseRelationships[1]?.methodPair).toEqual([
      'beta-binomial-conjugate',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(group.pairwiseRelationships[1]?.relationshipSources).toEqual([
      'explicit-correlated-method-declaration',
      'binary-conjugate-simplex-reduction',
    ]);
    expect(group.pairwiseRelationships[1]?.sharedInformationChannels).toEqual([
      'binary-trial-counts',
      'multinomial-category-counts',
    ]);
    // Beta-Binomial and Dirichlet-Multinomial have disjoint assumption ID sets;
    // the empty intersection remains [] rather than being replaced with their union:
    expect(group.pairwiseRelationships[1]?.sharedAssumptions).toEqual([]);

    // Binary Beta-Binomial / Dirichlet-Multinomial equivalence diagnostic:
    const eqDiag = group.binaryBetaDirichletEquivalence!;
    expect(eqDiag).toBeDefined();
    expect(plan.dependenceDiagnostics.binaryBetaDirichletEquivalence).toEqual(
      eqDiag,
    );
    expect(eqDiag.methodPair).toEqual([
      'beta-binomial-conjugate',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(eqDiag.outcomeSpaceIsBinary).toBe(true);
    expect(eqDiag.observationAlignment).toBe(
      'identical-binary-and-multinomial-counts',
    );
    expect(eqDiag.binaryObservationCounts).toEqual([14, 26]);
    expect(eqDiag.multinomialObservationCounts).toEqual([14, 26]);
    expect(eqDiag.observationsMatchExactly).toBe(true);
    expect(eqDiag.treatAsIndependentVotes).toBe(false);
    expect(eqDiag.predictiveEquivalenceCondition).toContain('Dirichlet');
    expect(eqDiag.nonIdenticalCaveat).toContain(
      'Do not assume numerical identity when prior hyperparameters, observation counts, or modeling assumptions differ',
    );

    // Unlinked evidence-driven method (poisson-gamma-hazard) is classified as
    // 'unknown-not-established' rather than statistically independent:
    expect(
      plan.dependenceDiagnostics.unlinkedSelectedEvidenceMethodIds,
    ).toEqual(['poisson-gamma-hazard']);
    expect(plan.dependenceDiagnostics.epistemicIndependencePolicy).toBe(
      'unknown-until-empirically-or-structurally-audited',
    );
    const betaPoissonPair = plan.dependenceDiagnostics.pairwiseAssessments.find(
      (p) =>
        p.methodPair[0] === 'beta-binomial-conjugate' &&
        p.methodPair[1] === 'poisson-gamma-hazard',
    )!;
    expect(betaPoissonPair.classification).toBe('unknown-not-established');
    expect(betaPoissonPair.inferredStatisticallyIndependent).toBe(false);
    expect(betaPoissonPair.canCountAsIndependentVotes).toBe(false);
  });

  it('connects cross-group methods linked via correlatedWithMethodIds, distinguishes divergent binary vs. multinomial counts, and preserves Student-t / First-Passage dependence', () => {
    const baseInput = createSyntheticBinaryGeopoliticsInput();

    // 1. When only Beta-Binomial and Dirichlet-Multinomial have available data
    // (different correlationGroupIds: 'bernoulli-frequency-family' vs 'dirichlet-categorical-family'),
    // they are still grouped into a single connected component via explicit correlatedWithMethodIds:
    const betaAndDirichletOnlyPlan = planMethodApplicability({
      ...baseInput,
      availableEvidence: {
        availableChannels: ['binary-trial-counts', 'multinomial-category-counts'],
        hasVerifiableEmpiricalData: true,
        binaryTrialSuccesses: 14,
        binaryTrialFailures: 26,
        multinomialOutcomeCounts: [20, 20], // divergent counts
      },
    });
    expect(
      betaAndDirichletOnlyPlan.evidenceDrivenApplicableMethodIds,
    ).toEqual(['beta-binomial-conjugate', 'dirichlet-multinomial-symmetry']);
    expect(betaAndDirichletOnlyPlan.correlatedMethodGroups).toHaveLength(1);
    const crossGroupComp = betaAndDirichletOnlyPlan.correlatedMethodGroups[0]!;
    expect(crossGroupComp.applicableMethodIds).toEqual([
      'beta-binomial-conjugate',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(crossGroupComp.correlationGroupIds).toEqual([
      'bernoulli-frequency-family',
      'dirichlet-categorical-family',
    ]);
    expect(crossGroupComp.relationshipSources).toEqual([
      'explicit-correlated-method-declaration',
      'binary-conjugate-simplex-reduction',
    ]);
    expect(
      crossGroupComp.binaryBetaDirichletEquivalence?.observationAlignment,
    ).toBe('permuted-or-divergent-counts');
    expect(
      crossGroupComp.binaryBetaDirichletEquivalence?.observationsMatchExactly,
    ).toBe(false);
    expect(
      crossGroupComp.binaryBetaDirichletEquivalence?.treatAsIndependentVotes,
    ).toBe(false);

    // 2. When only Beta-Binomial and Weighted-Kish are applicable (without Dirichlet-Multinomial),
    // the bernoulli-frequency-family component is preserved:
    const betaAndKishOnlyPlan = planMethodApplicability({
      ...baseInput,
      availableEvidence: {
        availableChannels: [
          'binary-trial-counts',
          'weighted-binary-trials',
          'kish-effective-sample-size',
        ],
        hasVerifiableEmpiricalData: true,
        binaryTrialSuccesses: 14,
        binaryTrialFailures: 26,
        weightedSampleSize: 40,
        kishEffectiveSampleSize: 28.5,
      },
    });
    expect(betaAndKishOnlyPlan.correlatedMethodGroups).toHaveLength(1);
    const betaKishComp = betaAndKishOnlyPlan.correlatedMethodGroups[0]!;
    expect(betaKishComp.applicableMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
    ]);
    // For the 2-method Beta-Binomial / Weighted-Kish component, BOTH methods require
    // 'stationary-success-probability', so it IS in commonRequiredAssumptions, and
    // only 'binary-trial-counts' is in sharedInformationChannels:
    expect(betaKishComp.sharedInformationChannels).toEqual([
      'binary-trial-counts',
    ]);
    expect(betaKishComp.sharedAssumptions).toEqual([
      'stationary-success-probability',
    ]);
    expect(betaKishComp.commonRequiredAssumptions).toEqual([
      'stationary-success-probability',
    ]);
    expect(betaKishComp.binaryBetaDirichletEquivalence).toBeUndefined();

    // 2b. An explicitly correlated pair with zero common information channels and
    // zero common assumptions still receives a dependency edge and forms a connected
    // component, while its pairwise and component shared metadata arrays remain empty:
    const betaBase = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'beta-binomial-conjugate',
    );
    const poissonBase = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'poisson-gamma-hazard',
    );
    const customBeta = validateScientificMethodDescriptor({
      ...betaBase,
      methodId: 'custom:disjoint-channel-beta',
      methodFamily: 'custom-scientific-method',
      dependenceProfile: {
        correlationGroupId: 'custom-beta-group',
        sharedInformationChannels: ['binary-trial-counts'],
        sharedLatentAssumptions: [
          'exchangeable-bernoulli-trials',
          'stationary-success-probability',
        ],
        correlatedWithMethodIds: ['custom:disjoint-channel-poisson'],
        independenceWarning:
          'Explicitly correlated with custom:disjoint-channel-poisson via shared latent event window.',
      },
    });
    const customPoisson = validateScientificMethodDescriptor({
      ...poissonBase,
      methodId: 'custom:disjoint-channel-poisson',
      methodFamily: 'custom-scientific-method',
      dependenceProfile: {
        correlationGroupId: 'custom-poisson-group',
        sharedInformationChannels: [
          'poisson-event-counts',
          'continuous-exposure-duration',
        ],
        sharedLatentAssumptions: [
          'conditionally-independent-poisson-increments',
          'homogeneous-or-known-exposure-intensity',
        ],
        correlatedWithMethodIds: ['custom:disjoint-channel-beta'],
        independenceWarning:
          'Explicitly correlated with custom:disjoint-channel-beta via shared latent event window.',
      },
    });
    const disjointLinkedRegistry = createScientificMethodRegistry([
      customBeta,
      customPoisson,
    ]);
    const disjointLinkedPlan = planMethodApplicability(
      baseInput,
      disjointLinkedRegistry,
    );
    expect(disjointLinkedPlan.correlatedMethodGroups).toHaveLength(1);
    const disjointComp = disjointLinkedPlan.correlatedMethodGroups[0]!;
    expect(disjointComp.applicableMethodIds).toEqual([
      'custom:disjoint-channel-beta',
      'custom:disjoint-channel-poisson',
    ]);
    expect(disjointComp.relationshipSources).toEqual([
      'explicit-correlated-method-declaration',
    ]);
    expect(disjointComp.pairwiseRelationships).toHaveLength(1);
    expect(
      disjointComp.pairwiseRelationships[0]?.sharedInformationChannels,
    ).toEqual([]);
    expect(disjointComp.pairwiseRelationships[0]?.sharedAssumptions).toEqual(
      [],
    );
    expect(disjointComp.sharedInformationChannels).toEqual([]);
    expect(disjointComp.sharedAssumptions).toEqual([]);
    expect(disjointComp.commonRequiredAssumptions).toEqual([]);

    // 3. Preserve Student-t / First-Passage relationship ('ito-continuous-diffusion-family')
    // when both are simultaneously applicable in a custom registry scenario:
    const studentTDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'student-t-terminal-diffusion',
    );
    const firstPassageDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'first-passage-barrier-diffusion',
    );
    const barrierCompatibleStudentT = validateScientificMethodDescriptor({
      ...studentTDesc,
      domain: {
        ...studentTDesc.domain,
        applicableSubdomains: [
          ...studentTDesc.domain.applicableSubdomains,
          'climate-anomaly-threshold-exceedance',
        ],
      },
      outcomeSpaceCompatibility: {
        ...studentTDesc.outcomeSpaceCompatibility,
        supportedKinds: [
          'binary',
          'discretized-continuous-partition',
          'first-passage-before-horizon',
        ],
        requiresPartitionThresholds: false,
      },
    });
    const diffusionRegistry = createScientificMethodRegistry([
      barrierCompatibleStudentT,
      firstPassageDesc,
    ]);
    const diffusionPlan = planMethodApplicability(
      {
        questionId: 'SYNTH-DIFF-2026-004',
        questionCategory: 'climate',
        subdomain: 'climate-anomaly-threshold-exceedance',
        outcomeSpace: {
          kind: 'first-passage-before-horizon',
          outcomeLabels: ['Crosses +1.7C barrier', 'Remains below +1.7C'],
          barrierLevel: 1.7,
          barrierDirection: 'up-and-in',
          horizonStartsAt: '2026-01-01T00:00:00.000Z',
          horizonEndsAt: '2026-12-31T23:59:59.000Z',
          eventDefinitionHash: 'synth_diff_004',
        },
        horizon: {
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-12-31T23:59:59.000Z',
        },
        availableEvidence: {
          availableChannels: [
            'continuous-state-trajectory',
            'drift-and-scale-estimates',
            'tail-degrees-of-freedom',
            'absorbing-barrier-specification',
          ],
          hasVerifiableEmpiricalData: true,
          continuousTrajectoryObservations: 60,
          estimatedDrift: 0.03,
          estimatedScaleOrVolatility: 0.12,
          degreesOfFreedom: 8,
          initialStateLevel: 1.42,
        },
        assumptions: {
          verifiedAssumptions: [
            'stationary-heavy-tailed-increments',
            'student-t-terminal-innovation-law',
            'continuous-sample-path-no-jump-overshoot',
            'constant-drift-and-volatility-to-horizon',
            'reflection-principle-absorbing-barrier',
          ],
        },
        computationalCapabilities: {
          maxAllowedCostTier: 'high',
          allowIterativeSpecialFunctions: true,
        },
      },
      diffusionRegistry,
    );
    expect(diffusionPlan.correlatedMethodGroups).toHaveLength(1);
    const diffComp = diffusionPlan.correlatedMethodGroups[0]!;
    expect(diffComp.correlationGroupId).toBe('ito-continuous-diffusion-family');
    expect(diffComp.applicableMethodIds).toEqual([
      'student-t-terminal-diffusion',
      'first-passage-barrier-diffusion',
    ]);
    expect(diffComp.relationshipSources).toEqual([
      'shared-correlation-group',
      'explicit-correlated-method-declaration',
    ]);
    expect(diffComp.sharedInformationChannels).toEqual([
      'continuous-state-trajectory',
      'drift-and-scale-estimates',
    ]);
    expect(diffComp.commonRequiredAssumptions).toEqual([
      'constant-drift-and-volatility-to-horizon',
    ]);
  });

  it('evaluates discretized continuous partition scenarios (synthetic economy/climate scenario) where both Student-t terminal diffusion and Dirichlet-Multinomial are simultaneously applicable', () => {
    const syntheticEconomyInput: MethodApplicabilityPlanningInput = {
      questionId: 'SYNTH-ECON-2026-002',
      questionCategory: 'economy',
      subdomain: 'macroeconomic-and-financial-indicators',
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
      subdomain: 'climate-anomaly-threshold-exceedance',
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

    // 6. Wildcard or pseudo-wildcard strings are rejected on planning input.subdomain
    expect(() =>
      planMethodApplicability({
        ...valid,
        subdomain: '*',
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        subdomain: 'all',
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMethodApplicability({
        ...valid,
        subdomain: 'universal',
      }),
    ).toThrow(RangeError);
  });

  it('rejects methods when supplied subdomain is outside their declared scope and accepts methods whose declared subdomain matches', () => {
    const baseInput = createSyntheticBinaryGeopoliticsInput();

    // 1. Subdomain 'heterogeneous-reference-classes' is in weighted-kish-effective-binomial's
    // declared applicableSubdomains, but NOT in beta-binomial-conjugate, poisson-gamma-hazard,
    // or dirichlet-multinomial-symmetry:
    const heterogeneousPlan = planMethodApplicability({
      ...baseInput,
      subdomain: 'heterogeneous-reference-classes',
    });

    expect(
      heterogeneousPlan.strictlyApplicableMethods.map((m) => m.methodId),
    ).toEqual(['weighted-kish-effective-binomial']);
    expect(heterogeneousPlan.evidenceDrivenApplicableMethodIds).toEqual([
      'weighted-kish-effective-binomial',
    ]);
    expect(heterogeneousPlan.structuralBaselineMethodIds).toEqual([
      'structural-uniform-baseline',
    ]);

    for (const rejectedId of [
      'beta-binomial-conjugate',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ] as const) {
      const rec = heterogeneousPlan.evaluatedMethods.find(
        (m) => m.methodId === rejectedId,
      )!;
      expect(rec.disposition).toBe('inapplicable');
      expect(rec.applicable).toBe(false);
      expect(rec.failedGateIds).toContain('domain-compatibility');
      expect(rec.reasonCodes).toContain('DOMAIN_SUBDOMAIN_INCOMPATIBLE');
      expect(rec.gates[0]?.status).toBe('failed');
      expect(rec.gates[0]?.reasonCode).toBe('DOMAIN_SUBDOMAIN_INCOMPATIBLE');
      expect(rec.gates[0]?.explanation).toContain('heterogeneous-reference-classes');
    }

    // Because beta-binomial-conjugate was rejected by subdomain incompatibility,
    // only 1 method in 'bernoulli-frequency-family' is applicable, so correlatedMethodGroups is empty:
    expect(heterogeneousPlan.correlatedMethodGroups).toEqual([]);

    // 2. Completely foreign subdomain rejects all 6 restricted evidence-driven methods
    // while structural-uniform-baseline (which explicitly declares universal subdomain applicability)
    // remains applicable-with-limitations:
    const foreignSubdomainPlan = planMethodApplicability({
      ...baseInput,
      subdomain: 'unrecognized-orbital-debris-subdomain',
    });
    expect(foreignSubdomainPlan.evidenceDrivenApplicableMethodIds).toEqual([]);
    expect(foreignSubdomainPlan.structuralBaselineMethodIds).toEqual([
      'structural-uniform-baseline',
    ]);
    for (const id of CORE_SCIENTIFIC_METHOD_IDS) {
      if (id === 'structural-uniform-baseline') continue;
      const rec = foreignSubdomainPlan.evaluatedMethods.find(
        (m) => m.methodId === id,
      )!;
      expect(rec.disposition).toBe('inapplicable');
      expect(rec.failedGateIds).toContain('domain-compatibility');
      expect(rec.reasonCodes).toContain('DOMAIN_SUBDOMAIN_INCOMPATIBLE');
    }
  });

  it('defers restricted methods when input.subdomain is absent and explains which subdomain information is missing', () => {
    const { subdomain: _omitted, ...inputWithoutSubdomain } =
      createSyntheticBinaryGeopoliticsInput();

    const plan = planMethodApplicability(inputWithoutSubdomain);

    // None of the restricted evidence-driven methods may be silently authorized:
    expect(plan.strictlyApplicableMethods).toEqual([]);
    expect(plan.evidenceDrivenApplicableMethodIds).toEqual([]);

    // The 4 binary-compatible evidence-driven methods are deferred specifically on domain-compatibility:
    expect(plan.deferredMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);

    for (const defId of plan.deferredMethodIds) {
      const rec = plan.evaluatedMethods.find((m) => m.methodId === defId)!;
      const desc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(defId);
      expect(rec.disposition).toBe('deferred');
      expect(rec.applicable).toBe(false);
      expect(rec.deferredGateIds).toContain('domain-compatibility');
      expect(rec.reasonCodes).toContain('DOMAIN_SUBDOMAIN_MISSING_DEFERRED');
      expect(rec.missingDataRequirements.length).toBeGreaterThan(0);
      expect(rec.missingDataRequirements[0]).toContain(
        'Question subdomain is missing',
      );
      for (const allowedSub of desc.domain.applicableSubdomains) {
        expect(rec.missingDataRequirements[0]).toContain(allowedSub);
      }
      expect(plan.missingDataByMethod[defId]).toEqual(rec.missingDataRequirements);
    }

    // Only structural-uniform-baseline (which explicitly declares universal subdomain applicability) passes domain-compatibility:
    expect(plan.structuralBaselineMethodIds).toEqual(['structural-uniform-baseline']);
    expect(plan.applicableWithLimitationsMethods.map((m) => m.methodId)).toEqual([
      'structural-uniform-baseline',
    ]);
  });

  it('authorizes universal subdomain applicability only when explicitly declared and never infers it from empty arrays or arbitrary strings', () => {
    const baseDesc = DEFAULT_SCIENTIFIC_METHOD_REGISTRY.getOrThrow(
      'beta-binomial-conjugate',
    );
    const customUniversalEvidenceMethod = validateScientificMethodDescriptor({
      ...baseDesc,
      methodId: 'custom:universal-bernoulli-updater',
      methodFamily: 'custom-scientific-method',
      domain: {
        ...baseDesc.domain,
        universalSubdomainApplicability: true,
        applicableSubdomains: [UNIVERSAL_SUBDOMAIN_TOKEN, 'binary-event-occurrence'],
      },
      dependenceProfile: {
        ...baseDesc.dependenceProfile,
        correlatedWithMethodIds: [],
      },
    });

    const customRegistry = createScientificMethodRegistry([
      ...DEFAULT_SCIENTIFIC_METHOD_REGISTRY.listAll(),
      customUniversalEvidenceMethod,
    ]);

    const { subdomain: _omitted, ...inputWithoutSubdomain } =
      createSyntheticBinaryGeopoliticsInput();

    // When subdomain is omitted, restricted methods are deferred, while the explicitly universal custom method is applicable:
    const planWithoutSubdomain = planMethodApplicability(
      inputWithoutSubdomain,
      customRegistry,
    );
    expect(planWithoutSubdomain.evidenceDrivenApplicableMethodIds).toEqual([
      'custom:universal-bernoulli-updater',
    ]);
    expect(planWithoutSubdomain.deferredMethodIds).toContain(
      'beta-binomial-conjugate',
    );

    // Defensive check in evaluateDomainGate: unvalidated custom registry with empty applicableSubdomains or arbitrary 'all' throws RangeError
    const malformedEmptySubdomainRegistry: ScientificMethodRegistry = {
      ...DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
      listAll: () => [
        {
          ...baseDesc,
          domain: {
            ...baseDesc.domain,
            applicableSubdomains: [],
          },
        },
      ],
    };
    expect(() =>
      planMethodApplicability(
        createSyntheticBinaryGeopoliticsInput(),
        malformedEmptySubdomainRegistry,
      ),
    ).toThrow(RangeError);

    const malformedArbitraryWildcardRegistry: ScientificMethodRegistry = {
      ...DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
      listAll: () => [
        {
          ...baseDesc,
          domain: {
            ...baseDesc.domain,
            applicableSubdomains: ['all'],
          },
        },
      ],
    };
    expect(() =>
      planMethodApplicability(
        createSyntheticBinaryGeopoliticsInput(),
        malformedArbitraryWildcardRegistry,
      ),
    ).toThrow(RangeError);
  });

  it('preserves the three-way domain distinction between inapplicable (conflicting subdomain), deferred (missing subdomain), and applicable-with-limitations (documented domain caveat)', () => {
    const baseInput = createSyntheticBinaryGeopoliticsInput();

    // 1. Inapplicable: supplied subdomain conflicts with beta-binomial-conjugate's declared scope
    const inapplicablePlan = planMethodApplicability({
      ...baseInput,
      subdomain: 'macroeconomic-and-financial-indicators',
    });
    const betaInapplicable = inapplicablePlan.evaluatedMethods.find(
      (m) => m.methodId === 'beta-binomial-conjugate',
    )!;
    expect(betaInapplicable.disposition).toBe('inapplicable');
    expect(betaInapplicable.applicable).toBe(false);
    expect(betaInapplicable.gates[0]?.status).toBe('failed');
    expect(betaInapplicable.gates[0]?.reasonCode).toBe(
      'DOMAIN_SUBDOMAIN_INCOMPATIBLE',
    );

    // 2. Deferred: subdomain is absent and beta-binomial-conjugate has restricted subdomains
    const { subdomain: _omitted, ...missingSubdomainInput } = baseInput;
    const deferredPlan = planMethodApplicability(missingSubdomainInput);
    const betaDeferred = deferredPlan.evaluatedMethods.find(
      (m) => m.methodId === 'beta-binomial-conjugate',
    )!;
    expect(betaDeferred.disposition).toBe('deferred');
    expect(betaDeferred.applicable).toBe(false);
    expect(betaDeferred.gates[0]?.status).toBe('deferred');
    expect(betaDeferred.gates[0]?.reasonCode).toBe(
      'DOMAIN_SUBDOMAIN_MISSING_DEFERRED',
    );

    // 3. Applicable-with-limitations: domain & subdomain match, with a documented domain constraint caveat
    const caveatPlan = planMethodApplicability({
      ...baseInput,
      subdomain: 'binary-event-occurrence',
      assumptions: {
        ...baseInput.assumptions,
        knownDomainConstraints: [
          'Parliamentary ratification calendar is subject to constitutional court review window',
        ],
      },
    });
    const betaCaveat = caveatPlan.evaluatedMethods.find(
      (m) => m.methodId === 'beta-binomial-conjugate',
    )!;
    expect(betaCaveat.disposition).toBe('applicable-with-limitations');
    expect(betaCaveat.applicable).toBe(true);
    expect(betaCaveat.gates[0]?.status).toBe('passed-with-limitations');
    expect(betaCaveat.gates[0]?.reasonCode).toBe('DOMAIN_COMPATIBLE_WITH_CAVEATS');
    expect(betaCaveat.limitationGateIds).toContain('domain-compatibility');
    expect(betaCaveat.activeLimitations).toContain(
      'Domain constraint caveat: Parliamentary ratification calendar is subject to constitutional court review window',
    );
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
