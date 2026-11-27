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
  DEFAULT_CREDIBLE_INTERVAL_LEVEL,
  EXECUTABLE_SCIENTIFIC_METHOD_IDS,
  MAX_CERTIFIED_SHAPE_PARAMETER,
  MIN_CERTIFIED_SHAPE_PARAMETER,
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
const MAX_CERTIFIED_OUTCOME_CARDINALITY = 64 as const;
const MIN_DEGREES_OF_FREEDOM = 1 as const;
const MAX_DEGREES_OF_FREEDOM = 2000 as const;

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
 * Creates a deterministic, fail-closed `EvidenceVerifier` for server-side
 * verification policies or deterministic offline tests.
 *
 * Fail-closed guarantees:
 *   - If neither an explicit `verifySubmission` callback nor a non-empty
 *     `verifiedEvidenceIds` allowlist is configured, every submission is
 *     rejected (`verifiedEmpirical: false`, `isPrimarySourceVerified: false`).
 *   - `isPrimarySourceVerified` is NEVER assumed `true` by default: it is
 *     `true` only when `verifiedEmpirical === true` AND primary-source status
 *     is explicitly affirmed via `primarySourceEvidenceIds` or an explicit
 *     `isPrimarySourceVerified: true` decision from `verifySubmission`.
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
  if (!isPlainObject(options)) {
    throw new RangeError(
      'createTrustedEvidenceVerifier requires a non-null options object',
    );
  }
  if (
    typeof options.verifierId !== 'string' ||
    options.verifierId.trim().length === 0
  ) {
    throw new RangeError(
      'createTrustedEvidenceVerifier requires a non-empty verifierId',
    );
  }
  const verifierId = options.verifierId.trim();

  if (
    options.verifySubmission !== undefined &&
    typeof options.verifySubmission !== 'function'
  ) {
    throw new RangeError(
      'createTrustedEvidenceVerifier.verifySubmission must be a function when provided',
    );
  }
  if (
    options.verifiedEvidenceIds !== undefined &&
    !Array.isArray(options.verifiedEvidenceIds)
  ) {
    throw new RangeError(
      'createTrustedEvidenceVerifier.verifiedEvidenceIds must be an array of strings when provided',
    );
  }
  if (
    options.primarySourceEvidenceIds !== undefined &&
    !Array.isArray(options.primarySourceEvidenceIds)
  ) {
    throw new RangeError(
      'createTrustedEvidenceVerifier.primarySourceEvidenceIds must be an array of strings when provided',
    );
  }

  const verifiedSet =
    options.verifiedEvidenceIds !== undefined
      ? new Set(
          options.verifiedEvidenceIds
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        )
      : null;
  const primarySet =
    options.primarySourceEvidenceIds !== undefined
      ? new Set(
          options.primarySourceEvidenceIds
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        )
      : null;

  return (
    context: EvidenceVerificationContext,
  ): EvidenceVerificationDecision => {
    const normalizedEvidenceId =
      isPlainObject(context) && typeof context.evidenceId === 'string'
        ? context.evidenceId.trim()
        : '';

    if (normalizedEvidenceId.length === 0) {
      return Object.freeze({
        verifiedEmpirical: false,
        isPrimarySourceVerified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed rejection by '${verifierId}': missing or empty evidenceId.`,
      });
    }

    const mappedEventIds =
      options.verifiedEventIdsByEvidenceId?.[normalizedEvidenceId];

    if (options.verifySubmission !== undefined) {
      const custom = options.verifySubmission(context);
      if (typeof custom === 'boolean') {
        const allowlistPermits =
          verifiedSet === null ||
          (verifiedSet.size > 0 && verifiedSet.has(normalizedEvidenceId));
        const verified = custom && allowlistPermits;
        const isPrimary =
          verified && primarySet !== null && primarySet.has(normalizedEvidenceId);
        return Object.freeze({
          verifiedEmpirical: verified,
          isPrimarySourceVerified: isPrimary,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale:
            options.defaultRationale ??
            (verified
              ? `Verified empirical provenance for '${normalizedEvidenceId}' via trusted verifier '${verifierId}'.`
              : `Rejected empirical provenance for '${normalizedEvidenceId}' via trusted verifier '${verifierId}'.`),
          ...(mappedEventIds !== undefined
            ? { verifiedEventIds: mappedEventIds }
            : {}),
        });
      }

      if (!isPlainObject(custom)) {
        return Object.freeze({
          verifiedEmpirical: false,
          isPrimarySourceVerified: false,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale: `Fail-closed rejection for '${normalizedEvidenceId}': verifySubmission returned a non-decision value.`,
        });
      }

      const allowlistPermits =
        verifiedSet === null ||
        (verifiedSet.size > 0 && verifiedSet.has(normalizedEvidenceId));
      const verified = custom.verifiedEmpirical === true && allowlistPermits;
      const explicitPrimary = custom.isPrimarySourceVerified;
      const isPrimary =
        verified &&
        (explicitPrimary === true ||
          (explicitPrimary === undefined &&
            primarySet !== null &&
            primarySet.has(normalizedEvidenceId)));
      const effectiveVerifierId =
        typeof custom.verifierId === 'string' &&
        custom.verifierId.trim().length > 0
          ? custom.verifierId.trim()
          : verifierId;
      const effectiveRationale =
        typeof custom.rationale === 'string' && custom.rationale.trim().length > 0
          ? custom.rationale.trim()
          : options.defaultRationale ??
            (verified
              ? `Verified empirical provenance for '${normalizedEvidenceId}' via trusted verifier '${effectiveVerifierId}'.`
              : `Rejected empirical provenance for '${normalizedEvidenceId}' via trusted verifier '${effectiveVerifierId}'.`);

      return Object.freeze({
        verifiedEmpirical: verified,
        isPrimarySourceVerified: isPrimary,
        verifierId: effectiveVerifierId,
        ...(typeof custom.verificationArtifactRef === 'string' &&
        custom.verificationArtifactRef.trim().length > 0
          ? { verificationArtifactRef: custom.verificationArtifactRef.trim() }
          : options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
        rationale: effectiveRationale,
        ...(custom.verifiedEventIds !== undefined
          ? { verifiedEventIds: custom.verifiedEventIds }
          : mappedEventIds !== undefined
            ? { verifiedEventIds: mappedEventIds }
            : {}),
      });
    }

    // Fail-closed: if no explicit verifySubmission callback AND no non-empty
    // verifiedEvidenceIds allowlist exist, no evidence may be verified.
    if (verifiedSet === null || verifiedSet.size === 0) {
      return Object.freeze({
        verifiedEmpirical: false,
        isPrimarySourceVerified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed rejection for '${normalizedEvidenceId}': verifier '${verifierId}' has neither an explicit verifySubmission callback nor a non-empty verifiedEvidenceIds allowlist.`,
      });
    }

    const isVerified = verifiedSet.has(normalizedEvidenceId);
    const isPrimary =
      isVerified &&
      primarySet !== null &&
      primarySet.has(normalizedEvidenceId);
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
          ? `Independently verified empirical provenance for '${normalizedEvidenceId}' via trusted verifier '${verifierId}'.`
          : `Submission '${normalizedEvidenceId}' is not in the trusted verifier's verifiedEvidenceIds allowlist.`),
      ...(mappedEventIds !== undefined
        ? { verifiedEventIds: mappedEventIds }
        : {}),
    });
  };
}

export const STRUCTURAL_SYMMETRY_BASIS_KINDS = Object.freeze([
  'transitive-permutation-group',
  'equal-cardinality-microstate-partition',
] as const);

export type StructuralSymmetryBasisKind =
  (typeof STRUCTURAL_SYMMETRY_BASIS_KINDS)[number];

/**
 * Valid mathematical symmetry contract required to justify
 * `structural-uniform-baseline` (`P(k) = 1 / K`). A binary outcome space is
 * never assumed 50/50, and a caller-provided boolean toggle plus prose
 * rationale is never accepted as proof of symmetry.
 */
export interface StructuralSymmetryContract {
  readonly basisKind: StructuralSymmetryBasisKind;
  /**
   * Generating bijections of {0, ..., K-1} whose generated subgroup G <= S_K
   * acts transitively across all K outcome labels, containing at least one
   * non-identity permutation.
   */
  readonly generatingPermutations: readonly (readonly number[])[];
  /**
   * Cardinality m_k of atomic equiprobable microstates assigned to each
   * outcome k in {0, ..., K-1}. Length must equal K and all m_k must be
   * identical positive safe integers (m_0 === m_1 === ... === m_{K-1}).
   */
  readonly microstateCountsPerOutcome: readonly number[];
  /**
   * Formal mathematical invariance proof specifying the symmetry group,
   * conserved measure-preserving observable, and analytical derivation.
   */
  readonly formalInvariant: {
    readonly groupName: string;
    readonly invariantObservable: string;
    readonly derivationReference: string;
  };
}

export interface StructuralSymmetryValidationResult {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly orbitSize: number;
  readonly groupOrderLowerBound: number;
  readonly microstatesPerOutcome: number | null;
}

export interface StructuralSymmetryVerificationDecision {
  readonly verified: boolean;
  readonly verifierId: string;
  readonly rationale: string;
  readonly verificationArtifactRef?: string;
}

export type StructuralSymmetryVerifier = (context: {
  readonly question: string;
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly contract: StructuralSymmetryContract;
  readonly validation: StructuralSymmetryValidationResult;
  readonly referenceTime: IsoDateTime;
}) => StructuralSymmetryVerificationDecision;

/**
 * Constructs a fail-closed server-side `StructuralSymmetryVerifier`.
 *
 * Fail-closed guarantees:
 *   - If neither an explicit `verifySymmetry` callback nor a non-empty
 *     server-side allowlist (`approvedDerivationReferences` or
 *     `approvedEventDefinitionHashes`) is configured, every symmetry contract
 *     is rejected (`verified: false`).
 *   - Mathematically invalid contracts (`validateStructuralSymmetryContract`
 *     failing) are ALWAYS rejected regardless of callback decisions.
 *   - Caller-supplied `formalInvariant`, `derivationReference`,
 *     `generatingPermutations`, and `microstateCountsPerOutcome` are NEVER
 *     treated as verified symmetry proof by themselves.
 */
export function createTrustedStructuralSymmetryVerifier(options: {
  readonly verifierId: string;
  readonly verificationArtifactRef?: string;
  readonly defaultRationale?: string;
  readonly approvedDerivationReferences?: readonly string[];
  readonly approvedEventDefinitionHashes?: readonly string[];
  readonly verifySymmetry?: (context: {
    readonly question: string;
    readonly outcomeSpace: OutcomeSpaceDescriptor;
    readonly contract: StructuralSymmetryContract;
    readonly validation: StructuralSymmetryValidationResult;
    readonly referenceTime: IsoDateTime;
  }) => Partial<StructuralSymmetryVerificationDecision> | boolean;
}): StructuralSymmetryVerifier {
  if (!isPlainObject(options)) {
    throw new RangeError(
      'createTrustedStructuralSymmetryVerifier requires a non-null options object',
    );
  }
  if (
    typeof options.verifierId !== 'string' ||
    options.verifierId.trim().length === 0
  ) {
    throw new RangeError(
      'createTrustedStructuralSymmetryVerifier requires a non-empty verifierId',
    );
  }
  const verifierId = options.verifierId.trim();

  if (
    options.verifySymmetry !== undefined &&
    typeof options.verifySymmetry !== 'function'
  ) {
    throw new RangeError(
      'createTrustedStructuralSymmetryVerifier.verifySymmetry must be a function when provided',
    );
  }
  if (
    options.approvedDerivationReferences !== undefined &&
    !Array.isArray(options.approvedDerivationReferences)
  ) {
    throw new RangeError(
      'createTrustedStructuralSymmetryVerifier.approvedDerivationReferences must be an array of strings when provided',
    );
  }
  if (
    options.approvedEventDefinitionHashes !== undefined &&
    !Array.isArray(options.approvedEventDefinitionHashes)
  ) {
    throw new RangeError(
      'createTrustedStructuralSymmetryVerifier.approvedEventDefinitionHashes must be an array of strings when provided',
    );
  }

  const refSet =
    options.approvedDerivationReferences !== undefined
      ? new Set(
          options.approvedDerivationReferences
            .filter((r): r is string => typeof r === 'string')
            .map((r) => r.trim())
            .filter((r) => r.length > 0),
        )
      : null;
  const hashSet =
    options.approvedEventDefinitionHashes !== undefined
      ? new Set(
          options.approvedEventDefinitionHashes
            .filter((h): h is string => typeof h === 'string')
            .map((h) => h.trim())
            .filter((h) => h.length > 0),
        )
      : null;

  return (context): StructuralSymmetryVerificationDecision => {
    const validation =
      context.validation ??
      validateStructuralSymmetryContract(context.contract, context.outcomeSpace);

    if (!validation.valid) {
      return Object.freeze({
        verified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed symmetry rejection by '${verifierId}': ${validation.reasons.join('; ')}`,
      });
    }

    const derivationRef = context.contract.formalInvariant.derivationReference.trim();
    const eventHash = context.outcomeSpace.eventDefinitionHash.trim();

    if (options.verifySymmetry !== undefined) {
      const custom = options.verifySymmetry({
        ...context,
        validation,
      });
      const allowlistPermits =
        (refSet === null || (refSet.size > 0 && refSet.has(derivationRef))) &&
        (hashSet === null || (hashSet.size > 0 && hashSet.has(eventHash)));

      if (typeof custom === 'boolean') {
        const verified = custom && allowlistPermits;
        return Object.freeze({
          verified,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale:
            options.defaultRationale ??
            (verified
              ? `Verified structural symmetry contract ('${context.contract.formalInvariant.groupName}') via trusted verifier '${verifierId}'.`
              : `Rejected structural symmetry contract ('${context.contract.formalInvariant.groupName}') via trusted verifier '${verifierId}'.`),
        });
      }

      if (!isPlainObject(custom)) {
        return Object.freeze({
          verified: false,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale: `Fail-closed symmetry rejection by '${verifierId}': verifySymmetry returned a non-decision value.`,
        });
      }

      const verified = custom.verified === true && allowlistPermits;
      const effectiveVerifierId =
        typeof custom.verifierId === 'string' &&
        custom.verifierId.trim().length > 0
          ? custom.verifierId.trim()
          : verifierId;
      const effectiveRationale =
        typeof custom.rationale === 'string' &&
        custom.rationale.trim().length > 0
          ? custom.rationale.trim()
          : options.defaultRationale ??
            (verified
              ? `Verified structural symmetry contract ('${context.contract.formalInvariant.groupName}') via trusted verifier '${effectiveVerifierId}'.`
              : `Rejected structural symmetry contract ('${context.contract.formalInvariant.groupName}') via trusted verifier '${effectiveVerifierId}'.`);

      return Object.freeze({
        verified,
        verifierId: effectiveVerifierId,
        ...(typeof custom.verificationArtifactRef === 'string' &&
        custom.verificationArtifactRef.trim().length > 0
          ? { verificationArtifactRef: custom.verificationArtifactRef.trim() }
          : options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
        rationale: effectiveRationale,
      });
    }

    const hasAnyAllowlist =
      (refSet !== null && refSet.size > 0) ||
      (hashSet !== null && hashSet.size > 0);
    if (!hasAnyAllowlist) {
      return Object.freeze({
        verified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed rejection by '${verifierId}': verifier has neither an explicit verifySymmetry callback nor a non-empty derivation/event-hash allowlist.`,
      });
    }

    const refOk = refSet === null || refSet.has(derivationRef);
    const hashOk = hashSet === null || hashSet.has(eventHash);
    const verified = refOk && hashOk;
    return Object.freeze({
      verified,
      verifierId,
      ...(options.verificationArtifactRef !== undefined
        ? { verificationArtifactRef: options.verificationArtifactRef }
        : {}),
      rationale:
        options.defaultRationale ??
        (verified
          ? `Independently verified structural symmetry contract ('${context.contract.formalInvariant.groupName}', ref='${derivationRef}') via trusted verifier '${verifierId}'.`
          : `Structural symmetry derivation '${derivationRef}' / event '${eventHash}' is not present in trusted verifier '${verifierId}' allowlist.`),
    });
  };
}

const ASYMMETRIC_BINARY_LABEL_PAIRS: ReadonlySet<string> = new Set([
  'yes|no',
  'no|yes',
  'true|false',
  'false|true',
  'success|failure',
  'failure|success',
  'pass|fail',
  'fail|pass',
  'win|loss',
  'loss|win',
  'approve|reject',
  'reject|approve',
  'approved|rejected',
  'rejected|approved',
  'occur|not occur',
  'not occur|occur',
  'occurs|does not occur',
  'does not occur|occurs',
  'above|below',
  'below|above',
  'exceed|not exceed',
  'not exceed|exceed',
  'breach|no breach',
  'no breach|breach',
  'barrier breached|no breach',
  'no breach|barrier breached',
  'ratified|not ratified',
  'not ratified|ratified',
  'present|absent',
  'absent|present',
  'positive|negative',
  'negative|positive',
]);

function normalizeSymmetryLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isAsymmetricNegationOrThresholdPair(
  labels: readonly string[],
): string | null {
  if (labels.length === 2) {
    const a = normalizeSymmetryLabel(labels[0]!);
    const b = normalizeSymmetryLabel(labels[1]!);
    if (ASYMMETRIC_BINARY_LABEL_PAIRS.has(`${a}|${b}`)) {
      return `Binary partition ['${labels[0]}', '${labels[1]}'] is an asymmetric occurrence/polarity complement pair, which is not invariant under label permutation`;
    }
    const negPrefixes = ['no ', 'not ', 'non ', 'un'];
    for (const prefix of negPrefixes) {
      if (b === `${prefix}${a}` || a === `${prefix}${b}`) {
        return `Binary partition ['${labels[0]}', '${labels[1]}'] is a logical negation pair (P vs not-P), which violates permutation symmetry`;
      }
    }
  }
  for (const raw of labels) {
    const norm = raw.trim().toLowerCase();
    if (
      /^(<=|>=|<|>)/.test(norm) ||
      /\b(at least|at most|less than|greater than|more than|fewer than|before|after)\b/.test(
        norm,
      )
    ) {
      return `Outcome label '${raw}' encodes an asymmetric inequality or temporal ordering bound incompatible with uniform label-exchange symmetry`;
    }
  }
  return null;
}

