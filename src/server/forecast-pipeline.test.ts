import { describe, expect, it, vi } from 'vitest';
import type { OutcomeSpaceDescriptor } from './forecast-types.ts';
import {
  ASSESSED_EVIDENCE_CATEGORIES,
  EVIDENCE_COLLECTION_STATUSES,
  FORECAST_PIPELINE_VERSION,
  ForecastPipelineRequestError,
  PIPELINE_EXECUTION_STATUSES,
  PIPELINE_FORECAST_KINDS,
  executeScientificMethod,
  runScientificForecastPipeline,
  type ForecastPipelineRequest,
  type StatisticalIndependenceCertification,
} from './index.ts';

const REFERENCE_TIME = '2026-06-15T12:00:00Z';

const BINARY_OUTCOME_SPACE: OutcomeSpaceDescriptor = Object.freeze({
  kind: 'binary',
  outcomeLabels: Object.freeze(['Yes', 'No']),
  horizonStartsAt: '2026-06-15T12:00:00Z',
  horizonEndsAt: '2028-12-31T23:59:59Z',
  eventDefinitionHash:
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockHarvesterFetch(): typeof globalThis.fetch {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.includes('api.openalex.org')) {
      return jsonResponse({
        results: [
          {
            id: 'https://openalex.org/W4391112223',
            doi: 'https://doi.org/10.1038/s41560-026-01001-z',
            title:
              'Global grid-scale battery storage deployment trends through 2026',
            publication_date: '2026-04-10',
            created_date: '2026-04-12',
            type: 'article',
            is_retracted: false,
            primary_location: {
              landing_page_url: 'https://doi.org/10.1038/s41560-026-01001-z',
              source: {
                display_name: 'Nature Energy',
              },
            },
            abstract_inverted_index: {
              Global: [0],
              battery: [1],
              storage: [2],
              capacity: [3],
              expanded: [4],
              in: [5],
              '2026.': [6],
            },
          },
        ],
      });
    }
    if (url.includes('en.wikipedia.org')) {
      return jsonResponse({
        query: {
          general: {
            sitename: 'Wikipedia',
          },
          pages: {
            '551122': {
              pageid: 551122,
              title: 'Battery storage power station',
              canonicalurl:
                'https://en.wikipedia.org/wiki/Battery_storage_power_station',
              touched: '2026-05-02T10:00:00Z',
              revisions: [
                {
                  timestamp: '2026-05-01T10:00:00Z',
                },
              ],
              extract:
                '<p>Grid-scale <b>battery storage</b> power stations provide utility-scale capacity.</p>',
            },
          },
        },
      });
    }
    return jsonResponse({ articles: [] });
  });
}

function assertDeeplyFrozen(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDeeplyFrozen(item, seen);
    }
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    assertDeeplyFrozen((value as Record<string, unknown>)[key], seen);
  }
}

