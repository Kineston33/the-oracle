/**
 * THE ORACLE — Stage 2B-1: End-to-End Scientific Forecast Pipeline Integration
 *
 * Orchestrates the complete server-side scientific forecasting pipeline by
 * connecting the existing verified Stage 1 and Stage 2A infrastructure:
 *
 *   Step A: Question validation & canonical proposition identity resolution
 *   Step B: Verifiable external evidence collection (`EvidenceHarvester`)
 *   Step C: Evidence trust verification, strict observation validation & global deduplication
 *   Step D: Deterministic scientific method applicability planning
 *   Step E: Isolated execution of applicable & implemented scientific methods
 *   Step F: Dependence-aware multi-method aggregation & forecast synthesis
 *
 * Scientific integrity guarantees:
 *   1. Enforces an explicit trust boundary between caller-declared submissions
 *      and independently verified empirical evidence. Caller-supplied booleans
 *      (`verifiedEmpirical`, `isPrimarySourceVerified`), publisher names, URLs,
 *      titles, or timestamps never independently establish empirical
 *      verification; quantitative submissions only enter verified channels when
 *      certified by an injected server-side `EvidenceVerifier`.
 *   2. Never converts arbitrary text, article counts, source counts, or
 *      thematic relevance scores into statistical sample sizes, event
 *      frequencies, likelihoods, or sufficient statistics.
 *   3. Never treats AI-generated claims or unverified assertions as empirical
 *      evidence.
 *   4. Validates every observation field strictly (`binary-trials` outcomes must
 *      be `1`, `'success'`, `0`, or `'failure'` — invalid values are never
 *      mapped to `0`; `poisson-arrivals` and `multinomial-trials` observations
 *      undergo equivalent strict validation) and quarantines malformed records
 *      with explicit diagnostics.
 *   5. Deduplicates multiple sources reporting the same historical event
 *      globally across all compatible submissions by canonical event identity
 *      (`schemaKind::eventFamily::eventId`) while preserving all reporting
 *      sources and provenance references, quarantining conflicting outcomes,
 *      and never merging unrelated event families.
 *   6. Evaluates every registered method in `ScientificMethodRegistry`; never
 *      arbitrarily picks a single method and never executes inapplicable,
 *      deferred, or unimplemented (`registered-specification-only`) methods.
 *   7. Isolates individual method execution failures so a runtime or numerical
 *      error in one method does not silently invalidate unrelated methods.
 *   8. Keeps `structural-uniform-baseline` strictly separate from empirical
 *      evidence, preserves declared vs. verified independence semantics
 *      (`tier: 'declared'`, `verificationStatus: 'declared-unverified-assertion'`,
 *      `statisticalIndependenceVerified = false`), and never describes an
 *      abstention or structural baseline as a successful empirical forecast.
 */

import { sha256Hex } from '../data/hash.ts';
import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import type {
  IdentityComponent,
  PropositionIdentity,
} from '../data/publication-types.ts';
import {
  resolveCanonicalQuestion,
  type CanonicalQuestionResolution,
  type ResolveCanonicalQuestionOptions,
} from '../data/question-resolver.ts';
import type {
  EvidenceReference,
  IsoDateTime,
  PredictionCategory,
} from '../data/types.ts';
import {
  harvestEvidence,
  isPrivateOrLocalHostname,
  toEvidenceReference,
  type DiscardedEvidenceDiagnostic,
  type EvidenceHarvestRequest,
  type EvidenceHarvestResult,
  type HarvestedEvidenceItem,
} from './evidence-harvester.ts';
import {
  EVIDENCE_DRIVEN_FOOTING_TIERS,
  synthesizeForecastDistribution,
  type ForecastSynthesisInput,
  type StatisticalIndependenceCertification,
} from './forecast-synthesis.ts';
import {
  validateOutcomeSpaceDescriptor,
  type AbstentionReason,
  type CalibrationVerificationStatus,
  type CategoryUncertaintyDecomposition,
  type DualChannelProbability,
  type EffectiveIndependenceAssessment,
  type EntropyDecomposition,
  type EvidentialFootingTier,
  type ForecastDistributionOutput,
  type OutcomeSpaceDescriptor,
  type ScientificMethodId,
  type ScientificMethodOutput,
  type UnexecutedApplicableMethodReport,
} from './forecast-types.ts';
import {
  executeScientificMethod,
  type BetaBinomialExecutionInput,
  type DirichletMultinomialExecutionInput,
  type ExecutableScientificMethodId,
  type PoissonGammaExecutionInput,
  type ScientificMethodExecutionInput,
  type StructuralUniformExecutionInput,
  type UnimplementedScientificMethodId,
  type WeightedKishExecutionInput,
} from './method-execution.ts';
import {
  DEFAULT_SCIENTIFIC_METHOD_REGISTRY,
  PREDICTION_CATEGORIES,
  isValidSubdomainIdentifier,
  type MethodAssumptionId,
  type MethodDataChannelId,
  type MethodImplementationStatus,
  type ScientificMethodRegistry,
} from './method-registry.ts';
import {
  planMethodApplicability,
  type AssumptionDeclarationsInput,
  type AvailableEvidenceInput,
  type ComputationalCapabilitiesInput,
  type ForecastHorizonInput,
  type MethodApplicabilityDisposition,
  type MethodApplicabilityPlan,
  type MethodApplicabilityPlanningInput,
  type MethodDependenceDiagnostics,
  type MethodEvaluationRecord,
} from './method-selection.ts';
import {
  kahanNeumaierSum,
  validateExhaustiveDistribution,
} from './numeric-primitives.ts';

export const FORECAST_PIPELINE_VERSION = '2B-1.0.0' as const;

/* -------------------------------------------------------------------------
   1. Pipeline Status, Classification & Trust Boundary Enums
   ------------------------------------------------------------------------- */

export const PIPELINE_EXECUTION_STATUSES = Object.freeze([
  'successful-empirical-forecast',
  'structural-baseline-forecast',
  'partial-execution',
  'failed-execution',
  'honest-abstention',
] as const);

export type PipelineExecutionStatus =
  (typeof PIPELINE_EXECUTION_STATUSES)[number];

export const PIPELINE_FORECAST_KINDS = Object.freeze([
  'empirical-forecast',
  'structural-baseline-only',
  'abstained',
  'failed',
] as const);

export type PipelineForecastKind = (typeof PIPELINE_FORECAST_KINDS)[number];

export const EVIDENCE_COLLECTION_STATUSES = Object.freeze([
  'succeeded-with-evidence',
  'succeeded-empty',
  'partial-provider-failure',
  'failed-all-providers',
  'skipped-offline',
] as const);

export type EvidenceCollectionStatus =
  (typeof EVIDENCE_COLLECTION_STATUSES)[number];

export const ASSESSED_EVIDENCE_CATEGORIES = Object.freeze([
  'documentary-evidence',
  'historical-observations',
  'structured-numerical-dataset',
  'statistical-sufficient-statistics',
  'unsupported-or-unverified-claim',
] as const);

export type AssessedEvidenceCategory =
  (typeof ASSESSED_EVIDENCE_CATEGORIES)[number];

export const EVIDENCE_TRUST_TIERS = Object.freeze([
  'independently-verified-empirical',
  'harvester-documentary',
  'caller-declared-unverified',
  'quarantined-invalid',
] as const);

export type EvidenceTrustTier = (typeof EVIDENCE_TRUST_TIERS)[number];

export const EVIDENCE_VERIFICATION_OUTCOMES = Object.freeze([
  'verified-by-trusted-verifier',
  'harvester-documentary-provenance',
  'downgraded-no-trusted-verifier',
  'rejected-by-trusted-verifier',
  'rejected-integrity-or-schema-gate',
] as const);

export type EvidenceVerificationOutcome =
  (typeof EVIDENCE_VERIFICATION_OUTCOMES)[number];

/* -------------------------------------------------------------------------
   2. Evidence Submission, Trust Verification & Assessment Contracts
   ------------------------------------------------------------------------- */

export interface EvidenceSourceCitation {
  readonly sourceId?: string;
  readonly evidenceId?: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
}