/**
 * Validates that a `StructuralSymmetryContract` provides a mathematically sound
 * group-theoretic and equal-microstate justification for `structural-uniform-baseline`
 * on the given `OutcomeSpaceDescriptor`.
 */
export function validateStructuralSymmetryContract(
  contract: unknown,
  outcomeSpace: OutcomeSpaceDescriptor,
): StructuralSymmetryValidationResult {
  const reasons: string[] = [];
  const outcomeCount = outcomeSpace.outcomeLabels.length;

  if (
    outcomeSpace.kind !== 'binary' &&
    outcomeSpace.kind !== 'categorical-exhaustive'
  ) {
    reasons.push(
      `structural-uniform-baseline is incompatible with outcomeSpace.kind '${outcomeSpace.kind}' (only 'binary' and 'categorical-exhaustive' discrete partitions are supported)`,
    );
  }
  if (outcomeCount < 2) {
    reasons.push(
      `Outcome space must contain at least 2 outcomes, found ${outcomeCount}`,
    );
  }

  const labelAsymmetry = isAsymmetricNegationOrThresholdPair(
    outcomeSpace.outcomeLabels,
  );
  if (labelAsymmetry !== null) {
    reasons.push(labelAsymmetry);
  }

  if (!isPlainObject(contract)) {
    reasons.push('structuralSymmetryContract must be a non-null plain object');
    return Object.freeze({
      valid: false,
      reasons: Object.freeze(reasons),
      orbitSize: 0,
      groupOrderLowerBound: 0,
      microstatesPerOutcome: null,
    });
  }

  if (
    typeof contract.basisKind !== 'string' ||
    !STRUCTURAL_SYMMETRY_BASIS_KINDS.includes(
      contract.basisKind as StructuralSymmetryBasisKind,
    )
  ) {
    reasons.push(
      `structuralSymmetryContract.basisKind must be one of [${STRUCTURAL_SYMMETRY_BASIS_KINDS.join(', ')}]`,
    );
  }

  // Validate generating permutations form a transitive bijection group on {0..K-1}:
  let orbitSize = 0;
  let validBijectionCount = 0;
  let hasNonIdentityGenerator = false;
  const validGenerators: number[][] = [];

  if (
    !Array.isArray(contract.generatingPermutations) ||
    contract.generatingPermutations.length === 0
  ) {
    reasons.push(
      'structuralSymmetryContract.generatingPermutations must be a non-empty array of permutations over {0, ..., K-1}',
    );
  } else {
    for (let gIdx = 0; gIdx < contract.generatingPermutations.length; gIdx++) {
      const gen = contract.generatingPermutations[gIdx];
      if (!Array.isArray(gen) || gen.length !== outcomeCount) {
        reasons.push(
          `generatingPermutations[${gIdx}] must have length ${outcomeCount}`,
        );
        continue;
      }
      const seenImages = new Set<number>();
      let genValid = true;
      let isIdentity = true;
      const normalizedGen: number[] = [];
      for (let i = 0; i < outcomeCount; i++) {
        const img = gen[i];
        if (
          typeof img !== 'number' ||
          !Number.isSafeInteger(img) ||
          img < 0 ||
          img >= outcomeCount
        ) {
          reasons.push(
            `generatingPermutations[${gIdx}][${i}] must be an integer in [0, ${outcomeCount - 1}]`,
          );
          genValid = false;
          break;
        }
        if (seenImages.has(img)) {
          reasons.push(
            `generatingPermutations[${gIdx}] is not a bijection (duplicate image index ${img})`,
          );
          genValid = false;
          break;
        }
        seenImages.add(img);
        normalizedGen.push(img);
        if (img !== i) {
          isIdentity = false;
        }
      }
      if (genValid) {
        validBijectionCount += 1;
        validGenerators.push(normalizedGen);
        if (!isIdentity) {
          hasNonIdentityGenerator = true;
        }
      }
    }

    if (!hasNonIdentityGenerator) {
      reasons.push(
        'generatingPermutations must include at least one non-identity bijection',
      );
    }

    if (
      validGenerators.length > 0 &&
      validBijectionCount === contract.generatingPermutations.length
    ) {
      // Exact finite-group orbit computation via BFS from outcome 0.
      // Because every generator g in S_K has finite order, forward closure under
      // generators equals closure under the generated subgroup G = <generators>.
      const visited = new Set<number>([0]);
      const queue: number[] = [0];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const gen of validGenerators) {
          const next = gen[curr]!;
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      orbitSize = visited.size;
      if (orbitSize !== outcomeCount) {
        reasons.push(
          `generatingPermutations do not act transitively on all ${outcomeCount} outcome labels (orbit from index 0 covers only [${[...visited].sort((a, b) => a - b).join(', ')}])`,
        );
      }
    }
  }

  // Validate equal microstate fiber cardinalities across all K outcomes:
  let microstatesPerOutcome: number | null = null;
  if (
    !Array.isArray(contract.microstateCountsPerOutcome) ||
    contract.microstateCountsPerOutcome.length !== outcomeCount
  ) {
    reasons.push(
      `microstateCountsPerOutcome must be an array of length ${outcomeCount}`,
    );
  } else {
    let allPositiveSafeInts = true;
    const counts: number[] = [];
    for (let k = 0; k < outcomeCount; k++) {
      const c = contract.microstateCountsPerOutcome[k];
      if (
        typeof c !== 'number' ||
        !Number.isSafeInteger(c) ||
        c < 1
      ) {
        reasons.push(
          `microstateCountsPerOutcome[${k}] must be a positive safe integer >= 1, received ${String(c)}`,
        );
        allPositiveSafeInts = false;
      } else {
        counts.push(c);
      }
    }
    if (allPositiveSafeInts && counts.length === outcomeCount) {
      const expected = counts[0]!;
      const unequalIndex = counts.findIndex((c) => c !== expected);
      if (unequalIndex !== -1) {
        reasons.push(
          `microstateCountsPerOutcome must be strictly equal across all outcomes to justify uniform 1/${outcomeCount} probabilities (outcome 0 has ${expected}, outcome ${unequalIndex} has ${counts[unequalIndex]})`,
        );
      } else {
        microstatesPerOutcome = expected;
      }
    }
  }

  // Validate formal mathematical invariant specification:
  if (!isPlainObject(contract.formalInvariant)) {
    reasons.push(
      'structuralSymmetryContract.formalInvariant must be a non-null plain object',
    );
  } else {
    const fi = contract.formalInvariant;
    const fields = [
      ['groupName', fi.groupName],
      ['invariantObservable', fi.invariantObservable],
      ['derivationReference', fi.derivationReference],
    ] as const;
    for (const [fieldName, rawVal] of fields) {
      if (typeof rawVal !== 'string' || rawVal.trim().length < 5) {
        reasons.push(
          `formalInvariant.${fieldName} must be a substantive non-empty mathematical specification (at least 5 characters)`,
        );
      }
    }
  }

  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
    orbitSize,
    groupOrderLowerBound: orbitSize,
    microstatesPerOutcome,
  });
}

export const MULTI_SOURCE_COMBINATION_BASES = Object.freeze([
  'disjoint-exchangeable-cohorts',
  'disjoint-poisson-exposure-windows',
  'disjoint-exogenous-weighted-cohorts',
] as const);

export type MultiSourceCombinationBasis =
  (typeof MULTI_SOURCE_COMBINATION_BASES)[number];

/**
 * Explicit mathematical justification required before combining multiple
 * independently verified submissions that target the same quantitative method.
 */
export interface MultiSourceCombinationJustification {
  readonly basis: MultiSourceCombinationBasis;
  /**
   * Exact set of verified submission `evidenceId`s being jointly combined for
   * this method (must include at least 2 distinct IDs and cover every verified
   * source contributing to the method).
   */
  readonly contributingEvidenceIds: readonly string[];
  /**
   * Certifies zero overlap across populations, trials, or exposure intervals
   * so pooled sums do not double-count observations.
   */
  readonly disjointPopulationsOrWindowsVerified: boolean;
  /**
   * Certifies homogeneous latent parameter space and identical priors across
   * all combined sources.
   */
  readonly homogeneousParameterSpaceVerified: boolean;
  /**
   * Required for `weighted-kish-effective-binomial`: certifies all combined
   * cohorts express weights on a commensurate exogenous scale.
   */
  readonly commonExogenousWeightScaleVerified?: boolean;
  /**
   * Explicit mathematical audit explanation preserving source dependence.
   */
  readonly mathematicalRationale: string;
}

export interface MultiSourceCombinationVerificationContext {
  readonly methodId: ExecutableScientificMethodId;
  readonly expectedBasis: MultiSourceCombinationBasis;
  readonly justification?: MultiSourceCombinationJustification;
  readonly contributingSubmissions: readonly PipelineEvidenceSubmission[];
  readonly contributingEvidenceIds: readonly string[];
  readonly contributingSourceUrls: readonly string[];
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
}

export interface MultiSourceCombinationVerificationDecision {
  readonly verified: boolean;
  readonly verifierId: string;
  readonly rationale: string;
  readonly verificationArtifactRef?: string;
  readonly verifiedEvidenceIds?: readonly string[];
}

export type MultiSourceCombinationVerifier = (
  context: MultiSourceCombinationVerificationContext,
) => MultiSourceCombinationVerificationDecision;

/**
 * Constructs a fail-closed server-side `MultiSourceCombinationVerifier`.
 *
 * Fail-closed guarantees:
 *   - If neither an explicit `verifyCombination` callback nor a non-empty
 *     `approvedMethodCombinations` mapping is configured, EVERY combination
 *     request is rejected (`verified: false`).
 *   - Caller-declared booleans (`disjointPopulationsOrWindowsVerified`,
 *     `homogeneousParameterSpaceVerified`, `commonExogenousWeightScaleVerified`)
 *     and prose `mathematicalRationale` are NEVER trusted on their own; they are
 *     preconditions checked alongside independent server-side verification.
 */
export function createTrustedCombinationVerifier(options: {
  readonly verifierId: string;
  readonly verificationArtifactRef?: string;
  readonly defaultRationale?: string;
  readonly approvedMethodCombinations?: Readonly<
    Partial<
      Record<ExecutableScientificMethodId, readonly (readonly string[])[]>
    >
  >;
  readonly verifyCombination?: (
    context: MultiSourceCombinationVerificationContext,
  ) => Partial<MultiSourceCombinationVerificationDecision> | boolean;
}): MultiSourceCombinationVerifier {
  if (!isPlainObject(options)) {
    throw new RangeError(
      'createTrustedCombinationVerifier requires a non-null options object',
    );
  }
  if (
    typeof options.verifierId !== 'string' ||
    options.verifierId.trim().length === 0
  ) {
    throw new RangeError(
      'createTrustedCombinationVerifier requires a non-empty verifierId',
    );
  }
  const verifierId = options.verifierId.trim();

  if (
    options.verifyCombination !== undefined &&
    typeof options.verifyCombination !== 'function'
  ) {
    throw new RangeError(
      'createTrustedCombinationVerifier.verifyCombination must be a function when provided',
    );
  }

  const approvedSetByMethod = new Map<string, Set<string>>();
  if (options.approvedMethodCombinations !== undefined) {
    if (!isPlainObject(options.approvedMethodCombinations)) {
      throw new RangeError(
        'createTrustedCombinationVerifier.approvedMethodCombinations must be an object when provided',
      );
    }
    for (const [mId, groups] of Object.entries(
      options.approvedMethodCombinations,
    )) {
      if (!Array.isArray(groups)) {
        continue;
      }
      const keySet = new Set<string>();
      for (const group of groups) {
        if (!Array.isArray(group)) {
          continue;
        }
        const normIds = group
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        if (normIds.length >= 2) {
          keySet.add(JSON.stringify([...new Set(normIds)].sort()));
        }
      }
      if (keySet.size > 0) {
        approvedSetByMethod.set(mId, keySet);
      }
    }
  }

  return (
    context: MultiSourceCombinationVerificationContext,
  ): MultiSourceCombinationVerificationDecision => {
    const j = context.justification;
    const expectedIds = [...new Set(context.contributingEvidenceIds)].sort();
    const expectedKey = JSON.stringify(expectedIds);

    const hasValidContractFields =
      isPlainObject(j) &&
      j.basis === context.expectedBasis &&
      j.disjointPopulationsOrWindowsVerified === true &&
      j.homogeneousParameterSpaceVerified === true &&
      (context.methodId !== 'weighted-kish-effective-binomial' ||
        j.commonExogenousWeightScaleVerified === true) &&
      typeof j.mathematicalRationale === 'string' &&
      j.mathematicalRationale.trim().length >= 10 &&
      Array.isArray(j.contributingEvidenceIds) &&
      j.contributingEvidenceIds.length === expectedIds.length &&
      JSON.stringify(
        [
          ...new Set(
            j.contributingEvidenceIds
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          ),
        ].sort(),
      ) === expectedKey;

    if (!hasValidContractFields) {
      return Object.freeze({
        verified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed rejection by '${verifierId}': missing or incomplete MultiSourceCombinationJustification contract for '${context.methodId}'.`,
      });
    }

    const methodAllowlist = approvedSetByMethod.get(context.methodId);
    const allowlistConfigured = approvedSetByMethod.size > 0;
    const allowlistPermits =
      !allowlistConfigured ||
      (methodAllowlist !== undefined && methodAllowlist.has(expectedKey));

    if (options.verifyCombination !== undefined) {
      const custom = options.verifyCombination(context);
      if (typeof custom === 'boolean') {
        const verified = custom && allowlistPermits;
        return Object.freeze({
          verified,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale:
            options.defaultRationale ??
            (verified
              ? `Verified disjoint multi-source combination for '${context.methodId}' (${context.contributingEvidenceIds.join(', ')}) via trusted verifier '${verifierId}'.`
              : `Rejected multi-source combination for '${context.methodId}' (${context.contributingEvidenceIds.join(', ')}) via trusted verifier '${verifierId}'.`),
          ...(verified
            ? { verifiedEvidenceIds: Object.freeze([...context.contributingEvidenceIds]) }
            : {}),
        });
      }

      if (!isPlainObject(custom)) {
        return Object.freeze({
          verified: false,
          verifierId,
          ...(options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
          rationale: `Fail-closed rejection by '${verifierId}': verifyCombination returned a non-decision value.`,
        });
      }

      const verified = custom.verified === true && allowlistPermits;
      const effectiveVerifierId =
        typeof custom.verifierId === 'string' &&
        custom.verifierId.trim().length > 0
          ? custom.verifierId.trim()
          : verifierId;
      const effectiveRationale =
        typeof custom.rationale === 'string' &&
        custom.rationale.trim().length > 0
          ? custom.rationale.trim()
          : options.defaultRationale ??
            (verified
              ? `Verified disjoint multi-source combination for '${context.methodId}' (${context.contributingEvidenceIds.join(', ')}) via trusted verifier '${effectiveVerifierId}'.`
              : `Rejected multi-source combination for '${context.methodId}' (${context.contributingEvidenceIds.join(', ')}) via trusted verifier '${effectiveVerifierId}'.`);

      return Object.freeze({
        verified,
        verifierId: effectiveVerifierId,
        ...(typeof custom.verificationArtifactRef === 'string' &&
        custom.verificationArtifactRef.trim().length > 0
          ? { verificationArtifactRef: custom.verificationArtifactRef.trim() }
          : options.verificationArtifactRef !== undefined
            ? { verificationArtifactRef: options.verificationArtifactRef }
            : {}),
        rationale: effectiveRationale,
        ...(custom.verifiedEvidenceIds !== undefined
          ? { verifiedEvidenceIds: custom.verifiedEvidenceIds }
          : verified
            ? { verifiedEvidenceIds: Object.freeze([...context.contributingEvidenceIds]) }
            : {}),
      });
    }

    if (!allowlistConfigured) {
      return Object.freeze({
        verified: false,
        verifierId,
        ...(options.verificationArtifactRef !== undefined
          ? { verificationArtifactRef: options.verificationArtifactRef }
          : {}),
        rationale: `Fail-closed rejection by '${verifierId}': verifier has neither an explicit verifyCombination callback nor a non-empty approvedMethodCombinations allowlist.`,
      });
    }

    return Object.freeze({
      verified: allowlistPermits,
      verifierId,
      ...(options.verificationArtifactRef !== undefined
        ? { verificationArtifactRef: options.verificationArtifactRef }
        : {}),
      rationale:
        options.defaultRationale ??
        (allowlistPermits
          ? `Independently verified multi-source combination for '${context.methodId}' (${context.contributingEvidenceIds.join(', ')}) via trusted verifier '${verifierId}'.`
          : `Source cohort set [${context.contributingEvidenceIds.join(', ')}] for '${context.methodId}' is not present in trusted verifier '${verifierId}' allowlist.`),
      ...(allowlistPermits
        ? { verifiedEvidenceIds: Object.freeze([...context.contributingEvidenceIds]) }
        : {}),
    });
  };
}

export interface MultiSourceCombinationDiagnostic {
  readonly methodId: ExecutableScientificMethodId;
  readonly combinationMode:
    | 'global-event-deduplication'
    | 'mathematically-justified-disjoint-combination';
  readonly combinationBasis:
    | 'event-level-global-deduplication'
    | MultiSourceCombinationBasis;
  readonly contributingEvidenceIds: readonly string[];
  readonly contributingSourceUrls: readonly string[];
  readonly dependencePreserved: true;
  readonly verifiedByVerifierId: string | null;
  readonly verificationArtifactRef: string | null;
  readonly mathematicalRationale: string;
  readonly dependenceNote: string;
}

export interface RejectedMultiSourceCombinationDiagnostic {
  readonly methodId: ExecutableScientificMethodId;
  readonly expectedBasis: MultiSourceCombinationBasis;
  readonly contributingEvidenceIds: readonly string[];
  readonly contributingSourceUrls: readonly string[];
  readonly rejectionCode:
    | 'missing-combination-justification'
    | 'invalid-combination-justification'
    | 'missing-trusted-combination-verifier'
    | 'rejected-by-trusted-combination-verifier';
  readonly verifiedByVerifierId: string | null;
  readonly verificationArtifactRef: string | null;
  readonly preservedIndividualSources: true;
  readonly explanation: string;
}

export interface StructuralSymmetryVerificationDiagnostic {
  readonly status:
    | 'verified'
    | 'rejected-no-trusted-verifier'
    | 'rejected-by-trusted-verifier'
    | 'rejected-legacy-premise-without-contract'
    | 'rejected-baseline-not-opted-in';
  readonly verifierId: string | null;
  readonly verificationArtifactRef: string | null;
  readonly contractBasisKind: StructuralSymmetryBasisKind | null;
  readonly explanation: string;
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
  readonly multiSourceCombinations: readonly MultiSourceCombinationDiagnostic[];
  readonly rejectedMultiSourceCombinations: readonly RejectedMultiSourceCombinationDiagnostic[];
  readonly structuralSymmetryVerification: StructuralSymmetryVerificationDiagnostic | null;
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
  readonly multiSourceCombinationJustifications?: Readonly<
    Record<string, MultiSourceCombinationJustification>
  >;
  readonly assumptions?: Partial<AssumptionDeclarationsInput>;
  readonly structuralSymmetryContract?: StructuralSymmetryContract;
  /**
   * @deprecated Unverified boolean + rationale premises never justify
   * `structural-uniform-baseline` symmetry and are rejected at the trust gate.
   * Supply a mathematically valid `structuralSymmetryContract` instead.
   */
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
  readonly symmetryVerifier?: StructuralSymmetryVerifier;
  readonly combinationVerifier?: MultiSourceCombinationVerifier;
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
   4. Internal Helpers, Mathematical Validators & Multi-Source Types
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

function canonicalJsonKey(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonKey(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonKey(obj[k])}`)
    .join(',')}}`;
}

function validateCredibleIntervalLevel(
  value: unknown,
  contextLabel: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= 1
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.credibleIntervalLevel must be a finite number strictly inside (0, 1), received ${String(value)}`,
    );
  }
  return value;
}

