import { describe, expect, it, vi } from 'vitest';
import type { OutcomeSpaceDescriptor } from './forecast-types.ts';
import {
  ASSESSED_EVIDENCE_CATEGORIES,
  EVIDENCE_COLLECTION_STATUSES,
  EVIDENCE_TRUST_TIERS,
  EVIDENCE_VERIFICATION_OUTCOMES,
  FORECAST_PIPELINE_VERSION,
  ForecastPipelineRequestError,
  MULTI_SOURCE_COMBINATION_BASES,
  PIPELINE_EXECUTION_STATUSES,
  PIPELINE_FORECAST_KINDS,
  STRUCTURAL_SYMMETRY_BASIS_KINDS,
  createTrustedCombinationVerifier,
  createTrustedEvidenceVerifier,
  createTrustedStructuralSymmetryVerifier,
  executeScientificMethod,
  runScientificForecastPipeline,
  validateStructuralSymmetryContract,
  type BinaryHistoricalObservationRecord,
  type ForecastPipelineRequest,
  type MultiSourceCombinationVerifier,
  type MultinomialHistoricalObservationRecord,
  type PoissonEventObservationRecord,
  type StatisticalIndependenceCertification,
  type StructuralSymmetryContract,
  type StructuralSymmetryVerifier,
} from './index.ts';

const REFERENCE_TIME = '2026-06-15T12:00:00Z';
const FIXED_EXECUTION_TIME = '2026-06-15T12:05:00.000Z';

const BINARY_OUTCOME_SPACE: OutcomeSpaceDescriptor = Object.freeze({
  kind: 'binary',
  outcomeLabels: Object.freeze(['Yes', 'No']),
  horizonStartsAt: '2026-06-15T12:00:00Z',
  horizonEndsAt: '2028-12-31T23:59:59Z',
  eventDefinitionHash:
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
});

const SYMMETRIC_COIN_OUTCOME_SPACE: OutcomeSpaceDescriptor = Object.freeze({
  kind: 'binary',
  outcomeLabels: Object.freeze(['Face-Alpha', 'Face-Beta']),
  horizonStartsAt: '2026-06-15T12:00:00Z',
  horizonEndsAt: '2028-12-31T23:59:59Z',
  eventDefinitionHash:
    'sha256:4444444444444444444444444444444444444444444444444444444444444444',
});

const SYMMETRIC_Z2_CONTRACT: StructuralSymmetryContract = Object.freeze({
  basisKind: 'transitive-permutation-group',
  formalInvariant: Object.freeze({
    groupName: 'Z2-label-exchange',
    invariantObservable:
      'Physical Hamiltonian and boundary conditions are invariant under relabeling outcomes 0 <-> 1.',
    derivationReference: 'audit://oracle/2026/symmetry/z2-exchange-derivation',
  }),
  generatingPermutations: Object.freeze([Object.freeze([1, 0])]),
  microstateCountsPerOutcome: Object.freeze([1, 1]),
});

const TRUSTED_VERIFIER = createTrustedEvidenceVerifier({
  verifierId: 'oracle-institutional-evidence-verifier-v1',
  verificationArtifactRef: 'audit://oracle/2026/verified-empirical-registry',
  verifySubmission: ({ submission }) => {
    const verified =
      'verifiedEmpirical' in submission && submission.verifiedEmpirical === true;
    const claimedPrimary =
      'isPrimarySourceVerified' in submission &&
      submission.isPrimarySourceVerified === true;
    return {
      verifiedEmpirical: verified,
      isPrimarySourceVerified: verified && claimedPrimary,
      rationale: verified
        ? `Authenticated test fixture '${submission.evidenceId}' via trusted empirical registry.`
        : `Rejected test fixture '${submission.evidenceId}': missing verified empirical attestation.`,
    };
  },
});

const TRUSTED_SYMMETRY_VERIFIER = createTrustedStructuralSymmetryVerifier({
  verifierId: 'oracle-institutional-symmetry-verifier-v1',
  verificationArtifactRef: 'audit://oracle/2026/verified-symmetry-registry',
  approvedDerivationReferences: [
    'audit://oracle/2026/symmetry/z2-exchange-derivation',
    'audit://oracle/2026/symmetry/c3-rotor',
  ],
});

