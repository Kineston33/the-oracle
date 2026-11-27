import { describe, expect, it, vi } from 'vitest';
import type { OutcomeSpaceDescriptor } from './forecast-types.ts';
import {
  ASSESSED_EVIDENCE_CATEGORIES,
  EVIDENCE_COLLECTION_STATUSES,
  EVIDENCE_TRUST_TIERS,
  EVIDENCE_VERIFICATION_OUTCOMES,
  FORECAST_PIPELINE_VERSION,
  ForecastPipelineRequestError,
  PIPELINE_EXECUTION_STATUSES,
  PIPELINE_FORECAST_KINDS,
  createTrustedEvidenceVerifier,
  executeScientificMethod,
  runScientificForecastPipeline,
  type BinaryHistoricalObservationRecord,
  type ForecastPipelineRequest,
  type MultinomialHistoricalObservationRecord,
  type PoissonEventObservationRecord,
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

const TRUSTED_VERIFIER = createTrustedEvidenceVerifier({
  verifierId: 'oracle-institutional-evidence-verifier-v1',
  verificationArtifactRef: 'audit://oracle/2026/verified-empirical-registry',
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
  it('re-exports Stage 2B-1 pipeline constants, trust boundary contracts, errors, and functions from src/server/index.ts', () => {
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
    expect(EVIDENCE_TRUST_TIERS).toEqual([
      'independently-verified-empirical',
      'harvester-documentary',
      'caller-declared-unverified',
      'quarantined-invalid',
    ]);
    expect(EVIDENCE_VERIFICATION_OUTCOMES).toEqual([
      'verified-by-trusted-verifier',
      'harvester-documentary-provenance',
      'downgraded-no-trusted-verifier',
      'rejected-by-trusted-verifier',
      'rejected-integrity-or-schema-gate',
    ]);
    expect(typeof runScientificForecastPipeline).toBe('function');
    expect(typeof createTrustedEvidenceVerifier).toBe('function');
  });

  it('1. executes the complete pipeline end-to-end with harvested documentary evidence and independently verified structured quantitative evidence', async () => {
    const mockFetch = createMockHarvesterFetch();

    const result = await runScientificForecastPipeline(
      {
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
      },
      {
        evidenceVerifier: TRUSTED_VERIFIER,
      },
    );

    // Step A: Canonical question identity
    expect(result.questionIdentity.questionCategory).toBe('climate');
    expect(result.questionIdentity.identityComplete).toBe(true);
    expect(result.questionIdentity.unresolvedComponents).toEqual([]);
    expect(result.questionIdentity.identityDigest).toMatch(/^[0-9a-f]{64}$/);

    // Step B & C: Evidence collection and assessment
    expect(result.evidenceCollectionStatus).toBe('succeeded-with-evidence');
    expect(result.harvestResult.items).toHaveLength(2);
    expect(result.retrievedEvidenceCount).toBe(3);
    expect(result.validatedQuantitativeEvidenceCount).toBe(1);
    expect(result.evidenceAssessment.documentaryEvidence).toHaveLength(2);
    expect(result.evidenceAssessment.structuredNumericalDatasets).toHaveLength(
      1,
    );
    expect(
      result.evidenceAssessment.structuredNumericalDatasets[0]?.trustTier,
    ).toBe('independently-verified-empirical');
    expect(
      result.evidenceAssessment.structuredNumericalDatasets[0]
        ?.verificationOutcome,
    ).toBe('verified-by-trusted-verifier');
    expect(
      result.evidenceAssessment.structuredNumericalDatasets[0]
        ?.verifiedByVerifierId,
    ).toBe('oracle-institutional-evidence-verifier-v1');

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
      jsonResponse({ results: [], articles: [], query: { pages: {} } }),
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
    assertDeeplyFrozen(abstained);

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

  it('3. preserves documentary evidence for provenance, never converts article counts or relevance scores into quantitative observations, and never trusts caller-supplied isPrimarySourceVerified without a verifier', async () => {
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

    const callerDoc = result.evidenceAssessment.documentaryEvidence.find(
      (d) => d.evidenceId === 'doc-iea-commentary-2026',
    );
    expect(callerDoc?.claimedPrimarySourceVerified).toBe(true);
    expect(callerDoc?.isPrimarySourceVerified).toBe(false);
    expect(callerDoc?.trustTier).toBe('caller-declared-unverified');

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
    const poissonRes = await runScientificForecastPipeline(
      {
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

    expect(poissonRes.pipelineStatus).toBe('successful-empirical-forecast');
    expect(poissonRes.executedMethodIds).toEqual(['poisson-gamma-hazard']);
    expect(
      poissonRes.uncertaintyDecomposition!.categoryDecompositions[0]!
        .parametricInterval.kind,
    ).toBe('available');
    const expectedSurv = (8 / 10.5) ** 4;
    expect(poissonRes.probabilityDistribution![0]!.probability).toBeCloseTo(
      1 - expectedSurv,
      14,
    );
    expect(poissonRes.probabilityDistribution![1]!.probability).toBeCloseTo(
      expectedSurv,
      14,
    );

    const ternarySpace: OutcomeSpaceDescriptor = Object.freeze({
      kind: 'categorical-exhaustive',
      outcomeLabels: Object.freeze([
        'Below-Target',
        'On-Target',
        'Above-Target',
      ]),
      horizonStartsAt: '2026-06-15T12:00:00Z',
      horizonEndsAt: '2028-12-31T23:59:59Z',
      eventDefinitionHash:
        'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    });

    const dirichletRes = await runScientificForecastPipeline(
      {
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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

    const result = await runScientificForecastPipeline(
      {
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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

    const weights = result.synthesisResult!.contrastReport.weightsByMethod;
    expect(weights['beta-binomial-conjugate']).toBeCloseTo(1 / 6, 15);
    expect(weights['weighted-kish-effective-binomial']).toBeCloseTo(1 / 6, 15);
    expect(weights['dirichlet-multinomial-symmetry']).toBeCloseTo(1 / 6, 15);
    expect(weights['poisson-gamma-hazard']).toBeCloseTo(1 / 2, 15);

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
    const result = await runScientificForecastPipeline(
      {
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
                  sourceUrl:
                    'https://www.nejm.org/doi/full/10.1056/bla-2025-001',
                },
                {
                  eventId: 'BLA-2025-001',
                  outcome: 'success',
                  observedAt: '2025-08-12T00:00:00Z',
                  publisher: 'Reuters Health',
                  sourceUrl: 'https://www.reuters.com/health/bla-2025-001',
                },
                {
                  eventId: 'BLA-2025-002',
                  outcome: 'failure',
                  observedAt: '2025-11-05T00:00:00Z',
                  publisher: 'FDA CDER',
                  sourceUrl: 'https://www.fda.gov/crl/bla-2025-002',
                },
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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

    const result = await runScientificForecastPipeline(
      {
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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
    const partialResult = await runScientificForecastPipeline(
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
              prior: { shape: 0.001, rate: 1 },
            },
          },
        ],
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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

    const failedResult = await runScientificForecastPipeline(
      {
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
      },
      { evidenceVerifier: TRUSTED_VERIFIER },
    );

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

    const run1 = await runScientificForecastPipeline(validReq, {
      evidenceVerifier: TRUSTED_VERIFIER,
    });
    const run2 = await runScientificForecastPipeline(validReq, {
      evidenceVerifier: TRUSTED_VERIFIER,
    });
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
        evidenceVerifier: TRUSTED_VERIFIER,
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

  describe('Revision 1 — Evidence Trust and Verification Boundary', () => {
    it('downgrades caller-submitted quantitative evidence when verifiedEmpirical is omitted or caller-supplied as true without a trusted EvidenceVerifier', async () => {
      const requestWithUnverifiedCallerClaims: ForecastPipelineRequest = {
        question:
          'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        submittedEvidence: [
          // 1. Missing verifiedEmpirical:
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'ds-missing-verified-flag',
            title: 'Caller Dataset Omitting verifiedEmpirical',
            publisher: 'International Energy Agency (IEA)',
            url: 'https://www.iea.org/data/unverified-cohort-2026',
            publishedAt: '2026-04-01T00:00:00Z',
            dataset: {
              kind: 'binary-cohort-table',
              successes: 15,
              failures: 2,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
          // 2. Caller-supplied verifiedEmpirical: true & isPrimarySourceVerified: true:
          {
            category: 'statistical-sufficient-statistics',
            evidenceId: 'stats-caller-self-asserted-true',
            title: 'Caller Self-Asserted Official Statistics',
            publisher: 'International Energy Agency (IEA)',
            url: 'https://www.iea.org/data/self-asserted-stats-2026',
            publishedAt: '2026-04-02T00:00:00Z',
            verifiedEmpirical: true,
            isPrimarySourceVerified: true,
            statistics: {
              targetMethodId: 'beta-binomial-conjugate',
              successes: 20,
              failures: 1,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
          // 3. Historical observations with caller-supplied verifiedEmpirical: true:
          {
            category: 'historical-observations',
            evidenceId: 'hist-caller-self-asserted-true',
            title: 'Caller Self-Asserted Historical Observations',
            publisher: 'International Energy Agency (IEA)',
            url: 'https://www.iea.org/data/self-asserted-hist-2026',
            publishedAt: '2026-04-03T00:00:00Z',
            verifiedEmpirical: true,
            isPrimarySourceVerified: true,
            observationSchema: {
              kind: 'binary-trials',
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
              observations: [
                {
                  eventId: 'IEA-MILESTONE-1',
                  outcome: 'success',
                  observedAt: '2025-05-01T00:00:00Z',
                  publisher: 'IEA',
                  sourceUrl: 'https://www.iea.org/reports/milestone-1',
                  verifiedEmpirical: true,
                },
              ],
            },
          },
        ],
      };

      // Execute WITHOUT a trusted evidenceVerifier:
      const res = await runScientificForecastPipeline(
        requestWithUnverifiedCallerClaims,
      );

      expect(res.retrievedEvidenceCount).toBe(3);
      expect(res.validatedQuantitativeEvidenceCount).toBe(0);
      expect(res.evidenceAssessment.historicalObservations).toHaveLength(0);
      expect(res.evidenceAssessment.structuredNumericalDatasets).toHaveLength(
        0,
      );
      expect(
        res.evidenceAssessment.statisticalSufficientStatistics,
      ).toHaveLength(0);
      expect(res.evidenceAssessment.declaredUnverifiedEvidence).toHaveLength(3);
      expect(
        res.evidenceAssessment.unsupportedOrUnverifiedClaims,
      ).toHaveLength(3);

      for (const rec of res.evidenceAssessment.declaredUnverifiedEvidence) {
        expect(rec.effectiveCategory).toBe('unsupported-or-unverified-claim');
        expect(rec.trustTier).toBe('caller-declared-unverified');
        expect(rec.verificationOutcome).toBe('downgraded-no-trusted-verifier');
        expect(rec.isPrimarySourceVerified).toBe(false);
        expect(rec.usableForQuantitativeMethods).toBe(false);
        expect(rec.verifiedByVerifierId).toBeNull();
      }

      const selfAsserted =
        res.evidenceAssessment.declaredUnverifiedEvidence.find(
          (r) => r.evidenceId === 'stats-caller-self-asserted-true',
        );
      expect(selfAsserted?.claimedVerifiedEmpirical).toBe(true);
      expect(selfAsserted?.claimedPrimarySourceVerified).toBe(true);
      expect(selfAsserted?.isPrimarySourceVerified).toBe(false);

      expect(
        res.evidenceAssessment.derivedAvailableEvidence
          .hasVerifiableEmpiricalData,
      ).toBe(false);
      expect(res.executedMethodIds).toEqual([]);
      expect(res.pipelineStatus).toBe('honest-abstention');
      expect(res.probabilityDistribution).toBeNull();
      assertDeeplyFrozen(res);
    });

    it('rejects fabricated institutional provenance when the trusted EvidenceVerifier does not authenticate the submission, and accepts only genuinely verified submissions', async () => {
      const selectiveVerifier = createTrustedEvidenceVerifier({
        verifierId: 'iea-cryptographic-manifest-verifier',
        verificationArtifactRef: 'audit://iea/2026/manifest-sha256',
        verifySubmission: (ctx) => {
          if (ctx.evidenceId === 'ds-authenticated-iea-2026') {
            return {
              verifiedEmpirical: true,
              isPrimarySourceVerified: true,
              rationale:
                'Matched cryptographic digest against official 2026 IEA data release manifest.',
            };
          }
          return {
            verifiedEmpirical: false,
            isPrimarySourceVerified: false,
            rationale: `Fabricated institutional provenance: '${ctx.submission.url}' is not present in the official IEA release manifest.`,
          };
        },
      });

      // 1. Only fabricated institutional submission -> rejected by verifier, abstains:
      const fabricatedOnlyRes = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-fabricated-iea-spoof',
              title: 'Official IEA Grid Storage Primary Telemetry 2026',
              publisher: 'International Energy Agency (IEA)',
              url: 'https://www.iea.org/data/spoofed-release-2026',
              publishedAt: '2026-05-01T00:00:00Z',
              verifiedEmpirical: true,
              isPrimarySourceVerified: true,
              dataset: {
                kind: 'binary-cohort-table',
                successes: 50,
                failures: 0,
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
              },
            },
          ],
        },
        { evidenceVerifier: selectiveVerifier },
      );

      expect(fabricatedOnlyRes.validatedQuantitativeEvidenceCount).toBe(0);
      expect(fabricatedOnlyRes.pipelineStatus).toBe('honest-abstention');
      expect(fabricatedOnlyRes.probabilityDistribution).toBeNull();
      const spoofRec = fabricatedOnlyRes.evidenceProvenance[0]!;
      expect(spoofRec.trustTier).toBe('caller-declared-unverified');
      expect(spoofRec.verificationOutcome).toBe('rejected-by-trusted-verifier');
      expect(spoofRec.claimedVerifiedEmpirical).toBe(true);
      expect(spoofRec.claimedPrimarySourceVerified).toBe(true);
      expect(spoofRec.isPrimarySourceVerified).toBe(false);
      expect(spoofRec.usableForQuantitativeMethods).toBe(false);
      expect(spoofRec.verifiedByVerifierId).toBe(
        'iea-cryptographic-manifest-verifier',
      );
      expect(spoofRec.assessmentNote).toContain(
        'Fabricated institutional provenance',
      );

      // 2. Both fabricated and authenticated submissions -> only the authenticated submission is counted and used:
      const mixedRes = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-fabricated-iea-spoof',
              title: 'Official IEA Grid Storage Primary Telemetry 2026',
              publisher: 'International Energy Agency (IEA)',
              url: 'https://www.iea.org/data/spoofed-release-2026',
              publishedAt: '2026-05-01T00:00:00Z',
              verifiedEmpirical: true,
              isPrimarySourceVerified: true,
              dataset: {
                kind: 'binary-cohort-table',
                successes: 50,
                failures: 0,
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
              },
            },
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-authenticated-iea-2026',
              title: 'Authenticated IEA Grid Storage Cohort',
              publisher: 'International Energy Agency (IEA)',
              url: 'https://www.iea.org/data/authenticated-release-2026',
              publishedAt: '2026-05-02T00:00:00Z',
              verifiedEmpirical: true,
              isPrimarySourceVerified: true,
              dataset: {
                kind: 'binary-cohort-table',
                successes: 6,
                failures: 4,
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
              },
            },
          ],
        },
        { evidenceVerifier: selectiveVerifier },
      );

      expect(mixedRes.retrievedEvidenceCount).toBe(2);
      expect(mixedRes.validatedQuantitativeEvidenceCount).toBe(1);
      expect(mixedRes.pipelineStatus).toBe('successful-empirical-forecast');
      // Posterior uses ONLY the authenticated dataset (6 successes, 4 failures -> (6+1)/(10+2) = 7/12):
      expect(mixedRes.probabilityDistribution![0]!.probability).toBeCloseTo(
        7 / 12,
        14,
      );
      assertDeeplyFrozen(mixedRes);
    });
  });

  describe('Revision 2 — Strict Observation Outcome and Field Validation', () => {
    it('never maps invalid binary-trials outcomes to 0 (failure) and quarantines malformed binary, Poisson, and multinomial observations with explicit diagnostics', async () => {
      const invalidBinaryObs = [
        // Valid success (1) and valid failure (0):
        {
          eventId: 'VALID-SUCC-1',
          outcome: 1,
          observedAt: '2025-01-10T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/valid-succ-1',
        },
        {
          eventId: 'VALID-SUCC-2',
          outcome: 'success',
          observedAt: '2025-01-11T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/valid-succ-2',
        },
        {
          eventId: 'VALID-FAIL-1',
          outcome: 0,
          observedAt: '2025-01-12T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/valid-fail-1',
        },
        // Invalid outcomes that previously would have been silently mapped to 0 (failure):
        {
          eventId: 'BAD-OUTCOME-UNKNOWN',
          outcome: 'unknown' as unknown as 0,
          observedAt: '2025-02-01T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/bad-unknown',
        },
        {
          eventId: 'BAD-OUTCOME-YES',
          outcome: 'yes' as unknown as 1,
          observedAt: '2025-02-02T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/bad-yes',
        },
        {
          eventId: 'BAD-OUTCOME-NUMBER-2',
          outcome: 2 as unknown as 1,
          observedAt: '2025-02-03T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/bad-num-2',
        },
        {
          eventId: 'BAD-OUTCOME-BOOL',
          outcome: true as unknown as 1,
          observedAt: '2025-02-04T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/bad-bool',
        },
        {
          eventId: 'BAD-OUTCOME-NULL',
          outcome: null as unknown as 0,
          observedAt: '2025-02-05T00:00:00Z',
          publisher: 'FDA CDER',
          sourceUrl: 'https://www.fda.gov/trials/bad-null',
        },
        // Invalid publisher, private sourceUrl, future observedAt, and negative weight:
        {
          eventId: 'BAD-FIELDS-OBS',
          outcome: 'failure',
          observedAt: '2027-01-01T00:00:00Z',
          publisher: '   ',
          sourceUrl: 'http://127.0.0.1/internal-trial',
          weight: -5,
        },
      ] satisfies BinaryHistoricalObservationRecord[];

      const invalidPoissonEvents = [
        {
          eventId: 'VALID-POISSON-1',
          occurredAt: '2025-03-01T00:00:00Z',
          publisher: 'UN Monitor',
          sourceUrl: 'https://treaties.un.org/inc/valid-1',
        },
        {
          eventId: 'BAD-POISSON-FIELDS',
          occurredAt: '2028-01-01T00:00:00Z',
          publisher: '',
          sourceUrl: 'ftp://files.un.org/inc/bad',
        },
        {
          eventId: 'BAD-POISSON-EXTRA-OUTCOME',
          occurredAt: '2025-03-05T00:00:00Z',
          publisher: 'UN Monitor',
          sourceUrl: 'https://treaties.un.org/inc/bad-outcome',
          outcome: 'failure',
        } as unknown as PoissonEventObservationRecord,
      ] satisfies PoissonEventObservationRecord[];

      const invalidMultinomialObs = [
        {
          eventId: 'VALID-MULTI-1',
          outcomeIndex: 0,
          outcomeLabel: 'Yes',
          observedAt: '2025-04-01T00:00:00Z',
          publisher: 'UNFCCC',
          sourceUrl: 'https://unfccc.int/multi/valid-1',
        },
        {
          eventId: 'BAD-MULTI-OUT-OF-RANGE',
          outcomeIndex: 5,
          observedAt: '2025-04-02T00:00:00Z',
          publisher: 'UNFCCC',
          sourceUrl: 'https://unfccc.int/multi/bad-range',
        },
        {
          eventId: 'BAD-MULTI-LABEL-CONFLICT',
          outcomeIndex: 0,
          outcomeLabel: 'No', // conflicts with index 0 ('Yes')
          observedAt: '2025-04-03T00:00:00Z',
          publisher: 'UNFCCC',
          sourceUrl: 'https://unfccc.int/multi/bad-conflict',
        },
      ] satisfies MultinomialHistoricalObservationRecord[];

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
              category: 'historical-observations',
              evidenceId: 'hist-strict-binary-validation',
              title: 'Binary Historical Trials with Malformed Records',
              publisher: 'UN Treaty Collection',
              url: 'https://treaties.un.org/data/strict-binary',
              publishedAt: '2026-05-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                observations: invalidBinaryObs,
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'hist-strict-poisson-validation',
              title: 'Poisson Arrivals with Malformed Records',
              publisher: 'UN Treaty Collection',
              url: 'https://treaties.un.org/data/strict-poisson',
              publishedAt: '2026-05-02T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'poisson-arrivals',
                eventOutcomeIndex: 0,
                historicalExposure: {
                  exposureDuration: 5,
                  exposureUnit: 'years',
                },
                forecastExposure: {
                  exposureDuration: 2,
                  exposureUnit: 'years',
                },
                prior: { shape: 1, rate: 1 },
                events: invalidPoissonEvents,
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'hist-strict-multinomial-validation',
              title: 'Multinomial Trials with Malformed Records',
              publisher: 'UN Treaty Collection',
              url: 'https://treaties.un.org/data/strict-multinomial',
              publishedAt: '2026-05-03T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'multinomial-trials',
                prior: { alpha: [1, 1] },
                observations: invalidMultinomialObs,
              },
            },
          ],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );

      // Binary counts must reflect ONLY the 2 valid successes and 1 valid failure (NOT 6 failures!):
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialSuccesses,
      ).toBe(2);
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialFailures,
      ).toBe(1);

      // Poisson count must reflect ONLY the 1 valid arrival:
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.poissonEventCount,
      ).toBe(1);

      // Multinomial counts must reflect ONLY the 1 valid observation in category 0:
      expect(
        res.evidenceAssessment.derivedAvailableEvidence
          .multinomialOutcomeCounts,
      ).toEqual([1, 0]);

      // 6 quarantined binary + 2 quarantined Poisson + 2 quarantined multinomial = 10 diagnostics:
      expect(res.evidenceAssessment.invalidObservationDiagnostics).toHaveLength(
        10,
      );

      const badUnknownDiag =
        res.evidenceAssessment.invalidObservationDiagnostics.find(
          (d) => d.rawEventId === 'BAD-OUTCOME-UNKNOWN',
        );
      expect(badUnknownDiag?.invalidFields).toEqual(['outcome']);
      expect(badUnknownDiag?.disposition).toBe('quarantined-observation');

      const badFieldsDiag =
        res.evidenceAssessment.invalidObservationDiagnostics.find(
          (d) => d.rawEventId === 'BAD-FIELDS-OBS',
        );
      expect(badFieldsDiag?.invalidFields).toEqual([
        'publisher',
        'sourceUrl',
        'observedAt',
        'weight',
      ]);

      const badMultiConflict =
        res.evidenceAssessment.invalidObservationDiagnostics.find(
          (d) => d.rawEventId === 'BAD-MULTI-LABEL-CONFLICT',
        );
      expect(badMultiConflict?.invalidFields).toEqual([
        'outcomeIndex',
        'outcomeLabel',
      ]);
      assertDeeplyFrozen(res);
    });
  });

  describe('Revision 3 — Pipeline-Wide Global Event Deduplication Across Submissions', () => {
    it('deduplicates the same real-world event across different evidenceId submissions, preserves all reporting sources, and quarantines cross-submission outcome conflicts', async () => {
      const res = await runScientificForecastPipeline(
        {
          question:
            'Will a CRISPR therapy be approved for a condition affecting 1% of adults before 2029 according to the FDA?',
          questionCategory: 'health',
          subdomain: 'clinical-and-scientific-replication-rates',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            // Submission 1: FDA registry feed
            {
              category: 'historical-observations',
              evidenceId: 'sub-fda-cder-feed',
              title: 'FDA CDER Primary Biologics Approval Feed',
              publisher: 'U.S. Food and Drug Administration',
              url: 'https://www.fda.gov/data/cder-feed-2026',
              publishedAt: '2026-05-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                observations: [
                  {
                    eventId: 'BLA-SHARED-2025-001',
                    outcome: 'success',
                    observedAt: '2025-06-10T00:00:00Z',
                    publisher: 'FDA CDER',
                    sourceUrl:
                      'https://www.fda.gov/approvals/bla-shared-2025-001',
                  },
                  {
                    eventId: 'BLA-UNIQUE-FDA-002',
                    outcome: 'failure',
                    observedAt: '2025-07-15T00:00:00Z',
                    publisher: 'FDA CDER',
                    sourceUrl: 'https://www.fda.gov/crl/bla-unique-fda-002',
                  },
                  {
                    eventId: 'BLA-CROSS-CONFLICT-004',
                    outcome: 'success',
                    observedAt: '2025-09-01T00:00:00Z',
                    publisher: 'FDA Preliminary',
                    sourceUrl: 'https://www.fda.gov/prelim/bla-004',
                  },
                ],
              },
            },
            // Submission 2: ClinicalTrials.gov / NEJM secondary registry feed
            // Reports the SAME 'BLA-SHARED-2025-001' event (with inverted successOutcomeIndex=1 & outcome='failure', which also means outcome 0 'Yes'!),
            // plus a unique event 'BLA-UNIQUE-NEJM-003',
            // plus a conflicting outcome for 'BLA-CROSS-CONFLICT-004':
            {
              category: 'historical-observations',
              evidenceId: 'sub-clinicaltrials-nejm-feed',
              title: 'ClinicalTrials.gov & NEJM Regulatory Outcome Mirror',
              publisher: 'New England Journal of Medicine',
              url: 'https://www.nejm.org/data/regulatory-mirror-2026',
              publishedAt: '2026-05-02T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 1, // inverted indexing: 1 = 'No'
                prior: { alpha: 1, beta: 1 },
                observations: [
                  {
                    eventId: 'BLA-SHARED-2025-001',
                    outcome: 'failure', // failure for index 1 ('No') == realized index 0 ('Yes') -> consistent!
                    observedAt: '2025-06-11T00:00:00Z',
                    publisher: 'NEJM Regulatory Tracker',
                    sourceUrl:
                      'https://www.nejm.org/doi/full/10.1056/bla-shared-2025-001',
                  },
                  {
                    eventId: 'BLA-UNIQUE-NEJM-003',
                    outcome: 'failure', // failure for index 1 ('No') == realized index 0 ('Yes') -> 1 success for index 0
                    observedAt: '2025-08-20T00:00:00Z',
                    publisher: 'NEJM Regulatory Tracker',
                    sourceUrl:
                      'https://www.nejm.org/doi/full/10.1056/bla-unique-nejm-003',
                  },
                  {
                    eventId: 'BLA-CROSS-CONFLICT-004',
                    outcome: 'success', // success for index 1 ('No') == realized index 1 ('No') -> conflicts with sub-1!
                    observedAt: '2025-09-02T00:00:00Z',
                    publisher: 'NEJM Regulatory Tracker',
                    sourceUrl: 'https://www.nejm.org/doi/full/10.1056/bla-004',
                  },
                ],
              },
            },
          ],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );

      // Global pool:
      // - 'BLA-SHARED-2025-001' -> counted ONCE as success (index 0)
      // - 'BLA-UNIQUE-FDA-002'  -> counted ONCE as failure (index 1)
      // - 'BLA-UNIQUE-NEJM-003' -> counted ONCE as success (index 0)
      // - 'BLA-CROSS-CONFLICT-004' -> quarantined globally (0 count)
      // Total: 2 successes, 1 failure (n = 3)
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialSuccesses,
      ).toBe(2);
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialFailures,
      ).toBe(1);
      expect(res.methodOutputs[0]!.effectiveSampleSize).toBe(3);

      // Check cross-submission deduplication diagnostic for 'BLA-SHARED-2025-001':
      const sharedDiag =
        res.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'BLA-SHARED-2025-001',
        );
      expect(sharedDiag).toBeDefined();
      expect(sharedDiag?.crossSubmissionDeduplicated).toBe(true);
      expect(sharedDiag?.contributingEvidenceIds).toEqual([
        'sub-fda-cder-feed',
        'sub-clinicaltrials-nejm-feed',
      ]);
      expect(sharedDiag?.rawReportCount).toBe(2);
      expect(sharedDiag?.deduplicatedCount).toBe(1);
      expect(sharedDiag?.status).toBe('deduplicated-consistent');
      expect(sharedDiag?.reportingSources).toHaveLength(2);

      // Check cross-submission conflict quarantine diagnostic for 'BLA-CROSS-CONFLICT-004':
      const conflictDiag =
        res.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'BLA-CROSS-CONFLICT-004',
        );
      expect(conflictDiag).toBeDefined();
      expect(conflictDiag?.crossSubmissionDeduplicated).toBe(true);
      expect(conflictDiag?.contributingEvidenceIds).toEqual([
        'sub-fda-cder-feed',
        'sub-clinicaltrials-nejm-feed',
      ]);
      expect(conflictDiag?.rawReportCount).toBe(2);
      expect(conflictDiag?.deduplicatedCount).toBe(0);
      expect(conflictDiag?.status).toBe('quarantined-conflicting-outcomes');

      // Both submission IDs are preserved on the executed method diagnostic:
      expect(res.executedMethodDiagnostics[0]?.inputProvenanceIds).toEqual([
        'sub-fda-cder-feed',
        'sub-clinicaltrials-nejm-feed',
      ]);
      assertDeeplyFrozen(res);
    });

    it('does not merge unrelated event families when local eventId strings happen to match, while deduplicating poisson-arrivals and multinomial-trials globally within their families', async () => {
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
            // Two binary-trials submissions from explicitly distinct eventFamily namespaces
            // that happen to both use local eventId 'ITEM-01':
            {
              category: 'historical-observations',
              evidenceId: 'sub-family-alpha',
              title: 'UNFCCC Bilateral Accord Cohort',
              publisher: 'UNFCCC',
              url: 'https://unfccc.int/data/family-alpha',
              publishedAt: '2026-04-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                eventFamily: 'bilateral-accord-ratifications',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                observations: [
                  {
                    eventId: 'ITEM-01',
                    outcome: 'success',
                    observedAt: '2024-06-01T00:00:00Z',
                    publisher: 'UNFCCC',
                    sourceUrl: 'https://unfccc.int/bilateral/item-01',
                  },
                ],
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'sub-family-beta',
              title: 'IMO Maritime Emission Protocol Cohort',
              publisher: 'International Maritime Organization',
              url: 'https://www.imo.org/data/family-beta',
              publishedAt: '2026-04-02T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                eventFamily: 'imo-maritime-protocols',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                observations: [
                  {
                    eventId: 'ITEM-01',
                    outcome: 'failure',
                    observedAt: '2024-09-01T00:00:00Z',
                    publisher: 'IMO',
                    sourceUrl: 'https://www.imo.org/protocols/item-01',
                  },
                ],
              },
            },
            // Two poisson-arrivals submissions sharing the same arrival event 'INC-2024-01'
            // (and also using 'ITEM-01', which must not collide with binary-trials!):
            {
              category: 'historical-observations',
              evidenceId: 'sub-poisson-feed-1',
              title: 'UN Treaty Incident Feed A',
              publisher: 'UN Treaty Monitoring',
              url: 'https://treaties.un.org/data/incidents-feed-a',
              publishedAt: '2026-04-03T00:00:00Z',
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
                    eventId: 'ITEM-01',
                    occurredAt: '2025-07-10T00:00:00Z',
                    publisher: 'UN Monitor',
                    sourceUrl: 'https://treaties.un.org/inc/item-01',
                  },
                ],
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'sub-poisson-feed-2',
              title: 'Associated Press Treaty Incident Mirror',
              publisher: 'Associated Press',
              url: 'https://apnews.com/data/incidents-feed-b',
              publishedAt: '2026-04-04T00:00:00Z',
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
                    occurredAt: '2024-05-01T02:00:00Z',
                    publisher: 'Associated Press',
                    sourceUrl: 'https://apnews.com/article/inc-2024-01',
                  },
                ],
              },
            },
          ],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );

      // Distinct binary eventFamily namespaces ('bilateral-accord-ratifications' vs 'imo-maritime-protocols')
      // are NOT merged or quarantined as conflicting despite both using eventId 'ITEM-01':
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialSuccesses,
      ).toBe(1);
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialFailures,
      ).toBe(1);

      // Poisson arrival 'INC-2024-01' across sub-poisson-feed-1 and sub-poisson-feed-2 IS deduplicated:
      // 3 raw Poisson reports -> 2 unique events ('INC-2024-01' and 'ITEM-01') over shared 10-year window:
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.poissonEventCount,
      ).toBe(2);
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.poissonExposureDuration,
      ).toBe(10);

      const poissonDedupDiag =
        res.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'INC-2024-01',
        );
      expect(poissonDedupDiag?.crossSubmissionDeduplicated).toBe(true);
      expect(poissonDedupDiag?.contributingEvidenceIds).toEqual([
        'sub-poisson-feed-1',
        'sub-poisson-feed-2',
      ]);
      expect(poissonDedupDiag?.deduplicatedCount).toBe(1);
      assertDeeplyFrozen(res);
    });

    it('deduplicates multinomial-trials across submissions and quarantines cross-submission category conflicts', async () => {
      const ternarySpace: OutcomeSpaceDescriptor = Object.freeze({
        kind: 'categorical-exhaustive',
        outcomeLabels: Object.freeze([
          'Below-Target',
          'On-Target',
          'Above-Target',
        ]),
        horizonStartsAt: '2026-06-15T12:00:00Z',
        horizonEndsAt: '2028-12-31T23:59:59Z',
        eventDefinitionHash:
          'sha256:4444444444444444444444444444444444444444444444444444444444444444',
      });

      const res = await runScientificForecastPipeline(
        {
          question:
            'Which macroeconomic inflation regime will prevail in 2028 according to the IEA?',
          questionCategory: 'economy',
          subdomain: 'multi-outcome-categorical-events',
          outcomeSpace: ternarySpace,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'historical-observations',
              evidenceId: 'sub-multi-oecd',
              title: 'OECD Regime Classification Series',
              publisher: 'OECD',
              url: 'https://stats.oecd.org/regime-series-a',
              publishedAt: '2026-04-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'multinomial-trials',
                prior: { alpha: [1, 1, 1] },
                observations: [
                  {
                    eventId: 'REGIME-2023-Q4',
                    outcomeIndex: 1,
                    observedAt: '2024-01-15T00:00:00Z',
                    publisher: 'OECD',
                    sourceUrl: 'https://stats.oecd.org/regime/2023-q4',
                  },
                  {
                    eventId: 'REGIME-2024-Q4',
                    outcomeIndex: 2,
                    observedAt: '2025-01-15T00:00:00Z',
                    publisher: 'OECD',
                    sourceUrl: 'https://stats.oecd.org/regime/2024-q4',
                  },
                ],
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'sub-multi-imf',
              title: 'IMF World Economic Outlook Regime Series',
              publisher: 'International Monetary Fund',
              url: 'https://www.imf.org/data/regime-series-b',
              publishedAt: '2026-04-02T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'multinomial-trials',
                prior: { alpha: [1, 1, 1] },
                observations: [
                  // Consistent cross-submission report for 'REGIME-2023-Q4' (via outcomeLabel 'On-Target' == index 1):
                  {
                    eventId: 'REGIME-2023-Q4',
                    outcomeLabel: 'On-Target',
                    observedAt: '2024-01-16T00:00:00Z',
                    publisher: 'IMF',
                    sourceUrl: 'https://www.imf.org/regime/2023-q4',
                  },
                  // Conflicting cross-submission report for 'REGIME-2024-Q4' (index 0 vs index 2):
                  {
                    eventId: 'REGIME-2024-Q4',
                    outcomeIndex: 0,
                    observedAt: '2025-01-16T00:00:00Z',
                    publisher: 'IMF',
                    sourceUrl: 'https://www.imf.org/regime/2024-q4',
                  },
                  // Unique event in IMF feed:
                  {
                    eventId: 'REGIME-2025-Q4',
                    outcomeIndex: 0,
                    observedAt: '2026-01-15T00:00:00Z',
                    publisher: 'IMF',
                    sourceUrl: 'https://www.imf.org/regime/2025-q4',
                  },
                ],
              },
            },
          ],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );

      // 'REGIME-2023-Q4' -> counted once in category 1 ('On-Target')
      // 'REGIME-2024-Q4' -> quarantined globally due to conflict (index 2 vs index 0)
      // 'REGIME-2025-Q4' -> counted once in category 0 ('Below-Target')
      expect(
        res.evidenceAssessment.derivedAvailableEvidence
          .multinomialOutcomeCounts,
      ).toEqual([1, 1, 0]);

      const consistentMulti =
        res.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'REGIME-2023-Q4',
        );
      expect(consistentMulti?.crossSubmissionDeduplicated).toBe(true);
      expect(consistentMulti?.deduplicatedCount).toBe(1);
      expect(consistentMulti?.status).toBe('deduplicated-consistent');

      const conflictMulti =
        res.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'REGIME-2024-Q4',
        );
      expect(conflictMulti?.crossSubmissionDeduplicated).toBe(true);
      expect(conflictMulti?.deduplicatedCount).toBe(0);
      expect(conflictMulti?.status).toBe('quarantined-conflicting-outcomes');
      assertDeeplyFrozen(res);
    });
  });
});