function validateCertifiedShapeNumber(
  value: unknown,
  fieldName: string,
): number {
  if (
    !isPositiveFiniteNumber(value) ||
    value < MIN_CERTIFIED_SHAPE_PARAMETER ||
    value > MAX_CERTIFIED_SHAPE_PARAMETER
  ) {
    throw new ForecastPipelineRequestError(
      `${fieldName} must lie within certified numerical domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}], received ${String(value)}`,
    );
  }
  return value;
}

function validateStrictTrimmedUnit(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForecastPipelineRequestError(
      `${fieldName} must be a non-empty string, received ${String(value)}`,
    );
  }
  if (value !== value.trim()) {
    throw new ForecastPipelineRequestError(
      `${fieldName} must not contain leading or trailing whitespace ('${value}')`,
    );
  }
  return value;
}

function validateBetaPrior(
  prior: unknown,
  contextLabel: string,
): { readonly alpha: number; readonly beta: number } {
  if (!isPlainObject(prior)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior must be a non-null plain object { alpha, beta }`,
    );
  }
  if (
    'scale' in prior &&
    prior.scale !== undefined
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior must not specify a 'scale' parameter`,
    );
  }
  const alpha = validateCertifiedShapeNumber(
    prior.alpha,
    `${contextLabel}.prior.alpha`,
  );
  const beta = validateCertifiedShapeNumber(
    prior.beta,
    `${contextLabel}.prior.beta`,
  );
  return Object.freeze({ alpha, beta });
}

function validateBetaCountsAndPosterior(
  prior: { readonly alpha: number; readonly beta: number },
  successes: unknown,
  failures: unknown,
  contextLabel: string,
): { readonly successes: number; readonly failures: number } {
  if (
    !isNonNegativeSafeInteger(successes) ||
    !isNonNegativeSafeInteger(failures)
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} requires non-negative safe integer successes and failures`,
    );
  }
  const totalTrials = kahanNeumaierSum([successes, failures]);
  if (!Number.isSafeInteger(totalTrials) || totalTrials < 1) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} requires safe integer total trials (successes + failures) >= 1, received ${totalTrials}`,
    );
  }
  const alphaPost = kahanNeumaierSum([prior.alpha, successes]);
  const betaPost = kahanNeumaierSum([prior.beta, failures]);
  if (
    !Number.isFinite(alphaPost) ||
    alphaPost > MAX_CERTIFIED_SHAPE_PARAMETER ||
    !Number.isFinite(betaPost) ||
    betaPost > MAX_CERTIFIED_SHAPE_PARAMETER
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} posterior Beta parameters (alphaPost=${alphaPost}, betaPost=${betaPost}) exceed certified numerical domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}]`,
    );
  }
  return { successes, failures };
}

function validateWeightedKishPayload(
  params: {
    readonly weightedSuccessMass: unknown;
    readonly weightedFailureMass: unknown;
    readonly sumSquaredWeights: unknown;
    readonly observationCount: unknown;
    readonly prior: unknown;
  },
  contextLabel: string,
): {
  readonly weightedSuccessMass: number;
  readonly weightedFailureMass: number;
  readonly sumSquaredWeights: number;
  readonly observationCount: number;
  readonly prior: { readonly alpha: number; readonly beta: number };
  readonly totalW: number;
  readonly nEff: number;
} {
  const {
    weightedSuccessMass,
    weightedFailureMass,
    sumSquaredWeights,
    observationCount,
    prior,
  } = params;
  if (
    typeof weightedSuccessMass !== 'number' ||
    !Number.isFinite(weightedSuccessMass) ||
    weightedSuccessMass < 0 ||
    typeof weightedFailureMass !== 'number' ||
    !Number.isFinite(weightedFailureMass) ||
    weightedFailureMass < 0 ||
    !isPositiveFiniteNumber(sumSquaredWeights) ||
    !isNonNegativeSafeInteger(observationCount) ||
    observationCount < 1
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} requires finite non-negative weighted masses, positive finite sumSquaredWeights, and safe integer observationCount >= 1`,
    );
  }
  const validatedPrior = validateBetaPrior(prior, contextLabel);

  const totalW = kahanNeumaierSum([weightedSuccessMass, weightedFailureMass]);
  if (!Number.isFinite(totalW) || totalW <= 0) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} requires total weighted mass (weightedSuccessMass + weightedFailureMass) to be finite and strictly positive, received ${totalW}`,
    );
  }
  const totalW2 = totalW * totalW;
  if (!Number.isFinite(totalW2) || totalW2 <= 0) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} squared total weighted mass overflows finite IEEE-754 binary64 arithmetic`,
    );
  }
  const nEff = totalW2 / sumSquaredWeights;
  if (!Number.isFinite(nEff) || nEff <= 0) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} Kish effective sample size must be finite and positive, received ${nEff}`,
    );
  }
  const kishTol = 64 * Number.EPSILON * Math.max(1, observationCount);
  if (nEff < 1 - kishTol || nEff > observationCount + kishTol) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} violates Kish Cauchy-Schwarz bounds (1 <= n_eff <= N=${observationCount}): computed n_eff=${nEff}`,
    );
  }
  if (
    observationCount === 1 &&
    weightedSuccessMass > 0 &&
    weightedFailureMass > 0
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} cannot have both weightedSuccessMass > 0 and weightedFailureMass > 0 when observationCount === 1`,
    );
  }

  const boundedNEff = Math.min(observationCount, Math.max(1, nEff));
  const effSuccesses = boundedNEff * (weightedSuccessMass / totalW);
  const effFailures = boundedNEff * (weightedFailureMass / totalW);
  const alphaPost = kahanNeumaierSum([validatedPrior.alpha, effSuccesses]);
  const betaPost = kahanNeumaierSum([validatedPrior.beta, effFailures]);
  if (
    !Number.isFinite(alphaPost) ||
    alphaPost > MAX_CERTIFIED_SHAPE_PARAMETER ||
    !Number.isFinite(betaPost) ||
    betaPost > MAX_CERTIFIED_SHAPE_PARAMETER
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} effective posterior Beta parameters (alphaPost=${alphaPost}, betaPost=${betaPost}) exceed certified domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}]`,
    );
  }

  return {
    weightedSuccessMass,
    weightedFailureMass,
    sumSquaredWeights,
    observationCount,
    prior: validatedPrior,
    totalW,
    nEff: boundedNEff,
  };
}

function validateGammaPrior(
  prior: unknown,
  contextLabel: string,
): { readonly shape: number; readonly rate: number } {
  if (!isPlainObject(prior)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior must be a non-null plain object { shape, rate }`,
    );
  }
  if ('scale' in prior && prior.scale !== undefined) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior must use shape-rate parameterization and forbid 'scale'`,
    );
  }
  if (
    prior.parameterization !== undefined &&
    prior.parameterization !== 'shape-rate'
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior.parameterization must be 'shape-rate', received '${String(prior.parameterization)}'`,
    );
  }
  const shape = validateCertifiedShapeNumber(
    prior.shape,
    `${contextLabel}.prior.shape`,
  );
  if (!isPositiveFiniteNumber(prior.rate)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior.rate must be a positive finite number, received ${String(prior.rate)}`,
    );
  }
  return Object.freeze({ shape, rate: prior.rate });
}

function validatePoissonExposuresUnitsAndPosterior(
  params: {
    readonly eventCount: unknown;
    readonly exposureDuration: unknown;
    readonly exposureUnit: unknown;
    readonly forecastExposureDuration: unknown;
    readonly forecastExposureUnit: unknown;
    readonly prior: unknown;
  },
  contextLabel: string,
): {
  readonly eventCount: number;
  readonly exposureDuration: number;
  readonly exposureUnit: string;
  readonly forecastExposureDuration: number;
  readonly forecastExposureUnit: string;
  readonly prior: { readonly shape: number; readonly rate: number };
} {
  const {
    eventCount,
    exposureDuration,
    exposureUnit,
    forecastExposureDuration,
    forecastExposureUnit,
    prior,
  } = params;
  if (!isNonNegativeSafeInteger(eventCount)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.eventCount must be a non-negative safe integer, received ${String(eventCount)}`,
    );
  }
  if (!isPositiveFiniteNumber(exposureDuration)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.exposureDuration must be a positive finite number, received ${String(exposureDuration)}`,
    );
  }
  if (!isPositiveFiniteNumber(forecastExposureDuration)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.forecastExposureDuration must be a positive finite number, received ${String(forecastExposureDuration)}`,
    );
  }
  const histUnit = validateStrictTrimmedUnit(
    exposureUnit,
    `${contextLabel}.exposureUnit`,
  );
  const foreUnit =
    forecastExposureUnit !== undefined
      ? validateStrictTrimmedUnit(
          forecastExposureUnit,
          `${contextLabel}.forecastExposureUnit`,
        )
      : histUnit;
  if (foreUnit !== histUnit) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} has incompatible Poisson exposure units: observed '${histUnit}' vs forecast '${foreUnit}'`,
    );
  }

  const validatedPrior = validateGammaPrior(prior, contextLabel);
  const shapePost = kahanNeumaierSum([validatedPrior.shape, eventCount]);
  if (
    !Number.isFinite(shapePost) ||
    shapePost > MAX_CERTIFIED_SHAPE_PARAMETER
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} posterior Gamma shape (${shapePost}) exceeds certified domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}]`,
    );
  }
  const ratePost = kahanNeumaierSum([validatedPrior.rate, exposureDuration]);
  if (!Number.isFinite(ratePost) || ratePost <= 0) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} posterior Gamma rate (${ratePost}) must be finite and positive`,
    );
  }
  const predictiveOddsRatio = forecastExposureDuration / ratePost;
  if (!Number.isFinite(predictiveOddsRatio) || predictiveOddsRatio <= 0) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} predictive exposure-to-rate ratio (${predictiveOddsRatio}) overflows or underflows IEEE-754 arithmetic`,
    );
  }

  return {
    eventCount,
    exposureDuration,
    exposureUnit: histUnit,
    forecastExposureDuration,
    forecastExposureUnit: foreUnit,
    prior: validatedPrior,
  };
}

function validateDirichletPrior(
  prior: unknown,
  outcomeCount: number,
  contextLabel: string,
): { readonly alpha: readonly number[] } {
  if (!isPlainObject(prior) || !Array.isArray(prior.alpha)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior.alpha must be an array of length ${outcomeCount}`,
    );
  }
  if (prior.alpha.length !== outcomeCount) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.prior.alpha length (${prior.alpha.length}) must match outcomeSpace cardinality (${outcomeCount})`,
    );
  }
  const alpha: number[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    alpha.push(
      validateCertifiedShapeNumber(
        prior.alpha[k],
        `${contextLabel}.prior.alpha[${k}]`,
      ),
    );
  }
  return Object.freeze({ alpha: Object.freeze(alpha) });
}

function validateMultinomialDimensionCountsAndPosterior(
  counts: unknown,
  prior: unknown,
  outcomeSpace: OutcomeSpaceDescriptor,
  contextLabel: string,
): {
  readonly counts: readonly number[];
  readonly prior: { readonly alpha: readonly number[] };
  readonly totalCount: number;
} {
  const outcomeCount = outcomeSpace.outcomeLabels.length;
  if (outcomeSpace.kind === 'first-passage-before-horizon') {
    throw new ForecastPipelineRequestError(
      `${contextLabel} multinomial model is incompatible with outcomeSpace.kind 'first-passage-before-horizon'`,
    );
  }
  if (
    outcomeCount < 2 ||
    outcomeCount > MAX_CERTIFIED_OUTCOME_CARDINALITY
  ) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} outcome cardinality (${outcomeCount}) must lie in [2, ${MAX_CERTIFIED_OUTCOME_CARDINALITY}]`,
    );
  }
  if (!Array.isArray(counts) || counts.length !== outcomeCount) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.counts must be an array of length ${outcomeCount}`,
    );
  }
  const validatedCounts: number[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    if (!isNonNegativeSafeInteger(counts[k])) {
      throw new ForecastPipelineRequestError(
        `${contextLabel}.counts[${k}] must be a non-negative safe integer, received ${String(counts[k])}`,
      );
    }
    validatedCounts.push(counts[k] as number);
  }
  const totalCount = kahanNeumaierSum(validatedCounts);
  if (!Number.isSafeInteger(totalCount) || totalCount < 1) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} total multinomial count must be a safe integer >= 1, received ${totalCount}`,
    );
  }

  const validatedPrior = validateDirichletPrior(
    prior,
    outcomeCount,
    contextLabel,
  );
  const posteriorAlphas: number[] = [];
  for (let k = 0; k < outcomeCount; k++) {
    const postK = kahanNeumaierSum([
      validatedPrior.alpha[k]!,
      validatedCounts[k]!,
    ]);
    if (!Number.isFinite(postK) || postK > MAX_CERTIFIED_SHAPE_PARAMETER) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} posterior Dirichlet alpha[${k}] (${postK}) exceeds certified domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}]`,
      );
    }
    posteriorAlphas.push(postK);
  }
  for (let k = 0; k < outcomeCount; k++) {
    const complementSum = kahanNeumaierSum(
      posteriorAlphas.filter((_, idx) => idx !== k),
    );
    if (
      !Number.isFinite(complementSum) ||
      complementSum < MIN_CERTIFIED_SHAPE_PARAMETER ||
      complementSum > MAX_CERTIFIED_SHAPE_PARAMETER
    ) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} Dirichlet marginal complement shape sum for outcome ${k} (${complementSum}) exceeds certified domain [${MIN_CERTIFIED_SHAPE_PARAMETER}, ${MAX_CERTIFIED_SHAPE_PARAMETER}]`,
      );
    }
  }

  return {
    counts: Object.freeze(validatedCounts),
    prior: validatedPrior,
    totalCount,
  };
}

function validateContinuousTrajectoryInputs(
  params: {
    readonly observationCount: unknown;
    readonly estimatedDrift: unknown;
    readonly estimatedScaleOrVolatility: unknown;
    readonly degreesOfFreedom: unknown;
    readonly initialStateLevel: unknown;
  },
  outcomeSpace: OutcomeSpaceDescriptor,
  targetMethodId: UnimplementedScientificMethodId | null,
  contextLabel: string,
): {
  readonly observationCount: number;
  readonly estimatedDrift: number;
  readonly estimatedScaleOrVolatility: number;
  readonly degreesOfFreedom?: number;
  readonly initialStateLevel?: number;
} {
  const {
    observationCount,
    estimatedDrift,
    estimatedScaleOrVolatility,
    degreesOfFreedom,
    initialStateLevel,
  } = params;

  if (!isNonNegativeSafeInteger(observationCount) || observationCount < 1) {
    throw new ForecastPipelineRequestError(
      `${contextLabel} requires positive safe integer trajectory observation count >= 1, received ${String(observationCount)}`,
    );
  }
  if (typeof estimatedDrift !== 'number' || !Number.isFinite(estimatedDrift)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.estimatedDrift must be a finite number, received ${String(estimatedDrift)}`,
    );
  }
  if (!isPositiveFiniteNumber(estimatedScaleOrVolatility)) {
    throw new ForecastPipelineRequestError(
      `${contextLabel}.estimatedScaleOrVolatility must be strictly positive and finite, received ${String(estimatedScaleOrVolatility)}`,
    );
  }

  let validDf: number | undefined;
  if (degreesOfFreedom !== undefined) {
    if (
      typeof degreesOfFreedom !== 'number' ||
      !Number.isFinite(degreesOfFreedom) ||
      degreesOfFreedom < MIN_DEGREES_OF_FREEDOM ||
      degreesOfFreedom > MAX_DEGREES_OF_FREEDOM
    ) {
      throw new ForecastPipelineRequestError(
        `${contextLabel}.degreesOfFreedom must be a finite number in [${MIN_DEGREES_OF_FREEDOM}, ${MAX_DEGREES_OF_FREEDOM}], received ${String(degreesOfFreedom)}`,
      );
    }
    validDf = degreesOfFreedom;
  }

  let validInitialState: number | undefined;
  if (initialStateLevel !== undefined) {
    if (
      typeof initialStateLevel !== 'number' ||
      !Number.isFinite(initialStateLevel)
    ) {
      throw new ForecastPipelineRequestError(
        `${contextLabel}.initialStateLevel must be a finite number, received ${String(initialStateLevel)}`,
      );
    }
    if (
      outcomeSpace.barrierLevel !== undefined &&
      outcomeSpace.barrierDirection !== undefined
    ) {
      const barrier = outcomeSpace.barrierLevel;
      const dir = outcomeSpace.barrierDirection;
      const alreadyCrossed =
        (dir === 'up-and-in' && initialStateLevel >= barrier) ||
        (dir === 'down-and-in' && initialStateLevel <= barrier);
      if (alreadyCrossed) {
        throw new ForecastPipelineRequestError(
          `${contextLabel}.initialStateLevel (${initialStateLevel}) is already at or beyond '${dir}' absorbing barrier (${barrier})`,
        );
      }
    }
    validInitialState = initialStateLevel;
  }

  if (targetMethodId === 'student-t-terminal-diffusion') {
    if (validDf === undefined) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} targeting 'student-t-terminal-diffusion' requires degreesOfFreedom in [${MIN_DEGREES_OF_FREEDOM}, ${MAX_DEGREES_OF_FREEDOM}]`,
      );
    }
    if (
      outcomeSpace.kind !== 'discretized-continuous-partition' ||
      !Array.isArray(outcomeSpace.partitionThresholds) ||
      outcomeSpace.partitionThresholds.length === 0
    ) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} targeting 'student-t-terminal-diffusion' requires outcomeSpace.kind === 'discretized-continuous-partition' with valid partitionThresholds`,
      );
    }
  }

  if (targetMethodId === 'first-passage-barrier-diffusion') {
    if (
      outcomeSpace.kind !== 'first-passage-before-horizon' ||
      outcomeSpace.barrierLevel === undefined ||
      outcomeSpace.barrierDirection === undefined
    ) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} targeting 'first-passage-barrier-diffusion' requires outcomeSpace.kind === 'first-passage-before-horizon' with barrierLevel and barrierDirection`,
      );
    }
    if (validInitialState === undefined) {
      throw new ForecastPipelineRequestError(
        `${contextLabel} targeting 'first-passage-barrier-diffusion' requires finite initialStateLevel strictly outside the absorbing barrier`,
      );
    }
  }

  return {
    observationCount,
    estimatedDrift,
    estimatedScaleOrVolatility,
    ...(validDf !== undefined ? { degreesOfFreedom: validDf } : {}),
    ...(validInitialState !== undefined
      ? { initialStateLevel: validInitialState }
      : {}),
  };
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
  readonly hasExplicitWindowId: boolean;
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