export interface BinaryHistoricalObservationRecord {
  /**
   * Canonical identifier of the underlying real-world trial or event.
   * Multiple records sharing the same `eventId` within the same `eventFamily`
   * across one or more submissions are deduplicated into a single observation
   * while preserving all reporting sources.
   */
  readonly eventId: string;
  /**
   * Optional event family namespace (defaults to `schema.eventFamily` or
   * `'binary-trials'`). Prevents merging unrelated event families whose local
   * `eventId` strings happen to match.
   */
  readonly eventFamily?: string;
  /**
   * Strict binary trial outcome: must be `1`, `'success'`, `0`, or `'failure'`.
   * Any other runtime value is quarantined with an explicit diagnostic and
   * never silently mapped to `0`.
   */
  readonly outcome: 0 | 1 | 'success' | 'failure';
  readonly observedAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  /**
   * Optional exogenous positive observation weight (`> 0`) for
   * `weighted-kish-effective-binomial`.
   */
  readonly weight?: number;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export interface PoissonEventObservationRecord {
  /**
   * Canonical identifier of the arrival event. Multiple sources reporting the
   * same incident within the same `eventFamily` across one or more submissions
   * are deduplicated into a single arrival event.
   */
  readonly eventId: string;
  readonly eventFamily?: string;
  readonly occurredAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export interface MultinomialHistoricalObservationRecord {
  /**
   * Canonical identifier of the categorical trial realization. Multiple sources
   * reporting the same realization within the same `eventFamily` across one or
   * more submissions are deduplicated into a single trial.
   */
  readonly eventId: string;
  readonly eventFamily?: string;
  readonly outcomeIndex?: number;
  readonly outcomeLabel?: string;
  readonly observedAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export type HistoricalObservationSchema =
  | {
      readonly kind: 'binary-trials';
      readonly eventFamily?: string;
      readonly successOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly alpha: number;
        readonly beta: number;
      };
      readonly enableWeightedKishChannel?: boolean;
      readonly credibleIntervalLevel?: number;
      readonly observations: readonly BinaryHistoricalObservationRecord[];
    }
  | {
      readonly kind: 'poisson-arrivals';
      readonly eventFamily?: string;
      readonly eventOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly shape: number;
        readonly rate: number;
      };
      readonly historicalExposure: {
        readonly exposureDuration: number;
        readonly exposureUnit: string;
        readonly exposureWindowId?: string;
      };
      readonly forecastExposure: {
        readonly exposureDuration: number;
        readonly exposureUnit?: string;
      };
      readonly credibleIntervalLevel?: number;
      readonly events: readonly PoissonEventObservationRecord[];
    }
  | {
      readonly kind: 'multinomial-trials';
      readonly eventFamily?: string;
      readonly prior: {
        readonly alpha: readonly number[];
      };
      readonly credibleIntervalLevel?: number;
      readonly observations: readonly MultinomialHistoricalObservationRecord[];
    };

export interface DocumentaryEvidenceSubmission {
  readonly category: 'documentary-evidence';
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly snippet?: string;
  readonly isPrimarySourceVerified?: boolean;
}

export interface HistoricalObservationsSubmission {
  readonly category: 'historical-observations';
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly verifiedEmpirical?: boolean;
  readonly isPrimarySourceVerified?: boolean;
  readonly isAiGenerated?: boolean;
  readonly derivedFromDocOrSourceCount?: boolean;
  readonly derivedFromRelevanceScore?: boolean;
  readonly lowConfidenceEvidence?: boolean;
  readonly observationSchema: HistoricalObservationSchema;
}

export type StructuredNumericalDatasetPayload =
  | {
      readonly kind: 'binary-cohort-table';
      readonly successes: number;
      readonly failures: number;
      readonly successOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly alpha: number;
        readonly beta: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly kind: 'weighted-binary-cohort-table';
      readonly weightedSuccessMass: number;
      readonly weightedFailureMass: number;
      readonly sumSquaredWeights: number;
      readonly observationCount: number;
      readonly successOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly alpha: number;
        readonly beta: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly kind: 'poisson-exposure-table';
      readonly eventCount: number;
      readonly exposureDuration: number;
      readonly exposureUnit: string;
      readonly forecastExposureDuration: number;
      readonly forecastExposureUnit?: string;
      readonly eventOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly shape: number;
        readonly rate: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly kind: 'multinomial-contingency-table';
      readonly counts: readonly number[];
      readonly prior: {
        readonly alpha: readonly number[];
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly kind: 'continuous-state-trajectory-table';
      readonly observationCount: number;
      readonly estimatedDrift: number;
      readonly estimatedScaleOrVolatility: number;
      readonly degreesOfFreedom?: number;
      readonly initialStateLevel?: number;
    };

export interface StructuredNumericalDatasetSubmission {
  readonly category: 'structured-numerical-dataset';
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly verifiedEmpirical?: boolean;
  readonly isPrimarySourceVerified?: boolean;
  readonly isAiGenerated?: boolean;
  readonly derivedFromDocOrSourceCount?: boolean;
  readonly derivedFromRelevanceScore?: boolean;
  readonly lowConfidenceEvidence?: boolean;
  readonly dataset: StructuredNumericalDatasetPayload;
}

export type SufficientStatisticsPayload =
  | {
      readonly targetMethodId: 'beta-binomial-conjugate';
      readonly successes: number;
      readonly failures: number;
      readonly successOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly alpha: number;
        readonly beta: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly targetMethodId: 'weighted-kish-effective-binomial';
      readonly weightedSuccessMass: number;
      readonly weightedFailureMass: number;
      readonly sumSquaredWeights: number;
      readonly observationCount: number;
      readonly successOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly alpha: number;
        readonly beta: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly targetMethodId: 'poisson-gamma-hazard';
      readonly eventCount: number;
      readonly exposureDuration: number;
      readonly exposureUnit: string;
      readonly forecastExposureDuration: number;
      readonly forecastExposureUnit?: string;
      readonly eventOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly shape: number;
        readonly rate: number;
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly targetMethodId: 'dirichlet-multinomial-symmetry';
      readonly counts: readonly number[];
      readonly prior: {
        readonly alpha: readonly number[];
      };
      readonly credibleIntervalLevel?: number;
    }
  | {
      readonly targetMethodId: UnimplementedScientificMethodId;
      readonly continuousTrajectoryObservations: number;
      readonly estimatedDrift: number;
      readonly estimatedScaleOrVolatility: number;
      readonly degreesOfFreedom?: number;
      readonly initialStateLevel?: number;
    };

export interface StatisticalSufficientStatisticsSubmission {
  readonly category: 'statistical-sufficient-statistics';
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly verifiedEmpirical?: boolean;
  readonly isPrimarySourceVerified?: boolean;
  readonly isAiGenerated?: boolean;
  readonly derivedFromDocOrSourceCount?: boolean;
  readonly derivedFromRelevanceScore?: boolean;
  readonly lowConfidenceEvidence?: boolean;
  readonly statistics: SufficientStatisticsPayload;
}

export interface UnsupportedOrUnverifiedClaimSubmission {
  readonly category: 'unsupported-or-unverified-claim';
  readonly evidenceId: string;
  readonly title?: string;
  readonly publisher?: string;
  readonly url?: string;
  readonly publishedAt?: string;
  readonly claimSummary: string;
  readonly origin?:
    | 'ai-generated'
    | 'unverified-source'
    | 'qualitative-assertion'
    | 'article-or-source-count-heuristic'
    | 'relevance-score-heuristic'
    | 'conflicting-event-reports'
    | 'other';
}

export type PipelineEvidenceSubmission =
  | DocumentaryEvidenceSubmission
  | HistoricalObservationsSubmission
  | StructuredNumericalDatasetSubmission
  | StatisticalSufficientStatisticsSubmission
  | UnsupportedOrUnverifiedClaimSubmission;

/**
 * Context passed to a trusted server-side `EvidenceVerifier` to authenticate
 * and verify caller-submitted evidence before it is permitted to enter any
 * quantitative evidence channel.
 */
export interface EvidenceVerificationContext {
  readonly evidenceId: string;
  readonly submission: PipelineEvidenceSubmission;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
  readonly harvestedItems: readonly HarvestedEvidenceItem[];
}

/**
 * Authoritative verification decision returned by a trusted server-side
 * `EvidenceVerifier`. Caller-supplied booleans (`verifiedEmpirical`,
 * `isPrimarySourceVerified`), publisher strings, URLs, titles, or timestamps
 * never substitute for this decision.
 */
export interface EvidenceVerificationDecision {
  /**
   * Whether the trusted verifier independently confirmed that this submission
   * is authentic empirical evidence suitable for quantitative modeling.
   */
  readonly verifiedEmpirical: boolean;
  /**
   * Whether the trusted verifier independently confirmed primary-source
   * institutional provenance. Forced to `false` whenever `verifiedEmpirical`
   * is `false`.
   */
  readonly isPrimarySourceVerified?: boolean;
  /**
   * Non-empty identifier of the trusted server-side verification authority.
   */
  readonly verifierId: string;
  /**
   * Optional cryptographic digest, audit log URI, or institutional registry
   * reference backing the verification decision.
   */
  readonly verificationArtifactRef?: string;
  /**
   * Explicit human-auditable explanation of why verification succeeded or
   * failed.
   */
  readonly rationale: string;
  /**
   * Optional allowlist of verified observation `eventId`s when verifying
   * `historical-observations`. When provided, any observation whose `eventId`
   * is absent from this list is quarantined as unverified.
   */
  readonly verifiedEventIds?: readonly string[];
}

export type EvidenceVerifier = (
  context: EvidenceVerificationContext,
) => EvidenceVerificationDecision;

/**
 * Creates a deterministic, auditable `EvidenceVerifier` for server-side
 * verification policies or deterministic offline tests.
 */
export function createTrustedEvidenceVerifier(options: {
  readonly verifierId: string;
  readonly defaultRationale?: string;
  readonly verificationArtifactRef?: string;
  readonly verifySubmission?: (
    context: EvidenceVerificationContext,
  ) => Partial<EvidenceVerificationDecision> | boolean;
  readonly verifiedEvidenceIds?: readonly string[];
  readonly primarySourceEvidenceIds?: readonly string[];
  readonly verifiedEventIdsByEvidenceId?: Readonly<
    Record<string, readonly string[]>
  >;
}): EvidenceVerifier {
  const verifierId = options.verifierId.trim();
  if (verifierId.length === 0) {
    throw new RangeError(
      'createTrustedEvidenceVerifier requires a non-empty verifierId',
    );
  }
  const verifiedSet =
    options.verifiedEvidenceIds !== undefined
      ? new Set(options.verifiedEvidenceIds.map((id) => id.trim()))
      : null;
  const primarySet =
    options.primarySourceEvidenceIds !== undefined
      ? new Set(options.primarySourceEvidenceIds.map((id) => id.trim()))
      : null;

  return (
    context: EvidenceVerificationContext,
  ): EvidenceVerificationDecision => {
    if (options.verifySubmission !== undefined) {
      const custom = options.verifySubmission(context);
      if (typeof custom === 'boolean') {
        return Object.freeze({
          verifiedEmpirical: custom,
          isPrimarySourceVerified:
            custom &&
            (primarySet === null || primarySet.has(context.evidenceId)),
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale:
            options.defaultRationale ??
            (custom
              ? `Verified empirical provenance for '${context.evidenceId}' via trusted verifier '${verifierId}'.`
              : `Rejected empirical provenance for '${context.evidenceId}' via trusted verifier '${verifierId}'.`),
          ...(options.verifiedEventIdsByEvidenceId?.[context.evidenceId] !==
          undefined
            ? {
                verifiedEventIds:
                  options.verifiedEventIdsByEvidenceId[context.evidenceId]!,
              }
            : {}),
        });
      }
      const verified = custom.verifiedEmpirical === true;
      return Object.freeze({
        verifiedEmpirical: verified,
        isPrimarySourceVerified:
          verified && (custom.isPrimarySourceVerified ?? true),
        verifierId: custom.verifierId ?? verifierId,
        ...(custom.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: custom.verificationArtifactRef }
          : options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
        rationale:
          custom.rationale ??
          options.defaultRationale ??
          (verified
            ? `Verified empirical provenance for '${context.evidenceId}' via trusted verifier '${verifierId}'.`
            : `Rejected empirical provenance for '${context.evidenceId}' via trusted verifier '${verifierId}'.`),
        ...(custom.verifiedEventIds !== undefined
          ? { verifiedEventIds: custom.verifiedEventIds }
          : options.verifiedEventIdsByEvidenceId?.[context.evidenceId] !==
              undefined
            ? {
                verifiedEventIds:
                  options.verifiedEventIdsByEvidenceId[context.evidenceId]!,
              }
            : {}),
      });
    }

    const isVerified =
      verifiedSet === null ? true : verifiedSet.has(context.evidenceId);
    const isPrimary =
      isVerified && (primarySet === null || primarySet.has(context.evidenceId));
    return Object.freeze({
      verifiedEmpirical: isVerified,
      isPrimarySourceVerified: isPrimary,
      verifierId,
      ...(options.verificationArtifactRef !== undefined
        ? { verificationArtifactRef: options.verificationArtifactRef }
        : {}),
      rationale:
        options.defaultRationale ??
        (isVerified
          ? `Independently verified empirical provenance for '${context.evidenceId}' via trusted verifier '${verifierId}'.`
          : `Submission '${context.evidenceId}' is not in the trusted verifier's verifiedEvidenceIds allowlist.`),
      ...(options.verifiedEventIdsByEvidenceId?.[context.evidenceId] !==
      undefined
        ? {
            verifiedEventIds:
              options.verifiedEventIdsByEvidenceId[context.evidenceId]!,
          }
        : {}),
    });
  };
}

export interface PipelineEvidenceProvenanceRecord {
  readonly evidenceId: string;
  readonly submittedCategory: AssessedEvidenceCategory;
  readonly effectiveCategory: AssessedEvidenceCategory;
  readonly origin: 'evidence-harvester' | 'caller-submission';
  readonly trustTier: EvidenceTrustTier;
  readonly verificationOutcome: EvidenceVerificationOutcome;
  readonly claimedVerifiedEmpirical?: boolean;
  readonly claimedPrimarySourceVerified?: boolean;
  readonly verifiedByVerifierId: string | null;
  readonly verificationArtifactRef: string | null;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime | null;
  readonly retrievedAt: IsoDateTime | null;
  readonly sourceProvider: string;
  readonly isPrimarySourceVerified: boolean;
  readonly usableForQuantitativeMethods: boolean;
  readonly supportedMethodIds: readonly ScientificMethodId[];
  readonly supportedDataChannels: readonly MethodDataChannelId[];
  readonly mergedSourceCitations: readonly EvidenceSourceCitation[];
  readonly assessmentNote: string;
}

export interface InvalidObservationDiagnostic {
  readonly evidenceId: string;
  readonly observationIndex: number;
  readonly schemaKind:
    | 'binary-trials'
    | 'poisson-arrivals'
    | 'multinomial-trials';
  readonly rawEventId: string | null;
  readonly invalidFields: readonly string[];
  readonly disposition: 'quarantined-observation';
  readonly explanation: string;
}

export interface DeduplicatedEventObservationDiagnostic {
  readonly evidenceId: string;
  readonly contributingEvidenceIds: readonly string[];
  readonly eventFamily: string;
  readonly canonicalEventKey: string;
  readonly eventId: string;
  readonly crossSubmissionDeduplicated: boolean;
  readonly rawReportCount: number;
  readonly deduplicatedCount: 0 | 1;
  readonly status:
    | 'deduplicated-consistent'
    | 'quarantined-conflicting-outcomes';
  readonly reportingSources: readonly EvidenceSourceCitation[];
  readonly explanation: string;
}

export interface EvidenceAssessmentReport {
  readonly totalRetrievedCount: number;
  readonly totalQuantitativeValidatedCount: number;
  readonly documentaryEvidence: readonly PipelineEvidenceProvenanceRecord[];
  readonly historicalObservations: readonly PipelineEvidenceProvenanceRecord[];
  readonly structuredNumericalDatasets: readonly PipelineEvidenceProvenanceRecord[];
  readonly statisticalSufficientStatistics: readonly PipelineEvidenceProvenanceRecord[];
  readonly declaredUnverifiedEvidence: readonly PipelineEvidenceProvenanceRecord[];
  readonly unsupportedOrUnverifiedClaims: readonly PipelineEvidenceProvenanceRecord[];
  readonly invalidObservationDiagnostics: readonly InvalidObservationDiagnostic[];
  readonly deduplicatedEventDiagnostics: readonly DeduplicatedEventObservationDiagnostic[];
  readonly derivedAvailableEvidence: AvailableEvidenceInput;
  readonly supportedMethodIds: readonly ScientificMethodId[];
  readonly missingRequirementsByMethod: Readonly<
    Record<string, readonly string[]>
  >;
  readonly assessmentNotes: readonly string[];
}

/* -------------------------------------------------------------------------
   3. Method Execution & Pipeline Result Contracts (Step D, Step E, Step F)
   ------------------------------------------------------------------------- */

export interface ExecutedMethodDiagnostic {
  readonly methodId: ScientificMethodId;
  readonly disposition: MethodApplicabilityDisposition;
  readonly inputProvenanceIds: readonly string[];
  readonly inputSourceUrls: readonly string[];
  readonly verifiedAssumptions: readonly MethodAssumptionId[];
  readonly unverifiedAssumptions: readonly MethodAssumptionId[];
  readonly activeLimitations: readonly string[];
  readonly output: ScientificMethodOutput;
}

export type SkippedMethodReasonCategory =
  | 'inapplicable-by-planner'
  | 'deferred-by-planner'
  | 'unimplemented-method'
  | 'missing-execution-inputs';

export interface SkippedMethodDiagnostic {
  readonly methodId: ScientificMethodId;
  readonly disposition: MethodApplicabilityDisposition;
  readonly skipCategory: SkippedMethodReasonCategory;
  readonly implementationStatus: MethodImplementationStatus;
  readonly failedOrDeferredGateIds: readonly string[];
  readonly missingInputs: readonly string[];
  readonly rationale: string;
}

export interface MethodExecutionFailureDiagnostic {
  readonly methodId: ScientificMethodId;
  readonly stage: 'method-execution' | 'output-validation';
  readonly errorName: string;
  readonly errorMessage: string;
  readonly inputProvenanceIds: readonly string[];
}

export interface PipelineQuestionIdentityReport {
  readonly rawQuestion: string;
  readonly normalizedQuestion: string;
  readonly canonicalQuestion: string;
  readonly questionId: string;
  readonly questionCategory: PredictionCategory;
  readonly subdomain?: string;
  readonly identity: PropositionIdentity;
  readonly identityDigest: string;
  readonly identityComplete: boolean;
  readonly unresolvedComponents: readonly IdentityComponent[];
  readonly resolution: CanonicalQuestionResolution;
}

export interface PipelineUncertaintyDecompositionReport {
  readonly categoryDecompositions: readonly CategoryUncertaintyDecomposition[];
  readonly entropyDecomposition: EntropyDecomposition | null;
}

export interface ForecastPipelineResult {
  readonly pipelineVersion: typeof FORECAST_PIPELINE_VERSION;
  readonly executedAt: IsoDateTime;
  readonly referenceTime: IsoDateTime;
  readonly questionIdentity: PipelineQuestionIdentityReport;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly pipelineStatus: PipelineExecutionStatus;
  readonly forecastKind: PipelineForecastKind;
  readonly isEmpiricalForecast: boolean;
  readonly evidenceCollectionStatus: EvidenceCollectionStatus;
  readonly retrievedEvidenceCount: number;
  readonly validatedQuantitativeEvidenceCount: number;
  readonly harvestResult: EvidenceHarvestResult;
  readonly discardedHarvestDiagnostics: readonly DiscardedEvidenceDiagnostic[];
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly evidenceProvenance: readonly PipelineEvidenceProvenanceRecord[];
  readonly evidenceAssessment: EvidenceAssessmentReport;
  readonly applicabilityPlan: MethodApplicabilityPlan;
  readonly methodApplicabilityResults: readonly MethodEvaluationRecord[];
  readonly executedMethodIds: readonly ScientificMethodId[];
  readonly skippedMethods: readonly SkippedMethodDiagnostic[];
  readonly deferredMethods: readonly MethodEvaluationRecord[];
  readonly inapplicableMethods: readonly MethodEvaluationRecord[];
  readonly unexecutedApplicableMethods: readonly UnexecutedApplicableMethodReport[];
  readonly methodExecutionFailures: readonly MethodExecutionFailureDiagnostic[];
  readonly methodOutputs: readonly ScientificMethodOutput[];
  readonly executedMethodDiagnostics: readonly ExecutedMethodDiagnostic[];
  readonly dependenceDiagnostics: MethodDependenceDiagnostics;
  readonly independenceSemantics: EffectiveIndependenceAssessment | null;
  readonly synthesisResult: ForecastDistributionOutput | null;
  readonly probabilityDistribution: readonly DualChannelProbability[] | null;
  readonly uncertaintyDecomposition: PipelineUncertaintyDecompositionReport | null;
  readonly footingTier: EvidentialFootingTier;
  readonly calibrationStatus: CalibrationVerificationStatus;
  readonly abstentionReason?: AbstentionReason;
  readonly limitations: readonly string[];
  readonly missingRequirements: readonly string[];
  readonly missingRequirementsByMethod: Readonly<
    Record<string, readonly string[]>
  >;
}

export interface ForecastPipelineRequest {
  readonly question: string;
  readonly questionId?: string;
  readonly questionCategory?: PredictionCategory;
  readonly subdomain?: string;
  readonly outcomeSpace?: OutcomeSpaceDescriptor;
  readonly horizon?: ForecastHorizonInput;
  readonly referenceTime?: IsoDateTime;
  readonly harvestOptions?: Omit<EvidenceHarvestRequest, 'query'> & {
    readonly skipRemoteHarvest?: boolean;
  };
  readonly submittedEvidence?: readonly PipelineEvidenceSubmission[];
  readonly assumptions?: Partial<AssumptionDeclarationsInput>;
  readonly structuralSymmetryPremise?: StructuralUniformExecutionInput['symmetryPremise'];
  readonly computationalCapabilities?: Partial<ComputationalCapabilitiesInput>;
  readonly footingTier?: EvidentialFootingTier;
  readonly calibrationStatus?: CalibrationVerificationStatus;
  readonly customWeightsByMethod?: Readonly<Record<string, number>>;
  readonly independenceCertification?: StatisticalIndependenceCertification;
  readonly statisticalIndependenceVerified?: boolean;
  readonly verifiedIndependentMethodCount?: number;
  readonly additionalLimitations?: readonly string[];
}

export interface ForecastPipelineDependencies {
  readonly questionResolver?: (
    rawQuery: string,
    options?: ResolveCanonicalQuestionOptions,
  ) => Promise<CanonicalQuestionResolution>;
  readonly evidenceHarvester?: (
    request: EvidenceHarvestRequest,
  ) => Promise<EvidenceHarvestResult>;
  /**
   * Injectable server-side evidence verifier establishing the trust boundary
   * between untrusted caller submissions and verified quantitative empirical
   * evidence. When omitted, all caller-submitted quantitative evidence is
   * preserved as `'caller-declared-unverified'` and prevented from entering
   * verified quantitative method channels.
   */
  readonly evidenceVerifier?: EvidenceVerifier;
  readonly registry?: ScientificMethodRegistry;
  readonly applicabilityPlanner?: (
    input: MethodApplicabilityPlanningInput,
    registry?: ScientificMethodRegistry,
  ) => MethodApplicabilityPlan;
  readonly methodExecutor?: (
    input: ScientificMethodExecutionInput,
    registry?: ScientificMethodRegistry,
  ) => ScientificMethodOutput;
  readonly synthesizer?: (
    input: ForecastSynthesisInput,
  ) => ForecastDistributionOutput;
  readonly now?: () => IsoDateTime;
}

export class ForecastPipelineRequestError extends RangeError {
  readonly diagnostics: readonly string[];

  constructor(message: string, diagnostics: readonly string[] = [message]) {
    super(message);
    this.name = 'ForecastPipelineRequestError';
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

/* -------------------------------------------------------------------------
   4. Internal Helpers, URL/Field Validators & Global Deduplication Types
   ------------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i]);
    }
    return Object.freeze(obj);
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFreeze(record[key]);
  }
  return Object.freeze(obj);
}

function isValidPublicHttpUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    if (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      isPrivateOrLocalHostname(parsed.hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

interface PreparedMethodExecutionBundle {
  readonly methodId: ExecutableScientificMethodId;
  readonly executionInput: ScientificMethodExecutionInput;
  readonly provenanceIds: readonly string[];
  readonly sourceUrls: readonly string[];
}

interface VerifiedSubmissionTrustMetadata {
  readonly isPrimarySourceVerified: boolean;
  readonly verifiedByVerifierId: string;
  readonly verificationArtifactRef: string | null;
  readonly rationale: string;
  readonly verifiedEventIdSet: ReadonlySet<string> | null;
  readonly claimedVerifiedEmpirical?: boolean;
  readonly claimedPrimarySourceVerified?: boolean;
}

interface ValidatedBinaryObservationReport {
  readonly evidenceId: string;
  readonly eventFamily: string;
  readonly canonicalEventKey: string;
  readonly eventId: string;
  readonly realizedOutcomeIndex: 0 | 1;
  readonly weight?: number;
  readonly citation: EvidenceSourceCitation;
}

interface PendingBinaryHistoricalSubmission {
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly baseCitation: EvidenceSourceCitation;
  readonly trust: VerifiedSubmissionTrustMetadata;
  readonly successOutcomeIndex: 0 | 1;
  readonly prior: { readonly alpha: number; readonly beta: number };
  readonly enableWeightedKishChannel: boolean;
  readonly credibleIntervalLevel?: number;
  readonly rawObservationCount: number;
  readonly canonicalEventKeys: readonly string[];
}

interface ValidatedPoissonObservationReport {
  readonly evidenceId: string;
  readonly eventFamily: string;
  readonly canonicalEventKey: string;
  readonly eventId: string;
  readonly eventOutcomeIndex: 0 | 1;
  readonly citation: EvidenceSourceCitation;
}

interface PendingPoissonHistoricalSubmission {
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly baseCitation: EvidenceSourceCitation;
  readonly trust: VerifiedSubmissionTrustMetadata;
  readonly eventOutcomeIndex: 0 | 1;
  readonly prior: { readonly shape: number; readonly rate: number };
  readonly historicalExposureDuration: number;
  readonly historicalExposureUnit: string;
  readonly exposureWindowId: string;
  readonly forecastExposureDuration: number;
  readonly forecastExposureUnit: string;
  readonly credibleIntervalLevel?: number;
  readonly rawEventCount: number;
  readonly canonicalEventKeys: readonly string[];
}

interface ValidatedMultinomialObservationReport {
  readonly evidenceId: string;
  readonly eventFamily: string;
  readonly canonicalEventKey: string;
  readonly eventId: string;
  readonly outcomeIndex: number;
  readonly citation: EvidenceSourceCitation;
}

interface PendingMultinomialHistoricalSubmission {
  readonly evidenceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
  readonly baseCitation: EvidenceSourceCitation;
  readonly trust: VerifiedSubmissionTrustMetadata;
  readonly priorAlpha: readonly number[];
  readonly credibleIntervalLevel?: number;
  readonly rawObservationCount: number;
  readonly canonicalEventKeys: readonly string[];
}

/* -------------------------------------------------------------------------
   5. Step C — Evidence Trust Boundary, Strict Validation & Global Deduplication
   ------------------------------------------------------------------------- */

/**
 * Evaluates harvested documentary items and caller-submitted evidence records,
 * enforcing:
 *   1. Explicit trust boundary via `evidenceVerifier`: caller-declared
 *      submissions without a successful trusted verification decision are
 *      preserved as `'caller-declared-unverified'` and never enter verified
 *      quantitative channels.
 *   2. Strict observation validation: in `binary-trials`, only `1`, `'success'`,
 *      `0`, or `'failure'` are accepted (`poisson-arrivals` and
 *      `multinomial-trials` enforce equivalent strict field and outcome
 *      validation). Invalid observations are quarantined with explicit
 *      diagnostics in `invalidObservationDiagnostics`.
 *   3. Pipeline-wide global event deduplication across all verified
 *      `historical-observations` submissions by canonical event identity
 *      (`${schemaKind}::${eventFamily}::${eventId}`).
 */
export function assessCollectedEvidence(params: {
  readonly harvestResult: EvidenceHarvestResult;
  readonly submittedEvidence: readonly PipelineEvidenceSubmission[];
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
  readonly structuralSymmetryPremise?: StructuralUniformExecutionInput['symmetryPremise'];
  readonly allowStructuralBaseline: boolean;
  readonly registry: ScientificMethodRegistry;
  readonly evidenceVerifier?: EvidenceVerifier;
}): {
  readonly report: EvidenceAssessmentReport;
  readonly provenanceRecords: readonly PipelineEvidenceProvenanceRecord[];
  readonly preparedMethodInputs: ReadonlyMap<
    ExecutableScientificMethodId,
    PreparedMethodExecutionBundle
  >;
} {
  const {
    harvestResult,
    submittedEvidence,
    outcomeSpace,
    referenceTime,
    structuralSymmetryPremise,
    allowStructuralBaseline,
    registry,
    evidenceVerifier,
  } = params;

  const referenceMs = parseIsoDateTimeMs(referenceTime)!;
  const outcomeCount = outcomeSpace.outcomeLabels.length;

  const documentaryEvidence: PipelineEvidenceProvenanceRecord[] = [];
  const historicalObservations: PipelineEvidenceProvenanceRecord[] = [];
  const structuredNumericalDatasets: PipelineEvidenceProvenanceRecord[] = [];
  const statisticalSufficientStatistics: PipelineEvidenceProvenanceRecord[] =
    [];
  const declaredUnverifiedEvidence: PipelineEvidenceProvenanceRecord[] = [];
  const unsupportedOrUnverifiedClaims: PipelineEvidenceProvenanceRecord[] = [];
  const invalidObservationDiagnostics: InvalidObservationDiagnostic[] = [];
  const deduplicatedEventDiagnostics: DeduplicatedEventObservationDiagnostic[] =
    [];
  const allProvenanceRecords: PipelineEvidenceProvenanceRecord[] = [];
  const assessmentNotes: string[] = [];

  // 1. Classify all harvested items from EvidenceHarvester as documentary-evidence:
  for (const item of harvestResult.items) {
    const record: PipelineEvidenceProvenanceRecord = Object.freeze({
      evidenceId: item.id,
      submittedCategory: 'documentary-evidence',
      effectiveCategory: 'documentary-evidence',
      origin: 'evidence-harvester',
      trustTier: 'harvester-documentary',
      verificationOutcome: 'harvester-documentary-provenance',
      verifiedByVerifierId: null,
      verificationArtifactRef: null,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      publishedAt: item.publishedAt,
      retrievedAt: item.provenance.retrievedAt,
      sourceProvider: item.sourceProvider,
      isPrimarySourceVerified: item.isPrimarySourceVerified,
      usableForQuantitativeMethods: false,
      supportedMethodIds: Object.freeze([]),
      supportedDataChannels: Object.freeze([]),
      mergedSourceCitations: Object.freeze([
        Object.freeze({
          ...(item.sourceId !== null ? { sourceId: item.sourceId } : {}),
          evidenceId: item.id,
          publisher: item.publisher,
          url: item.url,
          publishedAt: item.publishedAt,
        }),
      ]),
      assessmentNote:
        'Harvested documentary evidence (title, snippet, source count, and thematic relevance score) provides domain context only and is never converted into statistical sample sizes, event frequencies, likelihoods, or sufficient statistics.',
    });
    documentaryEvidence.push(record);
    allProvenanceRecords.push(record);
  }

  if (harvestResult.items.length > 0) {
    assessmentNotes.push(
      `Classified ${harvestResult.items.length} harvested item(s) from [${harvestResult.selectedProviders.join(', ')}] as documentary evidence only; article counts and relevance scores were not converted into quantitative observations.`,
    );
  }

  // Track aggregated quantitative channels & prepared method inputs:
  const availableChannelSet = new Set<MethodDataChannelId>();
  let hasVerifiableEmpiricalData = false;
  let lowConfidenceEvidence = false;

  let binaryTrialSuccesses: number | undefined;
  let binaryTrialFailures: number | undefined;
  let weightedSampleSize: number | undefined;
  let kishEffectiveSampleSize: number | undefined;
  let poissonEventCount: number | undefined;
  let poissonExposureDuration: number | undefined;
  let multinomialOutcomeCounts: readonly number[] | undefined;
  let continuousTrajectoryObservations: number | undefined;
  let estimatedDrift: number | undefined;
  let estimatedScaleOrVolatility: number | undefined;
  let degreesOfFreedom: number | undefined;
  let initialStateLevel: number | undefined;

  const preparedMethodInputs = new Map<
    ExecutableScientificMethodId,
    PreparedMethodExecutionBundle
  >();
  const supportedMethodSet = new Set<ScientificMethodId>();

  // Global event deduplication registries across all verified historical-observations submissions:
  const globalBinaryEvents = new Map<
    string,
    {
      readonly eventFamily: string;
      readonly canonicalEventKey: string;
      readonly eventId: string;
      readonly reports: ValidatedBinaryObservationReport[];
    }
  >();
  const pendingBinarySubmissions: PendingBinaryHistoricalSubmission[] = [];

  const globalPoissonEvents = new Map<
    string,
    {
      readonly eventFamily: string;
      readonly canonicalEventKey: string;
      readonly eventId: string;
      readonly reports: ValidatedPoissonObservationReport[];
    }
  >();
  const pendingPoissonSubmissions: PendingPoissonHistoricalSubmission[] = [];

  const globalMultinomialEvents = new Map<
    string,
    {
      readonly eventFamily: string;
      readonly canonicalEventKey: string;
      readonly eventId: string;
      readonly reports: ValidatedMultinomialObservationReport[];
    }
  >();
  const pendingMultinomialSubmissions: PendingMultinomialHistoricalSubmission[] =
    [];

  // Deduplicate caller-submitted evidence by evidenceId:
  const seenSubmissionIds = new Set<string>();

  for (let idx = 0; idx < submittedEvidence.length; idx++) {
    const rawSub = submittedEvidence[idx];
    if (!isPlainObject(rawSub)) {
      throw new ForecastPipelineRequestError(
        `submittedEvidence[${idx}] must be a non-null object`,
      );
    }

    const evidenceId =
      typeof rawSub.evidenceId === 'string' &&
      rawSub.evidenceId.trim().length > 0
        ? rawSub.evidenceId.trim()
        : `sub-${idx}`;

    if (seenSubmissionIds.has(evidenceId)) {
      assessmentNotes.push(
        `Skipped duplicate submittedEvidence entry with evidenceId '${evidenceId}' so duplicate submissions never double-count observations.`,
      );
      continue;
    }
    seenSubmissionIds.add(evidenceId);

    const cat = rawSub.category;
    if (
      typeof cat !== 'string' ||
      !ASSESSED_EVIDENCE_CATEGORIES.includes(cat as AssessedEvidenceCategory)
    ) {
      throw new ForecastPipelineRequestError(
        `submittedEvidence[${idx}].category must be one of [${ASSESSED_EVIDENCE_CATEGORIES.join(', ')}], received '${String(cat)}'`,
      );
    }

    // Handle explicit unsupported-or-unverified-claim:
    if (cat === 'unsupported-or-unverified-claim') {
      const sub = rawSub as UnsupportedOrUnverifiedClaimSubmission;
      const claimSummary =
        typeof sub.claimSummary === 'string' &&
        sub.claimSummary.trim().length > 0
          ? sub.claimSummary.trim()
          : 'Unverified or unsupported claim';
      const originLabel = sub.origin ?? 'other';
      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: 'unsupported-or-unverified-claim',
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
        trustTier: 'caller-declared-unverified',
        verificationOutcome: 'downgraded-no-trusted-verifier',
        verifiedByVerifierId: null,
        verificationArtifactRef: null,
        title:
          typeof sub.title === 'string' && sub.title.trim().length > 0
            ? sub.title.trim()
            : claimSummary,
        publisher:
          typeof sub.publisher === 'string' && sub.publisher.trim().length > 0
            ? sub.publisher.trim()
            : 'unverified-origin',
        url: typeof sub.url === 'string' ? sub.url : '',
        publishedAt:
          typeof sub.publishedAt === 'string' &&
          isValidIsoDateTime(sub.publishedAt)
            ? sub.publishedAt
            : null,
        retrievedAt: referenceTime,
        sourceProvider: `caller:${originLabel}`,
        isPrimarySourceVerified: false,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([]),
        assessmentNote: `Quarantined as unsupported-or-unverified-claim (origin: '${originLabel}'): ${claimSummary}. Never used as empirical evidence.`,
      });
      declaredUnverifiedEvidence.push(record);
      unsupportedOrUnverifiedClaims.push(record);
      allProvenanceRecords.push(record);
      assessmentNotes.push(record.assessmentNote);
      continue;
    }

    // Handle caller-submitted documentary-evidence:
    if (cat === 'documentary-evidence') {
      const sub = rawSub as DocumentaryEvidenceSubmission;
      const title = typeof sub.title === 'string' ? sub.title.trim() : '';
      const publisher =
        typeof sub.publisher === 'string' ? sub.publisher.trim() : '';
      const url = typeof sub.url === 'string' ? sub.url.trim() : '';
      const publishedAt =
        typeof sub.publishedAt === 'string' ? sub.publishedAt.trim() : '';
      const pubMs = isValidIsoDateTime(publishedAt)
        ? parseIsoDateTimeMs(publishedAt)
        : null;

      if (
        title.length === 0 ||
        publisher.length === 0 ||
        !isValidPublicHttpUrl(url) ||
        pubMs === null ||
        pubMs > referenceMs
      ) {
        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'documentary-evidence',
          effectiveCategory: 'unsupported-or-unverified-claim',
          origin: 'caller-submission',
          trustTier: 'quarantined-invalid',
          verificationOutcome: 'rejected-integrity-or-schema-gate',
          ...(sub.isPrimarySourceVerified !== undefined
            ? { claimedPrimarySourceVerified: sub.isPrimarySourceVerified }
            : {}),
          verifiedByVerifierId: null,
          verificationArtifactRef: null,
          title: title || evidenceId,
          publisher: publisher || 'unknown',
          url,
          publishedAt: pubMs !== null ? publishedAt : null,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:documentary',
          isPrimarySourceVerified: false,
          usableForQuantitativeMethods: false,
          supportedMethodIds: Object.freeze([]),
          supportedDataChannels: Object.freeze([]),
          mergedSourceCitations: Object.freeze([]),
          assessmentNote:
            'Documentary submission lacked valid title, publisher, public HTTP(S) URL, or chronological timestamp <= referenceTime and was downgraded to unsupported-or-unverified-claim.',
        });
        unsupportedOrUnverifiedClaims.push(record);
        allProvenanceRecords.push(record);
        assessmentNotes.push(record.assessmentNote);
        continue;
      }

      // Check trusted verifier for documentary primary-source status (caller boolean never self-verifies):
      let docVerifiedPrimary = false;
      let docVerifierId: string | null = null;
      let docArtifactRef: string | null = null;
      let docOutcome: EvidenceVerificationOutcome =
        'downgraded-no-trusted-verifier';
      if (evidenceVerifier !== undefined) {
        const decision = evidenceVerifier({
          evidenceId,
          submission: sub,
          outcomeSpace,
          referenceTime,
          harvestedItems: harvestResult.items,
        });
        if (
          isPlainObject(decision) &&
          typeof decision.verifierId === 'string' &&
          decision.verifierId.trim().length > 0 &&
          typeof decision.rationale === 'string' &&
          decision.rationale.trim().length > 0 &&
          decision.verifiedEmpirical === true
        ) {
          docVerifiedPrimary = decision.isPrimarySourceVerified === true;
          docVerifierId = decision.verifierId.trim();
          docArtifactRef =
            typeof decision.verificationArtifactRef === 'string' &&
            decision.verificationArtifactRef.trim().length > 0
              ? decision.verificationArtifactRef.trim()
              : null;
          docOutcome = 'verified-by-trusted-verifier';
        }
      }

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: 'documentary-evidence',
        effectiveCategory: 'documentary-evidence',
        origin: 'caller-submission',
        trustTier: docVerifiedPrimary
          ? 'independently-verified-empirical'
          : 'caller-declared-unverified',
        verificationOutcome: docOutcome,
        ...(sub.isPrimarySourceVerified !== undefined
          ? { claimedPrimarySourceVerified: sub.isPrimarySourceVerified }
          : {}),
        verifiedByVerifierId: docVerifierId,
        verificationArtifactRef: docArtifactRef,
        title,
        publisher,
        url,
        publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: 'caller:documentary',
        isPrimarySourceVerified: docVerifiedPrimary,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([
          Object.freeze({ evidenceId, publisher, url, publishedAt }),
        ]),
        assessmentNote:
          'Caller-submitted documentary evidence preserved for provenance; qualitative text is never converted into numerical likelihoods or sample sizes, and caller-supplied isPrimarySourceVerified is never trusted without an independent EvidenceVerifier.',
      });
      documentaryEvidence.push(record);
      allProvenanceRecords.push(record);
      continue;
    }

    // Common scientific-integrity gates for quantitative submissions
    // ('historical-observations', 'structured-numerical-dataset', 'statistical-sufficient-statistics'):
    const qSub = rawSub as
      | HistoricalObservationsSubmission
      | StructuredNumericalDatasetSubmission
      | StatisticalSufficientStatisticsSubmission;

    const title = typeof qSub.title === 'string' ? qSub.title.trim() : '';
    const publisher =
      typeof qSub.publisher === 'string' ? qSub.publisher.trim() : '';
    const url = typeof qSub.url === 'string' ? qSub.url.trim() : '';
    const publishedAt =
      typeof qSub.publishedAt === 'string' ? qSub.publishedAt.trim() : '';
    const pubMs = isValidIsoDateTime(publishedAt)
      ? parseIsoDateTimeMs(publishedAt)
      : null;

    const integrityRejectionReasons: string[] = [];
    if (qSub.isAiGenerated === true) {
      integrityRejectionReasons.push(
        'AI-generated claims are not verified empirical evidence and cannot be used as statistical observations or sufficient statistics',
      );
    }
    if (qSub.derivedFromDocOrSourceCount === true) {
      integrityRejectionReasons.push(
        'Counts derived from article counts or source counts cannot be treated as statistical sample sizes or event frequencies',
      );
    }
    if (qSub.derivedFromRelevanceScore === true) {
      integrityRejectionReasons.push(
        'Values derived from thematic relevance scores cannot be treated as statistical weights, likelihoods, or sufficient statistics',
      );
    }
    if (qSub.verifiedEmpirical === false) {
      integrityRejectionReasons.push(
        'Submission is explicitly marked verifiedEmpirical = false',
      );
    }
    if (
      title.length === 0 ||
      publisher.length === 0 ||
      !isValidPublicHttpUrl(url)
    ) {
      integrityRejectionReasons.push(
        'Quantitative evidence requires non-empty title, publisher, and valid public HTTP(S) provenance URL',
      );
    }
    if (pubMs === null || pubMs > referenceMs) {
      integrityRejectionReasons.push(
        `Quantitative evidence requires a valid ISO-8601 publishedAt timestamp <= referenceTime (${referenceTime})`,
      );
    }

    if (integrityRejectionReasons.length > 0) {
      const reasonText = `Rejected quantitative submission '${evidenceId}' (${cat}) at scientific integrity gate: ${integrityRejectionReasons.join('; ')}.`;
      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: cat as AssessedEvidenceCategory,
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
        trustTier: 'quarantined-invalid',
        verificationOutcome: 'rejected-integrity-or-schema-gate',
        ...(qSub.verifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: qSub.verifiedEmpirical }
          : {}),
        ...(qSub.isPrimarySourceVerified !== undefined
          ? { claimedPrimarySourceVerified: qSub.isPrimarySourceVerified }
          : {}),
        verifiedByVerifierId: null,
        verificationArtifactRef: null,
        title: title || evidenceId,
        publisher: publisher || 'unverified',
        url,
        publishedAt: pubMs !== null ? publishedAt : null,
        retrievedAt: referenceTime,
        sourceProvider: `caller:${cat}`,
        isPrimarySourceVerified: false,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([]),
        assessmentNote: reasonText,
      });
      unsupportedOrUnverifiedClaims.push(record);
      allProvenanceRecords.push(record);
      assessmentNotes.push(reasonText);
      continue;
    }

    const baseCitation: EvidenceSourceCitation = Object.freeze({
      evidenceId,
      publisher,
      url,
      publishedAt,
    });

    /* -------------------------------------------------------------------
       Explicit Evidence Trust & Verification Boundary Gate
       -------------------------------------------------------------------
       Caller-supplied booleans (`verifiedEmpirical: true`,
       `isPrimarySourceVerified: true`), publisher names, URLs, titles, or
       timestamps NEVER independently establish empirical verification.
       Without a successful decision from a trusted `evidenceVerifier`, the
       submission is preserved as declared/unverified evidence and prevented
       from entering verified quantitative channels.
       ------------------------------------------------------------------- */
    if (evidenceVerifier === undefined) {
      const downgradeNote = `Downgraded caller-submitted '${cat}' ('${evidenceId}', publisher='${publisher}', url='${url}', claimedVerifiedEmpirical=${String(qSub.verifiedEmpirical)}) to declared/unverified evidence: caller-supplied booleans, publisher names, URLs, titles, or timestamps cannot independently establish empirical verification without a trusted server-side evidenceVerifier.`;
      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: cat as AssessedEvidenceCategory,
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
        trustTier: 'caller-declared-unverified',
        verificationOutcome: 'downgraded-no-trusted-verifier',
        ...(qSub.verifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: qSub.verifiedEmpirical }
          : {}),
        ...(qSub.isPrimarySourceVerified !== undefined
          ? { claimedPrimarySourceVerified: qSub.isPrimarySourceVerified }
          : {}),
        verifiedByVerifierId: null,
        verificationArtifactRef: null,
        title,
        publisher,
        url,
        publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: `caller:${cat}`,
        isPrimarySourceVerified: false,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([baseCitation]),
        assessmentNote: downgradeNote,
      });
      declaredUnverifiedEvidence.push(record);
      unsupportedOrUnverifiedClaims.push(record);
      allProvenanceRecords.push(record);
      assessmentNotes.push(downgradeNote);
      continue;
    }

    const verificationDecision = evidenceVerifier({
      evidenceId,
      submission: qSub,
      outcomeSpace,
      referenceTime,
      harvestedItems: harvestResult.items,
    });

    const verifierIdValid =
      isPlainObject(verificationDecision) &&
      typeof verificationDecision.verifierId === 'string' &&
      verificationDecision.verifierId.trim().length > 0;
    const rationaleValid =
      isPlainObject(verificationDecision) &&
      typeof verificationDecision.rationale === 'string' &&
      verificationDecision.rationale.trim().length > 0;

    if (
      !verifierIdValid ||
      !rationaleValid ||
      verificationDecision.verifiedEmpirical !== true
    ) {
      const verifierId = verifierIdValid
        ? verificationDecision.verifierId.trim()
        : null;
      const artifactRef =
        isPlainObject(verificationDecision) &&
        typeof verificationDecision.verificationArtifactRef === 'string' &&
        verificationDecision.verificationArtifactRef.trim().length > 0
          ? verificationDecision.verificationArtifactRef.trim()
          : null;
      const rejectionRationale = rationaleValid
        ? verificationDecision.rationale.trim()
        : 'Trusted evidenceVerifier did not return a valid verifiedEmpirical=true decision with non-empty verifierId and rationale.';
      const rejectNote = `Rejected caller-submitted '${cat}' ('${evidenceId}', publisher='${publisher}', url='${url}', claimedVerifiedEmpirical=${String(qSub.verifiedEmpirical)}) at trusted verification boundary (verifier='${verifierId ?? 'invalid'}'): ${rejectionRationale}`;

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: cat as AssessedEvidenceCategory,
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
        trustTier: 'caller-declared-unverified',
        verificationOutcome: 'rejected-by-trusted-verifier',
        ...(qSub.verifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: qSub.verifiedEmpirical }
          : {}),
        ...(qSub.isPrimarySourceVerified !== undefined
          ? { claimedPrimarySourceVerified: qSub.isPrimarySourceVerified }
          : {}),
        verifiedByVerifierId: verifierId,
        verificationArtifactRef: artifactRef,
        title,
        publisher,
        url,
        publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: `caller:${cat}`,
        isPrimarySourceVerified: false,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([baseCitation]),
        assessmentNote: rejectNote,
      });
      declaredUnverifiedEvidence.push(record);
      unsupportedOrUnverifiedClaims.push(record);
      allProvenanceRecords.push(record);
      assessmentNotes.push(rejectNote);
      continue;
    }

    const trustMetadata: VerifiedSubmissionTrustMetadata = Object.freeze({
      isPrimarySourceVerified:
        verificationDecision.isPrimarySourceVerified === true,
      verifiedByVerifierId: verificationDecision.verifierId.trim(),
      verificationArtifactRef:
        typeof verificationDecision.verificationArtifactRef === 'string' &&
        verificationDecision.verificationArtifactRef.trim().length > 0
          ? verificationDecision.verificationArtifactRef.trim()
          : null,
      rationale: verificationDecision.rationale.trim(),
      verifiedEventIdSet:
        Array.isArray(verificationDecision.verifiedEventIds)
          ? new Set(
              verificationDecision.verifiedEventIds
                .filter((id): id is string => typeof id === 'string')
                .map((id) => id.trim())
                .filter((id) => id.length > 0),
            )
          : null,
      ...(qSub.verifiedEmpirical !== undefined
        ? { claimedVerifiedEmpirical: qSub.verifiedEmpirical }
        : {}),
      ...(qSub.isPrimarySourceVerified !== undefined
        ? { claimedPrimarySourceVerified: qSub.isPrimarySourceVerified }
        : {}),
    });

    if (qSub.lowConfidenceEvidence === true) {
      lowConfidenceEvidence = true;
    }

    /* -------------------------------------------------------------------
       Category 2: Historical Observations (`historical-observations`)
       -------------------------------------------------------------------
       Validates every observation field strictly and registers valid
       observations into the pipeline-wide global deduplication registry.
       ------------------------------------------------------------------- */
    if (cat === 'historical-observations') {
      const hSub = qSub as HistoricalObservationsSubmission;
      const schema = hSub.observationSchema;
      if (!isPlainObject(schema) || typeof schema.kind !== 'string') {
        throw new ForecastPipelineRequestError(
          `submittedEvidence[${idx}] ('${evidenceId}') has malformed observationSchema`,
        );
      }

      if (schema.kind === 'binary-trials') {
        if (
          (schema.successOutcomeIndex !== 0 &&
            schema.successOutcomeIndex !== 1) ||
          !isPlainObject(schema.prior) ||
          !isPositiveFiniteNumber(schema.prior.alpha) ||
          !isPositiveFiniteNumber(schema.prior.beta) ||
          !Array.isArray(schema.observations)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') binary-trials schema requires successOutcomeIndex (0 | 1), positive finite prior { alpha, beta }, and observations array`,
          );
        }

        const schemaEventFamily =
          typeof schema.eventFamily === 'string' &&
          schema.eventFamily.trim().length > 0
            ? schema.eventFamily.trim()
            : 'binary-trials';
        const submissionCanonicalKeys: string[] = [];

        for (let obsIdx = 0; obsIdx < schema.observations.length; obsIdx++) {
          const obs = schema.observations[obsIdx];
          if (!isPlainObject(obs)) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'binary-trials',
              rawEventId: null,
              invalidFields: Object.freeze(['observation']),
              disposition: 'quarantined-observation',
              explanation: `Quarantined binary observation at index ${obsIdx} in '${evidenceId}': observation must be a non-null plain object.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const rawEventId =
            typeof obs.eventId === 'string' && obs.eventId.trim().length > 0
              ? obs.eventId.trim()
              : null;
          const invalidFields: string[] = [];
          const reasons: string[] = [];

          if (rawEventId === null) {
            invalidFields.push('eventId');
            reasons.push('eventId must be a non-empty string');
          }
          if (obs.isAiGenerated === true) {
            invalidFields.push('isAiGenerated');
            reasons.push('AI-generated observations cannot be used as empirical trials');
          }
          if (obs.verifiedEmpirical === false) {
            invalidFields.push('verifiedEmpirical');
            reasons.push('observation is explicitly marked verifiedEmpirical=false');
          }
          if (
            rawEventId !== null &&
            trustMetadata.verifiedEventIdSet !== null &&
            !trustMetadata.verifiedEventIdSet.has(rawEventId)
          ) {
            invalidFields.push('eventId');
            reasons.push(
              `eventId '${rawEventId}' was not included in the trusted verifier's verifiedEventIds allowlist`,
            );
          }

          const obsPublisher =
            typeof obs.publisher === 'string' ? obs.publisher.trim() : '';
          if (obsPublisher.length === 0) {
            invalidFields.push('publisher');
            reasons.push('publisher must be a non-empty string');
          }

          const obsSourceUrl =
            typeof obs.sourceUrl === 'string' ? obs.sourceUrl.trim() : '';
          if (!isValidPublicHttpUrl(obsSourceUrl)) {
            invalidFields.push('sourceUrl');
            reasons.push('sourceUrl must be a valid public HTTP(S) URL');
          }

          const obsTime =
            typeof obs.observedAt === 'string' ? obs.observedAt.trim() : '';
          const obsMs = isValidIsoDateTime(obsTime)
            ? parseIsoDateTimeMs(obsTime)
            : null;
          if (obsMs === null || obsMs > referenceMs) {
            invalidFields.push('observedAt');
            reasons.push(
              `observedAt must be a valid ISO-8601 timestamp <= referenceTime (${referenceTime})`,
            );
          }

          // Strict binary outcome validation: ONLY 1, 'success', 0, or 'failure' are accepted!
          // Never silently map arbitrary values to 0.
          const rawOutcome = (obs as { outcome?: unknown }).outcome;
          const isValidSuccessOutcome =
            rawOutcome === 1 || rawOutcome === 'success';
          const isValidFailureOutcome =
            rawOutcome === 0 || rawOutcome === 'failure';
          if (!isValidSuccessOutcome && !isValidFailureOutcome) {
            invalidFields.push('outcome');
            reasons.push(
              `outcome must be strictly 1, 'success', 0, or 'failure', received ${JSON.stringify(rawOutcome)}`,
            );
          }

          const rawWeight = (obs as { weight?: unknown }).weight;
          if (
            rawWeight !== undefined &&
            !isPositiveFiniteNumber(rawWeight)
          ) {
            invalidFields.push('weight');
            reasons.push(
              `weight must be a positive finite number when provided, received ${String(rawWeight)}`,
            );
          }

          if (invalidFields.length > 0) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'binary-trials',
              rawEventId,
              invalidFields: Object.freeze(invalidFields),
              disposition: 'quarantined-observation',
              explanation: `Quarantined binary observation ${rawEventId !== null ? `'${rawEventId}' ` : ''}(index ${obsIdx}) in '${evidenceId}': ${reasons.join('; ')}.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const eventFamily =
            typeof obs.eventFamily === 'string' &&
            obs.eventFamily.trim().length > 0
              ? obs.eventFamily.trim()
              : schemaEventFamily;
          const canonicalEventKey = `binary-trials::${eventFamily}::${rawEventId!}`;
          const realizedOutcomeIndex: 0 | 1 = isValidSuccessOutcome
            ? schema.successOutcomeIndex
            : schema.successOutcomeIndex === 0
              ? 1
              : 0;

          const citation: EvidenceSourceCitation = Object.freeze({
            sourceId: rawEventId!,
            evidenceId,
            publisher: obsPublisher,
            url: obsSourceUrl,
            publishedAt: obsTime,
          });

          let entry = globalBinaryEvents.get(canonicalEventKey);
          if (!entry) {
            entry = {
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              reports: [],
            };
            globalBinaryEvents.set(canonicalEventKey, entry);
          }
          entry.reports.push(
            Object.freeze({
              evidenceId,
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              realizedOutcomeIndex,
              ...(typeof rawWeight === 'number' ? { weight: rawWeight } : {}),
              citation,
            }),
          );
          if (!submissionCanonicalKeys.includes(canonicalEventKey)) {
            submissionCanonicalKeys.push(canonicalEventKey);
          }
        }

        pendingBinarySubmissions.push(
          Object.freeze({
            evidenceId,
            title,
            publisher,
            url,
            publishedAt,
            baseCitation,
            trust: trustMetadata,
            successOutcomeIndex: schema.successOutcomeIndex,
            prior: Object.freeze({
              alpha: schema.prior.alpha,
              beta: schema.prior.beta,
            }),
            enableWeightedKishChannel: schema.enableWeightedKishChannel === true,
            ...(schema.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: schema.credibleIntervalLevel }
              : {}),
            rawObservationCount: schema.observations.length,
            canonicalEventKeys: Object.freeze(submissionCanonicalKeys),
          }),
        );
        continue;
      }

      if (schema.kind === 'poisson-arrivals') {
        if (
          (schema.eventOutcomeIndex !== 0 && schema.eventOutcomeIndex !== 1) ||
          !isPlainObject(schema.prior) ||
          !isPositiveFiniteNumber(schema.prior.shape) ||
          !isPositiveFiniteNumber(schema.prior.rate) ||
          !isPlainObject(schema.historicalExposure) ||
          !isPositiveFiniteNumber(schema.historicalExposure.exposureDuration) ||
          typeof schema.historicalExposure.exposureUnit !== 'string' ||
          schema.historicalExposure.exposureUnit.trim().length === 0 ||
          !isPlainObject(schema.forecastExposure) ||
          !isPositiveFiniteNumber(schema.forecastExposure.exposureDuration) ||
          !Array.isArray(schema.events)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-arrivals schema is malformed`,
          );
        }

        const histUnit = schema.historicalExposure.exposureUnit.trim();
        const foreUnit =
          schema.forecastExposure.exposureUnit !== undefined
            ? schema.forecastExposure.exposureUnit.trim()
            : histUnit;
        if (foreUnit.length === 0 || foreUnit !== histUnit) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-arrivals schema requires matching historicalExposure.exposureUnit ('${histUnit}') and forecastExposure.exposureUnit ('${foreUnit}')`,
          );
        }

        const schemaEventFamily =
          typeof schema.eventFamily === 'string' &&
          schema.eventFamily.trim().length > 0
            ? schema.eventFamily.trim()
            : 'poisson-arrivals';
        const exposureWindowId =
          typeof schema.historicalExposure.exposureWindowId === 'string' &&
          schema.historicalExposure.exposureWindowId.trim().length > 0
            ? schema.historicalExposure.exposureWindowId.trim()
            : `default-window:${histUnit}:${schema.historicalExposure.exposureDuration}`;
        const submissionCanonicalKeys: string[] = [];

        for (let obsIdx = 0; obsIdx < schema.events.length; obsIdx++) {
          const ev = schema.events[obsIdx];
          if (!isPlainObject(ev)) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'poisson-arrivals',
              rawEventId: null,
              invalidFields: Object.freeze(['event']),
              disposition: 'quarantined-observation',
              explanation: `Quarantined Poisson arrival record at index ${obsIdx} in '${evidenceId}': record must be a non-null plain object.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const rawEventId =
            typeof ev.eventId === 'string' && ev.eventId.trim().length > 0
              ? ev.eventId.trim()
              : null;
          const invalidFields: string[] = [];
          const reasons: string[] = [];

          if (rawEventId === null) {
            invalidFields.push('eventId');
            reasons.push('eventId must be a non-empty string');
          }
          if (ev.isAiGenerated === true) {
            invalidFields.push('isAiGenerated');
            reasons.push('AI-generated arrival events cannot be used as empirical observations');
          }
          if (ev.verifiedEmpirical === false) {
            invalidFields.push('verifiedEmpirical');
            reasons.push('event record is explicitly marked verifiedEmpirical=false');
          }
          if (
            rawEventId !== null &&
            trustMetadata.verifiedEventIdSet !== null &&
            !trustMetadata.verifiedEventIdSet.has(rawEventId)
          ) {
            invalidFields.push('eventId');
            reasons.push(
              `eventId '${rawEventId}' was not included in the trusted verifier's verifiedEventIds allowlist`,
            );
          }

          const evPublisher =
            typeof ev.publisher === 'string' ? ev.publisher.trim() : '';
          if (evPublisher.length === 0) {
            invalidFields.push('publisher');
            reasons.push('publisher must be a non-empty string');
          }

          const evSourceUrl =
            typeof ev.sourceUrl === 'string' ? ev.sourceUrl.trim() : '';
          if (!isValidPublicHttpUrl(evSourceUrl)) {
            invalidFields.push('sourceUrl');
            reasons.push('sourceUrl must be a valid public HTTP(S) URL');
          }

          const occTime =
            typeof ev.occurredAt === 'string' ? ev.occurredAt.trim() : '';
          const occMs = isValidIsoDateTime(occTime)
            ? parseIsoDateTimeMs(occTime)
            : null;
          if (occMs === null || occMs > referenceMs) {
            invalidFields.push('occurredAt');
            reasons.push(
              `occurredAt must be a valid ISO-8601 timestamp <= referenceTime (${referenceTime})`,
            );
          }

          // Strict check for any unexpected outcome or eventCount field on Poisson event record:
          const extraOutcome = (ev as Record<string, unknown>).outcome;
          if (
            extraOutcome !== undefined &&
            extraOutcome !== 1 &&
            extraOutcome !== 'arrival' &&
            extraOutcome !== 'event'
          ) {
            invalidFields.push('outcome');
            reasons.push(
              `Poisson arrival event record has invalid outcome ${JSON.stringify(extraOutcome)}`,
            );
          }
          const extraCount = (ev as Record<string, unknown>).eventCount;
          if (extraCount !== undefined && extraCount !== 1) {
            invalidFields.push('eventCount');
            reasons.push(
              `Poisson arrival event record must represent a single arrival (eventCount=1), received ${String(extraCount)}`,
            );
          }

          if (invalidFields.length > 0) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'poisson-arrivals',
              rawEventId,
              invalidFields: Object.freeze(invalidFields),
              disposition: 'quarantined-observation',
              explanation: `Quarantined Poisson arrival observation ${rawEventId !== null ? `'${rawEventId}' ` : ''}(index ${obsIdx}) in '${evidenceId}': ${reasons.join('; ')}.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const eventFamily =
            typeof ev.eventFamily === 'string' &&
            ev.eventFamily.trim().length > 0
              ? ev.eventFamily.trim()
              : schemaEventFamily;
          const canonicalEventKey = `poisson-arrivals::${eventFamily}::${rawEventId!}`;
          const citation: EvidenceSourceCitation = Object.freeze({
            sourceId: rawEventId!,
            evidenceId,
            publisher: evPublisher,
            url: evSourceUrl,
            publishedAt: occTime,
          });

          let entry = globalPoissonEvents.get(canonicalEventKey);
          if (!entry) {
            entry = {
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              reports: [],
            };
            globalPoissonEvents.set(canonicalEventKey, entry);
          }
          entry.reports.push(
            Object.freeze({
              evidenceId,
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              eventOutcomeIndex: schema.eventOutcomeIndex,
              citation,
            }),
          );
          if (!submissionCanonicalKeys.includes(canonicalEventKey)) {
            submissionCanonicalKeys.push(canonicalEventKey);
          }
        }

        pendingPoissonSubmissions.push(
          Object.freeze({
            evidenceId,
            title,
            publisher,
            url,
            publishedAt,
            baseCitation,
            trust: trustMetadata,
            eventOutcomeIndex: schema.eventOutcomeIndex,
            prior: Object.freeze({
              shape: schema.prior.shape,
              rate: schema.prior.rate,
            }),
            historicalExposureDuration:
              schema.historicalExposure.exposureDuration,
            historicalExposureUnit: histUnit,
            exposureWindowId,
            forecastExposureDuration: schema.forecastExposure.exposureDuration,
            forecastExposureUnit: foreUnit,
            ...(schema.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: schema.credibleIntervalLevel }
              : {}),
            rawEventCount: schema.events.length,
            canonicalEventKeys: Object.freeze(submissionCanonicalKeys),
          }),
        );
        continue;
      }

      if (schema.kind === 'multinomial-trials') {
        if (
          !isPlainObject(schema.prior) ||
          !Array.isArray(schema.prior.alpha) ||
          schema.prior.alpha.length !== outcomeCount ||
          !schema.prior.alpha.every((a) => isPositiveFiniteNumber(a)) ||
          !Array.isArray(schema.observations)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') multinomial-trials schema requires prior.alpha of length ${outcomeCount} with positive finite numbers and an observations array`,
          );
        }

        const schemaEventFamily =
          typeof schema.eventFamily === 'string' &&
          schema.eventFamily.trim().length > 0
            ? schema.eventFamily.trim()
            : 'multinomial-trials';
        const submissionCanonicalKeys: string[] = [];

        for (let obsIdx = 0; obsIdx < schema.observations.length; obsIdx++) {
          const obs = schema.observations[obsIdx];
          if (!isPlainObject(obs)) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'multinomial-trials',
              rawEventId: null,
              invalidFields: Object.freeze(['observation']),
              disposition: 'quarantined-observation',
              explanation: `Quarantined multinomial observation at index ${obsIdx} in '${evidenceId}': observation must be a non-null plain object.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const rawEventId =
            typeof obs.eventId === 'string' && obs.eventId.trim().length > 0
              ? obs.eventId.trim()
              : null;
          const invalidFields: string[] = [];
          const reasons: string[] = [];

          if (rawEventId === null) {
            invalidFields.push('eventId');
            reasons.push('eventId must be a non-empty string');
          }
          if (obs.isAiGenerated === true) {
            invalidFields.push('isAiGenerated');
            reasons.push('AI-generated observations cannot be used as empirical trials');
          }
          if (obs.verifiedEmpirical === false) {
            invalidFields.push('verifiedEmpirical');
            reasons.push('observation is explicitly marked verifiedEmpirical=false');
          }
          if (
            rawEventId !== null &&
            trustMetadata.verifiedEventIdSet !== null &&
            !trustMetadata.verifiedEventIdSet.has(rawEventId)
          ) {
            invalidFields.push('eventId');
            reasons.push(
              `eventId '${rawEventId}' was not included in the trusted verifier's verifiedEventIds allowlist`,
            );
          }

          const obsPublisher =
            typeof obs.publisher === 'string' ? obs.publisher.trim() : '';
          if (obsPublisher.length === 0) {
            invalidFields.push('publisher');
            reasons.push('publisher must be a non-empty string');
          }

          const obsSourceUrl =
            typeof obs.sourceUrl === 'string' ? obs.sourceUrl.trim() : '';
          if (!isValidPublicHttpUrl(obsSourceUrl)) {
            invalidFields.push('sourceUrl');
            reasons.push('sourceUrl must be a valid public HTTP(S) URL');
          }

          const obsTime =
            typeof obs.observedAt === 'string' ? obs.observedAt.trim() : '';
          const obsMs = isValidIsoDateTime(obsTime)
            ? parseIsoDateTimeMs(obsTime)
            : null;
          if (obsMs === null || obsMs > referenceMs) {
            invalidFields.push('observedAt');
            reasons.push(
              `observedAt must be a valid ISO-8601 timestamp <= referenceTime (${referenceTime})`,
            );
          }

          // Strict multinomial outcome validation:
          const rawIndex = (obs as { outcomeIndex?: unknown }).outcomeIndex;
          const rawLabel = (obs as { outcomeLabel?: unknown }).outcomeLabel;
          let resolvedIndex: number | null = null;

          if (rawIndex === undefined && rawLabel === undefined) {
            invalidFields.push('outcomeIndex');
            reasons.push(
              'multinomial observation requires outcomeIndex or outcomeLabel',
            );
          } else {
            if (rawIndex !== undefined) {
              if (
                !isNonNegativeSafeInteger(rawIndex) ||
                rawIndex >= outcomeCount
              ) {
                invalidFields.push('outcomeIndex');
                reasons.push(
                  `outcomeIndex must be a safe integer in [0, ${outcomeCount - 1}], received ${String(rawIndex)}`,
                );
              } else {
                resolvedIndex = rawIndex;
              }
            }
            if (rawLabel !== undefined) {
              const labelIdx =
                typeof rawLabel === 'string'
                  ? outcomeSpace.outcomeLabels.indexOf(rawLabel)
                  : -1;
              if (labelIdx === -1) {
                invalidFields.push('outcomeLabel');
                reasons.push(
                  `outcomeLabel ${JSON.stringify(rawLabel)} is not in outcomeSpace.outcomeLabels [${outcomeSpace.outcomeLabels.join(', ')}]`,
                );
              } else if (resolvedIndex !== null && resolvedIndex !== labelIdx) {
                invalidFields.push('outcomeIndex', 'outcomeLabel');
                reasons.push(
                  `outcomeIndex (${resolvedIndex} -> '${outcomeSpace.outcomeLabels[resolvedIndex]}') conflicts with outcomeLabel '${String(rawLabel)}' (index ${labelIdx})`,
                );
              } else {
                resolvedIndex = labelIdx;
              }
            }
          }

          if (invalidFields.length > 0 || resolvedIndex === null) {
            const diag: InvalidObservationDiagnostic = Object.freeze({
              evidenceId,
              observationIndex: obsIdx,
              schemaKind: 'multinomial-trials',
              rawEventId,
              invalidFields: Object.freeze(invalidFields),
              disposition: 'quarantined-observation',
              explanation: `Quarantined multinomial observation ${rawEventId !== null ? `'${rawEventId}' ` : ''}(index ${obsIdx}) in '${evidenceId}': ${reasons.join('; ')}.`,
            });
            invalidObservationDiagnostics.push(diag);
            assessmentNotes.push(diag.explanation);
            continue;
          }

          const eventFamily =
            typeof obs.eventFamily === 'string' &&
            obs.eventFamily.trim().length > 0
              ? obs.eventFamily.trim()
              : schemaEventFamily;
          const canonicalEventKey = `multinomial-trials::${eventFamily}::${rawEventId!}`;
          const citation: EvidenceSourceCitation = Object.freeze({
            sourceId: rawEventId!,
            evidenceId,
            publisher: obsPublisher,
            url: obsSourceUrl,
            publishedAt: obsTime,
          });

          let entry = globalMultinomialEvents.get(canonicalEventKey);
          if (!entry) {
            entry = {
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              reports: [],
            };
            globalMultinomialEvents.set(canonicalEventKey, entry);
          }
          entry.reports.push(
            Object.freeze({
              evidenceId,
              eventFamily,
              canonicalEventKey,
              eventId: rawEventId!,
              outcomeIndex: resolvedIndex,
              citation,
            }),
          );
          if (!submissionCanonicalKeys.includes(canonicalEventKey)) {
            submissionCanonicalKeys.push(canonicalEventKey);
          }
        }

        pendingMultinomialSubmissions.push(
          Object.freeze({
            evidenceId,
            title,
            publisher,
            url,
            publishedAt,
            baseCitation,
            trust: trustMetadata,
            priorAlpha: Object.freeze([...schema.prior.alpha]),
            ...(schema.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: schema.credibleIntervalLevel }
              : {}),
            rawObservationCount: schema.observations.length,
            canonicalEventKeys: Object.freeze(submissionCanonicalKeys),
          }),
        );
        continue;
      }

      throw new ForecastPipelineRequestError(
        `Unsupported observationSchema.kind '${String((schema as { kind?: unknown }).kind)}'`,
      );
    }

    /* -------------------------------------------------------------------
       Category 3: Structured Numerical Dataset (`structured-numerical-dataset`)
       ------------------------------------------------------------------- */
    if (cat === 'structured-numerical-dataset') {
      const dSub = qSub as StructuredNumericalDatasetSubmission;
      const ds = dSub.dataset;
      if (!isPlainObject(ds) || typeof ds.kind !== 'string') {
        throw new ForecastPipelineRequestError(
          `submittedEvidence[${idx}] ('${evidenceId}') has malformed dataset payload`,
        );
      }

      if (ds.kind === 'binary-cohort-table') {
        if (
          (ds.successOutcomeIndex !== 0 && ds.successOutcomeIndex !== 1) ||
          !isNonNegativeSafeInteger(ds.successes) ||
          !isNonNegativeSafeInteger(ds.failures) ||
          ds.successes + ds.failures < 1 ||
          !isPlainObject(ds.prior) ||
          !isPositiveFiniteNumber(ds.prior.alpha) ||
          !isPositiveFiniteNumber(ds.prior.beta)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') binary-cohort-table requires non-negative integer successes/failures with total >= 1 and positive finite prior { alpha, beta }`,
          );
        }

        binaryTrialSuccesses = ds.successes;
        binaryTrialFailures = ds.failures;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('binary-trial-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('beta-binomial-conjugate');

        const betaInput: BetaBinomialExecutionInput = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          outcomeSpace,
          successOutcomeIndex: ds.successOutcomeIndex,
          prior: Object.freeze({ alpha: ds.prior.alpha, beta: ds.prior.beta }),
          observed: Object.freeze({
            successes: ds.successes,
            failures: ds.failures,
          }),
          ...(ds.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: ds.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('beta-binomial-conjugate', {
          methodId: 'beta-binomial-conjugate',
          executionInput: betaInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'structured-numerical-dataset',
          effectiveCategory: 'structured-numerical-dataset',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured binary cohort dataset (successes=${ds.successes}, failures=${ds.failures}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'weighted-binary-cohort-table') {
        if (
          (ds.successOutcomeIndex !== 0 && ds.successOutcomeIndex !== 1) ||
          typeof ds.weightedSuccessMass !== 'number' ||
          !Number.isFinite(ds.weightedSuccessMass) ||
          ds.weightedSuccessMass < 0 ||
          typeof ds.weightedFailureMass !== 'number' ||
          !Number.isFinite(ds.weightedFailureMass) ||
          ds.weightedFailureMass < 0 ||
          !isPositiveFiniteNumber(ds.sumSquaredWeights) ||
          !isNonNegativeSafeInteger(ds.observationCount) ||
          ds.observationCount < 1 ||
          !isPlainObject(ds.prior) ||
          !isPositiveFiniteNumber(ds.prior.alpha) ||
          !isPositiveFiniteNumber(ds.prior.beta)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') weighted-binary-cohort-table has invalid weighted masses, observationCount, or prior parameters`,
          );
        }

        const totalW = ds.weightedSuccessMass + ds.weightedFailureMass;
        const nEff =
          ds.sumSquaredWeights > 0
            ? (totalW * totalW) / ds.sumSquaredWeights
            : 0;
        weightedSampleSize = ds.observationCount;
        kishEffectiveSampleSize = nEff;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('weighted-binary-trials');
        availableChannelSet.add('kish-effective-sample-size');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('weighted-kish-effective-binomial');

        const kishInput: WeightedKishExecutionInput = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          outcomeSpace,
          successOutcomeIndex: ds.successOutcomeIndex,
          prior: Object.freeze({ alpha: ds.prior.alpha, beta: ds.prior.beta }),
          observed: Object.freeze({
            weightedSuccessMass: ds.weightedSuccessMass,
            weightedFailureMass: ds.weightedFailureMass,
            sumSquaredWeights: ds.sumSquaredWeights,
            observationCount: ds.observationCount,
          }),
          ...(ds.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: ds.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('weighted-kish-effective-binomial', {
          methodId: 'weighted-kish-effective-binomial',
          executionInput: kishInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'structured-numerical-dataset',
          effectiveCategory: 'structured-numerical-dataset',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'weighted-kish-effective-binomial',
          ] as const),
          supportedDataChannels: Object.freeze([
            'weighted-binary-trials',
            'kish-effective-sample-size',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured weighted binary cohort dataset (n=${ds.observationCount}, n_eff=${nEff.toFixed(4)}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'poisson-exposure-table') {
        if (
          (ds.eventOutcomeIndex !== 0 && ds.eventOutcomeIndex !== 1) ||
          !isNonNegativeSafeInteger(ds.eventCount) ||
          !isPositiveFiniteNumber(ds.exposureDuration) ||
          typeof ds.exposureUnit !== 'string' ||
          ds.exposureUnit.trim().length === 0 ||
          !isPositiveFiniteNumber(ds.forecastExposureDuration) ||
          !isPlainObject(ds.prior) ||
          !isPositiveFiniteNumber(ds.prior.shape) ||
          !isPositiveFiniteNumber(ds.prior.rate)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-exposure-table has invalid eventCount, exposureDuration, or prior parameters`,
          );
        }

        const foreUnit = ds.forecastExposureUnit ?? ds.exposureUnit;
        poissonEventCount = ds.eventCount;
        poissonExposureDuration = ds.exposureDuration;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('poisson-event-counts');
        availableChannelSet.add('continuous-exposure-duration');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('poisson-gamma-hazard');

        const poissonInput: PoissonGammaExecutionInput = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          outcomeSpace,
          eventOutcomeIndex: ds.eventOutcomeIndex,
          prior: Object.freeze({
            shape: ds.prior.shape,
            rate: ds.prior.rate,
            parameterization: 'shape-rate' as const,
          }),
          observed: Object.freeze({
            eventCount: ds.eventCount,
            exposureDuration: ds.exposureDuration,
            exposureUnit: ds.exposureUnit,
          }),
          forecast: Object.freeze({
            exposureDuration: ds.forecastExposureDuration,
            exposureUnit: foreUnit,
          }),
          exposureUnit: ds.exposureUnit,
          ...(ds.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: ds.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('poisson-gamma-hazard', {
          methodId: 'poisson-gamma-hazard',
          executionInput: poissonInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'structured-numerical-dataset',
          effectiveCategory: 'structured-numerical-dataset',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
          supportedDataChannels: Object.freeze([
            'poisson-event-counts',
            'continuous-exposure-duration',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured Poisson exposure dataset (k=${ds.eventCount}, T=${ds.exposureDuration} ${ds.exposureUnit}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'multinomial-contingency-table') {
        if (
          !Array.isArray(ds.counts) ||
          ds.counts.length !== outcomeCount ||
          !ds.counts.every((c) => isNonNegativeSafeInteger(c)) ||
          ds.counts.reduce((a, b) => a + b, 0) < 1 ||
          !isPlainObject(ds.prior) ||
          !Array.isArray(ds.prior.alpha) ||
          ds.prior.alpha.length !== outcomeCount ||
          !ds.prior.alpha.every((a) => isPositiveFiniteNumber(a))
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') multinomial-contingency-table requires counts and prior.alpha arrays of length ${outcomeCount}`,
          );
        }

        multinomialOutcomeCounts = Object.freeze([...ds.counts]);
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('multinomial-category-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('dirichlet-multinomial-symmetry');

        const dirichletInput: DirichletMultinomialExecutionInput =
          Object.freeze({
            methodId: 'dirichlet-multinomial-symmetry',
            outcomeSpace,
            prior: Object.freeze({ alpha: Object.freeze([...ds.prior.alpha]) }),
            observed: Object.freeze({ counts: Object.freeze([...ds.counts]) }),
            ...(ds.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: ds.credibleIntervalLevel }
              : {}),
          });
        preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
          methodId: 'dirichlet-multinomial-symmetry',
          executionInput: dirichletInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'structured-numerical-dataset',
          effectiveCategory: 'structured-numerical-dataset',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'dirichlet-multinomial-symmetry',
          ] as const),
          supportedDataChannels: Object.freeze([
            'multinomial-category-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured multinomial contingency table ([${ds.counts.join(', ')}]; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'continuous-state-trajectory-table') {
        if (
          !isNonNegativeSafeInteger(ds.observationCount) ||
          ds.observationCount < 1 ||
          typeof ds.estimatedDrift !== 'number' ||
          !Number.isFinite(ds.estimatedDrift) ||
          !isPositiveFiniteNumber(ds.estimatedScaleOrVolatility)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') continuous-state-trajectory-table has invalid observationCount, estimatedDrift, or estimatedScaleOrVolatility`,
          );
        }

        continuousTrajectoryObservations = ds.observationCount;
        estimatedDrift = ds.estimatedDrift;
        estimatedScaleOrVolatility = ds.estimatedScaleOrVolatility;
        hasVerifiableEmpiricalData = true;
        const channels: MethodDataChannelId[] = [
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
        ];
        const methods: ScientificMethodId[] = [];
        availableChannelSet.add('continuous-state-trajectory');
        availableChannelSet.add('drift-and-scale-estimates');

        if (ds.degreesOfFreedom !== undefined) {
          degreesOfFreedom = ds.degreesOfFreedom;
          availableChannelSet.add('tail-degrees-of-freedom');
          channels.push('tail-degrees-of-freedom');
          methods.push('student-t-terminal-diffusion');
          supportedMethodSet.add('student-t-terminal-diffusion');
        }
        if (
          ds.initialStateLevel !== undefined &&
          outcomeSpace.barrierLevel !== undefined &&
          outcomeSpace.barrierDirection !== undefined
        ) {
          initialStateLevel = ds.initialStateLevel;
          availableChannelSet.add('absorbing-barrier-specification');
          channels.push('absorbing-barrier-specification');
          methods.push('first-passage-barrier-diffusion');
          supportedMethodSet.add('first-passage-barrier-diffusion');
        }

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'structured-numerical-dataset',
          effectiveCategory: 'structured-numerical-dataset',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(methods),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous state trajectory dataset (n=${ds.observationCount}, drift=${ds.estimatedDrift}, scale=${ds.estimatedScaleOrVolatility}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      throw new ForecastPipelineRequestError(
        `Unsupported dataset.kind '${String((ds as { kind?: unknown }).kind)}'`,
      );
    }

    /* -------------------------------------------------------------------
       Category 4: Statistical Sufficient Statistics (`statistical-sufficient-statistics`)
       ------------------------------------------------------------------- */
    if (cat === 'statistical-sufficient-statistics') {
      const sSub = qSub as StatisticalSufficientStatisticsSubmission;
      const stats = sSub.statistics;
      if (!isPlainObject(stats) || typeof stats.targetMethodId !== 'string') {
        throw new ForecastPipelineRequestError(
          `submittedEvidence[${idx}] ('${evidenceId}') has malformed statistics payload`,
        );
      }

      if (stats.targetMethodId === 'beta-binomial-conjugate') {
        if (
          (stats.successOutcomeIndex !== 0 &&
            stats.successOutcomeIndex !== 1) ||
          !isNonNegativeSafeInteger(stats.successes) ||
          !isNonNegativeSafeInteger(stats.failures) ||
          stats.successes + stats.failures < 1 ||
          !isPlainObject(stats.prior) ||
          !isPositiveFiniteNumber(stats.prior.alpha) ||
          !isPositiveFiniteNumber(stats.prior.beta)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') beta-binomial-conjugate statistics require non-negative integer successes/failures with total >= 1 and positive finite prior { alpha, beta }`,
          );
        }

        binaryTrialSuccesses = stats.successes;
        binaryTrialFailures = stats.failures;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('binary-trial-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('beta-binomial-conjugate');

        const betaInput: BetaBinomialExecutionInput = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          outcomeSpace,
          successOutcomeIndex: stats.successOutcomeIndex,
          prior: Object.freeze({
            alpha: stats.prior.alpha,
            beta: stats.prior.beta,
          }),
          observed: Object.freeze({
            successes: stats.successes,
            failures: stats.failures,
          }),
          ...(stats.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: stats.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('beta-binomial-conjugate', {
          methodId: 'beta-binomial-conjugate',
          executionInput: betaInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'statistical-sufficient-statistics',
          effectiveCategory: 'statistical-sufficient-statistics',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Beta-Binomial sufficient statistics (successes=${stats.successes}, failures=${stats.failures}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'weighted-kish-effective-binomial') {
        if (
          (stats.successOutcomeIndex !== 0 &&
            stats.successOutcomeIndex !== 1) ||
          typeof stats.weightedSuccessMass !== 'number' ||
          !Number.isFinite(stats.weightedSuccessMass) ||
          stats.weightedSuccessMass < 0 ||
          typeof stats.weightedFailureMass !== 'number' ||
          !Number.isFinite(stats.weightedFailureMass) ||
          stats.weightedFailureMass < 0 ||
          !isPositiveFiniteNumber(stats.sumSquaredWeights) ||
          !isNonNegativeSafeInteger(stats.observationCount) ||
          stats.observationCount < 1 ||
          !isPlainObject(stats.prior) ||
          !isPositiveFiniteNumber(stats.prior.alpha) ||
          !isPositiveFiniteNumber(stats.prior.beta)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') weighted-kish-effective-binomial statistics have invalid weighted masses, observationCount, or prior parameters`,
          );
        }

        const totalW = stats.weightedSuccessMass + stats.weightedFailureMass;
        const nEff =
          stats.sumSquaredWeights > 0
            ? (totalW * totalW) / stats.sumSquaredWeights
            : 0;
        weightedSampleSize = stats.observationCount;
        kishEffectiveSampleSize = nEff;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('weighted-binary-trials');
        availableChannelSet.add('kish-effective-sample-size');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('weighted-kish-effective-binomial');

        const kishInput: WeightedKishExecutionInput = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          outcomeSpace,
          successOutcomeIndex: stats.successOutcomeIndex,
          prior: Object.freeze({
            alpha: stats.prior.alpha,
            beta: stats.prior.beta,
          }),
          observed: Object.freeze({
            weightedSuccessMass: stats.weightedSuccessMass,
            weightedFailureMass: stats.weightedFailureMass,
            sumSquaredWeights: stats.sumSquaredWeights,
            observationCount: stats.observationCount,
          }),
          ...(stats.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: stats.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('weighted-kish-effective-binomial', {
          methodId: 'weighted-kish-effective-binomial',
          executionInput: kishInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'statistical-sufficient-statistics',
          effectiveCategory: 'statistical-sufficient-statistics',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'weighted-kish-effective-binomial',
          ] as const),
          supportedDataChannels: Object.freeze([
            'weighted-binary-trials',
            'kish-effective-sample-size',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Kish weighted binomial sufficient statistics (n=${stats.observationCount}, n_eff=${nEff.toFixed(4)}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'poisson-gamma-hazard') {
        if (
          (stats.eventOutcomeIndex !== 0 && stats.eventOutcomeIndex !== 1) ||
          !isNonNegativeSafeInteger(stats.eventCount) ||
          !isPositiveFiniteNumber(stats.exposureDuration) ||
          typeof stats.exposureUnit !== 'string' ||
          stats.exposureUnit.trim().length === 0 ||
          !isPositiveFiniteNumber(stats.forecastExposureDuration) ||
          !isPlainObject(stats.prior) ||
          !isPositiveFiniteNumber(stats.prior.shape) ||
          !isPositiveFiniteNumber(stats.prior.rate)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-gamma-hazard statistics have invalid eventCount, exposureDuration, or prior parameters`,
          );
        }

        const foreUnit = stats.forecastExposureUnit ?? stats.exposureUnit;
        poissonEventCount = stats.eventCount;
        poissonExposureDuration = stats.exposureDuration;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('poisson-event-counts');
        availableChannelSet.add('continuous-exposure-duration');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('poisson-gamma-hazard');

        const poissonInput: PoissonGammaExecutionInput = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          outcomeSpace,
          eventOutcomeIndex: stats.eventOutcomeIndex,
          prior: Object.freeze({
            shape: stats.prior.shape,
            rate: stats.prior.rate,
            parameterization: 'shape-rate' as const,
          }),
          observed: Object.freeze({
            eventCount: stats.eventCount,
            exposureDuration: stats.exposureDuration,
            exposureUnit: stats.exposureUnit,
          }),
          forecast: Object.freeze({
            exposureDuration: stats.forecastExposureDuration,
            exposureUnit: foreUnit,
          }),
          exposureUnit: stats.exposureUnit,
          ...(stats.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: stats.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('poisson-gamma-hazard', {
          methodId: 'poisson-gamma-hazard',
          executionInput: poissonInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'statistical-sufficient-statistics',
          effectiveCategory: 'statistical-sufficient-statistics',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
          supportedDataChannels: Object.freeze([
            'poisson-event-counts',
            'continuous-exposure-duration',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Poisson-Gamma sufficient statistics (k=${stats.eventCount}, T=${stats.exposureDuration} ${stats.exposureUnit}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'dirichlet-multinomial-symmetry') {
        if (
          !Array.isArray(stats.counts) ||
          stats.counts.length !== outcomeCount ||
          !stats.counts.every((c) => isNonNegativeSafeInteger(c)) ||
          stats.counts.reduce((a, b) => a + b, 0) < 1 ||
          !isPlainObject(stats.prior) ||
          !Array.isArray(stats.prior.alpha) ||
          stats.prior.alpha.length !== outcomeCount ||
          !stats.prior.alpha.every((a) => isPositiveFiniteNumber(a))
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') dirichlet-multinomial-symmetry statistics require counts and prior.alpha arrays of length ${outcomeCount}`,
          );
        }

        multinomialOutcomeCounts = Object.freeze([...stats.counts]);
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('multinomial-category-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('dirichlet-multinomial-symmetry');

        const dirichletInput: DirichletMultinomialExecutionInput =
          Object.freeze({
            methodId: 'dirichlet-multinomial-symmetry',
            outcomeSpace,
            prior: Object.freeze({
              alpha: Object.freeze([...stats.prior.alpha]),
            }),
            observed: Object.freeze({
              counts: Object.freeze([...stats.counts]),
            }),
            ...(stats.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: stats.credibleIntervalLevel }
              : {}),
          });
        preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
          methodId: 'dirichlet-multinomial-symmetry',
          executionInput: dirichletInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'statistical-sufficient-statistics',
          effectiveCategory: 'statistical-sufficient-statistics',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'dirichlet-multinomial-symmetry',
          ] as const),
          supportedDataChannels: Object.freeze([
            'multinomial-category-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Dirichlet-Multinomial sufficient statistics ([${stats.counts.join(', ')}]; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (
        stats.targetMethodId === 'student-t-terminal-diffusion' ||
        stats.targetMethodId === 'first-passage-barrier-diffusion'
      ) {
        continuousTrajectoryObservations =
          stats.continuousTrajectoryObservations;
        estimatedDrift = stats.estimatedDrift;
        estimatedScaleOrVolatility = stats.estimatedScaleOrVolatility;
        hasVerifiableEmpiricalData = true;
        const channels: MethodDataChannelId[] = [
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
        ];
        availableChannelSet.add('continuous-state-trajectory');
        availableChannelSet.add('drift-and-scale-estimates');

        if (stats.degreesOfFreedom !== undefined) {
          degreesOfFreedom = stats.degreesOfFreedom;
          availableChannelSet.add('tail-degrees-of-freedom');
          channels.push('tail-degrees-of-freedom');
        }
        if (stats.initialStateLevel !== undefined) {
          initialStateLevel = stats.initialStateLevel;
          if (
            outcomeSpace.barrierLevel !== undefined &&
            outcomeSpace.barrierDirection !== undefined
          ) {
            availableChannelSet.add('absorbing-barrier-specification');
            channels.push('absorbing-barrier-specification');
          }
        }
        supportedMethodSet.add(stats.targetMethodId);

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'statistical-sufficient-statistics',
          effectiveCategory: 'statistical-sufficient-statistics',
          origin: 'caller-submission',
          trustTier: 'independently-verified-empirical',
          verificationOutcome: 'verified-by-trusted-verifier',
          ...(trustMetadata.claimedVerifiedEmpirical !== undefined
            ? {
                claimedVerifiedEmpirical:
                  trustMetadata.claimedVerifiedEmpirical,
              }
            : {}),
          ...(trustMetadata.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  trustMetadata.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: trustMetadata.verifiedByVerifierId,
          verificationArtifactRef: trustMetadata.verificationArtifactRef,
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([stats.targetMethodId]),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous diffusion/barrier sufficient statistics for '${stats.targetMethodId}' (n=${stats.continuousTrajectoryObservations}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      throw new ForecastPipelineRequestError(
        `Unsupported statistics.targetMethodId '${String((stats as { targetMethodId?: unknown }).targetMethodId)}'`,
      );
    }
  }

  /* -----------------------------------------------------------------------
     Phase 2A: Global Deduplication Resolution for `binary-trials`
     ----------------------------------------------------------------------- */
  if (pendingBinarySubmissions.length > 0) {
    const resolvedBinaryEvents = new Map<
      string,
      {
        readonly status:
          | 'deduplicated-consistent'
          | 'quarantined-conflicting-outcomes';
        readonly realizedOutcomeIndex?: 0 | 1;
        readonly weight?: number;
        readonly contributingEvidenceIds: readonly string[];
        readonly citations: readonly EvidenceSourceCitation[];
      }
    >();

    for (const [canonicalKey, entry] of globalBinaryEvents.entries()) {
      const contributingIds: string[] = [];
      for (const r of entry.reports) {
        if (!contributingIds.includes(r.evidenceId)) {
          contributingIds.push(r.evidenceId);
        }
      }
      const crossSubmission = contributingIds.length > 1;
      const citations = entry.reports.map((r) => r.citation);
      const outcomeIndices = new Set<0 | 1>(
        entry.reports.map((r) => r.realizedOutcomeIndex),
      );

      if (outcomeIndices.size > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 0,
          status: 'quarantined-conflicting-outcomes',
          reportingSources: Object.freeze(citations),
          explanation: `Event '${entry.eventId}' (family '${entry.eventFamily}') had ${entry.reports.length} conflicting outcome reports across submission(s) [${contributingIds.join(', ')}] and was quarantined globally.`,
        });
        deduplicatedEventDiagnostics.push(diag);
        assessmentNotes.push(diag.explanation);
        resolvedBinaryEvents.set(canonicalKey, {
          status: 'quarantined-conflicting-outcomes',
          contributingEvidenceIds: Object.freeze(contributingIds),
          citations: Object.freeze(citations),
        });
        continue;
      }

      if (entry.reports.length > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 1,
          status: 'deduplicated-consistent',
          reportingSources: Object.freeze(citations),
          explanation: `Deduplicated ${entry.reports.length} consistent source reports for event '${entry.eventId}' (family '${entry.eventFamily}') across submission(s) [${contributingIds.join(', ')}] into 1 independent binary trial observation.`,
        });
        deduplicatedEventDiagnostics.push(diag);
      }

      const realizedOutcomeIndex = [...outcomeIndices][0]!;
      const firstWeighted = entry.reports.find((r) => r.weight !== undefined);
      resolvedBinaryEvents.set(canonicalKey, {
        status: 'deduplicated-consistent',
        realizedOutcomeIndex,
        ...(firstWeighted?.weight !== undefined
          ? { weight: firstWeighted.weight }
          : {}),
        contributingEvidenceIds: Object.freeze(contributingIds),
        citations: Object.freeze(citations),
      });
    }

    const referenceSub = pendingBinarySubmissions[0]!;
    const targetSuccessOutcomeIndex = referenceSub.successOutcomeIndex;
    const refOutcome0Alpha =
      referenceSub.successOutcomeIndex === 0
        ? referenceSub.prior.alpha
        : referenceSub.prior.beta;
    const refOutcome1Beta =
      referenceSub.successOutcomeIndex === 0
        ? referenceSub.prior.beta
        : referenceSub.prior.alpha;
    for (let i = 1; i < pendingBinarySubmissions.length; i++) {
      const other = pendingBinarySubmissions[i]!;
      const otherOutcome0Alpha =
        other.successOutcomeIndex === 0 ? other.prior.alpha : other.prior.beta;
      const otherOutcome1Beta =
        other.successOutcomeIndex === 0 ? other.prior.beta : other.prior.alpha;
      if (
        Math.abs(otherOutcome0Alpha - refOutcome0Alpha) > 1e-12 ||
        Math.abs(otherOutcome1Beta - refOutcome1Beta) > 1e-12
      ) {
        throw new ForecastPipelineRequestError(
          `Conflicting binary-trials prior hyperparameters across submissions '${referenceSub.evidenceId}' and '${other.evidenceId}'`,
        );
      }
    }
    let globalSuccesses = 0;
    let globalFailures = 0;
    const globalWeights: number[] = [];
    const globalOutcomes01: Array<0 | 1> = [];
    const allBinaryCitations: EvidenceSourceCitation[] = [];
    const seenGlobalUrls = new Set<string>();
    const activeBinarySubmissionIds: string[] = [];
    let anyWeightedEnabled = false;

    for (const [, resolved] of resolvedBinaryEvents.entries()) {
      if (resolved.status !== 'deduplicated-consistent') {
        continue;
      }
      const isSuccess =
        resolved.realizedOutcomeIndex === targetSuccessOutcomeIndex;
      if (isSuccess) {
        globalSuccesses += 1;
        globalOutcomes01.push(1);
      } else {
        globalFailures += 1;
        globalOutcomes01.push(0);
      }
      if (resolved.weight !== undefined) {
        globalWeights.push(resolved.weight);
      }
      for (const c of resolved.citations) {
        if (!seenGlobalUrls.has(c.url)) {
          seenGlobalUrls.add(c.url);
          allBinaryCitations.push(c);
        }
      }
    }

    const totalGlobalTrials = globalSuccesses + globalFailures;
    const canRunGlobalKish =
      pendingBinarySubmissions.some((s) => s.enableWeightedKishChannel) &&
      globalWeights.length === totalGlobalTrials &&
      totalGlobalTrials >= 2;

    for (const sub of pendingBinarySubmissions) {
      if (sub.enableWeightedKishChannel) {
        anyWeightedEnabled = true;
      }
      const subCitations: EvidenceSourceCitation[] = [sub.baseCitation];
      const seenSubUrls = new Set<string>([sub.baseCitation.url]);
      let subConsistentCount = 0;

      for (const key of sub.canonicalEventKeys) {
        const res = resolvedBinaryEvents.get(key);
        if (!res) {
          continue;
        }
        for (const c of res.citations) {
          if (!seenSubUrls.has(c.url)) {
            seenSubUrls.add(c.url);
            subCitations.push(c);
          }
        }
        if (res.status === 'deduplicated-consistent') {
          subConsistentCount += 1;
        }
      }

      if (subConsistentCount === 0) {
        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId: sub.evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'unsupported-or-unverified-claim',
          origin: 'caller-submission',
          trustTier: 'quarantined-invalid',
          verificationOutcome: 'rejected-integrity-or-schema-gate',
          ...(sub.trust.claimedVerifiedEmpirical !== undefined
            ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
            : {}),
          ...(sub.trust.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  sub.trust.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: sub.trust.verifiedByVerifierId,
          verificationArtifactRef: sub.trust.verificationArtifactRef,
          title: sub.title,
          publisher: sub.publisher,
          url: sub.url,
          publishedAt: sub.publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: false,
          usableForQuantitativeMethods: false,
          supportedMethodIds: Object.freeze([]),
          supportedDataChannels: Object.freeze([]),
          mergedSourceCitations: Object.freeze(subCitations),
          assessmentNote:
            'Zero valid historical binary trial observations remained after strict field validation and global conflict quarantine.',
        });
        unsupportedOrUnverifiedClaims.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      activeBinarySubmissionIds.push(sub.evidenceId);
      if (!seenGlobalUrls.has(sub.baseCitation.url)) {
        seenGlobalUrls.add(sub.baseCitation.url);
        allBinaryCitations.unshift(sub.baseCitation);
      }

      const itemMethods: ScientificMethodId[] = ['beta-binomial-conjugate'];
      const itemChannels: MethodDataChannelId[] = [
        'binary-trial-counts',
        'prior-hyperparameters',
      ];
      if (canRunGlobalKish) {
        itemMethods.push('weighted-kish-effective-binomial');
        itemChannels.push(
          'weighted-binary-trials',
          'kish-effective-sample-size',
        );
      }

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId: sub.evidenceId,
        submittedCategory: 'historical-observations',
        effectiveCategory: 'historical-observations',
        origin: 'caller-submission',
        trustTier: 'independently-verified-empirical',
        verificationOutcome: 'verified-by-trusted-verifier',
        ...(sub.trust.claimedVerifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
          : {}),
        ...(sub.trust.claimedPrimarySourceVerified !== undefined
          ? {
              claimedPrimarySourceVerified:
                sub.trust.claimedPrimarySourceVerified,
            }
          : {}),
        verifiedByVerifierId: sub.trust.verifiedByVerifierId,
        verificationArtifactRef: sub.trust.verificationArtifactRef,
        title: sub.title,
        publisher: sub.publisher,
        url: sub.url,
        publishedAt: sub.publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: 'caller:historical-observations',
        isPrimarySourceVerified: sub.trust.isPrimarySourceVerified,
        usableForQuantitativeMethods: true,
        supportedMethodIds: Object.freeze(itemMethods),
        supportedDataChannels: Object.freeze(itemChannels),
        mergedSourceCitations: Object.freeze(subCitations),
        assessmentNote: `Validated ${subConsistentCount} surviving binary historical trial(s) in '${sub.evidenceId}' (global deduplicated pool: n=${totalGlobalTrials}, k=${globalSuccesses}, n-k=${globalFailures}; verified by '${sub.trust.verifiedByVerifierId}').`,
      });
      historicalObservations.push(record);
      allProvenanceRecords.push(record);
    }

    if (totalGlobalTrials > 0 && activeBinarySubmissionIds.length > 0) {
      binaryTrialSuccesses = globalSuccesses;
      binaryTrialFailures = globalFailures;
      hasVerifiableEmpiricalData = true;
      availableChannelSet.add('binary-trial-counts');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('beta-binomial-conjugate');

      const betaInput: BetaBinomialExecutionInput = Object.freeze({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace,
        successOutcomeIndex: targetSuccessOutcomeIndex,
        prior: referenceSub.prior,
        observed: Object.freeze({
          successes: globalSuccesses,
          failures: globalFailures,
        }),
        ...(referenceSub.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('beta-binomial-conjugate', {
        methodId: 'beta-binomial-conjugate',
        executionInput: betaInput,
        provenanceIds: Object.freeze(activeBinarySubmissionIds),
        sourceUrls: Object.freeze(allBinaryCitations.map((c) => c.url)),
      });

      if (anyWeightedEnabled && canRunGlobalKish) {
        let wSucc = 0;
        let wFail = 0;
        let sumSq = 0;
        for (let i = 0; i < totalGlobalTrials; i++) {
          const wi = globalWeights[i]!;
          if (globalOutcomes01[i] === 1) {
            wSucc += wi;
          } else {
            wFail += wi;
          }
          sumSq += wi * wi;
        }
        const totalW = wSucc + wFail;
        const nEff = sumSq > 0 ? (totalW * totalW) / sumSq : 0;
        weightedSampleSize = totalGlobalTrials;
        kishEffectiveSampleSize = nEff;
        availableChannelSet.add('weighted-binary-trials');
        availableChannelSet.add('kish-effective-sample-size');
        supportedMethodSet.add('weighted-kish-effective-binomial');

        const kishInput: WeightedKishExecutionInput = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          outcomeSpace,
          successOutcomeIndex: targetSuccessOutcomeIndex,
          prior: referenceSub.prior,
          observed: Object.freeze({
            weightedSuccessMass: wSucc,
            weightedFailureMass: wFail,
            sumSquaredWeights: sumSq,
            observationCount: totalGlobalTrials,
          }),
          ...(referenceSub.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('weighted-kish-effective-binomial', {
          methodId: 'weighted-kish-effective-binomial',
          executionInput: kishInput,
          provenanceIds: Object.freeze(activeBinarySubmissionIds),
          sourceUrls: Object.freeze(allBinaryCitations.map((c) => c.url)),
        });
      }
    }
  }

  /* -----------------------------------------------------------------------
     Phase 2B: Global Deduplication Resolution for `poisson-arrivals`
     ----------------------------------------------------------------------- */
  if (pendingPoissonSubmissions.length > 0) {
    const resolvedPoissonEvents = new Map<
      string,
      {
        readonly status:
          | 'deduplicated-consistent'
          | 'quarantined-conflicting-outcomes';
        readonly contributingEvidenceIds: readonly string[];
        readonly citations: readonly EvidenceSourceCitation[];
      }
    >();

    for (const [canonicalKey, entry] of globalPoissonEvents.entries()) {
      const contributingIds: string[] = [];
      for (const r of entry.reports) {
        if (!contributingIds.includes(r.evidenceId)) {
          contributingIds.push(r.evidenceId);
        }
      }
      const crossSubmission = contributingIds.length > 1;
      const citations = entry.reports.map((r) => r.citation);
      const outcomeIndices = new Set<0 | 1>(
        entry.reports.map((r) => r.eventOutcomeIndex),
      );

      if (outcomeIndices.size > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 0,
          status: 'quarantined-conflicting-outcomes',
          reportingSources: Object.freeze(citations),
          explanation: `Poisson arrival event '${entry.eventId}' (family '${entry.eventFamily}') had conflicting eventOutcomeIndex values across submission(s) [${contributingIds.join(', ')}] and was quarantined globally.`,
        });
        deduplicatedEventDiagnostics.push(diag);
        assessmentNotes.push(diag.explanation);
        resolvedPoissonEvents.set(canonicalKey, {
          status: 'quarantined-conflicting-outcomes',
          contributingEvidenceIds: Object.freeze(contributingIds),
          citations: Object.freeze(citations),
        });
        continue;
      }

      if (entry.reports.length > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 1,
          status: 'deduplicated-consistent',
          reportingSources: Object.freeze(citations),
          explanation: `Deduplicated ${entry.reports.length} source reports for arrival event '${entry.eventId}' (family '${entry.eventFamily}') across submission(s) [${contributingIds.join(', ')}] into 1 Poisson event arrival.`,
        });
        deduplicatedEventDiagnostics.push(diag);
      }

      resolvedPoissonEvents.set(canonicalKey, {
        status: 'deduplicated-consistent',
        contributingEvidenceIds: Object.freeze(contributingIds),
        citations: Object.freeze(citations),
      });
    }

    const referenceSub = pendingPoissonSubmissions[0]!;
    let globalArrivalCount = 0;
    const allPoissonCitations: EvidenceSourceCitation[] = [];
    const seenGlobalUrls = new Set<string>();
    const activePoissonSubmissionIds: string[] = [];
    const exposureDurationByWindowId = new Map<string, number>();

    for (const [, resolved] of resolvedPoissonEvents.entries()) {
      if (resolved.status !== 'deduplicated-consistent') {
        continue;
      }
      globalArrivalCount += 1;
      for (const c of resolved.citations) {
        if (!seenGlobalUrls.has(c.url)) {
          seenGlobalUrls.add(c.url);
          allPoissonCitations.push(c);
        }
      }
    }

    for (const sub of pendingPoissonSubmissions) {
      const subCitations: EvidenceSourceCitation[] = [sub.baseCitation];
      const seenSubUrls = new Set<string>([sub.baseCitation.url]);

      for (const key of sub.canonicalEventKeys) {
        const res = resolvedPoissonEvents.get(key);
        if (!res) {
          continue;
        }
        for (const c of res.citations) {
          if (!seenSubUrls.has(c.url)) {
            seenSubUrls.add(c.url);
            subCitations.push(c);
          }
        }
      }

      // If a submission had raw events but 0 survived strict validation/conflict check:
      const subConsistentCount = sub.canonicalEventKeys.filter(
        (k) => resolvedPoissonEvents.get(k)?.status === 'deduplicated-consistent',
      ).length;
      if (sub.rawEventCount > 0 && subConsistentCount === 0) {
        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId: sub.evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'unsupported-or-unverified-claim',
          origin: 'caller-submission',
          trustTier: 'quarantined-invalid',
          verificationOutcome: 'rejected-integrity-or-schema-gate',
          ...(sub.trust.claimedVerifiedEmpirical !== undefined
            ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
            : {}),
          ...(sub.trust.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  sub.trust.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: sub.trust.verifiedByVerifierId,
          verificationArtifactRef: sub.trust.verificationArtifactRef,
          title: sub.title,
          publisher: sub.publisher,
          url: sub.url,
          publishedAt: sub.publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: false,
          usableForQuantitativeMethods: false,
          supportedMethodIds: Object.freeze([]),
          supportedDataChannels: Object.freeze([]),
          mergedSourceCitations: Object.freeze(subCitations),
          assessmentNote:
            'Zero valid Poisson arrival observations remained after strict field validation and global conflict quarantine.',
        });
        unsupportedOrUnverifiedClaims.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      activePoissonSubmissionIds.push(sub.evidenceId);
      if (!exposureDurationByWindowId.has(sub.exposureWindowId)) {
        exposureDurationByWindowId.set(
          sub.exposureWindowId,
          sub.historicalExposureDuration,
        );
      }
      if (!seenGlobalUrls.has(sub.baseCitation.url)) {
        seenGlobalUrls.add(sub.baseCitation.url);
        allPoissonCitations.unshift(sub.baseCitation);
      }

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId: sub.evidenceId,
        submittedCategory: 'historical-observations',
        effectiveCategory: 'historical-observations',
        origin: 'caller-submission',
        trustTier: 'independently-verified-empirical',
        verificationOutcome: 'verified-by-trusted-verifier',
        ...(sub.trust.claimedVerifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
          : {}),
        ...(sub.trust.claimedPrimarySourceVerified !== undefined
          ? {
              claimedPrimarySourceVerified:
                sub.trust.claimedPrimarySourceVerified,
            }
          : {}),
        verifiedByVerifierId: sub.trust.verifiedByVerifierId,
        verificationArtifactRef: sub.trust.verificationArtifactRef,
        title: sub.title,
        publisher: sub.publisher,
        url: sub.url,
        publishedAt: sub.publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: 'caller:historical-observations',
        isPrimarySourceVerified: sub.trust.isPrimarySourceVerified,
        usableForQuantitativeMethods: true,
        supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
        supportedDataChannels: Object.freeze([
          'poisson-event-counts',
          'continuous-exposure-duration',
          'prior-hyperparameters',
        ] as const),
        mergedSourceCitations: Object.freeze(subCitations),
        assessmentNote: `Validated ${subConsistentCount} surviving Poisson arrival event(s) in '${sub.evidenceId}' (global deduplicated arrivals=${globalArrivalCount}; verified by '${sub.trust.verifiedByVerifierId}').`,
      });
      historicalObservations.push(record);
      allProvenanceRecords.push(record);
    }

    if (activePoissonSubmissionIds.length > 0) {
      let totalExposureDuration = 0;
      for (const dur of exposureDurationByWindowId.values()) {
        totalExposureDuration += dur;
      }
      poissonEventCount = globalArrivalCount;
      poissonExposureDuration = totalExposureDuration;
      hasVerifiableEmpiricalData = true;
      availableChannelSet.add('poisson-event-counts');
      availableChannelSet.add('continuous-exposure-duration');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('poisson-gamma-hazard');

      const poissonInput: PoissonGammaExecutionInput = Object.freeze({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace,
        eventOutcomeIndex: referenceSub.eventOutcomeIndex,
        prior: Object.freeze({
          shape: referenceSub.prior.shape,
          rate: referenceSub.prior.rate,
          parameterization: 'shape-rate' as const,
        }),
        observed: Object.freeze({
          eventCount: globalArrivalCount,
          exposureDuration: totalExposureDuration,
          exposureUnit: referenceSub.historicalExposureUnit,
        }),
        forecast: Object.freeze({
          exposureDuration: referenceSub.forecastExposureDuration,
          exposureUnit: referenceSub.forecastExposureUnit,
        }),
        exposureUnit: referenceSub.historicalExposureUnit,
        ...(referenceSub.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('poisson-gamma-hazard', {
        methodId: 'poisson-gamma-hazard',
        executionInput: poissonInput,
        provenanceIds: Object.freeze(activePoissonSubmissionIds),
        sourceUrls: Object.freeze(allPoissonCitations.map((c) => c.url)),
      });
    }
  }

  /* -----------------------------------------------------------------------
     Phase 2C: Global Deduplication Resolution for `multinomial-trials`
     ----------------------------------------------------------------------- */
  if (pendingMultinomialSubmissions.length > 0) {
    const resolvedMultinomialEvents = new Map<
      string,
      {
        readonly status:
          | 'deduplicated-consistent'
          | 'quarantined-conflicting-outcomes';
        readonly outcomeIndex?: number;
        readonly contributingEvidenceIds: readonly string[];
        readonly citations: readonly EvidenceSourceCitation[];
      }
    >();

    for (const [canonicalKey, entry] of globalMultinomialEvents.entries()) {
      const contributingIds: string[] = [];
      for (const r of entry.reports) {
        if (!contributingIds.includes(r.evidenceId)) {
          contributingIds.push(r.evidenceId);
        }
      }
      const crossSubmission = contributingIds.length > 1;
      const citations = entry.reports.map((r) => r.citation);
      const outcomeIndices = new Set<number>(
        entry.reports.map((r) => r.outcomeIndex),
      );

      if (outcomeIndices.size > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 0,
          status: 'quarantined-conflicting-outcomes',
          reportingSources: Object.freeze(citations),
          explanation: `Multinomial event '${entry.eventId}' (family '${entry.eventFamily}') had conflicting category indices across submission(s) [${contributingIds.join(', ')}] and was quarantined globally.`,
        });
        deduplicatedEventDiagnostics.push(diag);
        assessmentNotes.push(diag.explanation);
        resolvedMultinomialEvents.set(canonicalKey, {
          status: 'quarantined-conflicting-outcomes',
          contributingEvidenceIds: Object.freeze(contributingIds),
          citations: Object.freeze(citations),
        });
        continue;
      }

      if (entry.reports.length > 1) {
        const diag: DeduplicatedEventObservationDiagnostic = Object.freeze({
          evidenceId: contributingIds[0]!,
          contributingEvidenceIds: Object.freeze(contributingIds),
          eventFamily: entry.eventFamily,
          canonicalEventKey: canonicalKey,
          eventId: entry.eventId,
          crossSubmissionDeduplicated: crossSubmission,
          rawReportCount: entry.reports.length,
          deduplicatedCount: 1,
          status: 'deduplicated-consistent',
          reportingSources: Object.freeze(citations),
          explanation: `Deduplicated ${entry.reports.length} source reports for categorical event '${entry.eventId}' (family '${entry.eventFamily}') across submission(s) [${contributingIds.join(', ')}] into 1 multinomial observation.`,
        });
        deduplicatedEventDiagnostics.push(diag);
      }

      resolvedMultinomialEvents.set(canonicalKey, {
        status: 'deduplicated-consistent',
        outcomeIndex: [...outcomeIndices][0]!,
        contributingEvidenceIds: Object.freeze(contributingIds),
        citations: Object.freeze(citations),
      });
    }

    const referenceSub = pendingMultinomialSubmissions[0]!;
    const globalCounts = new Array<number>(outcomeCount).fill(0);
    const allMultinomialCitations: EvidenceSourceCitation[] = [];
    const seenGlobalUrls = new Set<string>();
    const activeMultinomialSubmissionIds: string[] = [];

    for (const [, resolved] of resolvedMultinomialEvents.entries()) {
      if (
        resolved.status !== 'deduplicated-consistent' ||
        resolved.outcomeIndex === undefined
      ) {
        continue;
      }
      globalCounts[resolved.outcomeIndex] =
        (globalCounts[resolved.outcomeIndex] ?? 0) + 1;
      for (const c of resolved.citations) {
        if (!seenGlobalUrls.has(c.url)) {
          seenGlobalUrls.add(c.url);
          allMultinomialCitations.push(c);
        }
      }
    }

    const totalGlobalMultinomial = globalCounts.reduce((a, b) => a + b, 0);

    for (const sub of pendingMultinomialSubmissions) {
      const subCitations: EvidenceSourceCitation[] = [sub.baseCitation];
      const seenSubUrls = new Set<string>([sub.baseCitation.url]);
      let subConsistentCount = 0;

      for (const key of sub.canonicalEventKeys) {
        const res = resolvedMultinomialEvents.get(key);
        if (!res) {
          continue;
        }
        for (const c of res.citations) {
          if (!seenSubUrls.has(c.url)) {
            seenSubUrls.add(c.url);
            subCitations.push(c);
          }
        }
        if (res.status === 'deduplicated-consistent') {
          subConsistentCount += 1;
        }
      }

      if (subConsistentCount === 0) {
        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId: sub.evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'unsupported-or-unverified-claim',
          origin: 'caller-submission',
          trustTier: 'quarantined-invalid',
          verificationOutcome: 'rejected-integrity-or-schema-gate',
          ...(sub.trust.claimedVerifiedEmpirical !== undefined
            ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
            : {}),
          ...(sub.trust.claimedPrimarySourceVerified !== undefined
            ? {
                claimedPrimarySourceVerified:
                  sub.trust.claimedPrimarySourceVerified,
              }
            : {}),
          verifiedByVerifierId: sub.trust.verifiedByVerifierId,
          verificationArtifactRef: sub.trust.verificationArtifactRef,
          title: sub.title,
          publisher: sub.publisher,
          url: sub.url,
          publishedAt: sub.publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: false,
          usableForQuantitativeMethods: false,
          supportedMethodIds: Object.freeze([]),
          supportedDataChannels: Object.freeze([]),
          mergedSourceCitations: Object.freeze(subCitations),
          assessmentNote:
            'Zero valid categorical observations remained after strict field validation and global conflict quarantine.',
        });
        unsupportedOrUnverifiedClaims.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      activeMultinomialSubmissionIds.push(sub.evidenceId);
      if (!seenGlobalUrls.has(sub.baseCitation.url)) {
        seenGlobalUrls.add(sub.baseCitation.url);
        allMultinomialCitations.unshift(sub.baseCitation);
      }

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId: sub.evidenceId,
        submittedCategory: 'historical-observations',
        effectiveCategory: 'historical-observations',
        origin: 'caller-submission',
        trustTier: 'independently-verified-empirical',
        verificationOutcome: 'verified-by-trusted-verifier',
        ...(sub.trust.claimedVerifiedEmpirical !== undefined
          ? { claimedVerifiedEmpirical: sub.trust.claimedVerifiedEmpirical }
          : {}),
        ...(sub.trust.claimedPrimarySourceVerified !== undefined
          ? {
              claimedPrimarySourceVerified:
                sub.trust.claimedPrimarySourceVerified,
            }
          : {}),
        verifiedByVerifierId: sub.trust.verifiedByVerifierId,
        verificationArtifactRef: sub.trust.verificationArtifactRef,
        title: sub.title,
        publisher: sub.publisher,
        url: sub.url,
        publishedAt: sub.publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: 'caller:historical-observations',
        isPrimarySourceVerified: sub.trust.isPrimarySourceVerified,
        usableForQuantitativeMethods: true,
        supportedMethodIds: Object.freeze([
          'dirichlet-multinomial-symmetry',
        ] as const),
        supportedDataChannels: Object.freeze([
          'multinomial-category-counts',
          'prior-hyperparameters',
        ] as const),
        mergedSourceCitations: Object.freeze(subCitations),
        assessmentNote: `Validated ${subConsistentCount} surviving multinomial observation(s) in '${sub.evidenceId}' (global deduplicated counts: [${globalCounts.join(', ')}]; verified by '${sub.trust.verifiedByVerifierId}').`,
      });
      historicalObservations.push(record);
      allProvenanceRecords.push(record);
    }

    if (totalGlobalMultinomial > 0 && activeMultinomialSubmissionIds.length > 0) {
      multinomialOutcomeCounts = Object.freeze([...globalCounts]);
      hasVerifiableEmpiricalData = true;
      availableChannelSet.add('multinomial-category-counts');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('dirichlet-multinomial-symmetry');

      const dirichletInput: DirichletMultinomialExecutionInput = Object.freeze({
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace,
        prior: Object.freeze({
          alpha: Object.freeze([...referenceSub.priorAlpha]),
        }),
        observed: Object.freeze({
          counts: Object.freeze([...globalCounts]),
        }),
        ...(referenceSub.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
        methodId: 'dirichlet-multinomial-symmetry',
        executionInput: dirichletInput,
        provenanceIds: Object.freeze(activeMultinomialSubmissionIds),
        sourceUrls: Object.freeze(allMultinomialCitations.map((c) => c.url)),
      });
    }
  }

  // Handle structural-uniform-baseline symmetry premise when explicitly verified:
  if (
    allowStructuralBaseline &&
    isPlainObject(structuralSymmetryPremise) &&
    structuralSymmetryPremise.partitionSymmetryVerified === true &&
    typeof structuralSymmetryPremise.symmetryRationale === 'string' &&
    structuralSymmetryPremise.symmetryRationale.trim().length > 0 &&
    (outcomeSpace.kind === 'binary' ||
      outcomeSpace.kind === 'categorical-exhaustive')
  ) {
    availableChannelSet.add('outcome-partition-symmetry');
    supportedMethodSet.add('structural-uniform-baseline');
    const structInput: StructuralUniformExecutionInput = Object.freeze({
      methodId: 'structural-uniform-baseline',
      outcomeSpace,
      symmetryPremise: Object.freeze({
        partitionSymmetryVerified: true,
        ...(structuralSymmetryPremise.exhaustiveMutuallyExclusiveVerified !==
        undefined
          ? {
              exhaustiveMutuallyExclusiveVerified:
                structuralSymmetryPremise.exhaustiveMutuallyExclusiveVerified,
            }
          : {}),
        symmetryRationale: structuralSymmetryPremise.symmetryRationale.trim(),
      }),
    });
    preparedMethodInputs.set('structural-uniform-baseline', {
      methodId: 'structural-uniform-baseline',
      executionInput: structInput,
      provenanceIds: Object.freeze(['structural-symmetry-premise']),
      sourceUrls: Object.freeze([]),
    });
  }

  // Compute exact missing evidence requirements per registered method:
  const missingRequirementsByMethod: Record<string, readonly string[]> = {};
  for (const desc of registry.listAll()) {
    const missing: string[] = [];
    for (const reqCh of desc.requiredData.requiredInputChannels) {
      if (!availableChannelSet.has(reqCh)) {
        missing.push(
          `Missing required data channel '${reqCh}' for method '${desc.methodId}'`,
        );
      }
    }
    if (
      desc.requiredData.minimumConditions.requiresVerifiableEmpiricalEvidence &&
      !hasVerifiableEmpiricalData
    ) {
      missing.push(
        `Method '${desc.methodId}' requires independently verified quantitative empirical evidence (documentary evidence or caller-declared unverified claims cannot substitute for verified empirical observations)`,
      );
    }
    if (
      desc.methodId === 'structural-uniform-baseline' &&
      !preparedMethodInputs.has('structural-uniform-baseline')
    ) {
      missing.push(
        "Method 'structural-uniform-baseline' requires an explicit verified structuralSymmetryPremise (partitionSymmetryVerified: true with non-empty symmetryRationale)",
      );
    }
    missingRequirementsByMethod[desc.methodId] = Object.freeze(missing);
  }

  const derivedAvailableEvidence: AvailableEvidenceInput = Object.freeze({
    availableChannels: Object.freeze([...availableChannelSet]),
    hasVerifiableEmpiricalData,
    ...(binaryTrialSuccesses !== undefined ? { binaryTrialSuccesses } : {}),
    ...(binaryTrialFailures !== undefined ? { binaryTrialFailures } : {}),
    ...(weightedSampleSize !== undefined ? { weightedSampleSize } : {}),
    ...(kishEffectiveSampleSize !== undefined
      ? { kishEffectiveSampleSize }
      : {}),
    ...(poissonEventCount !== undefined ? { poissonEventCount } : {}),
    ...(poissonExposureDuration !== undefined
      ? { poissonExposureDuration }
      : {}),
    ...(multinomialOutcomeCounts !== undefined
      ? { multinomialOutcomeCounts }
      : {}),
    ...(continuousTrajectoryObservations !== undefined
      ? { continuousTrajectoryObservations }
      : {}),
    ...(estimatedDrift !== undefined ? { estimatedDrift } : {}),
    ...(estimatedScaleOrVolatility !== undefined
      ? { estimatedScaleOrVolatility }
      : {}),
    ...(degreesOfFreedom !== undefined ? { degreesOfFreedom } : {}),
    ...(initialStateLevel !== undefined ? { initialStateLevel } : {}),
    ...(lowConfidenceEvidence ? { lowConfidenceEvidence: true } : {}),
    ...(assessmentNotes.length > 0
      ? { dataQualityNotes: Object.freeze([...assessmentNotes]) }
      : {}),
  });

  // Only genuinely validated & independently verified quantitative submissions count:
  const totalQuantitativeValidatedCount =
    historicalObservations.length +
    structuredNumericalDatasets.length +
    statisticalSufficientStatistics.length;

  const report: EvidenceAssessmentReport = Object.freeze({
    totalRetrievedCount: allProvenanceRecords.length,
    totalQuantitativeValidatedCount,
    documentaryEvidence: Object.freeze(documentaryEvidence),
    historicalObservations: Object.freeze(historicalObservations),
    structuredNumericalDatasets: Object.freeze(structuredNumericalDatasets),
    statisticalSufficientStatistics: Object.freeze(
      statisticalSufficientStatistics,
    ),
    declaredUnverifiedEvidence: Object.freeze(declaredUnverifiedEvidence),
    unsupportedOrUnverifiedClaims: Object.freeze(unsupportedOrUnverifiedClaims),
    invalidObservationDiagnostics: Object.freeze(invalidObservationDiagnostics),
    deduplicatedEventDiagnostics: Object.freeze(deduplicatedEventDiagnostics),
    derivedAvailableEvidence,
    supportedMethodIds: Object.freeze([...supportedMethodSet]),
    missingRequirementsByMethod: Object.freeze(missingRequirementsByMethod),
    assessmentNotes: Object.freeze(assessmentNotes),
  });

  return {
    report,
    provenanceRecords: Object.freeze(allProvenanceRecords),
    preparedMethodInputs,
  };
}

/* -------------------------------------------------------------------------
   6. Effective Synthesis Plan Builder for Partial Execution Isolation
   ------------------------------------------------------------------------- */

/**
 * When one or more applicable executable methods fail during Step E, constructs
 * an effective `MethodApplicabilityPlan` for Step F (`synthesizeForecastDistribution`)
 * in which the failed methods are transitioned to `'deferred'` with explicit
 * execution-failure diagnostics while preserving all surviving applicable
 * methods and recomputing dependence diagnostics over the surviving set.
 */
function buildEffectivePlanAfterExecutionFailures(
  originalPlan: MethodApplicabilityPlan,
  planningInput: MethodApplicabilityPlanningInput,
  failedOrSkippedExecutableMethodIds: ReadonlySet<ScientificMethodId>,
  failureReasonByMethod: ReadonlyMap<ScientificMethodId, string>,
  registry: ScientificMethodRegistry,
): MethodApplicabilityPlan {
  if (failedOrSkippedExecutableMethodIds.size === 0) {
    return originalPlan;
  }

  const evaluatedMethods: MethodEvaluationRecord[] = [];
  const applicableMethods: MethodEvaluationRecord[] = [];
  const strictlyApplicableMethods: MethodEvaluationRecord[] = [];
  const applicableWithLimitationsMethods: MethodEvaluationRecord[] = [];
  const deferredMethods: MethodEvaluationRecord[] = [];
  const inapplicableMethods: MethodEvaluationRecord[] = [];

  const evidenceDrivenApplicableMethodIds: ScientificMethodId[] = [];
  const structuralBaselineMethodIds: ScientificMethodId[] = [];
  const deferredMethodIds: ScientificMethodId[] = [];
  const inapplicableMethodIds: ScientificMethodId[] = [];
  const discardedMethodResults = [...originalPlan.discardedMethodResults];

  for (const rec of originalPlan.evaluatedMethods) {
    if (
      rec.applicable &&
      failedOrSkippedExecutableMethodIds.has(rec.methodId)
    ) {
      const failReason =
        failureReasonByMethod.get(rec.methodId) ??
        `Method '${rec.methodId}' failed or was skipped during Step E execution.`;
      const deferredRec: MethodEvaluationRecord = Object.freeze({
        ...rec,
        disposition: 'deferred' as const,
        applicable: false,
        deferredGateIds: Object.freeze([
          ...rec.deferredGateIds,
          'required-data-availability' as const,
        ]),
        rationale: `${rec.rationale} | [step-e-execution-isolated] ${failReason}`,
        contractResult: Object.freeze({
          methodId: rec.methodId,
          applicable: false,
          rationale: `${rec.rationale} | [step-e-execution-isolated] ${failReason}`,
          failedGateIds: Object.freeze([
            ...rec.failedGateIds,
            ...rec.deferredGateIds,
            'required-data-availability',
          ]),
        }),
      });
      evaluatedMethods.push(deferredRec);
      deferredMethods.push(deferredRec);
      deferredMethodIds.push(rec.methodId);
      discardedMethodResults.push(deferredRec.contractResult);
      continue;
    }

    evaluatedMethods.push(rec);
    if (rec.applicable) {
      applicableMethods.push(rec);
      if (rec.disposition === 'applicable') {
        strictlyApplicableMethods.push(rec);
      } else {
        applicableWithLimitationsMethods.push(rec);
      }
      if (rec.role === 'structural-symmetry-baseline') {
        structuralBaselineMethodIds.push(rec.methodId);
      } else {
        evidenceDrivenApplicableMethodIds.push(rec.methodId);
      }
    } else if (rec.disposition === 'deferred') {
      deferredMethods.push(rec);
      deferredMethodIds.push(rec.methodId);
    } else {
      inapplicableMethods.push(rec);
      inapplicableMethodIds.push(rec.methodId);
    }
  }

  const survivingEvidenceSet = new Set<ScientificMethodId>(
    evidenceDrivenApplicableMethodIds,
  );
  const survivingApplicableSet = new Set<ScientificMethodId>(
    applicableMethods.map((m) => m.methodId),
  );

  const channelBySurvivingMethod = new Set<MethodDataChannelId>();
  for (const mId of survivingApplicableSet) {
    const desc = registry.get(mId);
    if (desc) {
      for (const ch of desc.requiredData.requiredInputChannels) {
        if (planningInput.availableEvidence.availableChannels.includes(ch)) {
          channelBySurvivingMethod.add(ch);
        }
      }
    }
  }

  const filteredComponents =
    originalPlan.dependenceDiagnostics.connectedComponents
      .map((comp) => {
        const members = comp.applicableMethodIds.filter((id) =>
          survivingEvidenceSet.has(id),
        );
        if (members.length < 2) {
          return null;
        }
        const pairs = comp.pairwiseRelationships.filter(
          (p) =>
            survivingEvidenceSet.has(p.methodPair[0]) &&
            survivingEvidenceSet.has(p.methodPair[1]),
        );
        return Object.freeze({
          ...comp,
          applicableMethodIds: Object.freeze(members),
          pairwiseRelationships: Object.freeze(pairs),
        });
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

  const inFilteredComponent = new Set<ScientificMethodId>();
  for (const comp of filteredComponents) {
    for (const id of comp.applicableMethodIds) {
      inFilteredComponent.add(id);
    }
  }

  const unlinkedSelectedEvidenceMethodIds =
    evidenceDrivenApplicableMethodIds.filter(
      (id) => !inFilteredComponent.has(id),
    );

  const pairwiseAssessments =
    originalPlan.dependenceDiagnostics.pairwiseAssessments.filter(
      (p) =>
        survivingApplicableSet.has(p.methodPair[0]) &&
        survivingApplicableSet.has(p.methodPair[1]),
    );

  const hasBothBetaAndDirichlet =
    survivingEvidenceSet.has('beta-binomial-conjugate') &&
    survivingEvidenceSet.has('dirichlet-multinomial-symmetry');

  const updatedDependenceDiagnostics: MethodDependenceDiagnostics =
    Object.freeze({
      connectedComponents: Object.freeze(filteredComponents),
      unlinkedSelectedEvidenceMethodIds: Object.freeze(
        unlinkedSelectedEvidenceMethodIds,
      ),
      pairwiseAssessments: Object.freeze(pairwiseAssessments),
      ...(hasBothBetaAndDirichlet &&
      originalPlan.dependenceDiagnostics.binaryBetaDirichletEquivalence !==
        undefined
        ? {
            binaryBetaDirichletEquivalence:
              originalPlan.dependenceDiagnostics.binaryBetaDirichletEquivalence,
          }
        : {}),
      evidenceConnectedComponentCount:
        filteredComponents.length + unlinkedSelectedEvidenceMethodIds.length,
      epistemicIndependencePolicy:
        originalPlan.dependenceDiagnostics.epistemicIndependencePolicy,
      summaryWarning: originalPlan.dependenceDiagnostics.summaryWarning,
    });

  return deepFreeze({
    ...originalPlan,
    evaluatedMethods: Object.freeze(evaluatedMethods),
    applicableMethods: Object.freeze(applicableMethods),
    strictlyApplicableMethods: Object.freeze(strictlyApplicableMethods),
    applicableWithLimitationsMethods: Object.freeze(
      applicableWithLimitationsMethods,
    ),
    deferredMethods: Object.freeze(deferredMethods),
    inapplicableMethods: Object.freeze(inapplicableMethods),
    evidenceDrivenApplicableMethodIds: Object.freeze(
      evidenceDrivenApplicableMethodIds,
    ),
    structuralBaselineMethodIds: Object.freeze(structuralBaselineMethodIds),
    deferredMethodIds: Object.freeze(deferredMethodIds),
    inapplicableMethodIds: Object.freeze(inapplicableMethodIds),
    correlatedMethodGroups: Object.freeze(filteredComponents),
    dependenceDiagnostics: updatedDependenceDiagnostics,
    discardedMethodResults: Object.freeze(discardedMethodResults),
  });
}

/* -------------------------------------------------------------------------
   7. Main Orchestrator — `runScientificForecastPipeline`
   ------------------------------------------------------------------------- */

/**
 * Executes the complete Stage 2B-1 Scientific Forecast Pipeline:
 *   Step A: Question validation & canonical identity resolution
 *   Step B: Evidence collection (`EvidenceHarvester`)
 *   Step C: Evidence trust verification, strict observation validation & global deduplication
 *   Step D: Method applicability planning (`planMethodApplicability`)
 *   Step E: Isolated scientific method execution (`executeScientificMethod`)
 *   Step F: Dependence-aware forecast synthesis (`synthesizeForecastDistribution`)
 */
export async function runScientificForecastPipeline(
  rawRequest: unknown,
  dependencies: ForecastPipelineDependencies = {},
): Promise<ForecastPipelineResult> {
  if (!isPlainObject(rawRequest)) {
    throw new ForecastPipelineRequestError(
      'ForecastPipelineRequest must be a non-null plain object',
    );
  }

  const request = rawRequest as unknown as ForecastPipelineRequest;
  const diagnostics: string[] = [];

  if (
    typeof request.question !== 'string' ||
    request.question.trim().length < 3
  ) {
    diagnostics.push(
      'ForecastPipelineRequest.question must be a non-empty string of at least 3 characters',
    );
  }

  const referenceTime: IsoDateTime =
    request.referenceTime ??
    dependencies.now?.() ??
    new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (!isValidIsoDateTime(referenceTime)) {
    diagnostics.push(
      `ForecastPipelineRequest.referenceTime must be a valid UTC ISO-8601 timestamp, received '${String(referenceTime)}'`,
    );
  }

  if (
    request.questionCategory !== undefined &&
    !PREDICTION_CATEGORIES.includes(request.questionCategory)
  ) {
    diagnostics.push(
      `ForecastPipelineRequest.questionCategory must be one of [${PREDICTION_CATEGORIES.join(', ')}], received '${String(request.questionCategory)}'`,
    );
  }

  if (
    request.subdomain !== undefined &&
    (typeof request.subdomain !== 'string' ||
      !isValidSubdomainIdentifier(request.subdomain))
  ) {
    diagnostics.push(
      `ForecastPipelineRequest.subdomain must be a canonical kebab-case identifier, received '${String(request.subdomain)}'`,
    );
  }

  if (diagnostics.length > 0) {
    throw new ForecastPipelineRequestError(diagnostics.join('; '), diagnostics);
  }

  const referenceDate = new Date(parseIsoDateTimeMs(referenceTime)!);
  const questionResolver =
    dependencies.questionResolver ?? resolveCanonicalQuestion;
  const evidenceHarvester = dependencies.evidenceHarvester ?? harvestEvidence;
  const registry = dependencies.registry ?? DEFAULT_SCIENTIFIC_METHOD_REGISTRY;
  const applicabilityPlanner =
    dependencies.applicabilityPlanner ?? planMethodApplicability;
  const methodExecutor = dependencies.methodExecutor ?? executeScientificMethod;
  const synthesizer =
    dependencies.synthesizer ?? synthesizeForecastDistribution;

  /* -----------------------------------------------------------------------
     Step A: Question validation & canonical identity resolution
     ----------------------------------------------------------------------- */
  const resolution = await questionResolver(request.question, {
    now: referenceDate,
  });

  const effectiveCategory: PredictionCategory | null =
    request.questionCategory ?? resolution.category;

  if (effectiveCategory === null) {
    throw new ForecastPipelineRequestError(
      `Question category could not be unambiguously resolved from question '${request.question.trim()}'; supply an explicit questionCategory in [${PREDICTION_CATEGORIES.join(', ')}]`,
    );
  }

  const questionId =
    request.questionId !== undefined && request.questionId.trim().length > 0
      ? request.questionId.trim()
      : resolution.candidate.candidateId;

  // Validate or construct canonical OutcomeSpaceDescriptor:
  let outcomeSpace: OutcomeSpaceDescriptor;
  if (request.outcomeSpace !== undefined) {
    try {
      outcomeSpace = validateOutcomeSpaceDescriptor(request.outcomeSpace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ForecastPipelineRequestError(
        `Invalid ForecastPipelineRequest.outcomeSpace: ${msg}`,
      );
    }
  } else if (resolution.candidate.horizon !== null) {
    const eventDefHash = await sha256Hex(
      `oracle.outcome-space/1\n${resolution.identityDigest}\nbinary:Yes|No`,
    );
    outcomeSpace = validateOutcomeSpaceDescriptor({
      kind: 'binary',
      outcomeLabels: ['Yes', 'No'],
      horizonStartsAt: resolution.candidate.horizon.startsAt,
      horizonEndsAt: resolution.candidate.horizon.endsAt,
      eventDefinitionHash: `sha256:${eventDefHash}`,
    });
  } else {
    throw new ForecastPipelineRequestError(
      `Question '${request.question.trim()}' does not contain an explicit forecast horizon and no outcomeSpace was provided; THE ORACLE refuses to guess forecast horizons or outcome partitions`,
    );
  }

  const horizon: ForecastHorizonInput =
    request.horizon ??
    Object.freeze({
      startsAt: outcomeSpace.horizonStartsAt,
      endsAt: outcomeSpace.horizonEndsAt,
      referenceTime,
    });

  const questionIdentity: PipelineQuestionIdentityReport = Object.freeze({
    rawQuestion: resolution.rawQuery,
    normalizedQuestion: resolution.normalizedQuery,
    canonicalQuestion: resolution.draftCanonicalQuestion,
    questionId,
    questionCategory: effectiveCategory,
    ...(request.subdomain !== undefined
      ? { subdomain: request.subdomain }
      : {}),
    identity: resolution.identity,
    identityDigest: resolution.identityDigest,
    identityComplete: resolution.identityComplete,
    unresolvedComponents: resolution.unresolvedComponents,
    resolution,
  });

  /* -----------------------------------------------------------------------
     Step B: Verifiable external evidence collection (`EvidenceHarvester`)
     ----------------------------------------------------------------------- */
  const skipRemoteHarvest = request.harvestOptions?.skipRemoteHarvest === true;
  let harvestResult: EvidenceHarvestResult;
  let evidenceCollectionStatus: EvidenceCollectionStatus;

  if (skipRemoteHarvest) {
    harvestResult = Object.freeze({
      query: resolution.rawQuery,
      category: effectiveCategory,
      selectedProviders: Object.freeze([]),
      referenceTime,
      executedAt: referenceTime,
      items: Object.freeze([]),
      discarded: Object.freeze([]),
      providerReports: Object.freeze([]),
      summary: Object.freeze({
        providersQueried: 0,
        providersSucceeded: 0,
        providersFailed: 0,
        rawCandidatesEvaluated: 0,
        totalAccepted: 0,
        totalDiscarded: 0,
      }),
    });
    evidenceCollectionStatus = 'skipped-offline';
  } else {
    const { skipRemoteHarvest: _omitted, ...restHarvestOpts } =
      request.harvestOptions ?? {};
    void _omitted;
    harvestResult = await evidenceHarvester({
      query: resolution.rawQuery,
      category: effectiveCategory,
      referenceTime,
      ...restHarvestOpts,
    });

    if (harvestResult.summary.providersQueried === 0) {
      evidenceCollectionStatus = 'succeeded-empty';
    } else if (
      harvestResult.summary.providersFailed ===
      harvestResult.summary.providersQueried
    ) {
      evidenceCollectionStatus = 'failed-all-providers';
    } else if (harvestResult.summary.providersFailed > 0) {
      evidenceCollectionStatus = 'partial-provider-failure';
    } else if (harvestResult.items.length > 0) {
      evidenceCollectionStatus = 'succeeded-with-evidence';
    } else {
      evidenceCollectionStatus = 'succeeded-empty';
    }
  }

  const evidenceReferences: readonly EvidenceReference[] = Object.freeze(
    harvestResult.items.map((item: HarvestedEvidenceItem) =>
      toEvidenceReference(item),
    ),
  );

  /* -----------------------------------------------------------------------
     Step C: Evidence trust verification, strict validation & deduplication
     ----------------------------------------------------------------------- */
  const allowStructuralBaseline =
    request.assumptions?.allowStructuralBaseline ??
    request.structuralSymmetryPremise?.partitionSymmetryVerified === true;

  const {
    report: evidenceAssessment,
    provenanceRecords: evidenceProvenance,
    preparedMethodInputs,
  } = assessCollectedEvidence({
    harvestResult,
    submittedEvidence: request.submittedEvidence ?? [],
    outcomeSpace,
    referenceTime,
    ...(request.structuralSymmetryPremise !== undefined
      ? { structuralSymmetryPremise: request.structuralSymmetryPremise }
      : {}),
    allowStructuralBaseline,
    registry,
    ...(dependencies.evidenceVerifier !== undefined
      ? { evidenceVerifier: dependencies.evidenceVerifier }
      : {}),
  });

  /* -----------------------------------------------------------------------
     Step D: Method applicability planning (`planMethodApplicability`)
     ----------------------------------------------------------------------- */
  const verifiedAssumptionsSet = new Set<MethodAssumptionId>(
    request.assumptions?.verifiedAssumptions ?? [],
  );
  if (
    allowStructuralBaseline &&
    preparedMethodInputs.has('structural-uniform-baseline')
  ) {
    verifiedAssumptionsSet.add('exhaustive-mutually-exclusive-categories');
    verifiedAssumptionsSet.add(
      'principle-of-indifference-partition-symmetry',
    );
  }

  const assumptionsInput: AssumptionDeclarationsInput = Object.freeze({
    verifiedAssumptions: Object.freeze([...verifiedAssumptionsSet]),
    ...(request.assumptions?.unverifiedButPlausibleAssumptions !== undefined
      ? {
          unverifiedButPlausibleAssumptions:
            request.assumptions.unverifiedButPlausibleAssumptions,
        }
      : {}),
    ...(request.assumptions?.violatedAssumptions !== undefined
      ? { violatedAssumptions: request.assumptions.violatedAssumptions }
      : {}),
    ...(request.assumptions?.knownDomainConstraints !== undefined
      ? { knownDomainConstraints: request.assumptions.knownDomainConstraints }
      : {}),
    allowStructuralBaseline,
    ...(request.assumptions?.requireExplicitAssumptionVerification !== undefined
      ? {
          requireExplicitAssumptionVerification:
            request.assumptions.requireExplicitAssumptionVerification,
        }
      : {}),
  });

  const computationalCapabilities: ComputationalCapabilitiesInput =
    Object.freeze({
      maxAllowedCostTier:
        request.computationalCapabilities?.maxAllowedCostTier ?? 'high',
      allowIterativeSpecialFunctions:
        request.computationalCapabilities?.allowIterativeSpecialFunctions ??
        true,
      ...(request.computationalCapabilities?.maxMemoryKbBudget !== undefined
        ? {
            maxMemoryKbBudget:
              request.computationalCapabilities.maxMemoryKbBudget,
          }
        : {}),
    });

  const planningInput: MethodApplicabilityPlanningInput = Object.freeze({
    questionId,
    questionCategory: effectiveCategory,
    ...(request.subdomain !== undefined
      ? { subdomain: request.subdomain }
      : {}),
    outcomeSpace,
    horizon,
    availableEvidence: evidenceAssessment.derivedAvailableEvidence,
    assumptions: assumptionsInput,
    computationalCapabilities,
  });

  const applicabilityPlan = applicabilityPlanner(planningInput, registry);

  /* -----------------------------------------------------------------------
     Step E: Isolated scientific method execution (`executeScientificMethod`)
     ----------------------------------------------------------------------- */
  const skippedMethods: SkippedMethodDiagnostic[] = [];
  const methodExecutionFailures: MethodExecutionFailureDiagnostic[] = [];
  const executedMethodDiagnostics: ExecutedMethodDiagnostic[] = [];
  const methodOutputs: ScientificMethodOutput[] = [];
  const failedOrSkippedExecutableIds = new Set<ScientificMethodId>();
  const failureReasonByMethod = new Map<ScientificMethodId, string>();

  for (const evalRec of applicabilityPlan.evaluatedMethods) {
    if (!evalRec.applicable) {
      skippedMethods.push(
        Object.freeze({
          methodId: evalRec.methodId,
          disposition: evalRec.disposition,
          skipCategory:
            evalRec.disposition === 'deferred'
              ? 'deferred-by-planner'
              : 'inapplicable-by-planner',
          implementationStatus: evalRec.implementationStatus,
          failedOrDeferredGateIds: Object.freeze([
            ...evalRec.failedGateIds,
            ...evalRec.deferredGateIds,
          ]),
          missingInputs: Object.freeze([
            ...evalRec.missingDataRequirements,
            ...(evidenceAssessment.missingRequirementsByMethod[
              evalRec.methodId
            ] ?? []),
          ]),
          rationale: evalRec.rationale,
        }),
      );
      continue;
    }

    if (
      !evalRec.hasExecutableImplementation ||
      evalRec.implementationStatus !== 'implemented-and-verified'
    ) {
      skippedMethods.push(
        Object.freeze({
          methodId: evalRec.methodId,
          disposition: evalRec.disposition,
          skipCategory: 'unimplemented-method',
          implementationStatus: evalRec.implementationStatus,
          failedOrDeferredGateIds: Object.freeze([]),
          missingInputs: Object.freeze([]),
          rationale: `Method '${evalRec.methodId}' is ${evalRec.disposition} according to the applicability planner, but has implementationStatus '${evalRec.implementationStatus}' (hasExecutableImplementation: false) and cannot be executed.`,
        }),
      );
      continue;
    }

    const bundle = preparedMethodInputs.get(
      evalRec.methodId as ExecutableScientificMethodId,
    );
    if (!bundle) {
      const missingList =
        evidenceAssessment.missingRequirementsByMethod[evalRec.methodId] ?? [
          `Missing execution parameter bundle for method '${evalRec.methodId}'`,
        ];
      const reason = `Method '${evalRec.methodId}' passed planner gates, but execution could not proceed because required method execution inputs were missing: ${missingList.join('; ')}.`;
      skippedMethods.push(
        Object.freeze({
          methodId: evalRec.methodId,
          disposition: evalRec.disposition,
          skipCategory: 'missing-execution-inputs',
          implementationStatus: evalRec.implementationStatus,
          failedOrDeferredGateIds: Object.freeze([]),
          missingInputs: Object.freeze([...missingList]),
          rationale: reason,
        }),
      );
      failedOrSkippedExecutableIds.add(evalRec.methodId);
      failureReasonByMethod.set(evalRec.methodId, reason);
      continue;
    }

    let executedOutput: ScientificMethodOutput;
    try {
      executedOutput = methodExecutor(bundle.executionInput, registry);
    } catch (err) {
      const errorName = err instanceof Error ? err.name : 'Error';
      const errorMessage = err instanceof Error ? err.message : String(err);
      methodExecutionFailures.push(
        Object.freeze({
          methodId: evalRec.methodId,
          stage: 'method-execution',
          errorName,
          errorMessage,
          inputProvenanceIds: bundle.provenanceIds,
        }),
      );
      failedOrSkippedExecutableIds.add(evalRec.methodId);
      failureReasonByMethod.set(
        evalRec.methodId,
        `Execution failed (${errorName}: ${errorMessage})`,
      );
      continue;
    }

    try {
      validateExhaustiveDistribution(
        executedOutput.outcomes,
        outcomeSpace.outcomeLabels.length,
      );
      if (executedOutput.methodId !== evalRec.methodId) {
        throw new RangeError(
          `Method executor returned methodId '${executedOutput.methodId}', expected '${evalRec.methodId}'`,
        );
      }
    } catch (err) {
      const errorName = err instanceof Error ? err.name : 'Error';
      const errorMessage = err instanceof Error ? err.message : String(err);
      methodExecutionFailures.push(
        Object.freeze({
          methodId: evalRec.methodId,
          stage: 'output-validation',
          errorName,
          errorMessage,
          inputProvenanceIds: bundle.provenanceIds,
        }),
      );
      failedOrSkippedExecutableIds.add(evalRec.methodId);
      failureReasonByMethod.set(
        evalRec.methodId,
        `Output validation failed (${errorName}: ${errorMessage})`,
      );
      continue;
    }

    const desc = registry.getOrThrow(evalRec.methodId);
    const verifiedForMethod = desc.requiredAssumptions
      .map((a) => a.id)
      .filter((id) => !evalRec.unverifiedAssumptions.includes(id));

    methodOutputs.push(executedOutput);
    executedMethodDiagnostics.push(
      Object.freeze({
        methodId: evalRec.methodId,
        disposition: evalRec.disposition,
        inputProvenanceIds: bundle.provenanceIds,
        inputSourceUrls: bundle.sourceUrls,
        verifiedAssumptions: Object.freeze(verifiedForMethod),
        unverifiedAssumptions: evalRec.unverifiedAssumptions,
        activeLimitations: Object.freeze([
          ...evalRec.activeLimitations,
          ...executedOutput.warnings,
        ]),
        output: executedOutput,
      }),
    );
  }

  /* -----------------------------------------------------------------------
     Step F: Dependence-aware forecast synthesis (`synthesizeForecastDistribution`)
     ----------------------------------------------------------------------- */
  const effectiveSynthesisPlan = buildEffectivePlanAfterExecutionFailures(
    applicabilityPlan,
    planningInput,
    failedOrSkippedExecutableIds,
    failureReasonByMethod,
    registry,
  );

  const survivingEvidenceOutputs = methodOutputs.filter(
    (o) => o.methodId !== 'structural-uniform-baseline',
  );
  const survivingStructuralOutputs = methodOutputs.filter(
    (o) => o.methodId === 'structural-uniform-baseline',
  );

  let synthesisFootingTier: EvidentialFootingTier | undefined =
    request.footingTier;
  if (
    survivingEvidenceOutputs.length > 0 &&
    synthesisFootingTier === undefined
  ) {
    const anyUnverifiedOrLimitations = executedMethodDiagnostics
      .filter((d) => d.methodId !== 'structural-uniform-baseline')
      .some(
        (d) =>
          d.disposition === 'applicable-with-limitations' ||
          d.unverifiedAssumptions.length > 0,
      );
    synthesisFootingTier = anyUnverifiedOrLimitations
      ? 'defensible-low-confidence-exploratory'
      : 'methodologically-sound-moderate-evidence';
  } else if (
    survivingEvidenceOutputs.length === 0 &&
    survivingStructuralOutputs.length > 0
  ) {
    synthesisFootingTier = 'structural-symmetry-baseline-only';
  } else if (
    survivingEvidenceOutputs.length === 0 &&
    survivingStructuralOutputs.length === 0
  ) {
    synthesisFootingTier = 'insufficient-basis-abstain';
  }

  const pipelineLimitations: string[] = [
    ...(request.additionalLimitations ?? []),
    ...evidenceAssessment.assessmentNotes,
  ];

  if (!resolution.identityComplete) {
    pipelineLimitations.push(
      `Canonical proposition identity has unresolved component(s) [${resolution.unresolvedComponents.join(', ')}]; forecast is conditioned on the supplied outcome space and cannot be published as an autonomous official ledger record.`,
    );
  }
  if (evidenceCollectionStatus === 'partial-provider-failure') {
    pipelineLimitations.push(
      `External evidence harvesting experienced partial provider failure (${harvestResult.summary.providersFailed}/${harvestResult.summary.providersQueried} provider(s) failed).`,
    );
  } else if (evidenceCollectionStatus === 'failed-all-providers') {
    pipelineLimitations.push(
      `External evidence harvesting failed across all ${harvestResult.summary.providersQueried} queried provider(s).`,
    );
  }

  for (const failure of methodExecutionFailures) {
    pipelineLimitations.push(
      `Isolated method failure in '${failure.methodId}' during ${failure.stage} (${failure.errorName}: ${failure.errorMessage}).`,
    );
  }

  let abstentionReason: AbstentionReason | undefined;
  if (
    survivingEvidenceOutputs.length === 0 &&
    survivingStructuralOutputs.length === 0
  ) {
    if (methodExecutionFailures.length > 0) {
      abstentionReason = 'numerical-representation-or-convergence-failure';
    } else {
      abstentionReason = 'no-defensible-theoretical-or-empirical-basis';
    }
  }

  let effectiveCustomWeights = request.customWeightsByMethod;
  if (
    effectiveCustomWeights !== undefined &&
    failedOrSkippedExecutableIds.size > 0 &&
    survivingEvidenceOutputs.length > 0
  ) {
    const survivingIds = survivingEvidenceOutputs.map((o) => o.methodId);
    const rawSurvivingWeights = survivingIds.map(
      (id) => effectiveCustomWeights?.[id] ?? 0,
    );
    const sumW = kahanNeumaierSum(rawSurvivingWeights);
    if (sumW > 0 && rawSurvivingWeights.every((w) => w > 0)) {
      const renorm: Record<string, number> = {};
      for (let i = 0; i < survivingIds.length; i++) {
        renorm[survivingIds[i]!] = rawSurvivingWeights[i]! / sumW;
      }
      effectiveCustomWeights = Object.freeze(renorm);
    }
  }

  const synthesisInput: ForecastSynthesisInput = Object.freeze({
    plan: effectiveSynthesisPlan,
    methodOutputs: Object.freeze(methodOutputs),
    questionCategory: effectiveCategory,
    ...(synthesisFootingTier !== undefined
      ? { footingTier: synthesisFootingTier }
      : {}),
    ...(request.calibrationStatus !== undefined
      ? { calibrationStatus: request.calibrationStatus }
      : {}),
    ...(effectiveCustomWeights !== undefined &&
    survivingEvidenceOutputs.length > 0
      ? { customWeightsByMethod: effectiveCustomWeights }
      : {}),
    ...(request.independenceCertification !== undefined &&
    survivingEvidenceOutputs.length > 0
      ? { independenceCertification: request.independenceCertification }
      : {}),
    ...(request.statisticalIndependenceVerified !== undefined
      ? {
          statisticalIndependenceVerified:
            request.statisticalIndependenceVerified,
        }
      : {}),
    ...(request.verifiedIndependentMethodCount !== undefined
      ? {
          verifiedIndependentMethodCount:
            request.verifiedIndependentMethodCount,
        }
      : {}),
    ...(abstentionReason !== undefined ? { abstentionReason } : {}),
    additionalMethodologicalLimitations: Object.freeze(pipelineLimitations),
  });

  const synthesisResult = synthesizer(synthesisInput);

  let pipelineStatus: PipelineExecutionStatus;
  let forecastKind: PipelineForecastKind;
  let isEmpiricalForecast: boolean;

  const hasValidDistribution =
    synthesisResult.outcomes.length >= 2 &&
    synthesisResult.abstentionReason === undefined;

  if (!hasValidDistribution) {
    if (methodExecutionFailures.length > 0) {
      pipelineStatus = 'failed-execution';
      forecastKind = 'failed';
      isEmpiricalForecast = false;
    } else {
      pipelineStatus = 'honest-abstention';
      forecastKind = 'abstained';
      isEmpiricalForecast = false;
    }
  } else if (failedOrSkippedExecutableIds.size > 0) {
    pipelineStatus = 'partial-execution';
    isEmpiricalForecast = survivingEvidenceOutputs.length > 0;
    forecastKind = isEmpiricalForecast
      ? 'empirical-forecast'
      : 'structural-baseline-only';
  } else if (
    synthesisResult.footingTier === 'structural-symmetry-baseline-only' ||
    survivingEvidenceOutputs.length === 0
  ) {
    pipelineStatus = 'structural-baseline-forecast';
    forecastKind = 'structural-baseline-only';
    isEmpiricalForecast = false;
  } else if (
    EVIDENCE_DRIVEN_FOOTING_TIERS.includes(synthesisResult.footingTier)
  ) {
    pipelineStatus = 'successful-empirical-forecast';
    forecastKind = 'empirical-forecast';
    isEmpiricalForecast = true;
  } else {
    pipelineStatus = 'honest-abstention';
    forecastKind = 'abstained';
    isEmpiricalForecast = false;
  }

  const missingReqSet = new Set<string>();
  if (!resolution.identityComplete) {
    missingReqSet.add(
      `Unresolved canonical identity components: [${resolution.unresolvedComponents.join(', ')}]`,
    );
  }
  const combinedMissingByMethod: Record<string, readonly string[]> = {};
  for (const evalRec of applicabilityPlan.evaluatedMethods) {
    const methodMissing = new Set<string>([
      ...(applicabilityPlan.missingDataByMethod[evalRec.methodId] ?? []),
      ...(evidenceAssessment.missingRequirementsByMethod[evalRec.methodId] ??
        []),
    ]);
    combinedMissingByMethod[evalRec.methodId] = Object.freeze([
      ...methodMissing,
    ]);
    if (!evalRec.applicable) {
      for (const m of methodMissing) {
        missingReqSet.add(m);
      }
    }
  }

  const probabilityDistribution: readonly DualChannelProbability[] | null =
    hasValidDistribution ? synthesisResult.outcomes : null;

  const uncertaintyDecomposition: PipelineUncertaintyDecompositionReport | null =
    hasValidDistribution
      ? Object.freeze({
          categoryDecompositions:
            synthesisResult.contrastReport.categoryDecompositions,
          entropyDecomposition:
            synthesisResult.contrastReport.entropyDecomposition,
        })
      : null;

  const result: ForecastPipelineResult = {
    pipelineVersion: FORECAST_PIPELINE_VERSION,
    executedAt: referenceTime,
    referenceTime,
    questionIdentity,
    outcomeSpace,
    pipelineStatus,
    forecastKind,
    isEmpiricalForecast,
    evidenceCollectionStatus,
    retrievedEvidenceCount: evidenceAssessment.totalRetrievedCount,
    validatedQuantitativeEvidenceCount:
      evidenceAssessment.totalQuantitativeValidatedCount,
    harvestResult,
    discardedHarvestDiagnostics: harvestResult.discarded,
    evidenceReferences,
    evidenceProvenance,
    evidenceAssessment,
    applicabilityPlan,
    methodApplicabilityResults: applicabilityPlan.evaluatedMethods,
    executedMethodIds: synthesisResult.contrastReport.executedMethodIds,
    skippedMethods: Object.freeze(skippedMethods),
    deferredMethods: applicabilityPlan.deferredMethods,
    inapplicableMethods: applicabilityPlan.inapplicableMethods,
    unexecutedApplicableMethods:
      synthesisResult.contrastReport.unexecutedApplicableMethods ??
      Object.freeze([]),
    methodExecutionFailures: Object.freeze(methodExecutionFailures),
    methodOutputs: Object.freeze(methodOutputs),
    executedMethodDiagnostics: Object.freeze(executedMethodDiagnostics),
    dependenceDiagnostics: applicabilityPlan.dependenceDiagnostics,
    independenceSemantics:
      synthesisResult.contrastReport.independenceSemantics ?? null,
    synthesisResult,
    probabilityDistribution,
    uncertaintyDecomposition,
    footingTier: synthesisResult.footingTier,
    calibrationStatus: synthesisResult.calibrationStatus,
    ...(synthesisResult.abstentionReason !== undefined
      ? { abstentionReason: synthesisResult.abstentionReason }
      : abstentionReason !== undefined && !hasValidDistribution
        ? { abstentionReason }
        : {}),
    limitations: synthesisResult.methodologicalLimitations,
    missingRequirements: Object.freeze([...missingReqSet]),
    missingRequirementsByMethod: Object.freeze(combinedMissingByMethod),
  };

  return deepFreeze(result);
}