const TRUSTED_COMBINATION_VERIFIER = createTrustedCombinationVerifier({
  verifierId: 'oracle-institutional-combination-verifier-v1',
  verificationArtifactRef: 'audit://oracle/2026/verified-combination-registry',
  verifyCombination: ({ contributingEvidenceIds, justification }) => ({
    verified:
      justification !== undefined &&
      contributingEvidenceIds.length >= 2 &&
      justification.disjointPopulationsOrWindowsVerified &&
      justification.homogeneousParameterSpaceVerified,
    rationale: `Authenticated disjoint multi-source combination [${contributingEvidenceIds.join(', ')}] via trusted combination registry.`,
  }),
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
    expect(typeof createTrustedStructuralSymmetryVerifier).toBe('function');
    expect(typeof createTrustedCombinationVerifier).toBe('function');
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

    const legacyBooleanSymmetryAbstained = await runScientificForecastPipeline({
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

    expect(legacyBooleanSymmetryAbstained.pipelineStatus).toBe(
      'honest-abstention',
    );
    expect(legacyBooleanSymmetryAbstained.forecastKind).toBe('abstained');
    expect(
      legacyBooleanSymmetryAbstained.probabilityDistribution,
    ).toBeNull();
    expect(
      legacyBooleanSymmetryAbstained.evidenceAssessment.assessmentNotes.some(
        (n) => n.includes('Rejected legacy boolean+rationale'),
      ),
    ).toBe(true);

    // Formally valid symmetry contract WITHOUT a trusted symmetryVerifier fails closed to honest-abstention:
    const unverifiedStructuralAbstained = await runScientificForecastPipeline({
      question:
        'Which symmetric coin face will show in the fair calibration draw before 2029 according to NIST?',
      questionCategory: 'science',
      subdomain: 'binary-event-occurrence',
      outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
      referenceTime: REFERENCE_TIME,
      harvestOptions: {
        providers: ['openalex'],
        fetchImpl: emptyFetch,
      },
      assumptions: {
        allowStructuralBaseline: true,
      },
      structuralSymmetryContract: SYMMETRIC_Z2_CONTRACT,
    });

    expect(unverifiedStructuralAbstained.pipelineStatus).toBe(
      'honest-abstention',
    );
    expect(unverifiedStructuralAbstained.forecastKind).toBe('abstained');
    expect(unverifiedStructuralAbstained.probabilityDistribution).toBeNull();
    expect(unverifiedStructuralAbstained.executedMethodIds).toEqual([]);
    expect(
      unverifiedStructuralAbstained.evidenceAssessment
        .structuralSymmetryVerification?.status,
    ).toBe('rejected-no-trusted-verifier');

    // With a trusted server-side symmetryVerifier, structural-uniform-baseline executes:
    const structuralOnly = await runScientificForecastPipeline(
      {
        question:
          'Which symmetric coin face will show in the fair calibration draw before 2029 according to NIST?',
        questionCategory: 'science',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: {
          providers: ['openalex'],
          fetchImpl: emptyFetch,
        },
        assumptions: {
          allowStructuralBaseline: true,
        },
        structuralSymmetryContract: SYMMETRIC_Z2_CONTRACT,
      },
      { symmetryVerifier: TRUSTED_SYMMETRY_VERIFIER },
    );

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
      structuralOnly.evidenceAssessment.structuralSymmetryVerification?.status,
    ).toBe('verified');
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
          'Which symmetric chamber will ratify the climate protocol first before 2029 according to the IPCC?',
        questionCategory: 'geopolitics',
        subdomain: 'geopolitical-or-conflict-incident-rates',
        outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        assumptions: {
          allowStructuralBaseline: true,
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
        structuralSymmetryContract: SYMMETRIC_Z2_CONTRACT,
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
      {
        evidenceVerifier: TRUSTED_VERIFIER,
        symmetryVerifier: TRUSTED_SYMMETRY_VERIFIER,
      },
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

  it('9. isolates individual method execution failures (partial-execution when another method succeeds, failed-execution when all applicable methods fail) and enforces Step C prior shape domain bounds upfront', async () => {
    await expect(
      runScientificForecastPipeline(
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
              evidenceId: 'ds-out-of-domain-poisson-upfront',
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
      ),
    ).rejects.toThrow(ForecastPipelineRequestError);

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
            evidenceId: 'ds-failing-poisson-executor-2026',
            title: 'Valid Poisson Exposure Dataset Failing At Execution',
            publisher: 'IPCC Secretariat',
            url: 'https://www.ipcc.ch/data/failing-poisson-2026',
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
          if (input.methodId === 'poisson-gamma-hazard') {
            throw new RangeError(
              'Simulated numerical instability in poisson-gamma-hazard.',
            );
          }
          return executeScientificMethod(input, reg);
        },
      },
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
            evidenceId: 'ds-failing-poisson-only',
            title: 'Valid Poisson Exposure Dataset Failing At Execution',
            publisher: 'IPCC Secretariat',
            url: 'https://www.ipcc.ch/data/failing-poisson-only-2026',
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
        methodExecutor: () => {
          throw new RangeError(
            'Simulated numerical convergence failure across all applicable methods.',
          );
        },
      },
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
      now: () => FIXED_EXECUTION_TIME,
    });
    const run2 = await runScientificForecastPipeline(validReq, {
      evidenceVerifier: TRUSTED_VERIFIER,
      now: () => FIXED_EXECUTION_TIME,
    });
    expect(run1).toEqual(run2);
    expect(run1.executedAt).toBe(FIXED_EXECUTION_TIME);
    expect(run1.executedAt).not.toBe(run1.referenceTime);
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

  describe('Revision 4 — Fail-Closed EvidenceVerifier, Primary-Source Separation & Event Allowlists', () => {
    it('fails closed when createTrustedEvidenceVerifier has neither verifySubmission nor non-empty verifiedEvidenceIds, and never sets isPrimarySourceVerified true by default', async () => {
      const bareVerifier = createTrustedEvidenceVerifier({
        verifierId: 'bare-unconfigured-verifier',
      });
      const emptyAllowlistVerifier = createTrustedEvidenceVerifier({
        verifierId: 'empty-allowlist-verifier',
        verifiedEvidenceIds: [],
      });

      const baseReq: ForecastPipelineRequest = {
        question:
          'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
        questionCategory: 'technology',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        submittedEvidence: [
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'ds-claimed-verified',
            title: 'Battery Deployment Registry',
            publisher: 'IEA',
            url: 'https://www.iea.org/data/battery-2026',
            publishedAt: '2026-04-01T00:00:00Z',
            verifiedEmpirical: true,
            isPrimarySourceVerified: true,
            dataset: {
              kind: 'binary-cohort-table',
              successes: 12,
              failures: 3,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
        ],
      };

      const bareRes = await runScientificForecastPipeline(baseReq, {
        evidenceVerifier: bareVerifier,
      });
      expect(bareRes.validatedQuantitativeEvidenceCount).toBe(0);
      expect(bareRes.pipelineStatus).toBe('honest-abstention');
      expect(bareRes.probabilityDistribution).toBeNull();
      expect(bareRes.evidenceProvenance[0]?.verificationOutcome).toBe(
        'rejected-by-trusted-verifier',
      );
      expect(bareRes.evidenceProvenance[0]?.isPrimarySourceVerified).toBe(
        false,
      );

      const emptyListRes = await runScientificForecastPipeline(baseReq, {
        evidenceVerifier: emptyAllowlistVerifier,
      });
      expect(emptyListRes.validatedQuantitativeEvidenceCount).toBe(0);
      expect(emptyListRes.pipelineStatus).toBe('honest-abstention');

      // Allowlisted verifiedEvidenceIds WITHOUT primarySourceEvidenceIds verifies empirical use only (isPrimarySourceVerified = false):
      const secondaryOnlyVerifier = createTrustedEvidenceVerifier({
        verifierId: 'allowlist-without-primary-v1',
        verifiedEvidenceIds: ['ds-claimed-verified'],
      });
      const secRes = await runScientificForecastPipeline(baseReq, {
        evidenceVerifier: secondaryOnlyVerifier,
      });
      expect(secRes.validatedQuantitativeEvidenceCount).toBe(1);
      expect(secRes.pipelineStatus).toBe('successful-empirical-forecast');
      expect(secRes.evidenceProvenance[0]?.verificationOutcome).toBe(
        'verified-by-trusted-verifier',
      );
      expect(secRes.evidenceProvenance[0]?.isPrimarySourceVerified).toBe(
        false,
      );

      // Explicit primarySourceEvidenceIds promotes isPrimarySourceVerified ONLY for explicitly listed primary IDs:
      const primaryVerifier = createTrustedEvidenceVerifier({
        verifierId: 'allowlist-with-primary-v1',
        verifiedEvidenceIds: ['ds-claimed-verified'],
        primarySourceEvidenceIds: ['ds-claimed-verified'],
      });
      const primRes = await runScientificForecastPipeline(baseReq, {
        evidenceVerifier: primaryVerifier,
      });
      expect(primRes.evidenceProvenance[0]?.isPrimarySourceVerified).toBe(true);
    });

    it('enforces verifiedEventIds allowlist on historical observations and distinguishes documentary approval vs rejection cleanly', async () => {
      const eventScopedVerifier = createTrustedEvidenceVerifier({
        verifierId: 'event-and-doc-verifier-v1',
        verifiedEvidenceIds: ['hist-scoped-trials', 'doc-verified-primary'],
        primarySourceEvidenceIds: ['doc-verified-primary'],
        verifiedEventIdsByEvidenceId: {
          'hist-scoped-trials': ['EVT-ALLOW-1', 'EVT-ALLOW-2'],
        },
      });

      const res = await runScientificForecastPipeline(
        {
          question:
            'Will a commercial orbital depot launch before 2029 according to NASA?',
          questionCategory: 'space',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'historical-observations',
              evidenceId: 'hist-scoped-trials',
              title: 'Historical Launch Registry',
              publisher: 'NASA',
              url: 'https://www.nasa.gov/launches/registry-2026',
              publishedAt: '2026-04-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                observations: [
                  {
                    eventId: 'EVT-ALLOW-1',
                    outcome: 'success',
                    observedAt: '2025-01-01T00:00:00Z',
                    publisher: 'NASA',
                    sourceUrl: 'https://www.nasa.gov/launches/evt-1',
                  },
                  {
                    eventId: 'EVT-UNVERIFIED-SPOOF',
                    outcome: 'failure',
                    observedAt: '2025-02-01T00:00:00Z',
                    publisher: 'NASA',
                    sourceUrl: 'https://www.nasa.gov/launches/evt-spoof',
                  },
                  {
                    eventId: 'EVT-ALLOW-2',
                    outcome: 'failure',
                    observedAt: '2025-03-01T00:00:00Z',
                    publisher: 'NASA',
                    sourceUrl: 'https://www.nasa.gov/launches/evt-2',
                  },
                ],
              },
            },
            {
              category: 'documentary-evidence',
              evidenceId: 'doc-verified-primary',
              title: 'NASA Official Solicitation Primary Release',
              publisher: 'NASA',
              url: 'https://www.nasa.gov/docs/solicitation-2026',
              publishedAt: '2026-04-05T00:00:00Z',
              isPrimarySourceVerified: true,
            },
            {
              category: 'documentary-evidence',
              evidenceId: 'doc-rejected-spoof',
              title: 'Unverified Blog Claiming Primary Status',
              publisher: 'Unknown Blog',
              url: 'https://example.com/blog/spoof-doc',
              publishedAt: '2026-04-06T00:00:00Z',
              isPrimarySourceVerified: true,
            },
          ],
        },
        { evidenceVerifier: eventScopedVerifier },
      );

      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialSuccesses,
      ).toBe(1);
      expect(
        res.evidenceAssessment.derivedAvailableEvidence.binaryTrialFailures,
      ).toBe(1);
      expect(
        res.evidenceAssessment.invalidObservationDiagnostics.some(
          (d) =>
            d.rawEventId === 'EVT-UNVERIFIED-SPOOF' &&
            d.disposition === 'quarantined-observation',
        ),
      ).toBe(true);

      const docApproved = res.evidenceAssessment.documentaryEvidence.find(
        (d) => d.evidenceId === 'doc-verified-primary',
      );
      expect(docApproved?.verificationOutcome).toBe(
        'verified-by-trusted-verifier',
      );
      expect(docApproved?.isPrimarySourceVerified).toBe(true);
      expect(docApproved?.usableForQuantitativeMethods).toBe(false);

      const docRejected = res.evidenceAssessment.documentaryEvidence.find(
        (d) => d.evidenceId === 'doc-rejected-spoof',
      );
      expect(docRejected?.verificationOutcome).toBe(
        'rejected-by-trusted-verifier',
      );
      expect(docRejected?.isPrimarySourceVerified).toBe(false);
    });
  });

  describe('Revision 5 — Formal StructuralSymmetryContract & Prohibition of Unverified 50/50 Baselines', () => {
    it('validates group-theoretic transitive symmetry contracts and rejects asymmetric negation pairs, non-bijections, non-transitive subgroups, and unequal microstate counts', () => {
      expect(STRUCTURAL_SYMMETRY_BASIS_KINDS).toEqual([
        'transitive-permutation-group',
        'equal-cardinality-microstate-partition',
      ]);

      // Valid Z_3 cyclic permutation group over 3 symmetric sectors:
      const threeSectorSpace: OutcomeSpaceDescriptor = {
        kind: 'categorical-exhaustive',
        outcomeLabels: ['Sector-A', 'Sector-B', 'Sector-C'],
        horizonStartsAt: '2026-06-15T12:00:00Z',
        horizonEndsAt: '2028-12-31T23:59:59Z',
        eventDefinitionHash:
          'sha256:5555555555555555555555555555555555555555555555555555555555555555',
      };
      const validZ3Contract: StructuralSymmetryContract = {
        basisKind: 'transitive-permutation-group',
        generatingPermutations: [[1, 2, 0]],
        microstateCountsPerOutcome: [4, 4, 4],
        formalInvariant: {
          groupName: 'Z3-cyclic-symmetry',
          invariantObservable:
            'Uniform phase-space Liouville measure invariant under cyclic 120-degree sector rotation.',
          derivationReference: 'audit://oracle/2026/symmetry/z3-sector-derivation',
        },
      };
      const okZ3 = validateStructuralSymmetryContract(
        validZ3Contract,
        threeSectorSpace,
      );
      expect(okZ3.valid).toBe(true);
      expect(okZ3.orbitSize).toBe(3);
      expect(okZ3.microstatesPerOutcome).toBe(4);

      // 1. Asymmetric negation / polarity binary labels (Yes/No, Breach/No-Breach, >100/<=100):
      const yesNoCheck = validateStructuralSymmetryContract(
        SYMMETRIC_Z2_CONTRACT,
        BINARY_OUTCOME_SPACE,
      );
      expect(yesNoCheck.valid).toBe(false);
      expect(
        yesNoCheck.reasons.some((r) => r.includes('asymmetric')),
      ).toBe(true);

      const thresholdSpace: OutcomeSpaceDescriptor = {
        kind: 'binary',
        outcomeLabels: ['> 5.0%', '<= 5.0%'],
        horizonStartsAt: '2026-06-15T12:00:00Z',
        horizonEndsAt: '2028-12-31T23:59:59Z',
        eventDefinitionHash:
          'sha256:6666666666666666666666666666666666666666666666666666666666666666',
      };
      expect(
        validateStructuralSymmetryContract(SYMMETRIC_Z2_CONTRACT, thresholdSpace)
          .valid,
      ).toBe(false);

      // 2. Identity-only permutation:
      expect(
        validateStructuralSymmetryContract(
          {
            ...SYMMETRIC_Z2_CONTRACT,
            generatingPermutations: [[0, 1]],
          },
          SYMMETRIC_COIN_OUTCOME_SPACE,
        ).valid,
      ).toBe(false);

      // 3. Non-bijection:
      expect(
        validateStructuralSymmetryContract(
          {
            ...SYMMETRIC_Z2_CONTRACT,
            generatingPermutations: [[0, 0]],
          },
          SYMMETRIC_COIN_OUTCOME_SPACE,
        ).valid,
      ).toBe(false);

      // 4. Non-transitive subgroup on 3 outcomes (swaps 0<->1 while fixing index 2):
      const nonTransitiveRes = validateStructuralSymmetryContract(
        {
          ...validZ3Contract,
          generatingPermutations: [[1, 0, 2]],
        },
        threeSectorSpace,
      );
      expect(nonTransitiveRes.valid).toBe(false);
      expect(nonTransitiveRes.orbitSize).toBe(2);

      // 5. Unequal microstate counts:
      expect(
        validateStructuralSymmetryContract(
          {
            ...validZ3Contract,
            microstateCountsPerOutcome: [4, 4, 3],
          },
          threeSectorSpace,
        ).valid,
      ).toBe(false);
    });

    it('enforces explicit allowStructuralBaseline decoupling, throws on invalid symmetry contracts, and respects optional StructuralSymmetryVerifier', async () => {
      const threeSectorSpace: OutcomeSpaceDescriptor = {
        kind: 'categorical-exhaustive',
        outcomeLabels: ['Sector-A', 'Sector-B', 'Sector-C'],
        horizonStartsAt: '2026-06-15T12:00:00Z',
        horizonEndsAt: '2028-12-31T23:59:59Z',
        eventDefinitionHash:
          'sha256:7777777777777777777777777777777777777777777777777777777777777777',
      };
      const validZ3Contract: StructuralSymmetryContract = {
        basisKind: 'transitive-permutation-group',
        generatingPermutations: [[1, 2, 0]],
        microstateCountsPerOutcome: [2, 2, 2],
        formalInvariant: {
          groupName: 'Z3-rotational-exchange',
          invariantObservable:
            'Uniform sector transition Hamiltonian under C_3 cyclic symmetry.',
          derivationReference: 'audit://oracle/2026/symmetry/c3-rotor',
        },
      };

      // Invalid contract on asymmetric ['Yes', 'No'] throws ForecastPipelineRequestError (never emits 50/50):
      await expect(
        runScientificForecastPipeline({
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: SYMMETRIC_Z2_CONTRACT,
        }),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // Valid symmetry contract WITHOUT allowStructuralBaseline: true -> honest-abstention:
      const withoutOptIn = await runScientificForecastPipeline({
        question:
          'Which rotational calibration sector will trigger before 2029 according to CERN?',
        questionCategory: 'science',
        outcomeSpace: threeSectorSpace,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        structuralSymmetryContract: validZ3Contract,
      });
      expect(withoutOptIn.pipelineStatus).toBe('honest-abstention');
      expect(withoutOptIn.probabilityDistribution).toBeNull();
      expect(
        withoutOptIn.evidenceAssessment.structuralSymmetryVerification?.status,
      ).toBe('rejected-baseline-not-opted-in');

      // Formally valid symmetry contract WITH allowStructuralBaseline=true but WITHOUT symmetryVerifier -> fail-closed honest-abstention:
      const withoutVerifier = await runScientificForecastPipeline({
        question:
          'Which rotational calibration sector will trigger before 2029 according to CERN?',
        questionCategory: 'science',
        outcomeSpace: threeSectorSpace,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        assumptions: { allowStructuralBaseline: true },
        structuralSymmetryContract: validZ3Contract,
      });
      expect(withoutVerifier.pipelineStatus).toBe('honest-abstention');
      expect(withoutVerifier.probabilityDistribution).toBeNull();
      expect(withoutVerifier.executedMethodIds).toEqual([]);
      expect(
        withoutVerifier.evidenceAssessment.derivedAvailableEvidence
          .availableChannels,
      ).toEqual([]);
      expect(
        withoutVerifier.evidenceAssessment.structuralSymmetryVerification
          ?.status,
      ).toBe('rejected-no-trusted-verifier');
      expect(
        withoutVerifier.missingRequirementsByMethod[
          'structural-uniform-baseline'
        ]?.some((m) => m.includes('symmetryVerifier')),
      ).toBe(true);

      // Rejecting symmetryVerifier -> honest-abstention:
      const rejectingSymVerifier: StructuralSymmetryVerifier = () => ({
        verified: false,
        verifierId: 'cern-symmetry-auditor',
        rationale:
          'Physical asymmetry detected: magnetic bias field breaks C_3 invariance.',
      });
      const rejectedByVerifier = await runScientificForecastPipeline(
        {
          question:
            'Which rotational calibration sector will trigger before 2029 according to CERN?',
          questionCategory: 'science',
          outcomeSpace: threeSectorSpace,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: validZ3Contract,
        },
        { symmetryVerifier: rejectingSymVerifier },
      );
      expect(rejectedByVerifier.pipelineStatus).toBe('honest-abstention');
      expect(rejectedByVerifier.probabilityDistribution).toBeNull();
      expect(
        rejectedByVerifier.evidenceAssessment.structuralSymmetryVerification
          ?.status,
      ).toBe('rejected-by-trusted-verifier');
      expect(
        rejectedByVerifier.evidenceAssessment.assessmentNotes.some((n) =>
          n.includes('magnetic bias field breaks C_3 invariance'),
        ),
      ).toBe(true);

      // Approving symmetryVerifier -> 1/3 uniform baseline across 3 sectors:
      const approvingSymVerifier: StructuralSymmetryVerifier = () => ({
        verified: true,
        verifierId: 'cern-symmetry-auditor',
        rationale: 'Verified C_3 rotational Hamiltonian invariance.',
      });
      const verifiedBaseline = await runScientificForecastPipeline(
        {
          question:
            'Which rotational calibration sector will trigger before 2029 according to CERN?',
          questionCategory: 'science',
          outcomeSpace: threeSectorSpace,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: validZ3Contract,
        },
        { symmetryVerifier: approvingSymVerifier },
      );
      expect(verifiedBaseline.pipelineStatus).toBe(
        'structural-baseline-forecast',
      );
      expect(verifiedBaseline.executedMethodIds).toEqual([
        'structural-uniform-baseline',
      ]);
      expect(
        verifiedBaseline.evidenceAssessment.structuralSymmetryVerification
          ?.status,
      ).toBe('verified');
      for (const out of verifiedBaseline.probabilityDistribution!) {
        expect(out.probability).toBeCloseTo(1 / 3, 14);
      }
    });
  });

  describe('Revision 6 — Certified Mathematical Bounds, Units, Parameterizations & Horizon/Weight Validation', () => {
    it('rejects out-of-domain priors/posteriors, Gamma scale parameterization, mismatched Poisson exposure units, Kish Cauchy-Schwarz violations, and invalid horizon/customWeights upfront', async () => {
      const baseBinaryReq: ForecastPipelineRequest = {
        question:
          'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
        questionCategory: 'technology',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: BINARY_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
      };

      // 1. Beta prior shape below MIN_CERTIFIED_SHAPE_PARAMETER (0.05) and posterior sum > MAX_CERTIFIED_SHAPE_PARAMETER (1e4):
      await expect(
        runScientificForecastPipeline(
          {
            ...baseBinaryReq,
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'bad-beta-shape',
                title: 'Bad Beta Shape',
                publisher: 'IEA',
                url: 'https://www.iea.org/data/bad-beta',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'binary-cohort-table',
                  successes: 5,
                  failures: 5,
                  successOutcomeIndex: 0,
                  prior: { alpha: 0.01, beta: 1 },
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      await expect(
        runScientificForecastPipeline(
          {
            ...baseBinaryReq,
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'bad-beta-post-max',
                title: 'Overflow Beta Posterior',
                publisher: 'IEA',
                url: 'https://www.iea.org/data/bad-beta-max',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'binary-cohort-table',
                  successes: 10000,
                  failures: 1,
                  successOutcomeIndex: 0,
                  prior: { alpha: 1, beta: 1 },
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 2. Gamma scale parameter rejection & mismatched exposureUnit rejection:
      await expect(
        runScientificForecastPipeline(
          {
            ...baseBinaryReq,
            subdomain: 'rare-event-arrival-hazards',
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'bad-gamma-scale',
                title: 'Gamma Scale Rejected',
                publisher: 'IEA',
                url: 'https://www.iea.org/data/bad-gamma-scale',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'poisson-exposure-table',
                  eventCount: 2,
                  exposureDuration: 5,
                  exposureUnit: 'years',
                  forecastExposureDuration: 2,
                  forecastExposureUnit: 'years',
                  eventOutcomeIndex: 0,
                  prior: { shape: 1, rate: 1, scale: 1 } as unknown as {
                    shape: number;
                    rate: number;
                  },
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      await expect(
        runScientificForecastPipeline(
          {
            ...baseBinaryReq,
            subdomain: 'rare-event-arrival-hazards',
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'bad-poisson-units',
                title: 'Poisson Mismatched Units',
                publisher: 'IEA',
                url: 'https://www.iea.org/data/bad-units',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'poisson-exposure-table',
                  eventCount: 2,
                  exposureDuration: 5,
                  exposureUnit: 'years',
                  forecastExposureDuration: 24,
                  forecastExposureUnit: 'months',
                  eventOutcomeIndex: 0,
                  prior: { shape: 1, rate: 1 },
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 3. Kish Cauchy-Schwarz violation (n_eff > N):
      await expect(
        runScientificForecastPipeline(
          {
            ...baseBinaryReq,
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'bad-kish-bounds',
                title: 'Violated Kish Cauchy-Schwarz',
                publisher: 'IEA',
                url: 'https://www.iea.org/data/bad-kish',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'weighted-binary-cohort-table',
                  weightedSuccessMass: 5,
                  weightedFailureMass: 5,
                  sumSquaredWeights: 1, // totalW^2 / sumSq = 100 > observationCount = 5
                  observationCount: 5,
                  successOutcomeIndex: 0,
                  prior: { alpha: 1, beta: 1 },
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 4. Invalid horizon (endsAt <= startsAt) and invalid customWeightsByMethod:
      await expect(
        runScientificForecastPipeline({
          ...baseBinaryReq,
          horizon: {
            startsAt: '2028-12-31T23:59:59Z',
            endsAt: '2026-06-15T12:00:00Z',
          },
        }),
      ).rejects.toThrow(ForecastPipelineRequestError);

      await expect(
        runScientificForecastPipeline({
          ...baseBinaryReq,
          customWeightsByMethod: {
            'structural-uniform-baseline': 1,
          } as unknown as Record<string, number>,
        }),
      ).rejects.toThrow(ForecastPipelineRequestError);

      await expect(
        runScientificForecastPipeline({
          ...baseBinaryReq,
          customWeightsByMethod: {
            'beta-binomial-conjugate': 0.5,
            'poisson-gamma-hazard': 0.4,
          },
        }),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 5. Partial execution renormalizes customWeightsByMethod strictly when keys match original applicable methods:
      const partialWeighted = await runScientificForecastPipeline(
        {
          ...baseBinaryReq,
          subdomain: 'geopolitical-or-conflict-incident-rates',
          customWeightsByMethod: {
            'beta-binomial-conjugate': 0.3,
            'poisson-gamma-hazard': 0.7,
          },
          submittedEvidence: [
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-ok-beta-renorm',
              title: 'Valid Beta Cohort',
              publisher: 'IEA',
              url: 'https://www.iea.org/data/ok-beta-renorm',
              publishedAt: '2026-04-01T00:00:00Z',
              verifiedEmpirical: true,
              dataset: {
                kind: 'binary-cohort-table',
                successes: 7,
                failures: 3,
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
              },
            },
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-fail-poisson-renorm',
              title: 'Failing Poisson Cohort',
              publisher: 'IEA',
              url: 'https://www.iea.org/data/fail-poisson-renorm',
              publishedAt: '2026-04-01T00:00:00Z',
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
            if (input.methodId === 'poisson-gamma-hazard') {
              throw new Error('Simulated executor outage');
            }
            return executeScientificMethod(input, reg);
          },
        },
      );
      expect(partialWeighted.pipelineStatus).toBe('partial-execution');
      expect(partialWeighted.executedMethodIds).toEqual([
        'beta-binomial-conjugate',
      ]);
      expect(
        partialWeighted.synthesisResult?.contrastReport.weightsByMethod[
          'beta-binomial-conjugate'
        ],
      ).toBeCloseTo(1, 14);
    });
  });

  describe('Revision 7 — Multi-Source Provenance Preservation, Silent Overwrite Prevention & Conflict Quarantine', () => {
    it('forbids silent overwrites across multiple verified quantitative sources, combines disjoint cohorts only with valid MultiSourceCombinationJustification, and preserves all source provenance IDs and URLs', async () => {
      expect(MULTI_SOURCE_COMBINATION_BASES).toEqual([
        'disjoint-exchangeable-cohorts',
        'disjoint-poisson-exposure-windows',
        'disjoint-exogenous-weighted-cohorts',
      ]);

      const twoCohortEvidence: ForecastPipelineRequest['submittedEvidence'] = [
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'cohort-eu-2026',
          title: 'EU Grid Storage Deployment Cohort',
          publisher: 'Eurostat',
          url: 'https://ec.europa.eu/eurostat/battery-2026',
          publishedAt: '2026-03-01T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 6,
            failures: 4,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
        {
          category: 'structured-numerical-dataset',
          evidenceId: 'cohort-us-2026',
          title: 'US EIA Grid Storage Deployment Cohort',
          publisher: 'U.S. EIA',
          url: 'https://www.eia.gov/electricity/battery-2026',
          publishedAt: '2026-03-15T00:00:00Z',
          verifiedEmpirical: true,
          dataset: {
            kind: 'binary-cohort-table',
            successes: 4,
            failures: 6,
            successOutcomeIndex: 0,
            prior: { alpha: 1, beta: 1 },
          },
        },
      ];

      // 1. Duplicate evidenceId with conflicting payloads throws ForecastPipelineRequestError:
      await expect(
        runScientificForecastPipeline(
          {
            question:
              'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
            questionCategory: 'technology',
            subdomain: 'binary-event-occurrence',
            outcomeSpace: BINARY_OUTCOME_SPACE,
            referenceTime: REFERENCE_TIME,
            harvestOptions: { skipRemoteHarvest: true },
            submittedEvidence: [
              twoCohortEvidence[0]!,
              {
                ...twoCohortEvidence[1]!,
                evidenceId: 'cohort-eu-2026',
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 2. Two distinct sources for beta-binomial-conjugate WITHOUT MultiSourceCombinationJustification -> fail-closed rejection preserving both sources:
      const missingJustRes = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: twoCohortEvidence,
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );
      expect(missingJustRes.pipelineStatus).toBe('honest-abstention');
      expect(missingJustRes.probabilityDistribution).toBeNull();
      expect(missingJustRes.executedMethodIds).toEqual([]);
      expect(
        missingJustRes.evidenceAssessment.structuredNumericalDatasets.map(
          (r) => r.evidenceId,
        ),
      ).toEqual(['cohort-eu-2026', 'cohort-us-2026']);
      expect(
        missingJustRes.evidenceAssessment.rejectedMultiSourceCombinations[0]
          ?.rejectionCode,
      ).toBe('missing-combination-justification');

      // 2b. Caller-declared valid MultiSourceCombinationJustification WITHOUT combinationVerifier -> fail-closed rejection preserving both sources:
      const noCombVerifierRes = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: twoCohortEvidence,
          multiSourceCombinationJustifications: {
            'beta-binomial-conjugate': {
              basis: 'disjoint-exchangeable-cohorts',
              contributingEvidenceIds: ['cohort-eu-2026', 'cohort-us-2026'],
              disjointPopulationsOrWindowsVerified: true,
              homogeneousParameterSpaceVerified: true,
              mathematicalRationale:
                'Caller falsely asserting disjointness without trusted server verification.',
            },
          },
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );
      expect(noCombVerifierRes.pipelineStatus).toBe('honest-abstention');
      expect(noCombVerifierRes.probabilityDistribution).toBeNull();
      expect(
        noCombVerifierRes.evidenceAssessment.structuredNumericalDatasets.map(
          (r) => r.url,
        ),
      ).toEqual([
        'https://ec.europa.eu/eurostat/battery-2026',
        'https://www.eia.gov/electricity/battery-2026',
      ]);
      expect(
        noCombVerifierRes.evidenceAssessment.rejectedMultiSourceCombinations[0]
          ?.rejectionCode,
      ).toBe('missing-trusted-combination-verifier');

      // 3. With valid MultiSourceCombinationJustification AND trusted combinationVerifier -> combines cleanly & preserves all provenance:
      const combinedRes = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: twoCohortEvidence,
          multiSourceCombinationJustifications: {
            'beta-binomial-conjugate': {
              basis: 'disjoint-exchangeable-cohorts',
              contributingEvidenceIds: ['cohort-eu-2026', 'cohort-us-2026'],
              disjointPopulationsOrWindowsVerified: true,
              homogeneousParameterSpaceVerified: true,
              mathematicalRationale:
                'EU Eurostat and US EIA national installation cohorts are geographically disjoint with exchangeable Beta-Binomial success rate.',
            },
          },
        },
        {
          evidenceVerifier: TRUSTED_VERIFIER,
          combinationVerifier: TRUSTED_COMBINATION_VERIFIER,
        },
      );

      expect(combinedRes.pipelineStatus).toBe('successful-empirical-forecast');
      // Combined: 6+4 = 10 successes, 4+6 = 10 failures -> (10+1)/(20+2) = 0.5
      expect(combinedRes.probabilityDistribution![0]!.probability).toBeCloseTo(
        11 / 22,
        14,
      );
      expect(combinedRes.executedMethodDiagnostics[0]?.inputProvenanceIds).toEqual(
        ['cohort-eu-2026', 'cohort-us-2026'],
      );
      expect(combinedRes.executedMethodDiagnostics[0]?.inputSourceUrls).toEqual([
        'https://ec.europa.eu/eurostat/battery-2026',
        'https://www.eia.gov/electricity/battery-2026',
      ]);
      expect(combinedRes.evidenceAssessment.multiSourceCombinations).toHaveLength(
        1,
      );
      expect(
        combinedRes.evidenceAssessment.multiSourceCombinations[0]
          ?.dependencePreserved,
      ).toBe(true);
      expect(
        combinedRes.evidenceAssessment.multiSourceCombinations[0]
          ?.combinationBasis,
      ).toBe('disjoint-exchangeable-cohorts');
      expect(
        combinedRes.evidenceAssessment.multiSourceCombinations[0]
          ?.verifiedByVerifierId,
      ).toBe('oracle-institutional-combination-verifier-v1');
      assertDeeplyFrozen(combinedRes);

      // 4. Multiple continuous-state-trajectory-table submissions never silently overwrite:
      const barrierSpace: OutcomeSpaceDescriptor = {
        kind: 'first-passage-before-horizon',
        outcomeLabels: ['Barrier-Breached', 'No-Breach'],
        horizonStartsAt: '2026-06-15T12:00:00Z',
        horizonEndsAt: '2028-12-31T23:59:59Z',
        eventDefinitionHash:
          'sha256:8888888888888888888888888888888888888888888888888888888888888888',
        barrierLevel: 435,
        barrierDirection: 'up-and-in',
      };
      await expect(
        runScientificForecastPipeline(
          {
            question:
              'Will atmospheric CO2 at Mauna Loa breach 435 ppm before 2029 according to NOAA?',
            questionCategory: 'climate',
            subdomain: 'climate-anomaly-threshold-exceedance',
            outcomeSpace: barrierSpace,
            referenceTime: REFERENCE_TIME,
            harvestOptions: { skipRemoteHarvest: true },
            submittedEvidence: [
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'cont-1',
                title: 'Trajectory Series A',
                publisher: 'NOAA',
                url: 'https://gml.noaa.gov/data/a',
                publishedAt: '2026-04-01T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'continuous-state-trajectory-table',
                  observationCount: 100,
                  estimatedDrift: 2.2,
                  estimatedScaleOrVolatility: 0.8,
                  initialStateLevel: 425,
                },
              },
              {
                category: 'structured-numerical-dataset',
                evidenceId: 'cont-2',
                title: 'Trajectory Series B',
                publisher: 'NOAA',
                url: 'https://gml.noaa.gov/data/b',
                publishedAt: '2026-04-02T00:00:00Z',
                verifiedEmpirical: true,
                dataset: {
                  kind: 'continuous-state-trajectory-table',
                  observationCount: 120,
                  estimatedDrift: 2.6,
                  estimatedScaleOrVolatility: 1.0,
                  initialStateLevel: 426,
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // 5. Conflicting binary-trials weights quarantine globally and conflicting Poisson window durations throw:
      const weightConflictRes = await runScientificForecastPipeline(
        {
          question:
            'Will a CRISPR therapy be approved before 2029 according to the FDA?',
          questionCategory: 'health',
          subdomain: 'clinical-and-scientific-replication-rates',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'historical-observations',
              evidenceId: 'weighted-feed-1',
              title: 'Weighted Trials Feed 1',
              publisher: 'FDA',
              url: 'https://www.fda.gov/trials/feed-1',
              publishedAt: '2026-04-01T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                enableWeightedKishChannel: true,
                observations: [
                  {
                    eventId: 'TRIAL-CONFLICT-W',
                    outcome: 'success',
                    weight: 1.0,
                    observedAt: '2025-01-01T00:00:00Z',
                    publisher: 'FDA',
                    sourceUrl: 'https://www.fda.gov/trials/w1',
                  },
                  {
                    eventId: 'TRIAL-CLEAN-1',
                    outcome: 'failure',
                    weight: 1.0,
                    observedAt: '2025-02-01T00:00:00Z',
                    publisher: 'FDA',
                    sourceUrl: 'https://www.fda.gov/trials/c1',
                  },
                ],
              },
            },
            {
              category: 'historical-observations',
              evidenceId: 'weighted-feed-2',
              title: 'Weighted Trials Feed 2',
              publisher: 'EMA',
              url: 'https://www.ema.europa.eu/trials/feed-2',
              publishedAt: '2026-04-02T00:00:00Z',
              verifiedEmpirical: true,
              observationSchema: {
                kind: 'binary-trials',
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
                enableWeightedKishChannel: true,
                observations: [
                  {
                    eventId: 'TRIAL-CONFLICT-W',
                    outcome: 'success',
                    weight: 3.5, // Conflicting weight for identical canonical event!
                    observedAt: '2025-01-02T00:00:00Z',
                    publisher: 'EMA',
                    sourceUrl: 'https://www.ema.europa.eu/trials/w2',
                  },
                  {
                    eventId: 'TRIAL-CLEAN-2',
                    outcome: 'success',
                    weight: 1.0,
                    observedAt: '2025-03-01T00:00:00Z',
                    publisher: 'EMA',
                    sourceUrl: 'https://www.ema.europa.eu/trials/c2',
                  },
                ],
              },
            },
          ],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );

      expect(
        weightConflictRes.evidenceAssessment.deduplicatedEventDiagnostics.find(
          (d) => d.eventId === 'TRIAL-CONFLICT-W',
        )?.status,
      ).toBe('quarantined-conflicting-outcomes');
      // Only TRIAL-CLEAN-1 (failure) and TRIAL-CLEAN-2 (success) survive:
      expect(
        weightConflictRes.evidenceAssessment.derivedAvailableEvidence
          .binaryTrialSuccesses,
      ).toBe(1);
      expect(
        weightConflictRes.evidenceAssessment.derivedAvailableEvidence
          .binaryTrialFailures,
      ).toBe(1);

      // 6. Conflicting Poisson exposure durations under identical exposureWindowId throw ForecastPipelineRequestError,
      // while disjoint exposureWindowIds combine ONLY when justified with 'disjoint-poisson-exposure-windows':
      const poissonWinEu = {
        category: 'historical-observations' as const,
        evidenceId: 'poisson-win-eu',
        title: 'EU Station Hazard Window 2016-2020',
        publisher: 'EU Safety Agency',
        url: 'https://safety.europa.eu/poisson-2016-2020',
        publishedAt: '2026-04-01T00:00:00Z',
        verifiedEmpirical: true,
        observationSchema: {
          kind: 'poisson-arrivals' as const,
          eventOutcomeIndex: 0 as const,
          historicalExposure: {
            exposureDuration: 5,
            exposureUnit: 'years',
            exposureWindowId: 'window-eu-2016-2020',
          },
          forecastExposure: { exposureDuration: 2, exposureUnit: 'years' },
          prior: { shape: 1, rate: 1 },
          events: [
            {
              eventId: 'HZ-EU-1',
              occurredAt: '2018-06-01T00:00:00Z',
              publisher: 'EU Safety Agency',
              sourceUrl: 'https://safety.europa.eu/hz-1',
            },
          ],
        },
      };
      const poissonWinJp = {
        category: 'historical-observations' as const,
        evidenceId: 'poisson-win-jp',
        title: 'Japan Station Hazard Window 2021-2025',
        publisher: 'Japan Safety Agency',
        url: 'https://safety.go.jp/poisson-2021-2025',
        publishedAt: '2026-04-02T00:00:00Z',
        verifiedEmpirical: true,
        observationSchema: {
          kind: 'poisson-arrivals' as const,
          eventOutcomeIndex: 0 as const,
          historicalExposure: {
            exposureDuration: 5,
            exposureUnit: 'years',
            exposureWindowId: 'window-jp-2021-2025',
          },
          forecastExposure: { exposureDuration: 2, exposureUnit: 'years' },
          prior: { shape: 1, rate: 1 },
          events: [
            {
              eventId: 'HZ-JP-1',
              occurredAt: '2023-06-01T00:00:00Z',
              publisher: 'Japan Safety Agency',
              sourceUrl: 'https://safety.go.jp/hz-1',
            },
          ],
        },
      };

      // Without justification -> fail-closed rejection preserving both historical sources:
      const poissonNoJust = await runScientificForecastPipeline(
        {
          question:
            'Will a station hazard occur before 2029 according to the IAEA?',
          questionCategory: 'technology',
          subdomain: 'rare-event-arrival-hazards',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [poissonWinEu, poissonWinJp],
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );
      expect(poissonNoJust.pipelineStatus).toBe('honest-abstention');
      expect(poissonNoJust.probabilityDistribution).toBeNull();
      expect(
        poissonNoJust.evidenceAssessment.historicalObservations.map(
          (r) => r.evidenceId,
        ),
      ).toEqual(['poisson-win-eu', 'poisson-win-jp']);
      expect(
        poissonNoJust.evidenceAssessment.rejectedMultiSourceCombinations[0]
          ?.rejectionCode,
      ).toBe('missing-combination-justification');

      // Falsely declared valid disjoint justification WITHOUT combinationVerifier -> fail-closed rejection preserving both sources:
      const poissonNoVerifier = await runScientificForecastPipeline(
        {
          question:
            'Will a station hazard occur before 2029 according to the IAEA?',
          questionCategory: 'technology',
          subdomain: 'rare-event-arrival-hazards',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [poissonWinEu, poissonWinJp],
          multiSourceCombinationJustifications: {
            'poisson-gamma-hazard': {
              basis: 'disjoint-poisson-exposure-windows',
              contributingEvidenceIds: ['poisson-win-eu', 'poisson-win-jp'],
              disjointPopulationsOrWindowsVerified: true,
              homogeneousParameterSpaceVerified: true,
              mathematicalRationale:
                'Caller claiming non-overlapping windows without trusted server verifier.',
            },
          },
        },
        { evidenceVerifier: TRUSTED_VERIFIER },
      );
      expect(poissonNoVerifier.pipelineStatus).toBe('honest-abstention');
      expect(poissonNoVerifier.probabilityDistribution).toBeNull();
      expect(
        poissonNoVerifier.evidenceAssessment.historicalObservations.map(
          (r) => r.evidenceId,
        ),
      ).toEqual(['poisson-win-eu', 'poisson-win-jp']);
      expect(
        poissonNoVerifier.evidenceAssessment.rejectedMultiSourceCombinations[0]
          ?.rejectionCode,
      ).toBe('missing-trusted-combination-verifier');

      // Identical exposureWindowId with conflicting durations -> throws:
      await expect(
        runScientificForecastPipeline(
          {
            question:
              'Will a station hazard occur before 2029 according to the IAEA?',
            questionCategory: 'technology',
            subdomain: 'rare-event-arrival-hazards',
            outcomeSpace: BINARY_OUTCOME_SPACE,
            referenceTime: REFERENCE_TIME,
            harvestOptions: { skipRemoteHarvest: true },
            submittedEvidence: [
              poissonWinEu,
              {
                ...poissonWinJp,
                observationSchema: {
                  ...poissonWinJp.observationSchema,
                  historicalExposure: {
                    exposureDuration: 8,
                    exposureUnit: 'years',
                    exposureWindowId: 'window-eu-2016-2020',
                  },
                  events: [],
                },
              },
            ],
          },
          { evidenceVerifier: TRUSTED_VERIFIER },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);

      // With valid 'disjoint-poisson-exposure-windows' justification AND trusted combinationVerifier -> sums exposure (5+5=10) and events (1+1=2):
      const combinedPoissonRes = await runScientificForecastPipeline(
        {
          question:
            'Will a station hazard occur before 2029 according to the IAEA?',
          questionCategory: 'technology',
          subdomain: 'rare-event-arrival-hazards',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [poissonWinEu, poissonWinJp],
          multiSourceCombinationJustifications: {
            'poisson-gamma-hazard': {
              basis: 'disjoint-poisson-exposure-windows',
              contributingEvidenceIds: ['poisson-win-eu', 'poisson-win-jp'],
              disjointPopulationsOrWindowsVerified: true,
              homogeneousParameterSpaceVerified: true,
              mathematicalRationale:
                'Non-overlapping EU (2016-2020) and JP (2021-2025) hazard windows share homogeneous Poisson hazard rate.',
            },
          },
        },
        {
          evidenceVerifier: TRUSTED_VERIFIER,
          combinationVerifier: TRUSTED_COMBINATION_VERIFIER,
        },
      );
      expect(
        combinedPoissonRes.evidenceAssessment.derivedAvailableEvidence
          .poissonEventCount,
      ).toBe(2);
      expect(
        combinedPoissonRes.evidenceAssessment.derivedAvailableEvidence
          .poissonExposureDuration,
      ).toBe(10);
      expect(
        combinedPoissonRes.evidenceAssessment.multiSourceCombinations[0]
          ?.combinationBasis,
      ).toBe('disjoint-poisson-exposure-windows');
      expect(
        combinedPoissonRes.evidenceAssessment.multiSourceCombinations[0]
          ?.verifiedByVerifierId,
      ).toBe('oracle-institutional-combination-verifier-v1');
      assertDeeplyFrozen(combinedPoissonRes);
    });
  });

  describe('Revision 8 — Separation of Execution Timestamp (executedAt) and Reference Valuation Time (referenceTime)', () => {
    it('uses dependencies.now() for executedAt independently from historical referenceTime, while preserving strict referenceTime <= leakage gating', async () => {
      const historicalReference = '2025-06-01T00:00:00Z';
      const actualRunTimestamp = '2026-11-27T09:15:30.000Z';

      const res = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: {
            kind: 'binary',
            outcomeLabels: ['Yes', 'No'],
            horizonStartsAt: '2025-06-01T00:00:00Z',
            horizonEndsAt: '2028-12-31T23:59:59Z',
            eventDefinitionHash:
              'sha256:9999999999999999999999999999999999999999999999999999999999999999',
          },
          referenceTime: historicalReference,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: [
            {
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-pre-reference-2025',
              title: 'Historical Pre-Reference Cohort',
              publisher: 'IEA',
              url: 'https://www.iea.org/data/pre-ref-2025',
              publishedAt: '2025-05-01T00:00:00Z',
              verifiedEmpirical: true,
              dataset: {
                kind: 'binary-cohort-table',
                successes: 8,
                failures: 4,
                successOutcomeIndex: 0,
                prior: { alpha: 1, beta: 1 },
              },
            },
            {
              // Published AFTER historical referenceTime (2025-06-01) but BEFORE actual execution time (2026-11-27):
              // Must STILL be quarantined against look-ahead bias relative to referenceTime!
              category: 'structured-numerical-dataset',
              evidenceId: 'ds-lookahead-leakage-2026',
              title: 'Post-Reference Lookahead Leakage Dataset',
              publisher: 'IEA',
              url: 'https://www.iea.org/data/lookahead-2026',
              publishedAt: '2026-01-15T00:00:00Z',
              verifiedEmpirical: true,
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
        {
          evidenceVerifier: TRUSTED_VERIFIER,
          now: () => actualRunTimestamp,
        },
      );

      expect(res.referenceTime).toBe(historicalReference);
      expect(res.executedAt).toBe(actualRunTimestamp);
      expect(res.harvestResult.referenceTime).toBe(historicalReference);
      expect(res.harvestResult.executedAt).toBe(actualRunTimestamp);
      expect(res.evidenceProvenance[0]?.retrievedAt).toBe(actualRunTimestamp);
      // Only ds-pre-reference-2025 is valid; ds-lookahead-leakage-2026 is quarantined:
      expect(res.validatedQuantitativeEvidenceCount).toBe(1);
      expect(res.probabilityDistribution![0]!.probability).toBeCloseTo(
        9 / 14,
        14,
      );
      const leakedRec = res.evidenceProvenance.find(
        (r) => r.evidenceId === 'ds-lookahead-leakage-2026',
      );
      expect(leakedRec?.usableForQuantitativeMethods).toBe(false);
      expect(leakedRec?.verificationOutcome).toBe(
        'rejected-integrity-or-schema-gate',
      );

      await expect(
        runScientificForecastPipeline(
          {
            question:
              'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
            questionCategory: 'technology',
            referenceTime: historicalReference,
            harvestOptions: { skipRemoteHarvest: true },
          },
          { now: () => 'not-a-valid-iso-timestamp' },
        ),
      ).rejects.toThrow(ForecastPipelineRequestError);
    });
  });

  describe('Audit Hardening — Fail-Closed Server-Side Symmetry & Combination Verifiers', () => {
    it('never enables structural-uniform-baseline from caller formalInvariant/derivationReference/permutations/microstateCounts without an approving trusted symmetryVerifier', async () => {
      const selfCertifiedContract: StructuralSymmetryContract = {
        basisKind: 'transitive-permutation-group',
        formalInvariant: {
          groupName: 'Z2-label-exchange',
          invariantObservable:
            'Caller claims Hamiltonian is invariant under 0 <-> 1 exchange.',
          derivationReference:
            'audit://caller-self-asserted/not-in-trusted-allowlist',
        },
        generatingPermutations: [[1, 0]],
        microstateCountsPerOutcome: [1, 1],
      };

      // 1. No symmetryVerifier -> honest abstention with clear rejection diagnostic:
      const unconfigured = await runScientificForecastPipeline({
        question:
          'Which symmetric coin face will show in the calibration run before 2029 according to NIST?',
        questionCategory: 'science',
        subdomain: 'binary-event-occurrence',
        outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
        referenceTime: REFERENCE_TIME,
        harvestOptions: { skipRemoteHarvest: true },
        assumptions: { allowStructuralBaseline: true },
        structuralSymmetryContract: selfCertifiedContract,
      });

      expect(unconfigured.pipelineStatus).toBe('honest-abstention');
      expect(unconfigured.forecastKind).toBe('abstained');
      expect(unconfigured.probabilityDistribution).toBeNull();
      expect(unconfigured.executedMethodIds).toEqual([]);
      expect(
        unconfigured.evidenceAssessment.structuralSymmetryVerification?.status,
      ).toBe('rejected-no-trusted-verifier');
      expect(
        unconfigured.evidenceAssessment.assessmentNotes.some((n) =>
          n.includes('no trusted server-side symmetryVerifier'),
        ),
      ).toBe(true);

      // 2. Empty trusted factory (neither allowlist nor callback) fails closed:
      const emptySymVerifier = createTrustedStructuralSymmetryVerifier({
        verifierId: 'empty-sym-verifier',
      });
      const rejectedEmpty = await runScientificForecastPipeline(
        {
          question:
            'Which symmetric coin face will show in the calibration run before 2029 according to NIST?',
          questionCategory: 'science',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: selfCertifiedContract,
        },
        { symmetryVerifier: emptySymVerifier },
      );
      expect(rejectedEmpty.pipelineStatus).toBe('honest-abstention');
      expect(
        rejectedEmpty.evidenceAssessment.structuralSymmetryVerification
          ?.status,
      ).toBe('rejected-by-trusted-verifier');

      // 3. Trusted verifier allowlist rejects caller self-asserted derivationReference:
      const rejectedUnallowlisted = await runScientificForecastPipeline(
        {
          question:
            'Which symmetric coin face will show in the calibration run before 2029 according to NIST?',
          questionCategory: 'science',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: selfCertifiedContract,
        },
        { symmetryVerifier: TRUSTED_SYMMETRY_VERIFIER },
      );
      expect(rejectedUnallowlisted.pipelineStatus).toBe('honest-abstention');
      expect(rejectedUnallowlisted.probabilityDistribution).toBeNull();
      expect(
        rejectedUnallowlisted.evidenceAssessment.structuralSymmetryVerification
          ?.verifierId,
      ).toBe('oracle-institutional-symmetry-verifier-v1');

      // 4. Trusted verifier approves allowlisted contract & event hash -> baseline executes:
      const hashPinnedSymVerifier = createTrustedStructuralSymmetryVerifier({
        verifierId: 'nist-symmetry-audit-v2',
        verificationArtifactRef: 'audit://nist/2026/symmetry-cert-01',
        approvedDerivationReferences: [
          SYMMETRIC_Z2_CONTRACT.formalInvariant.derivationReference,
        ],
        approvedEventDefinitionHashes: [
          SYMMETRIC_COIN_OUTCOME_SPACE.eventDefinitionHash,
        ],
      });
      const approved = await runScientificForecastPipeline(
        {
          question:
            'Which symmetric coin face will show in the calibration run before 2029 according to NIST?',
          questionCategory: 'science',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: SYMMETRIC_COIN_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          assumptions: { allowStructuralBaseline: true },
          structuralSymmetryContract: SYMMETRIC_Z2_CONTRACT,
        },
        { symmetryVerifier: hashPinnedSymVerifier },
      );
      expect(approved.pipelineStatus).toBe('structural-baseline-forecast');
      expect(approved.executedMethodIds).toEqual([
        'structural-uniform-baseline',
      ]);
      expect(
        approved.evidenceAssessment.structuralSymmetryVerification?.status,
      ).toBe('verified');
      expect(
        approved.evidenceAssessment.structuralSymmetryVerification
          ?.verificationArtifactRef,
      ).toBe('audit://nist/2026/symmetry-cert-01');
      assertDeeplyFrozen(approved);
    });

    it('rejects falsely declared valid MultiSourceCombinationJustification without trusted server verification, isolates unverified combinations cleanly, and preserves all individual sources and provenances', async () => {
      // 1. Overlapping/unverified cohorts where caller falsely certifies all boolean flags and rationale:
      const cohortsPlusIndependentPoisson: ForecastPipelineRequest['submittedEvidence'] =
        [
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'beta-cohort-overlap-a',
            title: 'Regional Grid Storage Survey A',
            publisher: 'Source Agency A',
            url: 'https://agency-a.example.org/grid-2026',
            publishedAt: '2026-03-01T00:00:00Z',
            verifiedEmpirical: true,
            dataset: {
              kind: 'binary-cohort-table',
              successes: 8,
              failures: 2,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'beta-cohort-overlap-b',
            title: 'Regional Grid Storage Survey B',
            publisher: 'Source Agency B',
            url: 'https://agency-b.example.org/grid-2026',
            publishedAt: '2026-03-05T00:00:00Z',
            verifiedEmpirical: true,
            dataset: {
              kind: 'binary-cohort-table',
              successes: 5,
              failures: 5,
              successOutcomeIndex: 0,
              prior: { alpha: 1, beta: 1 },
            },
          },
          {
            category: 'structured-numerical-dataset',
            evidenceId: 'poisson-independent-single',
            title: 'Independent High-Voltage Substation Telemetry',
            publisher: 'Grid Reliability Council',
            url: 'https://grc.example.org/substation-hazard-2026',
            publishedAt: '2026-03-10T00:00:00Z',
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
        ];

      // Server allowlist strictly permits a different cohort pair, NOT overlap-a + overlap-b:
      const strictServerCombVerifier: MultiSourceCombinationVerifier =
        createTrustedCombinationVerifier({
          verifierId: 'oracle-audit-combination-gate-v2',
          verificationArtifactRef:
            'audit://oracle/2026/disjoint-cohort-allowlist',
          approvedMethodCombinations: {
            'beta-binomial-conjugate': [['approved-cohort-1', 'approved-cohort-2']],
          },
        });

      const rejectedComboWithIsolatedPoisson =
        await runScientificForecastPipeline(
          {
            question:
              'Will regional grid capacity exceed 1,200 GW before 2029 according to the IEA?',
            questionCategory: 'technology',
            subdomain: 'geopolitical-or-conflict-incident-rates',
            outcomeSpace: BINARY_OUTCOME_SPACE,
            referenceTime: REFERENCE_TIME,
            harvestOptions: { skipRemoteHarvest: true },
            assumptions: {
              verifiedAssumptions: [
                'conditionally-independent-poisson-increments',
                'homogeneous-or-known-exposure-intensity',
              ],
            },
            submittedEvidence: cohortsPlusIndependentPoisson,
            multiSourceCombinationJustifications: {
              'beta-binomial-conjugate': {
                basis: 'disjoint-exchangeable-cohorts',
                contributingEvidenceIds: [
                  'beta-cohort-overlap-a',
                  'beta-cohort-overlap-b',
                ],
                disjointPopulationsOrWindowsVerified: true,
                homogeneousParameterSpaceVerified: true,
                mathematicalRationale:
                  'False caller claim: these two surveys actually sample overlapping utilities.',
              },
            },
          },
          {
            evidenceVerifier: TRUSTED_VERIFIER,
            combinationVerifier: strictServerCombVerifier,
          },
        );

      // Beta combination MUST be rejected without throwing or corrupting planMethodApplicability,
      // while independent single-source Poisson executes cleanly AND all 3 provenances remain intact:
      expect(rejectedComboWithIsolatedPoisson.executedMethodIds).toEqual([
        'poisson-gamma-hazard',
      ]);
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment
          .rejectedMultiSourceCombinations,
      ).toHaveLength(1);
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment
          .rejectedMultiSourceCombinations[0],
      ).toMatchObject({
        methodId: 'beta-binomial-conjugate',
        rejectionCode: 'rejected-by-trusted-combination-verifier',
        verifiedByVerifierId: 'oracle-audit-combination-gate-v2',
        preservedIndividualSources: true,
        contributingEvidenceIds: [
          'beta-cohort-overlap-a',
          'beta-cohort-overlap-b',
        ],
      });
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment.structuredNumericalDatasets.map(
          (r) => r.evidenceId,
        ),
      ).toEqual([
        'beta-cohort-overlap-a',
        'beta-cohort-overlap-b',
        'poisson-independent-single',
      ]);
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment.structuredNumericalDatasets.map(
          (r) => r.url,
        ),
      ).toEqual([
        'https://agency-a.example.org/grid-2026',
        'https://agency-b.example.org/grid-2026',
        'https://grc.example.org/substation-hazard-2026',
      ]);
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment
          .derivedAvailableEvidence.binaryTrialSuccesses,
      ).toBeUndefined();
      expect(
        rejectedComboWithIsolatedPoisson.evidenceAssessment
          .derivedAvailableEvidence.availableChannels,
      ).not.toContain('binary-trial-counts');

      // 2. Empty combination verifier fails closed even when caller sets every boolean to true:
      const emptyCombVerifier = createTrustedCombinationVerifier({
        verifierId: 'empty-combination-verifier',
      });
      const rejectedAllAbstained = await runScientificForecastPipeline(
        {
          question:
            'Will global battery storage exceed 1,200 GW before 2029 according to the IEA?',
          questionCategory: 'technology',
          subdomain: 'binary-event-occurrence',
          outcomeSpace: BINARY_OUTCOME_SPACE,
          referenceTime: REFERENCE_TIME,
          harvestOptions: { skipRemoteHarvest: true },
          submittedEvidence: cohortsPlusIndependentPoisson.slice(0, 2),
          multiSourceCombinationJustifications: {
            'beta-binomial-conjugate': {
              basis: 'disjoint-exchangeable-cohorts',
              contributingEvidenceIds: [
                'beta-cohort-overlap-a',
                'beta-cohort-overlap-b',
              ],
              disjointPopulationsOrWindowsVerified: true,
              homogeneousParameterSpaceVerified: true,
              mathematicalRationale:
                'Falsely asserting disjoint cohorts against unconfigured verifier.',
            },
          },
        },
        {
          evidenceVerifier: TRUSTED_VERIFIER,
          combinationVerifier: emptyCombVerifier,
        },
      );
      expect(rejectedAllAbstained.pipelineStatus).toBe('honest-abstention');
      expect(rejectedAllAbstained.probabilityDistribution).toBeNull();
      expect(
        rejectedAllAbstained.evidenceAssessment.derivedAvailableEvidence
          .hasVerifiableEmpiricalData,
      ).toBe(false);
      expect(
        rejectedAllAbstained.evidenceAssessment.derivedAvailableEvidence
          .availableChannels,
      ).toEqual([]);
      expect(
        rejectedAllAbstained.evidenceAssessment.structuredNumericalDatasets,
      ).toHaveLength(2);
      assertDeeplyFrozen(rejectedAllAbstained);
    });
  });
});