interface BetaMethodContribution {
  readonly sourceKind:
    | 'historical-observations-pool'
    | 'structured-numerical-dataset'
    | 'statistical-sufficient-statistics';
  readonly evidenceIds: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly successOutcomeIndex: 0 | 1;
  readonly successes: number;
  readonly failures: number;
  readonly prior: { readonly alpha: number; readonly beta: number };
  readonly credibleIntervalLevel?: number;
}

interface WeightedKishMethodContribution {
  readonly sourceKind:
    | 'historical-observations-pool'
    | 'structured-numerical-dataset'
    | 'statistical-sufficient-statistics';
  readonly evidenceIds: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly successOutcomeIndex: 0 | 1;
  readonly weightedSuccessMass: number;
  readonly weightedFailureMass: number;
  readonly sumSquaredWeights: number;
  readonly observationCount: number;
  readonly prior: { readonly alpha: number; readonly beta: number };
  readonly credibleIntervalLevel?: number;
}

interface PoissonMethodContribution {
  readonly sourceKind:
    | 'historical-observations-pool'
    | 'structured-numerical-dataset'
    | 'statistical-sufficient-statistics';
  readonly evidenceIds: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly eventOutcomeIndex: 0 | 1;
  readonly eventCount: number;
  readonly exposureDuration: number;
  readonly exposureUnit: string;
  readonly forecastExposureDuration: number;
  readonly forecastExposureUnit: string;
  readonly prior: { readonly shape: number; readonly rate: number };
  readonly credibleIntervalLevel?: number;
  readonly preVerifiedCombination?: {
    readonly justification: MultiSourceCombinationJustification;
    readonly verifiedByVerifierId: string;
    readonly verificationArtifactRef: string | null;
    readonly verifierRationale: string;
  };
}

interface DirichletMethodContribution {
  readonly sourceKind:
    | 'historical-observations-pool'
    | 'structured-numerical-dataset'
    | 'statistical-sufficient-statistics';
  readonly evidenceIds: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly counts: readonly number[];
  readonly priorAlpha: readonly number[];
  readonly credibleIntervalLevel?: number;
}

interface ContinuousTrajectoryContribution {
  readonly evidenceId: string;
  readonly observationCount: number;
  readonly estimatedDrift: number;
  readonly estimatedScaleOrVolatility: number;
  readonly degreesOfFreedom?: number;
  readonly initialStateLevel?: number;
  readonly targetMethodIds: readonly UnimplementedScientificMethodId[];
}

type MultiSourceCombinationGateResult =
  | {
      readonly approved: true;
      readonly justification: MultiSourceCombinationJustification;
      readonly verifiedByVerifierId: string;
      readonly verificationArtifactRef: string | null;
      readonly verifierRationale: string;
    }
  | {
      readonly approved: false;
      readonly rejection: RejectedMultiSourceCombinationDiagnostic;
    };

function evaluateMultiSourceCombinationGate(params: {
  readonly methodId: ExecutableScientificMethodId;
  readonly expectedBasis: MultiSourceCombinationBasis;
  readonly allContributingIds: readonly string[];
  readonly allContributingUrls: readonly string[];
  readonly contributingSubmissions: readonly PipelineEvidenceSubmission[];
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
  readonly justifications?: Readonly<
    Record<string, MultiSourceCombinationJustification>
  >;
  readonly combinationVerifier?: MultiSourceCombinationVerifier;
}): MultiSourceCombinationGateResult {
  const {
    methodId,
    expectedBasis,
    allContributingIds,
    allContributingUrls,
    contributingSubmissions,
    outcomeSpace,
    referenceTime,
    justifications,
    combinationVerifier,
  } = params;

  const frozenIds = Object.freeze([...allContributingIds]);
  const frozenUrls = Object.freeze([...allContributingUrls]);

  const makeRejection = (
    rejectionCode: RejectedMultiSourceCombinationDiagnostic['rejectionCode'],
    explanation: string,
    verifiedByVerifierId: string | null = null,
    verificationArtifactRef: string | null = null,
  ): MultiSourceCombinationGateResult => ({
    approved: false,
    rejection: Object.freeze({
      methodId,
      expectedBasis,
      contributingEvidenceIds: frozenIds,
      contributingSourceUrls: frozenUrls,
      rejectionCode,
      verifiedByVerifierId,
      verificationArtifactRef,
      preservedIndividualSources: true,
      explanation,
    }),
  });

  const j = justifications?.[methodId];
  if (!isPlainObject(j)) {
    return makeRejection(
      'missing-combination-justification',
      `Rejected multi-source combination for '${methodId}' over [${allContributingIds.join(', ')}]: silent overwriting is prohibited, and combining separate sources requires a server-verified MultiSourceCombinationJustification with basis='${expectedBasis}'. All individual sources and provenance records were preserved.`,
    );
  }

  const invalidReasons: string[] = [];
  if (j.basis !== expectedBasis) {
    invalidReasons.push(
      `basis must be '${expectedBasis}', received '${String(j.basis)}'`,
    );
  }
  if (j.disjointPopulationsOrWindowsVerified !== true) {
    invalidReasons.push('disjointPopulationsOrWindowsVerified must be true');
  }
  if (j.homogeneousParameterSpaceVerified !== true) {
    invalidReasons.push('homogeneousParameterSpaceVerified must be true');
  }
  if (
    methodId === 'weighted-kish-effective-binomial' &&
    j.commonExogenousWeightScaleVerified !== true
  ) {
    invalidReasons.push('commonExogenousWeightScaleVerified must be true');
  }
  if (
    typeof j.mathematicalRationale !== 'string' ||
    j.mathematicalRationale.trim().length < 10
  ) {
    invalidReasons.push(
      'mathematicalRationale must be a substantive explanation (at least 10 characters)',
    );
  }

  let declaredIds: string[] = [];
  if (!Array.isArray(j.contributingEvidenceIds)) {
    invalidReasons.push(
      `contributingEvidenceIds must be an array matching [${allContributingIds.join(', ')}]`,
    );
  } else {
    declaredIds = j.contributingEvidenceIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (
      declaredIds.length !== j.contributingEvidenceIds.length ||
      new Set(declaredIds).size !== declaredIds.length ||
      declaredIds.length < 2
    ) {
      invalidReasons.push(
        'contributingEvidenceIds must contain at least 2 unique non-empty evidenceIds',
      );
    } else {
      const declaredSet = new Set(declaredIds);
      const expectedSet = new Set(allContributingIds);
      const missing = allContributingIds.filter((id) => !declaredSet.has(id));
      const extra = declaredIds.filter((id) => !expectedSet.has(id));
      if (missing.length > 0 || extra.length > 0) {
        invalidReasons.push(
          `contributingEvidenceIds does not match active contributing evidenceIds [${allContributingIds.join(', ')}] (missing=[${missing.join(', ')}], unexpected=[${extra.join(', ')}])`,
        );
      }
    }
  }

  if (invalidReasons.length > 0) {
    return makeRejection(
      'invalid-combination-justification',
      `Rejected invalid multi-source combination justification for '${methodId}' over [${allContributingIds.join(', ')}]: ${invalidReasons.join('; ')}. All individual sources and provenance records were preserved.`,
    );
  }

  const normalizedJustification: MultiSourceCombinationJustification =
    Object.freeze({
      basis: j.basis as MultiSourceCombinationBasis,
      contributingEvidenceIds: Object.freeze(declaredIds),
      disjointPopulationsOrWindowsVerified: true,
      homogeneousParameterSpaceVerified: true,
      ...(j.commonExogenousWeightScaleVerified !== undefined
        ? {
            commonExogenousWeightScaleVerified:
              j.commonExogenousWeightScaleVerified,
          }
        : {}),
      mathematicalRationale: (j.mathematicalRationale as string).trim(),
    });

  // Fail-closed server-side verification gate: caller-declared booleans and
  // rationale prose are NEVER trusted without an independent combinationVerifier.
  if (combinationVerifier === undefined) {
    return makeRejection(
      'missing-trusted-combination-verifier',
      `Rejected multi-source combination for '${methodId}' over [${allContributingIds.join(', ')}] (fail-closed): no trusted server-side combinationVerifier was supplied. Caller-declared disjointPopulationsOrWindowsVerified/homogeneousParameterSpaceVerified booleans and rationale text do not establish independence or shared parameters by themselves. All individual sources and provenance records were preserved.`,
    );
  }

  const decision = combinationVerifier({
    methodId,
    expectedBasis,
    justification: normalizedJustification,
    contributingSubmissions: Object.freeze([...contributingSubmissions]),
    contributingEvidenceIds: frozenIds,
    contributingSourceUrls: frozenUrls,
    outcomeSpace,
    referenceTime,
  });

  const vId =
    isPlainObject(decision) && typeof decision.verifierId === 'string'
      ? decision.verifierId.trim()
      : '';
  const vRat =
    isPlainObject(decision) && typeof decision.rationale === 'string'
      ? decision.rationale.trim()
      : '';
  const artifactRef =
    isPlainObject(decision) &&
    typeof decision.verificationArtifactRef === 'string' &&
    decision.verificationArtifactRef.trim().length > 0
      ? decision.verificationArtifactRef.trim()
      : null;

  if (vId.length === 0 || vRat.length === 0 || decision.verified !== true) {
    return makeRejection(
      'rejected-by-trusted-combination-verifier',
      `Rejected multi-source combination for '${methodId}' over [${allContributingIds.join(', ')}] at trusted combinationVerifier ('${vId || 'invalid'}'): ${vRat || 'did not return verified=true with non-empty verifierId and rationale'}. All individual sources and provenance records were preserved.`,
      vId || null,
      artifactRef,
    );
  }

  if (decision.verifiedEvidenceIds !== undefined) {
    if (!Array.isArray(decision.verifiedEvidenceIds)) {
      return makeRejection(
        'rejected-by-trusted-combination-verifier',
        `Rejected multi-source combination for '${methodId}' at trusted combinationVerifier ('${vId}'): verifiedEvidenceIds must be an array when supplied. All individual sources and provenance records were preserved.`,
        vId,
        artifactRef,
      );
    }
    const verifiedSet = new Set(
      decision.verifiedEvidenceIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim()),
    );
    const unverified = allContributingIds.filter((id) => !verifiedSet.has(id));
    if (unverified.length > 0) {
      return makeRejection(
        'rejected-by-trusted-combination-verifier',
        `Rejected multi-source combination for '${methodId}' at trusted combinationVerifier ('${vId}'): contributor(s) [${unverified.join(', ')}] were not covered in verifiedEvidenceIds. All individual sources and provenance records were preserved.`,
        vId,
        artifactRef,
      );
    }
  }

  return {
    approved: true,
    justification: normalizedJustification,
    verifiedByVerifierId: vId,
    verificationArtifactRef: artifactRef,
    verifierRationale: vRat,
  };
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
 *   4. Fail-closed server-side verification for both `StructuralSymmetryContract`
 *      (`symmetryVerifier`) and `MultiSourceCombinationJustification`
 *      (`combinationVerifier`).
 */