describe('Stage 2B-1 — End-to-End Scientific Forecast Pipeline Integration (src/server/forecast-pipeline.ts)', () => {
  it('re-exports Stage 2B-1 pipeline constants, errors, and functions from src/server/index.ts', () => {
    expect(FORECAST_PIPELINE_VERSION).toBe('2B-1.0.0');
    expect(PIPELINE_EXECUTION_STATUSES).toEqual([
      'successful-empirical-forecast',
      'structural-baseline-forecast',
      'partial-execution',
      'failed-execution',
      'honest-abstention',
    ]);
    expect(PIPELINE_FORECAST_KINDS).toEqual([
      'empirical-forecast',
      'structural-baseline-only',
      'abstained',
      'failed',
    ]);
    expect(EVIDENCE_COLLECTION_STATUSES).toEqual([
      'succeeded-with-evidence',
      'succeeded-empty',
      'partial-provider-failure',
      'failed-all-providers',
      'skipped-offline',
    ]);
    expect(ASSESSED_EVIDENCE_CATEGORIES).toEqual([
      'documentary-evidence',
      'historical-observations',
      'structured-numerical-dataset',
      'statistical-sufficient-statistics',
      'unsupported-or-unverified-claim',
    ]);
    expect(typeof runScientificForecastPipeline).toBe('function');
  });

  it('1. executes the complete pipeline end-to-end with harvested documentary evidence and validated structured quantitative evidence', async () => {
    const mockFetch = createMockHarvesterFetch();

    const result = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex', 'wikipedia'],
        fetchImpl: mockFetch,
      },
      assumptions: {
        verifiedAssumptions: [
          'exchangeable-bernoulli-trials',
          'stationary-success-probability',
        ],
      },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-iea-grid-milestones-2026',
          title: 'IEA Historical Grid Capacity Expansion Milestone Cohort',
          publisher: 'International Energy Agency (IEA)',
          url: 'https://www.iea.org/data-and-statistics/battery-storage-cohort-2026',
          publishedAt: '2026-05-10T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 14,
            failures: 6,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
      ],
    });

    // Step A: Canonical question identity
    expect(result.questionIdentity.questionCategory).toBe('climate');
    expect(result.questionIdentity.identityComplete).toBe(true);
    expect(result.questionIdentity.unresolvedComponents).toEqual([]);
    expect(result.questionIdentity.identityDigest).toMatch(/^[0-9a-f]{64}$/);

    // Step B & C: Evidence collection and assessment
    expect(result.evidenceCollectionStatus).toBe('succeeded-with-evidence');
    expect(result.harvestResult.items).toHaveLength(2);
    expect(result.retrievedEvidenceCount).toBe(3); // 2 harvested documentary + 1 structured dataset
    expect(result.validatedQuantitativeEvidenceCount).toBe(1);
    expect(result.evidenceAssessment.documentaryEvidence).toHaveLength(2);
    expect(result.evidenceAssessment.structuredNumericalDatasets).toHaveLength(
      1,
    );

    // Step D & E: Method applicability and execution
    expect(result.methodApplicabilityResults).toHaveLength(7);
    expect(result.executedMethodIds).toEqual(['beta-binomial-conjugate']);
    expect(result.methodExecutionFailures).toEqual([]);

    // Step F: Forecast synthesis & pipeline status
    expect(result.pipelineStatus).toBe('successful-empirical-forecast');
    expect(result.forecastKind).toBe('empirical-forecast');
    expect(result.isEmpiricalForecast).toBe(true);
    expect(result.footingTier).toBe('methodologically-sound-moderate-evidence');
    expect(result.calibrationStatus).toBe(
      'unverified-no-out-of-sample-evaluation',
    );
    expect(result.probabilityDistribution).not.toBeNull();
    expect(result.probabilityDistribution).toHaveLength(2);
    // Posterior Beta(1 + 14, 1 + 6) = Beta(15, 7) => E[p] = 15/22
    expect(result.probabilityDistribution![0]!.probability).toBeCloseTo(
      15 / 22,
      14,
    );
    expect(result.probabilityDistribution![1]!.probability).toBeCloseTo(
      7 / 22,
      14,
    );
    expect(result.uncertaintyDecomposition).not.toBeNull();
    expect(
      result.uncertaintyDecomposition!.categoryDecompositions[0]!
        .parametricInterval.kind,
    ).toBe('available');
    assertDeeplyFrozen(result);
  });

  it('2. abstains honestly when evidence collection returns no results and no structural baseline is verified, or emits structural-baseline-forecast when symmetry is explicitly verified', async () => {
    const emptyFetch: typeof globalThis.fetch = vi.fn(async () =>
      jsonResponse({ results: [], articles: [], query: { search: [] } }),
    );

    const abstained = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
       outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex'],
        fetchImpl: emptyFetch,
      },
    });

    expect(abstained.evidenceCollectionStatus).toBe('succeeded-empty');
    expect(abstained.retrievedEvidenceCount).toBe(0);
    expect(abstained.validatedQuantitativeEvidenceCount).toBe(0);
    expect(abstained.executedMethodIds).toEqual([]);
    expect(abstained.pipelineStatus).toBe('honest-abstention');
    expect(abstained.forecastKind).toBe('abstained');
    expect(abstained.isEmpiricalForecast).toBe(false);
    expect(abstained.footingTier).toBe('insufficient-basis-abstain');
    expect(abstained.probabilityDistribution).toBeNull();
    expect(abstained.uncertaintyDecomposition).toBeNull();
    expect(abstained.abstentionReason).toBe(
      'no-defensible-theoretical-or-empirical-basis',
    );
    expect(
      abstained.missingRequirementsByMethod['beta-binomial-conjugate']!.length,
    ).toBeGreaterThan(0);
    assertDeeplyFrozen(abstained);

    // When partition symmetry is explicitly verified, produces structural-baseline-forecast (not successful-empirical-forecast):
    const structuralOnly = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex'],
        fetchImpl: emptyFetch,
      },
      structuralSymmetryPremise: {
        partitionSymmetryVerified: true,
        exhaustiveMutuallyExclusiveVerified: true,
        symmetryRationale:
          'Binary partition [Yes, No] is mutually exclusive and collectively exhaustive under zero empirical evidence.',
      },
    });

    expect(structuralOnly.pipelineStatus).toBe('structural-baseline-forecast');
    expect(structuralOnly.forecastKind).toBe('structural-baseline-only');
    expect(structuralOnly.isEmpiricalForecast).toBe(false);
    expect(structuralOnly.footingTier).toBe(
      'structural-symmetry-baseline-only',
    );
    expect(structuralOnly.executedMethodIds).toEqual([
      'structural-uniform-baseline',
    ]);
    expect(
      structuralOnly.independenceSemantics?.effectiveIndependentMethodCount,
    ).toBe(0);
    expect(structuralOnly.probabilityDistribution![0]!.probability).toBe(0.5);
    expect(structuralOnly.probabilityDistribution![1]!.probability).toBe(0.5);
    assertDeeplyFrozen(structuralOnly);
  });

  it('3. preserves documentary evidence for provenance but never converts article counts, source counts, or relevance scores into quantitative observations', async () => {
    const mockFetch = createMockHarvesterFetch();

    const result = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex', 'wikipedia'],
        fetchImpl: mockFetch,
      },
      submittedEvidence: [
        {
          category: 'documentary-evidence',
          evidenceId: 'doc-iea-commentary-2026',
          title: 'IEA World Energy Outlook Executive Summary 2026',
          publisher: 'International Energy Agency',
          url: 'https://www.iea.org/reports/world-energy-outlook-2026',
          publishedAt: '2026-05-01T00:00:00Z',
          snippet: 'Qualitative commentary on global grid storage adoption.',
          isPrimarySourceVerified: true,
        },
      ],
    });

    expect(result.retrievedEvidenceCount).toBe(3);
    expect(result.validatedQuantitativeEvidenceCount).toBe(0);
    expect(result.evidenceAssessment.documentaryEvidence).toHaveLength(3);
    expect(
      result.evidenceAssessment.derivedAvailableEvidence
        .hasVerifiableEmpiricalData,
    ).toBe(false);
    expect(
      result.evidenceAssessment.derivedAvailableEvidence.availableChannels,
    ).toEqual([]);
    expect(result.executedMethodIds).toEqual([]);
    expect(result.pipelineStatus).toBe('honest-abstention');
    expect(result.probabilityDistribution).toBeNull();
  });

  it('4. executes a single supported quantitative method (Poisson-Gamma or 3-category Dirichlet-Multinomial) and preserves single-method credible intervals', async () => {
    const poissonRes = await runScientificForecastPipeline({
      question:
        'Will a commercial mission return samples from the lunar south pole before 2029 according to NASA?',
      questionCategory: 'space',
      subdomain: 'rare-event-arrival-hazards',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      assumptions: {
        verifiedAssumptions: [
          'conditionally-independent-poisson-increments',
          'homogeneous-or-known-exposure-intensity',
        ],
      },
      submittedEvidence: [
        {
          category: 'statistical-sufficient-statistics',
          evidenceId: 'stats-lunar-landers-2026',
          title: 'Historical Lunar South Pole Soft-Landing Arrival Telemetry',
          publisher: 'NASA Planetary Data System',
          url: 'https://pds.nasa.gov/ds-view/pds/viewDataset.jsp?dsid=lunar-2026',
          publishedAt: '2026-04-01T00:00:00Z',
          verifiedEmpirical: true,
          statistics: {
            targetMethodId: 'poisson-gamma-hazard',
            eventCount: 3,
            exposureDuration: 6,
            exposureUnit: 'years',
            forecastExposureDuration: 2.5,
            forecastExposureUnit: 'years',
            eventOutcomeIndex: 0,
            prior: { shape: 1, rate: 2 },
          },
        },
      ],
    });

    expect(poissonRes.pipelineStatus).toBe('successful-empirical-forecast');
    expect(poissonRes.executedMethodIds).toEqual(['poisson-gamma-hazard']);
    expect(
      poissonRes.uncertaintyDecomposition!.categoryDecompositions[0]!
        .parametricInterval.kind,
    ).toBe('available');
    // Posterior Gamma(shape = 1 + 3 = 4, rate = 2 + 6 = 8), H = 2.5 => P(N=0) = (8 / 10.5)^4
    const expectedSurv = (8 / 10.5) ** 4;
    expect(poissonRes.probabilityDistribution![0]!.probability).toBeCloseTo(
      1 - expectedSurv,
      14,
    );
    expect(poissonRes.probabilityDistribution![1]!.probability).toBeCloseTo(
      expectedSurv,
      14,
    );

    // 3-category Dirichlet-Multinomial:
    const ternarySpace: OutcomeSpaceDescriptor = Object.freeze({
      kind: 'categorical-exhaustive',
      outcomeLabels: Object.freeze(['Below-Target', 'On-Target', 'Above-Target']),
      horizonStartsAt: '2026-06-15T12:00:00Z',
      horizonEndsAt: '2028-12-31T23:59:59Z',
      eventDefinitionHash:
        'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    });

    const dirichletRes = await runScientificForecastPipeline({
      question:
        'Which macroeconomic inflation regime will prevail in 2028 according to the IEA?',
      questionCategory: 'economy',
      subdomain: 'multi-outcome-categorical-events',
      outcomeSpace: ternarySpace,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      assumptions: {
        verifiedAssumptions: [
          'exchangeable-multinomial-trials',
          'exhaustive-mutually-exclusive-categories',
        ],
      },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-regime-counts-2026',
          title: 'Historical Macroeconomic Regime Realizations',
          publisher: 'OECD Statistics',
          url: 'https://stats.oecd.org/regime-realizations-2026',
          publishedAt: '2026-03-15T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'multinomial-contingency-table',
            counts: [5, 12, 3],
            prior: { alpha: [1, 1, 1] },
          },
        },
      ],
    });

    expect(dirichletRes.pipelineStatus).toBe('successful-empirical-forecast');
    expect(dirichletRes.executedMethodIds).toEqual([
      'dirichlet-multinomial-symmetry',
    ]);
    expect(dirichletRes.probabilityDistribution).toHaveLength(3);
    expect(dirichletRes.probabilityDistribution![0]!.probability).toBeCloseTo(
      6 / 23,
      14,
    );
    expect(dirichletRes.probabilityDistribution![1]!.probability).toBeCloseTo(
      13 / 23,
      14,
    );
    expect(dirichletRes.probabilityDistribution![2]!.probability).toBeCloseTo(
      4 / 23,
      14,
    );
  });

  it('5 & 6. executes multiple applicable methods across correlated components, keeps structural baseline separate, and enforces declared vs verified independence semantics', async () => {
    const certification: StatisticalIndependenceCertification = {
      certificationId: 'CERT-PIPE-2026-001',
      evidenceReference:
        'audit://oracle/2026/pipeline-disjoint-cohort-and-hazard-telemetry',
      participatingMethodIds: [
        'beta-binomial-conjugate',
        'weighted-kish-effective-binomial',
        'poisson-gamma-hazard',
        'dirichlet-multinomial-symmetry',
      ],
      certifiedIndependentGroups: [
        {
          groupId: 'binomial-dirichlet-cohort-group',
          methodIds: [
            'beta-binomial-conjugate',
            'weighted-kish-effective-binomial',
            'dirichlet-multinomial-symmetry',
          ],
          evidenceDatasetOrChannelRef: 'dataset://oracle/treaty-cohort-v1',
        },
        {
          groupId: 'poisson-hazard-telemetry-group',
          methodIds: ['poisson-gamma-hazard'],
          evidenceDatasetOrChannelRef: 'dataset://oracle/hazard-telemetry-v1',
        },
      ],
      certifiedRelationships: [
        {
          groupIdA: 'binomial-dirichlet-cohort-group',
          groupIdB: 'poisson-hazard-telemetry-group',
          evidenceBasis:
            'Disjoint institutional data collection channels with orthogonal residual assertions.',
          maxAbsResidualDependenceMetric: 0.02,
        },
      ],
      methodologicalJustification:
        'Discrete treaty cohort and continuous incident arrival telemetry originate from distinct institutional streams.',
      verificationStatus: 'empirically-verified-orthogonal-residuals',
    };

    const result = await runScientificForecastPipeline({
      question:
        'Will a new international climate treaty be ratified before 2029 according to the IPCC?',
      questionCategory: 'geopolitics',
      subdomain: 'geopolitical-or-conflict-incident-rates',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
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
        ],
      },
      structuralSymmetryPremise: {
        partitionSymmetryVerified: true,
        exhaustiveMutuallyExclusiveVerified: true,
        symmetryRationale:
          'Binary [Yes, No] outcome partition serves as a structural reference benchmark.',
      },
      independenceCertification: certification,
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-treaty-binary-2026',
          title: 'Historical Multilateral Treaty Ratification Cohort',
          publisher: 'UN Treaty Collection',
          url: 'https://treaties.un.org/data/cohort-2026',
          publishedAt: '2026-01-15T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 12,
            failures: 8,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-treaty-weighted-2026',
          title: 'Recency-Weighted Multilateral Treaty Ratification Cohort',
          publisher: 'UN Treaty Collection',
          url: 'https://treaties.un.org/data/weighted-cohort-2026',
          publishedAt: '2026-01-16T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'weighted-binary-cohort-table',
            weightedSuccessMass: 9.5,
            weightedFailureMass: 4.5,
            sumSquaredWeights: 14.0,
            observationCount: 20,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-treaty-poisson-2026',
          title: 'Continuous-Time Treaty Ratification Arrival Telemetry',
          publisher: 'IPCC Secretariat',
          url: 'https://www.ipcc.ch/data/treaty-hazard-2026',
          publishedAt: '2026-02-01T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'poisson-exposure-table',
            eventCount: 6,
            exposureDuration: 10,
            exposureUnit: 'years',
            forecastExposureDuration: 2.5,
            forecastExposureUnit: 'years',
            eventOutcomeIndex: 0,
            prior: { shape: 1, rate: 1 },
          },
        },
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-treaty-dirichlet-2026',
          title: 'Categorical Treaty Outcome Contingency Table',
          publisher: 'UN Treaty Collection',
          url: 'https://treaties.un.org/data/contingency-2026',
          publishedAt: '2026-02-10T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'multinomial-contingency-table',
            counts: [12, 8],
            prior: { alpha: [1, 1] },
          },
        },
      ],
    });

    expect(result.pipelineStatus).toBe('successful-empirical-forecast');
    expect(result.executedMethodIds).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
      'structural-uniform-baseline',
    ]);
    expect(
      result.synthesisResult?.contrastReport.ensembleContributingMethodIds,
    ).toEqual([
      'beta-binomial-conjugate',
      'weighted-kish-effective-binomial',
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(
      result.synthesisResult?.contrastReport.referenceOnlyMethodIds,
    ).toEqual(['structural-uniform-baseline']);

    // Two-level dependence-aware weights: 1/6 each for correlated Bernoulli/Dirichlet family, 1/2 for Poisson-Gamma:
    const weights = result.synthesisResult!.contrastReport.weightsByMethod;
    expect(weights['beta-binomial-conjugate']).toBeCloseTo(1 / 6, 15);
    expect(weights['weighted-kish-effective-binomial']).toBeCloseTo(1 / 6, 15);
    expect(weights['dirichlet-multinomial-symmetry']).toBeCloseTo(1 / 6, 15);
    expect(weights['poisson-gamma-hazard']).toBeCloseTo(1 / 2, 15);

    // Declared vs verified independence semantics:
    expect(result.independenceSemantics?.certificationTier).toBe('declared');
    expect(result.independenceSemantics?.declaredIndependentGroupCount).toBe(2);
    expect(result.independenceSemantics?.statisticalIndependenceVerified).toBe(
      false,
    );
    expect(result.independenceSemantics?.effectiveIndependentMethodCount).toBe(
      1,
    );
    expect(
      result.independenceSemantics?.independenceCertification?.tier,
    ).toBe('declared');
    expect(
      result.independenceSemantics?.independenceCertification
        ?.verificationStatus,
    ).toBe('declared-unverified-assertion');
    expect(
      result.independenceSemantics?.independenceCertification
        ?.claimedVerificationStatus,
    ).toBe('empirically-verified-orthogonal-residuals');
    assertDeeplyFrozen(result);
  });

  it('7. deduplicates multiple sources reporting the same historical event and quarantines conflicting event reports, AI-generated claims, and article-count heuristics', async () => {
    const result = await runScientificForecastPipeline({
      question:
        'Will a CRISPR therapy be approved for a condition affecting 1% of adults before 2029 according to the FDA?',
      questionCategory: 'health',
      subdomain: 'clinical-and-scientific-replication-rates',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      submittedEvidence: [
        {
          category: 'historical-observations',
          evidenceId: 'hist-fda-crispr-trials-2026',
          title: 'FDA Phase III Gene Therapy BLA Decisions',
          publisher: 'U.S. Food and Drug Administration (FDA)',
          url: 'https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products',
          publishedAt: '2026-05-01T00:00:00Z',
          verifiedEmpirical: true,
          observationSchema: {
            kind: 'binary-trials',
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
            observations: [
              // Same event 'BLA-2025-001' reported by 3 different sources -> counts as 1 success, not 3!
              {
                eventId: 'BLA-2025-001',
                outcome: 'success',
                observedAt: '2025-08-10T00:00:00Z',
                publisher: 'FDA CDER',
                sourceUrl: 'https://www.fda.gov/approvals/bla-2025-001',
              },
              {
                eventId: 'BLA-2025-001',
                outcome: 'success',
                observedAt: '2025-08-11T00:00:00Z',
                publisher: 'New England Journal of Medicine',
                sourceUrl: 'https://www.nejm.org/doi/full/10.1056/bla-2025-001',
              },
              {
                eventId: 'BLA-2025-001',
                outcome: 'success',
                observedAt: '2025-08-12T00:00:00Z',
                publisher: 'Reuters Health',
                sourceUrl: 'https://www.reuters.com/health/bla-2025-001',
              },
              // Distinct event 'BLA-2025-002' -> 1 failure
              {
                eventId: 'BLA-2025-002',
                outcome: 'failure',
                observedAt: '2025-11-05T00:00:00Z',
                publisher: 'FDA CDER',
                sourceUrl: 'https://www.fda.gov/crl/bla-2025-002',
              },
              // Conflicting reports for 'BLA-2026-CONFLICT' -> quarantined, 0 observations added
              {
                eventId: 'BLA-2026-CONFLICT',
                outcome: 'success',
                observedAt: '2026-01-15T00:00:00Z',
                publisher: 'Secondary Blog A',
                sourceUrl: 'https://example.org/blog-a/bla-2026',
              },
              {
                eventId: 'BLA-2026-CONFLICT',
                outcome: 'failure',
                observedAt: '2026-01-15T00:00:00Z',
                publisher: 'Secondary Blog B',
                sourceUrl: 'https://example.org/blog-b/bla-2026',
              },
            ],
          },
        },
        // AI-generated claim must be rejected into unsupported-or-unverified-claim:
        {
          category: 'statistical-sufficient-statistics',
          evidenceId: 'ai-hallucinated-stats',
          title: 'LLM Estimated Approval Counts',
          publisher: 'Synthetic AI Forecaster',
          url: 'https://example.com/ai-stats',
          publishedAt: '2026-05-01T00:00:00Z',
          isAiGenerated: true,
          statistics: {
            targetMethodId: 'beta-binomial-conjugate',
            successes: 99,
            failures: 1,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
        // Article-count heuristic must be rejected into unsupported-or-unverified-claim:
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'article-count-pseudo-dataset',
          title: 'GDELT Article Count Proxy',
          publisher: 'Aggregator Heuristic',
          url: 'https://example.com/article-counts',
          publishedAt: '2026-05-01T00:00:00Z',
          derivedFromDocOrSourceCount: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 50,
            failures: 10,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
      ],
    });

    expect(result.validatedQuantitativeEvidenceCount).toBe(1);
    expect(
      result.evidenceAssessment.unsupportedOrUnverifiedClaims,
    ).toHaveLength(2);
    expect(
      result.evidenceAssessment.deduplicatedEventDiagnostics,
    ).toHaveLength(2);

    const consistentDiag =
      result.evidenceAssessment.deduplicatedEventDiagnostics.find(
        (d) => d.eventId === 'BLA-2025-001',
      );
    expect(consistentDiag?.rawReportCount).toBe(3);
    expect(consistentDiag?.deduplicatedCount).toBe(1);
    expect(consistentDiag?.status).toBe('deduplicated-consistent');
    expect(consistentDiag?.reportingSources).toHaveLength(3);

    const conflictDiag =
      result.evidenceAssessment.deduplicatedEventDiagnostics.find(
        (d) => d.eventId === 'BLA-2026-CONFLICT',
      );
    expect(conflictDiag?.rawReportCount).toBe(2);
    expect(conflictDiag?.deduplicatedCount).toBe(0);
    expect(conflictDiag?.status).toBe('quarantined-conflicting-outcomes');

    // Only 1 deduplicated success ('BLA-2025-001') and 1 deduplicated failure ('BLA-2025-002') -> n = 2:
    expect(
      result.evidenceAssessment.derivedAvailableEvidence.binaryTrialSuccesses,
    ).toBe(1);
    expect(
      result.evidenceAssessment.derivedAvailableEvidence.binaryTrialFailures,
    ).toBe(1);
    expect(result.methodOutputs[0]!.effectiveSampleSize).toBe(2);
    expect(result.probabilityDistribution![0]!.probability).toBeCloseTo(
      0.5,
      14,
    );
  });

  it('8. does not treat applicable unimplemented diffusion/barrier methods as executable and abstains honestly without fabricating probabilities', async () => {
    const barrierSpace: OutcomeSpaceDescriptor = Object.freeze({
      kind: 'first-passage-before-horizon',
      outcomeLabels: Object.freeze(['Barrier-Breached', 'No-Breach']),
      horizonStartsAt: '2026-06-15T12:00:00Z',
      horizonEndsAt: '2028-12-31T23:59:59Z',
      eventDefinitionHash:
        'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      barrierLevel: 435,
      barrierDirection: 'up-and-in',
    });

    const result = await runScientificForecastPipeline({
      question:
        'Will atmospheric CO2 at Mauna Loa breach 435 ppm before 2029 according to NOAA?',
      questionCategory: 'climate',
      subdomain: 'climate-anomaly-threshold-exceedance',
      outcomeSpace: barrierSpace,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      assumptions: {
        verifiedAssumptions: [
          'continuous-sample-path-no-jump-overshoot',
          'constant-drift-and-volatility-to-horizon',
          'reflection-principle-absorbing-barrier',
        ],
      },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-noaa-co2-trajectory-2026',
          title: 'NOAA Mauna Loa Continuous Monthly CO2 Trajectory',
          publisher: 'NOAA Global Monitoring Laboratory',
          url: 'https://gml.noaa.gov/ccgg/trends/data.html',
          publishedAt: '2026-05-05T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'continuous-state-trajectory-table',
            observationCount: 120,
            estimatedDrift: 2.4,
            estimatedScaleOrVolatility: 0.8,
            initialStateLevel: 426.5,
          },
        },
      ],
    });

    expect(
      result.applicabilityPlan.evidenceDrivenApplicableMethodIds,
    ).toContain('first-passage-barrier-diffusion');
    expect(result.executedMethodIds).toEqual([]);
    expect(result.unexecutedApplicableMethods).toEqual([
      expect.objectContaining({
        methodId: 'first-passage-barrier-diffusion',
        implementationStatus: 'registered-specification-only',
      }),
    ]);
    expect(
      result.skippedMethods.find(
        (s) => s.methodId === 'first-passage-barrier-diffusion',
      )?.skipCategory,
    ).toBe('unimplemented-method');
    expect(result.pipelineStatus).toBe('honest-abstention');
    expect(result.probabilityDistribution).toBeNull();
  });

  it('9. isolates individual method execution failures (partial-execution when another method succeeds, failed-execution when all applicable methods fail)', async () => {
    // Case A: beta-binomial-conjugate succeeds while poisson-gamma-hazard fails in Step E
    // due to prior.shape = 0.001 < MIN_CERTIFIED_SHAPE_PARAMETER (0.05):
    const partialResult = await runScientificForecastPipeline({
      question:
        'Will a new international climate treaty be ratified before 2029 according to the IPCC?',
      questionCategory: 'geopolitics',
      subdomain: 'geopolitical-or-conflict-incident-rates',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-valid-beta-2026',
          title: 'Valid Binary Cohort Dataset',
          publisher: 'UN Treaty Collection',
          url: 'https://treaties.un.org/data/valid-beta-2026',
          publishedAt: '2026-03-01T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 10,
            failures: 5,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-out-of-domain-poisson-2026',
          title: 'Out-of-Certified-Domain Poisson Prior Dataset',
          publisher: 'IPCC Secretariat',
          url: 'https://www.ipcc.ch/data/out-of-domain-poisson-2026',
          publishedAt: '2026-03-02T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'poisson-exposure-table',
            eventCount: 0,
            exposureDuration: 5,
            exposureUnit: 'years',
            forecastExposureDuration: 2,
            forecastExposureUnit: 'years',
            eventOutcomeIndex: 0,
            // Posterior shape = 0.001 + 0 = 0.001 < 0.05 certified domain -> throws in Step E!
            prior: { shape: 0.001, rate: 1 },
          },
        },
      ],
    });

    expect(partialResult.pipelineStatus).toBe('partial-execution');
    expect(partialResult.forecastKind).toBe('empirical-forecast');
    expect(partialResult.isEmpiricalForecast).toBe(true);
    expect(partialResult.executedMethodIds).toEqual([
      'beta-binomial-conjugate',
    ]);
    expect(partialResult.methodExecutionFailures).toHaveLength(1);
    expect(partialResult.methodExecutionFailures[0]?.methodId).toBe(
      'poisson-gamma-hazard',
    );
    expect(partialResult.methodExecutionFailures[0]?.stage).toBe(
      'method-execution',
    );
    expect(partialResult.probabilityDistribution).not.toBeNull();
    expect(partialResult.probabilityDistribution![0]!.probability).toBeCloseTo(
      11 / 17,
      14,
    );
    expect(
      partialResult.limitations.some((l) =>
        l.includes("Isolated method failure in 'poisson-gamma-hazard'"),
      ),
    ).toBe(true);
    assertDeeplyFrozen(partialResult);

    // Case B: Only poisson-gamma-hazard is applicable and it fails in Step E -> failed-execution:
    const failedResult = await runScientificForecastPipeline({
      question:
        'Will a new international climate treaty be ratified before 2029 according to the IPCC?',
      questionCategory: 'geopolitics',
      subdomain: 'rare-event-arrival-hazards',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-out-of-domain-poisson-only',
          title: 'Out-of-Certified-Domain Poisson Prior Dataset',
          publisher: 'IPCC Secretariat',
          url: 'https://www.ipcc.ch/data/out-of-domain-poisson-2026',
          publishedAt: '2026-03-02T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'poisson-exposure-table',
            eventCount: 0,
            exposureDuration: 5,
            exposureUnit: 'years',
            forecastExposureDuration: 2,
            forecastExposureUnit: 'years',
            eventOutcomeIndex: 0,
            prior: { shape: 0.001, rate: 1 },
          },
        },
      ],
    });

    expect(failedResult.pipelineStatus).toBe('failed-execution');
    expect(failedResult.forecastKind).toBe('failed');
    expect(failedResult.isEmpiricalForecast).toBe(false);
    expect(failedResult.executedMethodIds).toEqual([]);
    expect(failedResult.methodExecutionFailures).toHaveLength(1);
    expect(failedResult.probabilityDistribution).toBeNull();
    expect(failedResult.uncertaintyDecomposition).toBeNull();
    expect(failedResult.abstentionReason).toBe(
      'numerical-representation-or-convergence-failure',
    );
    assertDeeplyFrozen(failedResult);
  });

  it('10. rejects malformed or unsupported pipeline requests with ForecastPipelineRequestError and produces deterministic results across repeated runs', async () => {
    await expect(runScientificForecastPipeline(null)).rejects.toThrow(
      ForecastPipelineRequestError,
    );
    await expect(
      runScientificForecastPipeline({ question: '  ' }),
    ).rejects.toThrow(ForecastPipelineRequestError);
    await expect(
      runScientificForecastPipeline({
        question: 'Will something happen soon?',
        questionCategory: 'science',
      }),
    ).rejects.toThrow(/does not contain an explicit forecast horizon/);
    await expect(
      runScientificForecastPipeline({
        question:
          'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
        subdomain: 'NOT A VALID SUBDOMAIN!',
      }),
    ).rejects.toThrow(ForecastPipelineRequestError);

    const validReq: ForecastPipelineRequest = {
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      submittedEvidence: [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'ds-iea-battery-2026',
          title: 'IEA Historical Grid Storage Expansion Cohort',
          publisher: 'International Energy Agency',
          url: 'https://www.iea.org/data/grid-storage-2026',
          publishedAt: '2026-04-01T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 8,
            failures: 4,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
      ],
    };

    const run1 = await runScientificForecastPipeline(validReq);
    const run2 = await runScientificForecastPipeline(validReq);
    expect(run1).toEqual(run2);
    assertDeeplyFrozen(run1);
  });

  it('11. records partial-provider-failure and failed-all-providers evidence collection statuses accurately', async () => {
    const partialFetch: typeof globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('api.openalex.org')) {
        return jsonResponse({ error: 'Upstream rate limit' }, 503);
      }
      return jsonResponse({
        query: {
          general: { sitename: 'Wikipedia' },
          pages: {
            '551122': {
              pageid: 551122,
              title: 'Battery storage power station',
              canonicalurl:
                'https://en.wikipedia.org/wiki/Battery_storage_power_station',
              touched: '2026-05-02T10:00:00Z',
              revisions: [{ timestamp: '2026-05-01T10:00:00Z' }],
              extract: '<p>Grid-scale battery storage.</p>',
            },
          },
        },
      });
    });

    const partialProviderRes = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex', 'wikipedia'],
        fetchImpl: partialFetch,
      },
    });
    expect(partialProviderRes.evidenceCollectionStatus).toBe(
      'partial-provider-failure',
    );
    expect(partialProviderRes.retrievedEvidenceCount).toBe(1);
    expect(partialProviderRes.pipelineStatus).toBe('honest-abstention');

    const allFailFetch: typeof globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'Service unavailable' }, 503),
    );
    const allFailRes = await runScientificForecastPipeline({
      question:
        'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex', 'wikipedia'],
        fetchImpl: allFailFetch,
      },
    });
    expect(allFailRes.evidenceCollectionStatus).toBe('failed-all-providers');
    expect(allFailRes.retrievedEvidenceCount).toBe(0);
    expect(allFailRes.pipelineStatus).toBe('honest-abstention');
  });

  it('12. isolates output-validation failures in Step E when a custom executor produces a non-normalized distribution', async () => {
    const res = await runScientificForecastPipeline(
      {
        question:
          'Will a new international climate treaty be ratified before 2029 according to the IPCC?',
        questionCategory: 'geopolitics',
        subdomain: 'geopolitical-or-conflict-incident-rates',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        submittedEvidence: [
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'ds-beta-ok',
            title: 'Valid Binary Cohort Dataset',
            publisher: 'UN Treaty Collection',
            url: 'https://treaties.un.org/data/beta-ok',
            publishedAt: '2026-03-01T00:00:00Z',
            verifiedEmpirical: true,
            dataset: {
              kind: 'binary-cohort-table',
              successes: 9,
              failures: 3,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'ds-poisson-corrupt-output',
            title: 'Valid Poisson Exposure Dataset',
            publisher: 'IPCC Secretariat',
            url: 'https://www.ipcc.ch/data/poisson-corrupt',
            publishedAt: '2026-03-02T00:00:00Z',
            verifiedEmpirical: true,
            dataset: {
              kind: 'poisson-exposure-table',
              eventCount: 2,
              exposureDuration: 5,
              exposureUnit: 'years',
              forecastExposureDuration: 2,
              forecastExposureUnit: 'years',
              eventOutcomeIndex: 0,
              prior: { shape: 1, rate: 1 },
            },
          },
        ],
      },
      {
        methodExecutor: (input, reg) => {
          const out = executeScientificMethod(input, reg);
          if (input.methodId === 'poisson-gamma-hazard') {
            return {
              ...out,
              outcomes: [
                {
                  ...out.outcomes[0]!,
                  probability: 0.9,
                },
                {
                  ...out.outcomes[1]!,
                  probability: 0.9,
                },
              ],
            };
          }
          return out;
        },
      },
    );

    expect(res.pipelineStatus).toBe('partial-execution');
    expect(res.executedMethodIds).toEqual(['beta-binomial-conjugate']);
    expect(res.methodExecutionFailures).toHaveLength(1);
    expect(res.methodExecutionFailures[0]?.methodId).toBe(
      'poisson-gamma-hazard',
    );
    expect(res.methodExecutionFailures[0]?.stage).toBe('output-validation');
    expect(res.probabilityDistribution![0]!.probability).toBeCloseTo(
      10 / 14,
      14,
    );
  });

  it('13. deduplicates historical poisson-arrivals and multinomial-trials observations by eventId', async () => {
    const res = await runScientificForecastPipeline({
      question:
        'Will a new international climate treaty be ratified before 2029 according to the IPCC?',
      questionCategory: 'geopolitics',
      subdomain: 'geopolitical-or-conflict-incident-rates',
      outcomeSpace: BINARY_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: { skipRemoteHarvest: true },
      submittedEvidence: [
        {
          category: 'historical-observations',
          evidenceId: 'hist-poisson-events-2026',
          title: 'Historical Treaty Incident Arrivals',
          publisher: 'UN Treaty Monitoring',
          url: 'https://treaties.un.org/data/incidents-2026',
          publishedAt: '2026-04-01T00:00:00Z',
          verifiedEmpirical: true,
          observationSchema: {
            kind: 'poisson-arrivals',
            eventOutcomeIndex: 0,
            historicalExposure: {
              exposureDuration: 10,
              exposureUnit: 'years',
            },
            forecastExposure: {
              exposureDuration: 2,
              exposureUnit: 'years',
            },
            prior: { shape: 1, rate: 1 },
            events: [
              {
                eventId: 'INC-2024-01',
                occurredAt: '2024-05-01T00:00:00Z',
                publisher: 'UN Monitor',
                sourceUrl: 'https://treaties.un.org/inc/2024-01',
              },
              {
                eventId: 'INC-2024-01',
                occurredAt: '2024-05-01T02:00:00Z',
                publisher: 'Associated Press',
                sourceUrl: 'https://apnews.com/article/inc-2024-01',
              },
              {
                eventId: 'INC-2025-02',
                occurredAt: '2025-07-10T00:00:00Z',
                publisher: 'UN Monitor',
                sourceUrl: 'https://treaties.un.org/inc/2025-02',
              },
            ],
          },
        },
        {
          category: 'historical-observations',
          evidenceId: 'hist-multinomial-trials-2026',
          title: 'Historical Categorical Realizations',
          publisher: 'UN Treaty Monitoring',
          url: 'https://treaties.un.org/data/multinomial-2026',
          publishedAt: '2026-04-02T00:00:00Z',
          verifiedEmpirical: true,
          observationSchema: {
            kind: 'multinomial-trials',
            prior: { alpha: [1, 1] },
            observations: [
              {
                eventId: 'SUMMIT-2023-A',
                outcomeIndex: 0,
                observedAt: '2023-12-01T00:00:00Z',
                publisher: 'UNFCCC',
                sourceUrl: 'https://unfccc.int/summit-2023-a',
              },
              {
                eventId: 'SUMMIT-2023-A',
                outcomeIndex: 0,
                observedAt: '2023-12-02T00:00:00Z',
                publisher: 'Nature News',
                sourceUrl: 'https://www.nature.com/articles/summit-2023-a',
              },
              {
                eventId: 'SUMMIT-2024-B',
                outcomeIndex: 1,
                observedAt: '2024-12-01T00:00:00Z',
                publisher: 'UNFCCC',
                sourceUrl: 'https://unfccc.int/summit-2024-b',
              },
            ],
          },
        },
      ],
    });

    expect(
      res.evidenceAssessment.derivedAvailableEvidence.poissonEventCount,
    ).toBe(2); // 3 raw reports -> 2 deduplicated events
    expect(
      res.evidenceAssessment.derivedAvailableEvidence.multinomialOutcomeCounts,
    ).toEqual([1, 1]); // 3 raw reports -> [1, 1] deduplicated counts
    expect(res.executedMethodIds).toEqual([
      'poisson-gamma-hazard',
      'dirichlet-multinomial-symmetry',
    ]);
    expect(res.pipelineStatus).toBe('successful-empirical-forecast');
  });
});