export function assessCollectedEvidence(params: {
  readonly harvestResult: EvidenceHarvestResult;
  readonly submittedEvidence: readonly PipelineEvidenceSubmission[];
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
  readonly executedAt?: IsoDateTime;
  readonly question?: string;
  readonly structuralSymmetryContract?: StructuralSymmetryContract;
  readonly structuralSymmetryPremise?: StructuralUniformExecutionInput['symmetryPremise'];
  readonly allowStructuralBaseline: boolean;
  readonly multiSourceCombinationJustifications?: Readonly<
    Record<string, MultiSourceCombinationJustification>
  >;
  readonly registry: ScientificMethodRegistry;
  readonly evidenceVerifier?: EvidenceVerifier;
  readonly symmetryVerifier?: StructuralSymmetryVerifier;
  readonly combinationVerifier?: MultiSourceCombinationVerifier;
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
    executedAt,
    question,
    structuralSymmetryContract,
    structuralSymmetryPremise,
    allowStructuralBaseline,
    multiSourceCombinationJustifications,
    registry,
    evidenceVerifier,
    symmetryVerifier,
    combinationVerifier,
  } = params;

  const effectiveExecutedAt: IsoDateTime =
    executedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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
  const multiSourceCombinations: MultiSourceCombinationDiagnostic[] = [];
  const rejectedMultiSourceCombinations: RejectedMultiSourceCombinationDiagnostic[] =
    [];
  const rejectedCombinationMessageByMethod = new Map<
    ScientificMethodId,
    string
  >();
  let structuralSymmetryVerification: StructuralSymmetryVerificationDiagnostic | null =
    null;
  const allProvenanceRecords: PipelineEvidenceProvenanceRecord[] = [];
  const assessmentNotes: string[] = [];
  const verifiedSubmissionById = new Map<string, PipelineEvidenceSubmission>();

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

  // Non-overwriting per-method contribution accumulators:
  const betaContributions: BetaMethodContribution[] = [];
  const kishContributions: WeightedKishMethodContribution[] = [];
  const poissonContributions: PoissonMethodContribution[] = [];
  const dirichletContributions: DirichletMethodContribution[] = [];
  const continuousContributions: ContinuousTrajectoryContribution[] = [];

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

  // Deduplicate identical caller-submitted evidence by evidenceId; fail closed on conflicting payloads:
  const seenSubmissionPayloads = new Map<string, string>();

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

    const payloadSignature = canonicalJsonKey(rawSub);
    const priorPayloadSignature = seenSubmissionPayloads.get(evidenceId);
    if (priorPayloadSignature !== undefined) {
      if (priorPayloadSignature !== payloadSignature) {
        throw new ForecastPipelineRequestError(
          `Conflicting duplicate submittedEvidence entries share evidenceId '${evidenceId}' with non-identical payloads`,
        );
      }
      assessmentNotes.push(
        `Skipped identical duplicate submittedEvidence entry with evidenceId '${evidenceId}' so duplicate submissions never double-count observations.`,
      );
      continue;
    }
    seenSubmissionPayloads.set(evidenceId, payloadSignature);

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
        retrievedAt: effectiveExecutedAt,
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
          retrievedAt: effectiveExecutedAt,
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
      let docRejectionNote: string | null = null;

      if (evidenceVerifier !== undefined) {
        const decision = evidenceVerifier({
          evidenceId,
          submission: sub,
          outcomeSpace,
          referenceTime,
          harvestedItems: harvestResult.items,
        });
        const verifierIdValid =
          isPlainObject(decision) &&
          typeof decision.verifierId === 'string' &&
          decision.verifierId.trim().length > 0;
        const rationaleValid =
          isPlainObject(decision) &&
          typeof decision.rationale === 'string' &&
          decision.rationale.trim().length > 0;
        docVerifierId = verifierIdValid ? decision.verifierId.trim() : null;
        docArtifactRef =
          isPlainObject(decision) &&
          typeof decision.verificationArtifactRef === 'string' &&
          decision.verificationArtifactRef.trim().length > 0
            ? decision.verificationArtifactRef.trim()
            : null;

        if (
          verifierIdValid &&
          rationaleValid &&
          decision.verifiedEmpirical === true
        ) {
          docVerifiedPrimary = decision.isPrimarySourceVerified === true;
          docOutcome = 'verified-by-trusted-verifier';
        } else {
          docVerifiedPrimary = false;
          docOutcome = 'rejected-by-trusted-verifier';
          const rejReason = rationaleValid
            ? decision.rationale.trim()
            : 'Trusted evidenceVerifier rejected documentary evidence verification.';
          docRejectionNote = `Documentary submission '${evidenceId}' was rejected by trusted verifier ('${docVerifierId ?? 'invalid'}'): ${rejReason}`;
          assessmentNotes.push(docRejectionNote);
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
        retrievedAt: effectiveExecutedAt,
        sourceProvider: 'caller:documentary',
        isPrimarySourceVerified: docVerifiedPrimary,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([
          Object.freeze({ evidenceId, publisher, url, publishedAt }),
        ]),
        assessmentNote:
          docRejectionNote ??
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
        retrievedAt: effectiveExecutedAt,
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
        retrievedAt: effectiveExecutedAt,
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
        retrievedAt: effectiveExecutedAt,
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

    // Fail closed if verifiedEventIds was supplied as an empty array on historical-observations:
    const rawVerifiedEventIds = verificationDecision.verifiedEventIds;
    if (rawVerifiedEventIds !== undefined && !Array.isArray(rawVerifiedEventIds)) {
      throw new ForecastPipelineRequestError(
        `EvidenceVerifier decision for '${evidenceId}' returned invalid non-array verifiedEventIds`,
      );
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
        Array.isArray(rawVerifiedEventIds)
          ? new Set(
              rawVerifiedEventIds
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
    verifiedSubmissionById.set(evidenceId, qSub);

    /* -------------------------------------------------------------------
       Category 2: Historical Observations (`historical-observations`)
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
          !Array.isArray(schema.observations)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') binary-trials schema requires successOutcomeIndex (0 | 1) and observations array`,
          );
        }
        const validatedPrior = validateBetaPrior(
          schema.prior,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          schema.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

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
            schema.enableWeightedKishChannel === true &&
            rawWeight === undefined
          ) {
            invalidFields.push('weight');
            reasons.push(
              'weight is required on every binary trial observation when enableWeightedKishChannel is true',
            );
          } else if (
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
            prior: validatedPrior,
            enableWeightedKishChannel: schema.enableWeightedKishChannel === true,
            ...(ciLevel !== undefined
              ? { credibleIntervalLevel: ciLevel }
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
          !isPlainObject(schema.historicalExposure) ||
          !isPlainObject(schema.forecastExposure) ||
          !Array.isArray(schema.events)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-arrivals schema is malformed`,
          );
        }

        const validatedPoisson = validatePoissonExposuresUnitsAndPosterior(
          {
            eventCount: 0,
            exposureDuration: schema.historicalExposure.exposureDuration,
            exposureUnit: schema.historicalExposure.exposureUnit,
            forecastExposureDuration: schema.forecastExposure.exposureDuration,
            forecastExposureUnit: schema.forecastExposure.exposureUnit,
            prior: schema.prior,
          },
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          schema.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        let hasExplicitWindowId = false;
        let exposureWindowId = '__implicit-default-poisson-window__';
        if (schema.historicalExposure.exposureWindowId !== undefined) {
          exposureWindowId = validateStrictTrimmedUnit(
            schema.historicalExposure.exposureWindowId,
            `submittedEvidence[${idx}] ('${evidenceId}').historicalExposure.exposureWindowId`,
          );
          hasExplicitWindowId = true;
        }

        const schemaEventFamily =
          typeof schema.eventFamily === 'string' &&
          schema.eventFamily.trim().length > 0
            ? schema.eventFamily.trim()
            : 'poisson-arrivals';
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
            prior: validatedPoisson.prior,
            historicalExposureDuration: validatedPoisson.exposureDuration,
            historicalExposureUnit: validatedPoisson.exposureUnit,
            exposureWindowId,
            hasExplicitWindowId,
            forecastExposureDuration:
              validatedPoisson.forecastExposureDuration,
            forecastExposureUnit: validatedPoisson.forecastExposureUnit,
            ...(ciLevel !== undefined
              ? { credibleIntervalLevel: ciLevel }
              : {}),
            rawEventCount: schema.events.length,
            canonicalEventKeys: Object.freeze(submissionCanonicalKeys),
          }),
        );
        continue;
      }

      if (schema.kind === 'multinomial-trials') {
        if (outcomeSpace.kind === 'first-passage-before-horizon') {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') multinomial-trials is incompatible with outcomeSpace.kind 'first-passage-before-horizon'`,
          );
        }
        if (
          outcomeCount < 2 ||
          outcomeCount > MAX_CERTIFIED_OUTCOME_CARDINALITY
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') outcome cardinality (${outcomeCount}) must lie in [2, ${MAX_CERTIFIED_OUTCOME_CARDINALITY}]`,
          );
        }
        if (!Array.isArray(schema.observations)) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') multinomial-trials schema requires an observations array`,
          );
        }
        const validatedPrior = validateDirichletPrior(
          schema.prior,
          outcomeCount,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          schema.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

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
            priorAlpha: validatedPrior.alpha,
            ...(ciLevel !== undefined
              ? { credibleIntervalLevel: ciLevel }
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
        if (ds.successOutcomeIndex !== 0 && ds.successOutcomeIndex !== 1) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') binary-cohort-table requires successOutcomeIndex (0 | 1)`,
          );
        }
        const validatedPrior = validateBetaPrior(
          ds.prior,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const validatedCounts = validateBetaCountsAndPosterior(
          validatedPrior,
          ds.successes,
          ds.failures,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          ds.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        betaContributions.push({
          sourceKind: 'structured-numerical-dataset',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          successOutcomeIndex: ds.successOutcomeIndex,
          successes: validatedCounts.successes,
          failures: validatedCounts.failures,
          prior: validatedPrior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured binary cohort dataset (successes=${validatedCounts.successes}, failures=${validatedCounts.failures}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'weighted-binary-cohort-table') {
        if (ds.successOutcomeIndex !== 0 && ds.successOutcomeIndex !== 1) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') weighted-binary-cohort-table requires successOutcomeIndex (0 | 1)`,
          );
        }
        const validatedKish = validateWeightedKishPayload(
          {
            weightedSuccessMass: ds.weightedSuccessMass,
            weightedFailureMass: ds.weightedFailureMass,
            sumSquaredWeights: ds.sumSquaredWeights,
            observationCount: ds.observationCount,
            prior: ds.prior,
          },
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          ds.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        kishContributions.push({
          sourceKind: 'structured-numerical-dataset',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          successOutcomeIndex: ds.successOutcomeIndex,
          weightedSuccessMass: validatedKish.weightedSuccessMass,
          weightedFailureMass: validatedKish.weightedFailureMass,
          sumSquaredWeights: validatedKish.sumSquaredWeights,
          observationCount: validatedKish.observationCount,
          prior: validatedKish.prior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated structured weighted binary cohort dataset (n=${validatedKish.observationCount}, n_eff=${validatedKish.nEff.toFixed(4)}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'poisson-exposure-table') {
        if (ds.eventOutcomeIndex !== 0 && ds.eventOutcomeIndex !== 1) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-exposure-table requires eventOutcomeIndex (0 | 1)`,
          );
        }
        const validatedPoisson = validatePoissonExposuresUnitsAndPosterior(
          {
            eventCount: ds.eventCount,
            exposureDuration: ds.exposureDuration,
            exposureUnit: ds.exposureUnit,
            forecastExposureDuration: ds.forecastExposureDuration,
            forecastExposureUnit: ds.forecastExposureUnit,
            prior: ds.prior,
          },
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          ds.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        poissonContributions.push({
          sourceKind: 'structured-numerical-dataset',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          eventOutcomeIndex: ds.eventOutcomeIndex,
          eventCount: validatedPoisson.eventCount,
          exposureDuration: validatedPoisson.exposureDuration,
          exposureUnit: validatedPoisson.exposureUnit,
          forecastExposureDuration: validatedPoisson.forecastExposureDuration,
          forecastExposureUnit: validatedPoisson.forecastExposureUnit,
          prior: validatedPoisson.prior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated structured Poisson exposure dataset (k=${validatedPoisson.eventCount}, T=${validatedPoisson.exposureDuration} ${validatedPoisson.exposureUnit}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'multinomial-contingency-table') {
        const validatedMultinomial =
          validateMultinomialDimensionCountsAndPosterior(
            ds.counts,
            ds.prior,
            outcomeSpace,
            `submittedEvidence[${idx}] ('${evidenceId}')`,
          );
        const ciLevel = validateCredibleIntervalLevel(
          ds.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        dirichletContributions.push({
          sourceKind: 'structured-numerical-dataset',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          counts: validatedMultinomial.counts,
          priorAlpha: validatedMultinomial.prior.alpha,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated structured multinomial contingency table ([${validatedMultinomial.counts.join(', ')}]; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'continuous-state-trajectory-table') {
        const validatedCont = validateContinuousTrajectoryInputs(
          {
            observationCount: ds.observationCount,
            estimatedDrift: ds.estimatedDrift,
            estimatedScaleOrVolatility: ds.estimatedScaleOrVolatility,
            degreesOfFreedom: ds.degreesOfFreedom,
            initialStateLevel: ds.initialStateLevel,
          },
          outcomeSpace,
          null,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        const channels: MethodDataChannelId[] = [
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
        ];
        const methods: UnimplementedScientificMethodId[] = [];

        if (validatedCont.degreesOfFreedom !== undefined) {
          channels.push('tail-degrees-of-freedom');
          methods.push('student-t-terminal-diffusion');
        }
        if (
          validatedCont.initialStateLevel !== undefined &&
          outcomeSpace.barrierLevel !== undefined &&
          outcomeSpace.barrierDirection !== undefined
        ) {
          channels.push('absorbing-barrier-specification');
          methods.push('first-passage-barrier-diffusion');
        }

        continuousContributions.push({
          evidenceId,
          observationCount: validatedCont.observationCount,
          estimatedDrift: validatedCont.estimatedDrift,
          estimatedScaleOrVolatility: validatedCont.estimatedScaleOrVolatility,
          ...(validatedCont.degreesOfFreedom !== undefined
            ? { degreesOfFreedom: validatedCont.degreesOfFreedom }
            : {}),
          ...(validatedCont.initialStateLevel !== undefined
            ? { initialStateLevel: validatedCont.initialStateLevel }
            : {}),
          targetMethodIds: Object.freeze(methods),
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
          retrievedAt: effectiveExecutedAt,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(methods),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous state trajectory dataset (n=${validatedCont.observationCount}, drift=${validatedCont.estimatedDrift}, scale=${validatedCont.estimatedScaleOrVolatility}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
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
          stats.successOutcomeIndex !== 0 &&
          stats.successOutcomeIndex !== 1
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') beta-binomial-conjugate statistics require successOutcomeIndex (0 | 1)`,
          );
        }
        const validatedPrior = validateBetaPrior(
          stats.prior,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const validatedCounts = validateBetaCountsAndPosterior(
          validatedPrior,
          stats.successes,
          stats.failures,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          stats.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        betaContributions.push({
          sourceKind: 'statistical-sufficient-statistics',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          successOutcomeIndex: stats.successOutcomeIndex,
          successes: validatedCounts.successes,
          failures: validatedCounts.failures,
          prior: validatedPrior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Beta-Binomial sufficient statistics (successes=${validatedCounts.successes}, failures=${validatedCounts.failures}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'weighted-kish-effective-binomial') {
        if (
          stats.successOutcomeIndex !== 0 &&
          stats.successOutcomeIndex !== 1
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') weighted-kish-effective-binomial statistics require successOutcomeIndex (0 | 1)`,
          );
        }
        const validatedKish = validateWeightedKishPayload(
          {
            weightedSuccessMass: stats.weightedSuccessMass,
            weightedFailureMass: stats.weightedFailureMass,
            sumSquaredWeights: stats.sumSquaredWeights,
            observationCount: stats.observationCount,
            prior: stats.prior,
          },
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          stats.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        kishContributions.push({
          sourceKind: 'statistical-sufficient-statistics',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          successOutcomeIndex: stats.successOutcomeIndex,
          weightedSuccessMass: validatedKish.weightedSuccessMass,
          weightedFailureMass: validatedKish.weightedFailureMass,
          sumSquaredWeights: validatedKish.sumSquaredWeights,
          observationCount: validatedKish.observationCount,
          prior: validatedKish.prior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated Kish weighted binomial sufficient statistics (n=${validatedKish.observationCount}, n_eff=${validatedKish.nEff.toFixed(4)}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'poisson-gamma-hazard') {
        if (stats.eventOutcomeIndex !== 0 && stats.eventOutcomeIndex !== 1) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-gamma-hazard statistics require eventOutcomeIndex (0 | 1)`,
          );
        }
        const validatedPoisson = validatePoissonExposuresUnitsAndPosterior(
          {
            eventCount: stats.eventCount,
            exposureDuration: stats.exposureDuration,
            exposureUnit: stats.exposureUnit,
            forecastExposureDuration: stats.forecastExposureDuration,
            forecastExposureUnit: stats.forecastExposureUnit,
            prior: stats.prior,
          },
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );
        const ciLevel = validateCredibleIntervalLevel(
          stats.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        poissonContributions.push({
          sourceKind: 'statistical-sufficient-statistics',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          eventOutcomeIndex: stats.eventOutcomeIndex,
          eventCount: validatedPoisson.eventCount,
          exposureDuration: validatedPoisson.exposureDuration,
          exposureUnit: validatedPoisson.exposureUnit,
          forecastExposureDuration: validatedPoisson.forecastExposureDuration,
          forecastExposureUnit: validatedPoisson.forecastExposureUnit,
          prior: validatedPoisson.prior,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated Poisson-Gamma sufficient statistics (k=${validatedPoisson.eventCount}, T=${validatedPoisson.exposureDuration} ${validatedPoisson.exposureUnit}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'dirichlet-multinomial-symmetry') {
        const validatedMultinomial =
          validateMultinomialDimensionCountsAndPosterior(
            stats.counts,
            stats.prior,
            outcomeSpace,
            `submittedEvidence[${idx}] ('${evidenceId}')`,
          );
        const ciLevel = validateCredibleIntervalLevel(
          stats.credibleIntervalLevel,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        dirichletContributions.push({
          sourceKind: 'statistical-sufficient-statistics',
          evidenceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze([url]),
          counts: validatedMultinomial.counts,
          priorAlpha: validatedMultinomial.prior.alpha,
          ...(ciLevel !== undefined ? { credibleIntervalLevel: ciLevel } : {}),
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
          retrievedAt: effectiveExecutedAt,
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
          assessmentNote: `Validated Dirichlet-Multinomial sufficient statistics ([${validatedMultinomial.counts.join(', ')}]; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (
        stats.targetMethodId === 'student-t-terminal-diffusion' ||
        stats.targetMethodId === 'first-passage-barrier-diffusion'
      ) {
        const validatedCont = validateContinuousTrajectoryInputs(
          {
            observationCount: stats.continuousTrajectoryObservations,
            estimatedDrift: stats.estimatedDrift,
            estimatedScaleOrVolatility: stats.estimatedScaleOrVolatility,
            degreesOfFreedom: stats.degreesOfFreedom,
            initialStateLevel: stats.initialStateLevel,
          },
          outcomeSpace,
          stats.targetMethodId,
          `submittedEvidence[${idx}] ('${evidenceId}')`,
        );

        const channels: MethodDataChannelId[] = [
          'continuous-state-trajectory',
          'drift-and-scale-estimates',
        ];

        if (validatedCont.degreesOfFreedom !== undefined) {
          channels.push('tail-degrees-of-freedom');
        }
        if (
          validatedCont.initialStateLevel !== undefined &&
          outcomeSpace.barrierLevel !== undefined &&
          outcomeSpace.barrierDirection !== undefined
        ) {
          channels.push('absorbing-barrier-specification');
        }

        continuousContributions.push({
          evidenceId,
          observationCount: validatedCont.observationCount,
          estimatedDrift: validatedCont.estimatedDrift,
          estimatedScaleOrVolatility: validatedCont.estimatedScaleOrVolatility,
          ...(validatedCont.degreesOfFreedom !== undefined
            ? { degreesOfFreedom: validatedCont.degreesOfFreedom }
            : {}),
          ...(validatedCont.initialStateLevel !== undefined
            ? { initialStateLevel: validatedCont.initialStateLevel }
            : {}),
          targetMethodIds: Object.freeze([stats.targetMethodId]),
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
          retrievedAt: effectiveExecutedAt,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: trustMetadata.isPrimarySourceVerified,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([stats.targetMethodId]),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous diffusion/barrier sufficient statistics for '${stats.targetMethodId}' (n=${validatedCont.observationCount}; verified by '${trustMetadata.verifiedByVerifierId}': ${trustMetadata.rationale}).`,
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
    const anyWeightedEnabledGlobal = pendingBinarySubmissions.some(
      (s) => s.enableWeightedKishChannel,
    );
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

      const reportWeights = entry.reports
        .map((r) => r.weight)
        .filter((w): w is number => w !== undefined);
      const hasConflictingWeights =
        reportWeights.length > 0 &&
        (reportWeights.some((w) => Math.abs(w - reportWeights[0]!) > 1e-12) ||
          reportWeights.length < entry.reports.length);

      if (outcomeIndices.size > 1 || hasConflictingWeights) {
        const conflictReason =
          outcomeIndices.size > 1
            ? `${entry.reports.length} conflicting outcome reports`
            : `conflicting observation weights [${reportWeights.join(', ')}]`;
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
          explanation: `Event '${entry.eventId}' (family '${entry.eventFamily}') had ${conflictReason} across submission(s) [${contributingIds.join(', ')}] and was quarantined globally.`,
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
      const consensusWeight = reportWeights[0];
      resolvedBinaryEvents.set(canonicalKey, {
        status: 'deduplicated-consistent',
        realizedOutcomeIndex,
        ...(consensusWeight !== undefined ? { weight: consensusWeight } : {}),
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
    const refCi =
      referenceSub.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;

    for (let i = 1; i < pendingBinarySubmissions.length; i++) {
      const other = pendingBinarySubmissions[i]!;
      const otherOutcome0Alpha =
        other.successOutcomeIndex === 0 ? other.prior.alpha : other.prior.beta;
      const otherOutcome1Beta =
        other.successOutcomeIndex === 0 ? other.prior.beta : other.prior.alpha;
      const otherCi =
        other.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
      if (
        Math.abs(otherOutcome0Alpha - refOutcome0Alpha) > 1e-12 ||
        Math.abs(otherOutcome1Beta - refOutcome1Beta) > 1e-12
      ) {
        throw new ForecastPipelineRequestError(
          `Conflicting binary-trials prior hyperparameters across submissions '${referenceSub.evidenceId}' and '${other.evidenceId}'`,
        );
      }
      if (Math.abs(otherCi - refCi) > 1e-12) {
        throw new ForecastPipelineRequestError(
          `Conflicting binary-trials credibleIntervalLevel across submissions '${referenceSub.evidenceId}' (${refCi}) and '${other.evidenceId}' (${otherCi})`,
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
      anyWeightedEnabledGlobal &&
      globalWeights.length === totalGlobalTrials &&
      totalGlobalTrials >= 2;

    for (const sub of pendingBinarySubmissions) {
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
          retrievedAt: effectiveExecutedAt,
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
        retrievedAt: effectiveExecutedAt,
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
      validateBetaCountsAndPosterior(
        referenceSub.prior,
        globalSuccesses,
        globalFailures,
        `global binary-trials pool [${activeBinarySubmissionIds.join(', ')}]`,
      );

      const poolUrls = Object.freeze(allBinaryCitations.map((c) => c.url));
      const poolIds = Object.freeze([...activeBinarySubmissionIds]);
      betaContributions.push({
        sourceKind: 'historical-observations-pool',
        evidenceIds: poolIds,
        sourceUrls: poolUrls,
        successOutcomeIndex: targetSuccessOutcomeIndex,
        successes: globalSuccesses,
        failures: globalFailures,
        prior: referenceSub.prior,
        ...(referenceSub.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
          : {}),
      });

      if (canRunGlobalKish) {
        const succWeights: number[] = [];
        const failWeights: number[] = [];
        const sqWeights: number[] = [];
        for (let i = 0; i < totalGlobalTrials; i++) {
          const wi = globalWeights[i]!;
          if (globalOutcomes01[i] === 1) {
            succWeights.push(wi);
          } else {
            failWeights.push(wi);
          }
          sqWeights.push(wi * wi);
        }
        const wSucc = kahanNeumaierSum(succWeights);
        const wFail = kahanNeumaierSum(failWeights);
        const sumSq = kahanNeumaierSum(sqWeights);
        const validatedKishPool = validateWeightedKishPayload(
          {
            weightedSuccessMass: wSucc,
            weightedFailureMass: wFail,
            sumSquaredWeights: sumSq,
            observationCount: totalGlobalTrials,
            prior: referenceSub.prior,
          },
          `global weighted binary-trials pool [${activeBinarySubmissionIds.join(', ')}]`,
        );

        kishContributions.push({
          sourceKind: 'historical-observations-pool',
          evidenceIds: poolIds,
          sourceUrls: poolUrls,
          successOutcomeIndex: targetSuccessOutcomeIndex,
          weightedSuccessMass: validatedKishPool.weightedSuccessMass,
          weightedFailureMass: validatedKishPool.weightedFailureMass,
          sumSquaredWeights: validatedKishPool.sumSquaredWeights,
          observationCount: validatedKishPool.observationCount,
          prior: validatedKishPool.prior,
          ...(referenceSub.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
            : {}),
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
    const refCi =
      referenceSub.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
    for (let i = 1; i < pendingPoissonSubmissions.length; i++) {
      const other = pendingPoissonSubmissions[i]!;
      const otherCi =
        other.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
      if (other.eventOutcomeIndex !== referenceSub.eventOutcomeIndex) {
        throw new ForecastPipelineRequestError(
          `Conflicting poisson-arrivals eventOutcomeIndex across submissions '${referenceSub.evidenceId}' (${referenceSub.eventOutcomeIndex}) and '${other.evidenceId}' (${other.eventOutcomeIndex})`,
        );
      }
      if (other.historicalExposureUnit !== referenceSub.historicalExposureUnit) {
        throw new ForecastPipelineRequestError(
          `Conflicting poisson-arrivals historicalExposure.exposureUnit across submissions '${referenceSub.evidenceId}' ('${referenceSub.historicalExposureUnit}') and '${other.evidenceId}' ('${other.historicalExposureUnit}')`,
        );
      }
      if (
        other.forecastExposureUnit !== referenceSub.forecastExposureUnit ||
        Math.abs(
          other.forecastExposureDuration -
            referenceSub.forecastExposureDuration,
        ) > 1e-12
      ) {
        throw new ForecastPipelineRequestError(
          `Conflicting poisson-arrivals forecastExposure across submissions '${referenceSub.evidenceId}' and '${other.evidenceId}'`,
        );
      }
      if (
        Math.abs(other.prior.shape - referenceSub.prior.shape) > 1e-12 ||
        Math.abs(other.prior.rate - referenceSub.prior.rate) > 1e-12
      ) {
        throw new ForecastPipelineRequestError(
          `Conflicting poisson-arrivals prior hyperparameters across submissions '${referenceSub.evidenceId}' and '${other.evidenceId}'`,
        );
      }
      if (Math.abs(otherCi - refCi) > 1e-12) {
        throw new ForecastPipelineRequestError(
          `Conflicting poisson-arrivals credibleIntervalLevel across submissions '${referenceSub.evidenceId}' (${refCi}) and '${other.evidenceId}' (${otherCi})`,
        );
      }
    }

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
          retrievedAt: effectiveExecutedAt,
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
      const existingWindowDuration = exposureDurationByWindowId.get(
        sub.exposureWindowId,
      );
      if (existingWindowDuration !== undefined) {
        if (
          Math.abs(existingWindowDuration - sub.historicalExposureDuration) >
          1e-12
        ) {
          throw new ForecastPipelineRequestError(
            `Conflicting historicalExposure.exposureDuration values (${existingWindowDuration} vs ${sub.historicalExposureDuration}) reported for Poisson exposureWindowId '${sub.hasExplicitWindowId ? sub.exposureWindowId : 'default'}' across submissions`,
          );
        }
      } else {
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
        retrievedAt: effectiveExecutedAt,
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
      const poolUrls = allPoissonCitations.map((c) => c.url);
      let preVerifiedCombination:
        | PoissonMethodContribution['preVerifiedCombination']
        | undefined;
      let poolAllowed = true;

      if (exposureDurationByWindowId.size > 1) {
        const contributingSubs = activePoissonSubmissionIds
          .map((id) => verifiedSubmissionById.get(id))
          .filter((s): s is PipelineEvidenceSubmission => s !== undefined);
        const gate = evaluateMultiSourceCombinationGate({
          methodId: 'poisson-gamma-hazard',
          expectedBasis: 'disjoint-poisson-exposure-windows',
          allContributingIds: activePoissonSubmissionIds,
          allContributingUrls: poolUrls,
          contributingSubmissions: contributingSubs,
          outcomeSpace,
          referenceTime,
          ...(multiSourceCombinationJustifications !== undefined
            ? { justifications: multiSourceCombinationJustifications }
            : {}),
          ...(combinationVerifier !== undefined ? { combinationVerifier } : {}),
        });
        if (!gate.approved) {
          poolAllowed = false;
          rejectedMultiSourceCombinations.push(gate.rejection);
          assessmentNotes.push(gate.rejection.explanation);
          rejectedCombinationMessageByMethod.set(
            'poisson-gamma-hazard',
            gate.rejection.explanation,
          );
        } else {
          preVerifiedCombination = {
            justification: gate.justification,
            verifiedByVerifierId: gate.verifiedByVerifierId,
            verificationArtifactRef: gate.verificationArtifactRef,
            verifierRationale: gate.verifierRationale,
          };
        }
      }

      if (poolAllowed) {
        const totalExposureDuration = kahanNeumaierSum([
          ...exposureDurationByWindowId.values(),
        ]);
        const validatedPoolPoisson = validatePoissonExposuresUnitsAndPosterior(
          {
            eventCount: globalArrivalCount,
            exposureDuration: totalExposureDuration,
            exposureUnit: referenceSub.historicalExposureUnit,
            forecastExposureDuration: referenceSub.forecastExposureDuration,
            forecastExposureUnit: referenceSub.forecastExposureUnit,
            prior: referenceSub.prior,
          },
          `global poisson-arrivals pool [${activePoissonSubmissionIds.join(', ')}]`,
        );

        poissonContributions.push({
          sourceKind: 'historical-observations-pool',
          evidenceIds: Object.freeze([...activePoissonSubmissionIds]),
          sourceUrls: Object.freeze(poolUrls),
          eventOutcomeIndex: referenceSub.eventOutcomeIndex,
          eventCount: validatedPoolPoisson.eventCount,
          exposureDuration: validatedPoolPoisson.exposureDuration,
          exposureUnit: validatedPoolPoisson.exposureUnit,
          forecastExposureDuration: validatedPoolPoisson.forecastExposureDuration,
          forecastExposureUnit: validatedPoolPoisson.forecastExposureUnit,
          prior: validatedPoolPoisson.prior,
          ...(referenceSub.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
            : {}),
          ...(preVerifiedCombination !== undefined
            ? { preVerifiedCombination }
            : {}),
        });

        if (
          activePoissonSubmissionIds.length > 1 &&
          preVerifiedCombination !== undefined
        ) {
          assessmentNotes.push(
            `Pooled ${activePoissonSubmissionIds.length} disjoint Poisson exposure windows [${[...exposureDurationByWindowId.keys()].join(', ')}] into total exposure ${totalExposureDuration} ${validatedPoolPoisson.exposureUnit} (verified by '${preVerifiedCombination.verifiedByVerifierId}').`,
          );
        }
      }
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
    const refCi =
      referenceSub.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
    for (let i = 1; i < pendingMultinomialSubmissions.length; i++) {
      const other = pendingMultinomialSubmissions[i]!;
      const otherCi =
        other.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
      if (
        other.priorAlpha.length !== referenceSub.priorAlpha.length ||
        other.priorAlpha.some(
          (a, k) => Math.abs(a - referenceSub.priorAlpha[k]!) > 1e-12,
        )
      ) {
        throw new ForecastPipelineRequestError(
          `Conflicting multinomial-trials Dirichlet prior hyperparameters across submissions '${referenceSub.evidenceId}' and '${other.evidenceId}'`,
        );
      }
      if (Math.abs(otherCi - refCi) > 1e-12) {
        throw new ForecastPipelineRequestError(
          `Conflicting multinomial-trials credibleIntervalLevel across submissions '${referenceSub.evidenceId}' (${refCi}) and '${other.evidenceId}' (${otherCi})`,
        );
      }
    }

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

    const totalGlobalMultinomial = kahanNeumaierSum(globalCounts);

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
          retrievedAt: effectiveExecutedAt,
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
        retrievedAt: effectiveExecutedAt,
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
      const validatedPoolMultinomial =
        validateMultinomialDimensionCountsAndPosterior(
          globalCounts,
          { alpha: referenceSub.priorAlpha },
          outcomeSpace,
          `global multinomial-trials pool [${activeMultinomialSubmissionIds.join(', ')}]`,
        );

      dirichletContributions.push({
        sourceKind: 'historical-observations-pool',
        evidenceIds: Object.freeze([...activeMultinomialSubmissionIds]),
        sourceUrls: Object.freeze(allMultinomialCitations.map((c) => c.url)),
        counts: validatedPoolMultinomial.counts,
        priorAlpha: validatedPoolMultinomial.prior.alpha,
        ...(referenceSub.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: referenceSub.credibleIntervalLevel }
          : {}),
      });
    }
  }

  /* -----------------------------------------------------------------------
     Phase 3: Non-Overwriting Multi-Source Resolution per Method
     (Fail-closed server-side combination verification)
     ----------------------------------------------------------------------- */
  if (betaContributions.length > 0) {
    const firstBeta = betaContributions[0]!;
    if (betaContributions.length === 1) {
      binaryTrialSuccesses = firstBeta.successes;
      binaryTrialFailures = firstBeta.failures;
      availableChannelSet.add('binary-trial-counts');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('beta-binomial-conjugate');

      const betaInput: BetaBinomialExecutionInput = Object.freeze({
        methodId: 'beta-binomial-conjugate',
        outcomeSpace,
        successOutcomeIndex: firstBeta.successOutcomeIndex,
        prior: firstBeta.prior,
        observed: Object.freeze({
          successes: firstBeta.successes,
          failures: firstBeta.failures,
        }),
        ...(firstBeta.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: firstBeta.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('beta-binomial-conjugate', {
        methodId: 'beta-binomial-conjugate',
        executionInput: betaInput,
        provenanceIds: firstBeta.evidenceIds,
        sourceUrls: firstBeta.sourceUrls,
      });

      if (firstBeta.evidenceIds.length > 1) {
        const rationale = `Collapsed ${firstBeta.evidenceIds.length} parallel binary-trials observation feeds via pipeline-wide canonical event deduplication without double-counting.`;
        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          combinationMode: 'global-event-deduplication',
          combinationBasis: 'event-level-global-deduplication',
          contributingEvidenceIds: firstBeta.evidenceIds,
          contributingSourceUrls: firstBeta.sourceUrls,
          dependencePreserved: true,
          verifiedByVerifierId: null,
          verificationArtifactRef: null,
          mathematicalRationale: rationale,
          dependenceNote: `Merged ${firstBeta.evidenceIds.length} binary-trials observation feeds via pipeline-wide canonical event deduplication; overlapping event reports were collapsed without double-counting.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    } else {
      const allIds: string[] = [];
      const allUrls: string[] = [];
      const seenUrl = new Set<string>();
      for (const c of betaContributions) {
        for (const id of c.evidenceIds) {
          allIds.push(id);
        }
        for (const u of c.sourceUrls) {
          if (!seenUrl.has(u)) {
            seenUrl.add(u);
            allUrls.push(u);
          }
        }
      }
      const contributingSubs = allIds
        .map((id) => verifiedSubmissionById.get(id))
        .filter((s): s is PipelineEvidenceSubmission => s !== undefined);

      const gate = evaluateMultiSourceCombinationGate({
        methodId: 'beta-binomial-conjugate',
        expectedBasis: 'disjoint-exchangeable-cohorts',
        allContributingIds: allIds,
        allContributingUrls: allUrls,
        contributingSubmissions: contributingSubs,
        outcomeSpace,
        referenceTime,
        ...(multiSourceCombinationJustifications !== undefined
          ? { justifications: multiSourceCombinationJustifications }
          : {}),
        ...(combinationVerifier !== undefined ? { combinationVerifier } : {}),
      });

      if (!gate.approved) {
        rejectedMultiSourceCombinations.push(gate.rejection);
        assessmentNotes.push(gate.rejection.explanation);
        rejectedCombinationMessageByMethod.set(
          'beta-binomial-conjugate',
          gate.rejection.explanation,
        );
      } else {
        const refAlpha0 =
          firstBeta.successOutcomeIndex === 0
            ? firstBeta.prior.alpha
            : firstBeta.prior.beta;
        const refBeta1 =
          firstBeta.successOutcomeIndex === 0
            ? firstBeta.prior.beta
            : firstBeta.prior.alpha;
        const refCi =
          firstBeta.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;

        const succ0List: number[] = [];
        const fail1List: number[] = [];
        for (const c of betaContributions) {
          const alpha0 =
            c.successOutcomeIndex === 0 ? c.prior.alpha : c.prior.beta;
          const beta1 =
            c.successOutcomeIndex === 0 ? c.prior.beta : c.prior.alpha;
          const ci =
            c.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
          if (
            Math.abs(alpha0 - refAlpha0) > 1e-12 ||
            Math.abs(beta1 - refBeta1) > 1e-12
          ) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'beta-binomial-conjugate' submissions [${allIds.join(', ')}] with incompatible Beta priors`,
            );
          }
          if (Math.abs(ci - refCi) > 1e-12) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'beta-binomial-conjugate' submissions [${allIds.join(', ')}] with conflicting credibleIntervalLevel (${refCi} vs ${ci})`,
            );
          }
          succ0List.push(
            c.successOutcomeIndex === 0 ? c.successes : c.failures,
          );
          fail1List.push(
            c.successOutcomeIndex === 0 ? c.failures : c.successes,
          );
        }

        const combinedSucc0 = kahanNeumaierSum(succ0List);
        const combinedFail1 = kahanNeumaierSum(fail1List);
        const canonicalPrior = Object.freeze({
          alpha: refAlpha0,
          beta: refBeta1,
        });
        validateBetaCountsAndPosterior(
          canonicalPrior,
          combinedSucc0,
          combinedFail1,
          `combined beta-binomial-conjugate submissions [${allIds.join(', ')}]`,
        );

        binaryTrialSuccesses = combinedSucc0;
        binaryTrialFailures = combinedFail1;
        availableChannelSet.add('binary-trial-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('beta-binomial-conjugate');

        const betaInput: BetaBinomialExecutionInput = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          outcomeSpace,
          successOutcomeIndex: 0,
          prior: canonicalPrior,
          observed: Object.freeze({
            successes: combinedSucc0,
            failures: combinedFail1,
          }),
          ...(firstBeta.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: refCi }
            : {}),
        });
        preparedMethodInputs.set('beta-binomial-conjugate', {
          methodId: 'beta-binomial-conjugate',
          executionInput: betaInput,
          provenanceIds: Object.freeze(allIds),
          sourceUrls: Object.freeze(allUrls),
        });

        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          combinationMode: 'mathematically-justified-disjoint-combination',
          combinationBasis: gate.justification.basis,
          contributingEvidenceIds: Object.freeze(allIds),
          contributingSourceUrls: Object.freeze(allUrls),
          dependencePreserved: true,
          verifiedByVerifierId: gate.verifiedByVerifierId,
          verificationArtifactRef: gate.verificationArtifactRef,
          mathematicalRationale: gate.justification.mathematicalRationale,
          dependenceNote: `Combined ${allIds.length} verified sources for 'beta-binomial-conjugate' under justified basis '${gate.justification.basis}' (total outcomes: [${combinedSucc0}, ${combinedFail1}]; verified by '${gate.verifiedByVerifierId}': ${gate.verifierRationale}). All source provenance IDs and URLs preserved.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    }
  }

  if (kishContributions.length > 0) {
    const firstKish = kishContributions[0]!;
    if (kishContributions.length === 1) {
      const validatedSingle = validateWeightedKishPayload(
        {
          weightedSuccessMass: firstKish.weightedSuccessMass,
          weightedFailureMass: firstKish.weightedFailureMass,
          sumSquaredWeights: firstKish.sumSquaredWeights,
          observationCount: firstKish.observationCount,
          prior: firstKish.prior,
        },
        `weighted-kish-effective-binomial [${firstKish.evidenceIds.join(', ')}]`,
      );
      weightedSampleSize = validatedSingle.observationCount;
      kishEffectiveSampleSize = validatedSingle.nEff;
      availableChannelSet.add('weighted-binary-trials');
      availableChannelSet.add('kish-effective-sample-size');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('weighted-kish-effective-binomial');

      const kishInput: WeightedKishExecutionInput = Object.freeze({
        methodId: 'weighted-kish-effective-binomial',
        outcomeSpace,
        successOutcomeIndex: firstKish.successOutcomeIndex,
        prior: firstKish.prior,
        observed: Object.freeze({
          weightedSuccessMass: firstKish.weightedSuccessMass,
          weightedFailureMass: firstKish.weightedFailureMass,
          sumSquaredWeights: firstKish.sumSquaredWeights,
          observationCount: firstKish.observationCount,
        }),
        ...(firstKish.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: firstKish.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('weighted-kish-effective-binomial', {
        methodId: 'weighted-kish-effective-binomial',
        executionInput: kishInput,
        provenanceIds: firstKish.evidenceIds,
        sourceUrls: firstKish.sourceUrls,
      });

      if (firstKish.evidenceIds.length > 1) {
        const rationale = `Collapsed ${firstKish.evidenceIds.length} weighted binary-trials feeds via canonical event deduplication prior to Kish effective sample size computation.`;
        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          combinationMode: 'global-event-deduplication',
          combinationBasis: 'event-level-global-deduplication',
          contributingEvidenceIds: firstKish.evidenceIds,
          contributingSourceUrls: firstKish.sourceUrls,
          dependencePreserved: true,
          verifiedByVerifierId: null,
          verificationArtifactRef: null,
          mathematicalRationale: rationale,
          dependenceNote: `Merged ${firstKish.evidenceIds.length} weighted binary-trials feeds via canonical event deduplication before computing Kish effective sample size (n=${validatedSingle.observationCount}, n_eff=${validatedSingle.nEff.toFixed(4)}).`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    } else {
      const allIds: string[] = [];
      const allUrls: string[] = [];
      const seenUrl = new Set<string>();
      for (const c of kishContributions) {
        for (const id of c.evidenceIds) {
          allIds.push(id);
        }
        for (const u of c.sourceUrls) {
          if (!seenUrl.has(u)) {
            seenUrl.add(u);
            allUrls.push(u);
          }
        }
      }
      const contributingSubs = allIds
        .map((id) => verifiedSubmissionById.get(id))
        .filter((s): s is PipelineEvidenceSubmission => s !== undefined);

      const gate = evaluateMultiSourceCombinationGate({
        methodId: 'weighted-kish-effective-binomial',
        expectedBasis: 'disjoint-exogenous-weighted-cohorts',
        allContributingIds: allIds,
        allContributingUrls: allUrls,
        contributingSubmissions: contributingSubs,
        outcomeSpace,
        referenceTime,
        ...(multiSourceCombinationJustifications !== undefined
          ? { justifications: multiSourceCombinationJustifications }
          : {}),
        ...(combinationVerifier !== undefined ? { combinationVerifier } : {}),
      });

      if (!gate.approved) {
        rejectedMultiSourceCombinations.push(gate.rejection);
        assessmentNotes.push(gate.rejection.explanation);
        rejectedCombinationMessageByMethod.set(
          'weighted-kish-effective-binomial',
          gate.rejection.explanation,
        );
      } else {
        const refAlpha0 =
          firstKish.successOutcomeIndex === 0
            ? firstKish.prior.alpha
            : firstKish.prior.beta;
        const refBeta1 =
          firstKish.successOutcomeIndex === 0
            ? firstKish.prior.beta
            : firstKish.prior.alpha;
        const refCi =
          firstKish.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;

        const w0List: number[] = [];
        const w1List: number[] = [];
        const sumSqList: number[] = [];
        const obsCountList: number[] = [];
        for (const c of kishContributions) {
          const alpha0 =
            c.successOutcomeIndex === 0 ? c.prior.alpha : c.prior.beta;
          const beta1 =
            c.successOutcomeIndex === 0 ? c.prior.beta : c.prior.alpha;
          const ci =
            c.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
          if (
            Math.abs(alpha0 - refAlpha0) > 1e-12 ||
            Math.abs(beta1 - refBeta1) > 1e-12
          ) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'weighted-kish-effective-binomial' submissions [${allIds.join(', ')}] with incompatible Beta priors`,
            );
          }
          if (Math.abs(ci - refCi) > 1e-12) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'weighted-kish-effective-binomial' submissions [${allIds.join(', ')}] with conflicting credibleIntervalLevel (${refCi} vs ${ci})`,
            );
          }
          w0List.push(
            c.successOutcomeIndex === 0
              ? c.weightedSuccessMass
              : c.weightedFailureMass,
          );
          w1List.push(
            c.successOutcomeIndex === 0
              ? c.weightedFailureMass
              : c.weightedSuccessMass,
          );
          sumSqList.push(c.sumSquaredWeights);
          obsCountList.push(c.observationCount);
        }

        const canonicalPrior = Object.freeze({
          alpha: refAlpha0,
          beta: refBeta1,
        });
        const combinedKish = validateWeightedKishPayload(
          {
            weightedSuccessMass: kahanNeumaierSum(w0List),
            weightedFailureMass: kahanNeumaierSum(w1List),
            sumSquaredWeights: kahanNeumaierSum(sumSqList),
            observationCount: kahanNeumaierSum(obsCountList),
            prior: canonicalPrior,
          },
          `combined weighted-kish-effective-binomial submissions [${allIds.join(', ')}]`,
        );

        weightedSampleSize = combinedKish.observationCount;
        kishEffectiveSampleSize = combinedKish.nEff;
        availableChannelSet.add('weighted-binary-trials');
        availableChannelSet.add('kish-effective-sample-size');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('weighted-kish-effective-binomial');

        const kishInput: WeightedKishExecutionInput = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          outcomeSpace,
          successOutcomeIndex: 0,
          prior: canonicalPrior,
          observed: Object.freeze({
            weightedSuccessMass: combinedKish.weightedSuccessMass,
            weightedFailureMass: combinedKish.weightedFailureMass,
            sumSquaredWeights: combinedKish.sumSquaredWeights,
            observationCount: combinedKish.observationCount,
          }),
          ...(firstKish.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: refCi }
            : {}),
        });
        preparedMethodInputs.set('weighted-kish-effective-binomial', {
          methodId: 'weighted-kish-effective-binomial',
          executionInput: kishInput,
          provenanceIds: Object.freeze(allIds),
          sourceUrls: Object.freeze(allUrls),
        });

        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'weighted-kish-effective-binomial',
          combinationMode: 'mathematically-justified-disjoint-combination',
          combinationBasis: gate.justification.basis,
          contributingEvidenceIds: Object.freeze(allIds),
          contributingSourceUrls: Object.freeze(allUrls),
          dependencePreserved: true,
          verifiedByVerifierId: gate.verifiedByVerifierId,
          verificationArtifactRef: gate.verificationArtifactRef,
          mathematicalRationale: gate.justification.mathematicalRationale,
          dependenceNote: `Combined ${allIds.length} weighted binomial sources under justified basis '${gate.justification.basis}' (n=${combinedKish.observationCount}, n_eff=${combinedKish.nEff.toFixed(4)}; verified by '${gate.verifiedByVerifierId}': ${gate.verifierRationale}). All source provenance IDs and URLs preserved.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    }
  }

  if (poissonContributions.length > 0) {
    const firstPoisson = poissonContributions[0]!;
    if (poissonContributions.length === 1) {
      poissonEventCount = firstPoisson.eventCount;
      poissonExposureDuration = firstPoisson.exposureDuration;
      availableChannelSet.add('poisson-event-counts');
      availableChannelSet.add('continuous-exposure-duration');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('poisson-gamma-hazard');

      const poissonInput: PoissonGammaExecutionInput = Object.freeze({
        methodId: 'poisson-gamma-hazard',
        outcomeSpace,
        eventOutcomeIndex: firstPoisson.eventOutcomeIndex,
        prior: Object.freeze({
          shape: firstPoisson.prior.shape,
          rate: firstPoisson.prior.rate,
          parameterization: 'shape-rate' as const,
        }),
        observed: Object.freeze({
          eventCount: firstPoisson.eventCount,
          exposureDuration: firstPoisson.exposureDuration,
          exposureUnit: firstPoisson.exposureUnit,
        }),
        forecast: Object.freeze({
          exposureDuration: firstPoisson.forecastExposureDuration,
          exposureUnit: firstPoisson.forecastExposureUnit,
        }),
        exposureUnit: firstPoisson.exposureUnit,
        ...(firstPoisson.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: firstPoisson.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('poisson-gamma-hazard', {
        methodId: 'poisson-gamma-hazard',
        executionInput: poissonInput,
        provenanceIds: firstPoisson.evidenceIds,
        sourceUrls: firstPoisson.sourceUrls,
      });

      if (firstPoisson.evidenceIds.length > 1) {
        const preVerified = firstPoisson.preVerifiedCombination;
        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          combinationMode:
            preVerified !== undefined
              ? 'mathematically-justified-disjoint-combination'
              : 'global-event-deduplication',
          combinationBasis:
            preVerified !== undefined
              ? preVerified.justification.basis
              : 'event-level-global-deduplication',
          contributingEvidenceIds: firstPoisson.evidenceIds,
          contributingSourceUrls: firstPoisson.sourceUrls,
          dependencePreserved: true,
          verifiedByVerifierId: preVerified?.verifiedByVerifierId ?? null,
          verificationArtifactRef: preVerified?.verificationArtifactRef ?? null,
          mathematicalRationale:
            preVerified !== undefined
              ? preVerified.justification.mathematicalRationale
              : `Collapsed ${firstPoisson.evidenceIds.length} Poisson arrival feeds sharing exposure window '${firstPoisson.exposureDuration} ${firstPoisson.exposureUnit}' via canonical event deduplication.`,
          dependenceNote: `Aggregated ${firstPoisson.evidenceIds.length} Poisson arrival feeds (k=${firstPoisson.eventCount}, T=${firstPoisson.exposureDuration} ${firstPoisson.exposureUnit}${preVerified ? `; verified by '${preVerified.verifiedByVerifierId}'` : ''}) without overwriting provenance.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    } else {
      const allIds: string[] = [];
      const allUrls: string[] = [];
      const seenUrl = new Set<string>();
      for (const c of poissonContributions) {
        for (const id of c.evidenceIds) {
          allIds.push(id);
        }
        for (const u of c.sourceUrls) {
          if (!seenUrl.has(u)) {
            seenUrl.add(u);
            allUrls.push(u);
          }
        }
      }
      const contributingSubs = allIds
        .map((id) => verifiedSubmissionById.get(id))
        .filter((s): s is PipelineEvidenceSubmission => s !== undefined);

      const gate = evaluateMultiSourceCombinationGate({
        methodId: 'poisson-gamma-hazard',
        expectedBasis: 'disjoint-poisson-exposure-windows',
        allContributingIds: allIds,
        allContributingUrls: allUrls,
        contributingSubmissions: contributingSubs,
        outcomeSpace,
        referenceTime,
        ...(multiSourceCombinationJustifications !== undefined
          ? { justifications: multiSourceCombinationJustifications }
          : {}),
        ...(combinationVerifier !== undefined ? { combinationVerifier } : {}),
      });

      if (!gate.approved) {
        rejectedMultiSourceCombinations.push(gate.rejection);
        assessmentNotes.push(gate.rejection.explanation);
        rejectedCombinationMessageByMethod.set(
          'poisson-gamma-hazard',
          gate.rejection.explanation,
        );
      } else {
        const refCi =
          firstPoisson.credibleIntervalLevel ??
          DEFAULT_CREDIBLE_INTERVAL_LEVEL;
        const eventCounts: number[] = [];
        const exposureDurations: number[] = [];
        for (const c of poissonContributions) {
          const ci =
            c.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
          if (c.eventOutcomeIndex !== firstPoisson.eventOutcomeIndex) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'poisson-gamma-hazard' submissions [${allIds.join(', ')}] with conflicting eventOutcomeIndex`,
            );
          }
          if (
            c.exposureUnit !== firstPoisson.exposureUnit ||
            c.forecastExposureUnit !== firstPoisson.forecastExposureUnit ||
            Math.abs(
              c.forecastExposureDuration -
                firstPoisson.forecastExposureDuration,
            ) > 1e-12
          ) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'poisson-gamma-hazard' submissions [${allIds.join(', ')}] with incompatible exposure units or forecast exposure horizons`,
            );
          }
          if (
            Math.abs(c.prior.shape - firstPoisson.prior.shape) > 1e-12 ||
            Math.abs(c.prior.rate - firstPoisson.prior.rate) > 1e-12
          ) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'poisson-gamma-hazard' submissions [${allIds.join(', ')}] with incompatible Gamma priors`,
            );
          }
          if (Math.abs(ci - refCi) > 1e-12) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'poisson-gamma-hazard' submissions [${allIds.join(', ')}] with conflicting credibleIntervalLevel`,
            );
          }
          eventCounts.push(c.eventCount);
          exposureDurations.push(c.exposureDuration);
        }

        const combinedPoisson = validatePoissonExposuresUnitsAndPosterior(
          {
            eventCount: kahanNeumaierSum(eventCounts),
            exposureDuration: kahanNeumaierSum(exposureDurations),
            exposureUnit: firstPoisson.exposureUnit,
            forecastExposureDuration: firstPoisson.forecastExposureDuration,
            forecastExposureUnit: firstPoisson.forecastExposureUnit,
            prior: firstPoisson.prior,
          },
          `combined poisson-gamma-hazard submissions [${allIds.join(', ')}]`,
        );

        poissonEventCount = combinedPoisson.eventCount;
        poissonExposureDuration = combinedPoisson.exposureDuration;
        availableChannelSet.add('poisson-event-counts');
        availableChannelSet.add('continuous-exposure-duration');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('poisson-gamma-hazard');

        const poissonInput: PoissonGammaExecutionInput = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          outcomeSpace,
          eventOutcomeIndex: firstPoisson.eventOutcomeIndex,
          prior: Object.freeze({
            shape: firstPoisson.prior.shape,
            rate: firstPoisson.prior.rate,
            parameterization: 'shape-rate' as const,
          }),
          observed: Object.freeze({
            eventCount: combinedPoisson.eventCount,
            exposureDuration: combinedPoisson.exposureDuration,
            exposureUnit: combinedPoisson.exposureUnit,
          }),
          forecast: Object.freeze({
            exposureDuration: combinedPoisson.forecastExposureDuration,
            exposureUnit: combinedPoisson.forecastExposureUnit,
          }),
          exposureUnit: combinedPoisson.exposureUnit,
          ...(firstPoisson.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: refCi }
            : {}),
        });
        preparedMethodInputs.set('poisson-gamma-hazard', {
          methodId: 'poisson-gamma-hazard',
          executionInput: poissonInput,
          provenanceIds: Object.freeze(allIds),
          sourceUrls: Object.freeze(allUrls),
        });

        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          combinationMode: 'mathematically-justified-disjoint-combination',
          combinationBasis: gate.justification.basis,
          contributingEvidenceIds: Object.freeze(allIds),
          contributingSourceUrls: Object.freeze(allUrls),
          dependencePreserved: true,
          verifiedByVerifierId: gate.verifiedByVerifierId,
          verificationArtifactRef: gate.verificationArtifactRef,
          mathematicalRationale: gate.justification.mathematicalRationale,
          dependenceNote: `Combined ${allIds.length} verified Poisson exposure sources under justified basis '${gate.justification.basis}' (k=${combinedPoisson.eventCount}, T=${combinedPoisson.exposureDuration} ${combinedPoisson.exposureUnit}; verified by '${gate.verifiedByVerifierId}': ${gate.verifierRationale}). All source provenance IDs and URLs preserved.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    }
  }

  if (dirichletContributions.length > 0) {
    const firstDirichlet = dirichletContributions[0]!;
    if (dirichletContributions.length === 1) {
      multinomialOutcomeCounts = firstDirichlet.counts;
      availableChannelSet.add('multinomial-category-counts');
      availableChannelSet.add('prior-hyperparameters');
      supportedMethodSet.add('dirichlet-multinomial-symmetry');

      const dirichletInput: DirichletMultinomialExecutionInput = Object.freeze({
        methodId: 'dirichlet-multinomial-symmetry',
        outcomeSpace,
        prior: Object.freeze({ alpha: firstDirichlet.priorAlpha }),
        observed: Object.freeze({ counts: firstDirichlet.counts }),
        ...(firstDirichlet.credibleIntervalLevel !== undefined
          ? { credibleIntervalLevel: firstDirichlet.credibleIntervalLevel }
          : {}),
      });
      preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
        methodId: 'dirichlet-multinomial-symmetry',
        executionInput: dirichletInput,
        provenanceIds: firstDirichlet.evidenceIds,
        sourceUrls: firstDirichlet.sourceUrls,
      });

      if (firstDirichlet.evidenceIds.length > 1) {
        const rationale = `Collapsed ${firstDirichlet.evidenceIds.length} multinomial-trials observation feeds via pipeline-wide canonical event deduplication.`;
        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'dirichlet-multinomial-symmetry',
          combinationMode: 'global-event-deduplication',
          combinationBasis: 'event-level-global-deduplication',
          contributingEvidenceIds: firstDirichlet.evidenceIds,
          contributingSourceUrls: firstDirichlet.sourceUrls,
          dependencePreserved: true,
          verifiedByVerifierId: null,
          verificationArtifactRef: null,
          mathematicalRationale: rationale,
          dependenceNote: `Merged ${firstDirichlet.evidenceIds.length} multinomial-trials observation feeds via global canonical event deduplication ([${firstDirichlet.counts.join(', ')}]).`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    } else {
      const allIds: string[] = [];
      const allUrls: string[] = [];
      const seenUrl = new Set<string>();
      for (const c of dirichletContributions) {
        for (const id of c.evidenceIds) {
          allIds.push(id);
        }
        for (const u of c.sourceUrls) {
          if (!seenUrl.has(u)) {
            seenUrl.add(u);
            allUrls.push(u);
          }
        }
      }
      const contributingSubs = allIds
        .map((id) => verifiedSubmissionById.get(id))
        .filter((s): s is PipelineEvidenceSubmission => s !== undefined);

      const gate = evaluateMultiSourceCombinationGate({
        methodId: 'dirichlet-multinomial-symmetry',
        expectedBasis: 'disjoint-exchangeable-cohorts',
        allContributingIds: allIds,
        allContributingUrls: allUrls,
        contributingSubmissions: contributingSubs,
        outcomeSpace,
        referenceTime,
        ...(multiSourceCombinationJustifications !== undefined
          ? { justifications: multiSourceCombinationJustifications }
          : {}),
        ...(combinationVerifier !== undefined ? { combinationVerifier } : {}),
      });

      if (!gate.approved) {
        rejectedMultiSourceCombinations.push(gate.rejection);
        assessmentNotes.push(gate.rejection.explanation);
        rejectedCombinationMessageByMethod.set(
          'dirichlet-multinomial-symmetry',
          gate.rejection.explanation,
        );
      } else {
        const refCi =
          firstDirichlet.credibleIntervalLevel ??
          DEFAULT_CREDIBLE_INTERVAL_LEVEL;
        for (const c of dirichletContributions) {
          const ci =
            c.credibleIntervalLevel ?? DEFAULT_CREDIBLE_INTERVAL_LEVEL;
          if (
            c.priorAlpha.length !== firstDirichlet.priorAlpha.length ||
            c.priorAlpha.some(
              (a, k) => Math.abs(a - firstDirichlet.priorAlpha[k]!) > 1e-12,
            )
          ) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'dirichlet-multinomial-symmetry' submissions [${allIds.join(', ')}] with incompatible Dirichlet priors`,
            );
          }
          if (Math.abs(ci - refCi) > 1e-12) {
            throw new ForecastPipelineRequestError(
              `Cannot combine multiple 'dirichlet-multinomial-symmetry' submissions [${allIds.join(', ')}] with conflicting credibleIntervalLevel`,
            );
          }
        }

        const combinedCounts: number[] = [];
        for (let k = 0; k < outcomeCount; k++) {
          combinedCounts.push(
            kahanNeumaierSum(dirichletContributions.map((c) => c.counts[k]!)),
          );
        }
        const validatedCombinedDirichlet =
          validateMultinomialDimensionCountsAndPosterior(
            combinedCounts,
            { alpha: firstDirichlet.priorAlpha },
            outcomeSpace,
            `combined dirichlet-multinomial-symmetry submissions [${allIds.join(', ')}]`,
          );

        multinomialOutcomeCounts = validatedCombinedDirichlet.counts;
        availableChannelSet.add('multinomial-category-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('dirichlet-multinomial-symmetry');

        const dirichletInput: DirichletMultinomialExecutionInput =
          Object.freeze({
            methodId: 'dirichlet-multinomial-symmetry',
            outcomeSpace,
            prior: Object.freeze({ alpha: firstDirichlet.priorAlpha }),
            observed: Object.freeze({
              counts: validatedCombinedDirichlet.counts,
            }),
            ...(firstDirichlet.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: refCi }
              : {}),
          });
        preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
          methodId: 'dirichlet-multinomial-symmetry',
          executionInput: dirichletInput,
          provenanceIds: Object.freeze(allIds),
          sourceUrls: Object.freeze(allUrls),
        });

        const diag: MultiSourceCombinationDiagnostic = Object.freeze({
          methodId: 'dirichlet-multinomial-symmetry',
          combinationMode: 'mathematically-justified-disjoint-combination',
          combinationBasis: gate.justification.basis,
          contributingEvidenceIds: Object.freeze(allIds),
          contributingSourceUrls: Object.freeze(allUrls),
          dependencePreserved: true,
          verifiedByVerifierId: gate.verifiedByVerifierId,
          verificationArtifactRef: gate.verificationArtifactRef,
          mathematicalRationale: gate.justification.mathematicalRationale,
          dependenceNote: `Combined ${allIds.length} verified multinomial sources under justified basis '${gate.justification.basis}' (counts=[${validatedCombinedDirichlet.counts.join(', ')}]; verified by '${gate.verifiedByVerifierId}': ${gate.verifierRationale}). All source provenance IDs and URLs preserved.`,
        });
        multiSourceCombinations.push(diag);
        assessmentNotes.push(diag.dependenceNote);
      }
    }
  }

  if (continuousContributions.length > 1) {
    throw new ForecastPipelineRequestError(
      `Multiple continuous diffusion/barrier submissions [${continuousContributions.map((c) => c.evidenceId).join(', ')}] cannot silently overwrite each other or be naively averaged across separate trajectory parameterizations`,
    );
  } else if (continuousContributions.length === 1) {
    const c = continuousContributions[0]!;
    continuousTrajectoryObservations = c.observationCount;
    estimatedDrift = c.estimatedDrift;
    estimatedScaleOrVolatility = c.estimatedScaleOrVolatility;
    availableChannelSet.add('continuous-state-trajectory');
    availableChannelSet.add('drift-and-scale-estimates');
    if (c.degreesOfFreedom !== undefined) {
      degreesOfFreedom = c.degreesOfFreedom;
      availableChannelSet.add('tail-degrees-of-freedom');
    }
    if (c.initialStateLevel !== undefined) {
      initialStateLevel = c.initialStateLevel;
      if (
        outcomeSpace.barrierLevel !== undefined &&
        outcomeSpace.barrierDirection !== undefined
      ) {
        availableChannelSet.add('absorbing-barrier-specification');
      }
    }
    for (const tm of c.targetMethodIds) {
      supportedMethodSet.add(tm);
    }
  }

  const EMPIRICAL_CHANNEL_SET: ReadonlySet<MethodDataChannelId> = new Set([
    'binary-trial-counts',
    'weighted-binary-trials',
    'kish-effective-sample-size',
    'poisson-event-counts',
    'continuous-exposure-duration',
    'multinomial-category-counts',
    'continuous-state-trajectory',
    'drift-and-scale-estimates',
    'tail-degrees-of-freedom',
  ]);
  hasVerifiableEmpiricalData = [...availableChannelSet].some((ch) =>
    EMPIRICAL_CHANNEL_SET.has(ch),
  );

  /* -----------------------------------------------------------------------
     Phase 4: Formal StructuralSymmetryContract & Fail-Closed Verifier Gate
     ----------------------------------------------------------------------- */
  if (
    structuralSymmetryPremise !== undefined &&
    structuralSymmetryContract === undefined
  ) {
    const msg =
      "Rejected legacy boolean+rationale structuralSymmetryPremise without a mathematically valid StructuralSymmetryContract; unverified boolean symmetry claims never unlock 'structural-uniform-baseline' or emit a 50/50 baseline.";
    assessmentNotes.push(msg);
    structuralSymmetryVerification = Object.freeze({
      status: 'rejected-legacy-premise-without-contract',
      verifierId: null,
      verificationArtifactRef: null,
      contractBasisKind: null,
      explanation: msg,
    });
  }

  if (structuralSymmetryContract !== undefined) {
    const symValidation = validateStructuralSymmetryContract(
      structuralSymmetryContract,
      outcomeSpace,
    );
    if (!symValidation.valid) {
      throw new ForecastPipelineRequestError(
        `Invalid structuralSymmetryContract: ${symValidation.reasons.join('; ')}`,
        symValidation.reasons,
      );
    }

    if (!allowStructuralBaseline) {
      const msg =
        "StructuralSymmetryContract passed mathematical schema validation, but assumptions.allowStructuralBaseline is not true; 'structural-uniform-baseline' remains disabled.";
      assessmentNotes.push(msg);
      structuralSymmetryVerification = Object.freeze({
        status: 'rejected-baseline-not-opted-in',
        verifierId: null,
        verificationArtifactRef: null,
        contractBasisKind: structuralSymmetryContract.basisKind,
        explanation: msg,
      });
    } else {
      // FAIL-CLOSED: never self-certify structural symmetry without an explicit
      // trusted server-side symmetryVerifier returning verified=true.
      let verifierApproved = false;
      let verifierTag = '';

      if (symmetryVerifier === undefined) {
        const msg =
          "Rejected StructuralSymmetryContract for 'structural-uniform-baseline' (fail-closed): no trusted server-side symmetryVerifier was configured. Caller-supplied formalInvariant, derivationReference, generatingPermutations, and microstateCountsPerOutcome do not self-verify physical partition symmetry.";
        assessmentNotes.push(msg);
        structuralSymmetryVerification = Object.freeze({
          status: 'rejected-no-trusted-verifier',
          verifierId: null,
          verificationArtifactRef: null,
          contractBasisKind: structuralSymmetryContract.basisKind,
          explanation: msg,
        });
      } else {
        const decision = symmetryVerifier({
          question: question ?? '',
          outcomeSpace,
          contract: structuralSymmetryContract,
          validation: symValidation,
          referenceTime,
        });
        const vId =
          isPlainObject(decision) && typeof decision.verifierId === 'string'
            ? decision.verifierId.trim()
            : '';
        const vRat =
          isPlainObject(decision) && typeof decision.rationale === 'string'
            ? decision.rationale.trim()
            : '';
        const artifactRef =
          isPlainObject(decision) &&
          typeof decision.verificationArtifactRef === 'string' &&
          decision.verificationArtifactRef.trim().length > 0
            ? decision.verificationArtifactRef.trim()
            : null;

        if (vId.length === 0 || vRat.length === 0 || decision.verified !== true) {
          verifierApproved = false;
          const msg = `StructuralSymmetryContract was rejected by trusted symmetryVerifier ('${vId || 'invalid'}'): ${vRat || 'did not return verified=true with non-empty verifierId and rationale'}.`;
          assessmentNotes.push(msg);
          structuralSymmetryVerification = Object.freeze({
            status: 'rejected-by-trusted-verifier',
            verifierId: vId || null,
            verificationArtifactRef: artifactRef,
            contractBasisKind: structuralSymmetryContract.basisKind,
            explanation: msg,
          });
        } else {
          verifierApproved = true;
          verifierTag = `; verified by '${vId}'${artifactRef ? ` (ref='${artifactRef}')` : ''}: ${vRat}`;
          const msg = `StructuralSymmetryContract ('${structuralSymmetryContract.formalInvariant.groupName}') was independently verified by trusted symmetryVerifier '${vId}'${artifactRef ? ` (ref='${artifactRef}')` : ''}: ${vRat}.`;
          structuralSymmetryVerification = Object.freeze({
            status: 'verified',
            verifierId: vId,
            verificationArtifactRef: artifactRef,
            contractBasisKind: structuralSymmetryContract.basisKind,
            explanation: msg,
          });
        }
      }

      if (verifierApproved) {
        availableChannelSet.add('outcome-partition-symmetry');
        supportedMethodSet.add('structural-uniform-baseline');
        const structInput: StructuralUniformExecutionInput = Object.freeze({
          methodId: 'structural-uniform-baseline',
          outcomeSpace,
          symmetryPremise: Object.freeze({
            partitionSymmetryVerified: true,
            exhaustiveMutuallyExclusiveVerified: true,
            symmetryRationale: `${structuralSymmetryContract.formalInvariant.groupName}: ${structuralSymmetryContract.formalInvariant.invariantObservable} (${structuralSymmetryContract.formalInvariant.derivationReference}) [Orbit=${symValidation.orbitSize}, generators=${structuralSymmetryContract.generatingPermutations.length}, microstateCounts=[${structuralSymmetryContract.microstateCountsPerOutcome.join(', ')}]${verifierTag}]`,
          }),
        });
        preparedMethodInputs.set('structural-uniform-baseline', {
          methodId: 'structural-uniform-baseline',
          executionInput: structInput,
          provenanceIds: Object.freeze(['structural-symmetry-contract']),
          sourceUrls: Object.freeze([]),
        });
      }
    }
  }

  /* -----------------------------------------------------------------------
     Phase 5: Missing Requirements & Immutable Assessment Report
     ----------------------------------------------------------------------- */
  const missingRequirementsByMethod: Record<string, readonly string[]> = {};
  for (const desc of registry.listAll()) {
    const missing: string[] = [];
    const rejectedCombinationNote = rejectedCombinationMessageByMethod.get(
      desc.methodId,
    );
    if (rejectedCombinationNote !== undefined) {
      missing.push(rejectedCombinationNote);
    }
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
        structuralSymmetryVerification !== null
          ? structuralSymmetryVerification.explanation
          : "Method 'structural-uniform-baseline' requires assumptions.allowStructuralBaseline=true, a mathematically valid StructuralSymmetryContract, AND an explicit trusted server-side symmetryVerifier decision (verified=true)",
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
    multiSourceCombinations: Object.freeze(multiSourceCombinations),
    rejectedMultiSourceCombinations: Object.freeze(
      rejectedMultiSourceCombinations,
    ),
    structuralSymmetryVerification,
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

  const executedAt: IsoDateTime =
    dependencies.now?.() ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (!isValidIsoDateTime(executedAt)) {
    diagnostics.push(
      `ForecastPipelineDependencies.now() must return a valid UTC ISO-8601 timestamp, received '${String(executedAt)}'`,
    );
  }

  const referenceTime: IsoDateTime = request.referenceTime ?? executedAt;

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

  if (request.customWeightsByMethod !== undefined) {
    if (!isPlainObject(request.customWeightsByMethod)) {
      diagnostics.push(
        'ForecastPipelineRequest.customWeightsByMethod must be a non-null plain object',
      );
    } else {
      const weightEntries = Object.entries(request.customWeightsByMethod);
      if (weightEntries.length === 0) {
        diagnostics.push(
          'ForecastPipelineRequest.customWeightsByMethod must not be empty',
        );
      } else {
        const rawVals: number[] = [];
        for (const [mId, w] of weightEntries) {
          if (
            !EXECUTABLE_SCIENTIFIC_METHOD_IDS.includes(
              mId as ExecutableScientificMethodId,
            ) ||
            mId === 'structural-uniform-baseline'
          ) {
            diagnostics.push(
              `ForecastPipelineRequest.customWeightsByMethod['${mId}'] must be an executable evidence-driven methodId (not 'structural-uniform-baseline' or unknown)`,
            );
          }
          if (
            typeof w !== 'number' ||
            !Number.isFinite(w) ||
            w <= 0 ||
            w > 1
          ) {
            diagnostics.push(
              `ForecastPipelineRequest.customWeightsByMethod['${mId}'] must be a finite number in (0, 1], received ${String(w)}`,
            );
          } else {
            rawVals.push(w);
          }
        }
        if (rawVals.length === weightEntries.length) {
          const wSum = kahanNeumaierSum(rawVals);
          if (!Number.isFinite(wSum) || Math.abs(wSum - 1) > 1e-12) {
            diagnostics.push(
              `ForecastPipelineRequest.customWeightsByMethod weights must sum to 1 within 1e-12, received ${wSum}`,
            );
          }
        }
      }
    }
  }

  if (request.horizon !== undefined) {
    if (!isPlainObject(request.horizon)) {
      diagnostics.push(
        'ForecastPipelineRequest.horizon must be a non-null plain object',
      );
    } else {
      const hStarts = request.horizon.startsAt;
      const hEnds = request.horizon.endsAt;
      if (!isValidIsoDateTime(hStarts) || !isValidIsoDateTime(hEnds)) {
        diagnostics.push(
          `ForecastPipelineRequest.horizon startsAt and endsAt must be valid UTC ISO-8601 timestamps`,
        );
      } else {
        const sMs = parseIsoDateTimeMs(hStarts)!;
        const eMs = parseIsoDateTimeMs(hEnds)!;
        if (eMs <= sMs) {
          diagnostics.push(
            `ForecastPipelineRequest.horizon endsAt (${hEnds}) must be strictly after startsAt (${hStarts})`,
          );
        }
      }
      if (request.horizon.referenceTime !== undefined) {
        if (!isValidIsoDateTime(request.horizon.referenceTime)) {
          diagnostics.push(
            `ForecastPipelineRequest.horizon.referenceTime must be a valid UTC ISO-8601 timestamp`,
          );
        } else if (isValidIsoDateTime(hEnds)) {
          const rMs = parseIsoDateTimeMs(request.horizon.referenceTime)!;
          const eMs = parseIsoDateTimeMs(hEnds)!;
          if (rMs >= eMs) {
            diagnostics.push(
              `ForecastPipelineRequest.horizon.referenceTime (${request.horizon.referenceTime}) must be strictly before endsAt (${hEnds})`,
            );
          }
        }
      }
      if (
        request.horizon.hasPositiveExposureScaling !== undefined &&
        typeof request.horizon.hasPositiveExposureScaling !== 'boolean'
      ) {
        diagnostics.push(
          `ForecastPipelineRequest.horizon.hasPositiveExposureScaling must be a boolean when provided`,
        );
      }
    }
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
      executedAt,
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
    request.assumptions?.allowStructuralBaseline === true;

  const {
    report: evidenceAssessment,
    provenanceRecords: evidenceProvenance,
    preparedMethodInputs,
  } = assessCollectedEvidence({
    harvestResult,
    submittedEvidence: request.submittedEvidence ?? [],
    outcomeSpace,
    referenceTime,
    executedAt,
    question: resolution.rawQuery,
    ...(request.structuralSymmetryContract !== undefined
      ? { structuralSymmetryContract: request.structuralSymmetryContract }
      : {}),
    ...(request.structuralSymmetryPremise !== undefined
      ? { structuralSymmetryPremise: request.structuralSymmetryPremise }
      : {}),
    allowStructuralBaseline,
    ...(request.multiSourceCombinationJustifications !== undefined
      ? {
          multiSourceCombinationJustifications:
            request.multiSourceCombinationJustifications,
        }
      : {}),
    registry,
    ...(dependencies.evidenceVerifier !== undefined
      ? { evidenceVerifier: dependencies.evidenceVerifier }
      : {}),
    ...(dependencies.symmetryVerifier !== undefined
      ? { symmetryVerifier: dependencies.symmetryVerifier }
      : {}),
    ...(dependencies.combinationVerifier !== undefined
      ? { combinationVerifier: dependencies.combinationVerifier }
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
    survivingEvidenceOutputs.length > 0
  ) {
    const originalApplicableIds = new Set<string>(
      applicabilityPlan.evidenceDrivenApplicableMethodIds,
    );
    const providedKeys = Object.keys(effectiveCustomWeights);
    if (
      providedKeys.length !== originalApplicableIds.size ||
      !providedKeys.every((k) => originalApplicableIds.has(k))
    ) {
      throw new ForecastPipelineRequestError(
        `customWeightsByMethod keys [${providedKeys.join(', ')}] do not match applicable evidence-driven methodIds [${[...originalApplicableIds].join(', ')}]`,
      );
    }
    if (failedOrSkippedExecutableIds.size > 0) {
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
    executedAt,
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
