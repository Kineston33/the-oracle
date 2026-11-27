/**
 * THE ORACLE — Stage 2B-1: End-to-End Scientific Forecast Pipeline Integration
 *
 * Orchestrates the complete server-side scientific forecasting pipeline by
 * connecting the existing verified Stage 1 and Stage 2A infrastructure:
 *
 *   Step A: Question validation & canonical proposition identity resolution
 *   Step B: Verifiable external evidence collection (`EvidenceHarvester`)
 *   Step C: Evidence assessment & quantitative observation deduplication
 *   Step D: Deterministic scientific method applicability planning
 *   Step E: Isolated execution of applicable & implemented scientific methods
 *   Step F: Dependence-aware multi-method aggregation & forecast synthesis
 *
 * Scientific integrity guarantees:
 *   1. Never converts arbitrary text, article counts, source counts, or
 *      thematic relevance scores into statistical sample sizes, event
 *      frequencies, likelihoods, or sufficient statistics.
 *   2. Never treats AI-generated claims or unverified assertions as empirical
 *      evidence.
 *   3. Deduplicates multiple sources reporting the same historical event so
 *      shared media/scholarly coverage never inflates sample sizes, while
 *      preserving all source provenance records.
 *   4. Evaluates every registered method in `ScientificMethodRegistry`; never
 *      arbitrarily picks a single method and never executes inapplicable,
 *      deferred, or unimplemented (`registered-specification-only`) methods.
 *   5. Isolates individual method execution failures so a runtime or numerical
 *      error in one method does not silently invalidate unrelated methods.
 *   6. Keeps `structural-uniform-baseline` strictly separate from empirical
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
   1. Pipeline Status & Classification Enums
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

/* -------------------------------------------------------------------------
   2. Evidence Submission & Assessment Contracts (Step B & Step C)
   ------------------------------------------------------------------------- */

export interface EvidenceSourceCitation {
  readonly sourceId?: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt: IsoDateTime;
}

export interface BinaryHistoricalObservationRecord {
  /**
   * Canonical identifier of the underlying real-world trial or event.
   * Multiple records sharing the same `eventId` (for example, several news or
   * institutional sources reporting the same treaty vote or clinical trial)
   * are deduplicated into a single observation while preserving all sources.
   */
  readonly eventId: string;
  readonly outcome: 0 | 1 | 'success' | 'failure';
  readonly observedAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  /**
   * Optional exogenous non-negative observation weight for
   * `weighted-kish-effective-binomial`.
   */
  readonly weight?: number;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export interface PoissonEventObservationRecord {
  /**
   * Canonical identifier of the arrival event. Multiple sources reporting the
   * same incident are deduplicated into a single arrival event.
   */
  readonly eventId: string;
  readonly occurredAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export interface MultinomialHistoricalObservationRecord {
  /**
   * Canonical identifier of the categorical trial realization. Multiple sources
   * reporting the same realization are deduplicated into a single trial.
   */
  readonly eventId: string;
  readonly outcomeIndex: number;
  readonly observedAt: IsoDateTime;
  readonly publisher: string;
  readonly sourceUrl: string;
  readonly isAiGenerated?: boolean;
  readonly verifiedEmpirical?: boolean;
}

export type HistoricalObservationSchema =
  | {
      readonly kind: 'binary-trials';
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
      readonly eventOutcomeIndex: 0 | 1;
      readonly prior: {
        readonly shape: number;
        readonly rate: number;
      };
      readonly historicalExposure: {
        readonly exposureDuration: number;
        readonly exposureUnit: string;
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

export interface PipelineEvidenceProvenanceRecord {
  readonly evidenceId: string;
  readonly submittedCategory: AssessedEvidenceCategory;
  readonly effectiveCategory: AssessedEvidenceCategory;
  readonly origin: 'evidence-harvester' | 'caller-submission';
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

export interface DeduplicatedEventObservationDiagnostic {
  readonly evidenceId: string;
  readonly eventId: string;
  readonly rawReportCount: number;
  readonly deduplicatedCount: 0 | 1;
  readonly status: 'deduplicated-consistent' | 'quarantined-conflicting-outcomes';
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
  readonly unsupportedOrUnverifiedClaims: readonly PipelineEvidenceProvenanceRecord[];
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
   4. Internal Helpers & Deep Immutability
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

function isValidHttpUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

interface PreparedMethodExecutionBundle {
  readonly methodId: ExecutableScientificMethodId;
  readonly executionInput: ScientificMethodExecutionInput;
  readonly provenanceIds: readonly string[];
  readonly sourceUrls: readonly string[];
}

/* -------------------------------------------------------------------------
   5. Step C — Evidence Assessment & Deduplication Engine
   ------------------------------------------------------------------------- */

/**
 * Evaluates harvested documentary items and caller-submitted evidence records,
 * enforcing strict scientific separation between:
 *   - Documentary evidence (`documentary-evidence`)
 *   - Historical observations (`historical-observations`)
 *   - Structured numerical datasets (`structured-numerical-dataset`)
 *   - Statistical sufficient statistics (`statistical-sufficient-statistics`)
 *   - Unsupported or unverified claims (`unsupported-or-unverified-claim`)
 *
 * Never converts text, article counts, source counts, or relevance scores into
 * sample sizes, frequencies, likelihoods, or sufficient statistics.
 * Deduplicates multiple sources reporting the same historical event (`eventId`)
 * while preserving all reporting source citations.
 */
export function assessCollectedEvidence(params: {
  readonly harvestResult: EvidenceHarvestResult;
  readonly submittedEvidence: readonly PipelineEvidenceSubmission[];
  readonly outcomeSpace: OutcomeSpaceDescriptor;
  readonly referenceTime: IsoDateTime;
  readonly structuralSymmetryPremise?: StructuralUniformExecutionInput['symmetryPremise'];
  readonly allowStructuralBaseline: boolean;
  readonly registry: ScientificMethodRegistry;
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
  } = params;

  const referenceMs = parseIsoDateTimeMs(referenceTime)!;
  const outcomeCount = outcomeSpace.outcomeLabels.length;

  const documentaryEvidence: PipelineEvidenceProvenanceRecord[] = [];
  const historicalObservations: PipelineEvidenceProvenanceRecord[] = [];
  const structuredNumericalDatasets: PipelineEvidenceProvenanceRecord[] = [];
  const statisticalSufficientStatistics: PipelineEvidenceProvenanceRecord[] = [];
  const unsupportedOrUnverifiedClaims: PipelineEvidenceProvenanceRecord[] = [];
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

  // Deduplicate caller-submitted evidence by evidenceId while merging source citations:
  const seenSubmissionIds = new Set<string>();

  for (let idx = 0; idx < submittedEvidence.length; idx++) {
    const rawSub = submittedEvidence[idx];
    if (!isPlainObject(rawSub)) {
      throw new ForecastPipelineRequestError(
        `submittedEvidence[${idx}] must be a non-null object`,
      );
    }

    const evidenceId =
      typeof rawSub.evidenceId === 'string' && rawSub.evidenceId.trim().length > 0
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
        typeof sub.claimSummary === 'string' && sub.claimSummary.trim().length > 0
          ? sub.claimSummary.trim()
          : 'Unverified or unsupported claim';
      const originLabel = sub.origin ?? 'other';
      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: 'unsupported-or-unverified-claim',
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
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
      unsupportedOrUnverifiedClaims.push(record);
      allProvenanceRecords.push(record);
      assessmentNotes.push(record.assessmentNote);
      continue;
    }

    // Handle caller-submitted documentary-evidence:
    if (cat === 'documentary-evidence') {
      const sub = rawSub as DocumentaryEvidenceSubmission;
      const title =
        typeof sub.title === 'string' ? sub.title.trim() : '';
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
        !isValidHttpUrl(url) ||
        pubMs === null ||
        pubMs > referenceMs
      ) {
        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'documentary-evidence',
          effectiveCategory: 'unsupported-or-unverified-claim',
          origin: 'caller-submission',
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
            'Documentary submission lacked valid title, publisher, HTTP(S) URL, or chronological timestamp <= referenceTime and was downgraded to unsupported-or-unverified-claim.',
        });
        unsupportedOrUnverifiedClaims.push(record);
        allProvenanceRecords.push(record);
        assessmentNotes.push(record.assessmentNote);
        continue;
      }

      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: 'documentary-evidence',
        effectiveCategory: 'documentary-evidence',
        origin: 'caller-submission',
        title,
        publisher,
        url,
        publishedAt,
        retrievedAt: referenceTime,
        sourceProvider: 'caller:documentary',
        isPrimarySourceVerified: sub.isPrimarySourceVerified === true,
        usableForQuantitativeMethods: false,
        supportedMethodIds: Object.freeze([]),
        supportedDataChannels: Object.freeze([]),
        mergedSourceCitations: Object.freeze([
          Object.freeze({ publisher, url, publishedAt }),
        ]),
        assessmentNote:
          'Caller-submitted documentary evidence preserved for provenance; qualitative text is never converted into numerical likelihoods or sample sizes.',
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

    const rejectionReasons: string[] = [];
    if (qSub.isAiGenerated === true) {
      rejectionReasons.push(
        'AI-generated claims are not verified empirical evidence and cannot be used as statistical observations or sufficient statistics',
      );
    }
    if (qSub.derivedFromDocOrSourceCount === true) {
      rejectionReasons.push(
        'Counts derived from article counts or source counts cannot be treated as statistical sample sizes or event frequencies',
      );
    }
    if (qSub.derivedFromRelevanceScore === true) {
      rejectionReasons.push(
        'Values derived from thematic relevance scores cannot be treated as statistical weights, likelihoods, or sufficient statistics',
      );
    }
    if (qSub.verifiedEmpirical === false) {
      rejectionReasons.push(
        'Submission is explicitly marked verifiedEmpirical = false',
      );
    }
    if (title.length === 0 || publisher.length === 0 || !isValidHttpUrl(url)) {
      rejectionReasons.push(
        'Quantitative evidence requires non-empty title, publisher, and valid HTTP(S) provenance URL',
      );
    }
    if (pubMs === null || pubMs > referenceMs) {
      rejectionReasons.push(
        `Quantitative evidence requires a valid ISO-8601 publishedAt timestamp <= referenceTime (${referenceTime})`,
      );
    }

    if (rejectionReasons.length > 0) {
      const reasonText = `Rejected quantitative submission '${evidenceId}' (${cat}) into unsupported-or-unverified-claim: ${rejectionReasons.join('; ')}.`;
      const record: PipelineEvidenceProvenanceRecord = Object.freeze({
        evidenceId,
        submittedCategory: cat as AssessedEvidenceCategory,
        effectiveCategory: 'unsupported-or-unverified-claim',
        origin: 'caller-submission',
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

    if (qSub.lowConfidenceEvidence === true) {
      lowConfidenceEvidence = true;
    }

    const baseCitation: EvidenceSourceCitation = Object.freeze({
      publisher,
      url,
      publishedAt,
    });

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
          !isPlainObject(schema.prior) ||
          !Array.isArray(schema.observations)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') binary-trials schema requires successOutcomeIndex (0 | 1), prior { alpha, beta }, and observations array`,
          );
        }

        // Deduplicate by eventId so multiple sources reporting the same event
        // count as ONE trial, never multiple trials:
        const groupedByEvent = new Map<
          string,
          BinaryHistoricalObservationRecord[]
        >();
        for (const obs of schema.observations) {
          if (
            typeof obs !== 'object' ||
            obs === null ||
            typeof obs.eventId !== 'string' ||
            obs.eventId.trim().length === 0
          ) {
            continue;
          }
          if (obs.isAiGenerated === true || obs.verifiedEmpirical === false) {
            assessmentNotes.push(
              `Excluded unverified/AI-generated binary observation '${obs.eventId}' in '${evidenceId}'.`,
            );
            continue;
          }
          const obsMs = isValidIsoDateTime(obs.observedAt)
            ? parseIsoDateTimeMs(obs.observedAt)
            : null;
          if (obsMs === null || obsMs > referenceMs || !isValidHttpUrl(obs.sourceUrl)) {
            assessmentNotes.push(
              `Excluded binary observation '${obs.eventId}' in '${evidenceId}' due to invalid/future timestamp or invalid sourceUrl.`,
            );
            continue;
          }
          const evKey = obs.eventId.trim();
          const list = groupedByEvent.get(evKey) ?? [];
          list.push(obs);
          groupedByEvent.set(evKey, list);
        }

        let kSuccesses = 0;
        let kFailures = 0;
        const weights: number[] = [];
        const outcomes01: Array<0 | 1> = [];
        const mergedCitations: EvidenceSourceCitation[] = [baseCitation];
        const seenCitationUrls = new Set<string>([baseCitation.url]);

        for (const [evKey, reports] of groupedByEvent.entries()) {
          const mappedOutcomes = new Set<0 | 1>();
          const citationsForEvent: EvidenceSourceCitation[] = [];
          for (const r of reports) {
            const normOut: 0 | 1 =
              r.outcome === 1 || r.outcome === 'success' ? 1 : 0;
            mappedOutcomes.add(normOut);
            const c: EvidenceSourceCitation = Object.freeze({
              sourceId: evKey,
              publisher: r.publisher.trim(),
              url: r.sourceUrl.trim(),
              publishedAt: r.observedAt,
            });
            citationsForEvent.push(c);
          }

          if (mappedOutcomes.size > 1) {
            deduplicatedEventDiagnostics.push(
              Object.freeze({
                evidenceId,
                eventId: evKey,
                rawReportCount: reports.length,
                deduplicatedCount: 0,
                status: 'quarantined-conflicting-outcomes',
                reportingSources: Object.freeze(citationsForEvent),
                explanation: `Event '${evKey}' had ${reports.length} conflicting outcome reports across sources and was quarantined rather than guessed.`,
              }),
            );
            assessmentNotes.push(
              `Quarantined conflicting reports for eventId '${evKey}' in '${evidenceId}'.`,
            );
            continue;
          }

          if (reports.length > 1) {
            deduplicatedEventDiagnostics.push(
              Object.freeze({
                evidenceId,
                eventId: evKey,
                rawReportCount: reports.length,
                deduplicatedCount: 1,
                status: 'deduplicated-consistent',
                reportingSources: Object.freeze(citationsForEvent),
                explanation: `Deduplicated ${reports.length} consistent source reports for event '${evKey}' into 1 independent trial observation.`,
              }),
            );
          }

          for (const c of citationsForEvent) {
            if (!seenCitationUrls.has(c.url)) {
              seenCitationUrls.add(c.url);
              mergedCitations.push(c);
            }
          }

          const singleOutcome = [...mappedOutcomes][0]!;
          if (singleOutcome === 1) {
            kSuccesses += 1;
          } else {
            kFailures += 1;
          }
          outcomes01.push(singleOutcome);
          const w = reports[0]!.weight;
          if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
            weights.push(w);
          }
        }

        const totalValidTrials = kSuccesses + kFailures;
        if (totalValidTrials === 0) {
          const record: PipelineEvidenceProvenanceRecord = Object.freeze({
            evidenceId,
            submittedCategory: 'historical-observations',
            effectiveCategory: 'unsupported-or-unverified-claim',
            origin: 'caller-submission',
            title,
            publisher,
            url,
            publishedAt,
            retrievedAt: referenceTime,
            sourceProvider: 'caller:historical-observations',
            isPrimarySourceVerified: true,
            usableForQuantitativeMethods: false,
            supportedMethodIds: Object.freeze([]),
            supportedDataChannels: Object.freeze([]),
            mergedSourceCitations: Object.freeze(mergedCitations),
            assessmentNote:
              'Zero valid historical binary trial observations remained after provenance and conflict validation.',
          });
          unsupportedOrUnverifiedClaims.push(record);
          allProvenanceRecords.push(record);
          continue;
        }

        const itemMethods: ScientificMethodId[] = ['beta-binomial-conjugate'];
        const itemChannels: MethodDataChannelId[] = [
          'binary-trial-counts',
          'prior-hyperparameters',
        ];

        binaryTrialSuccesses = kSuccesses;
        binaryTrialFailures = kFailures;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('binary-trial-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('beta-binomial-conjugate');

        const betaInput: BetaBinomialExecutionInput = Object.freeze({
          methodId: 'beta-binomial-conjugate',
          outcomeSpace,
          successOutcomeIndex: schema.successOutcomeIndex,
          prior: Object.freeze({
            alpha: schema.prior.alpha,
            beta: schema.prior.beta,
          }),
          observed: Object.freeze({
            successes: kSuccesses,
            failures: kFailures,
          }),
          ...(schema.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: schema.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('beta-binomial-conjugate', {
          methodId: 'beta-binomial-conjugate',
          executionInput: betaInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze(mergedCitations.map((c) => c.url)),
        });

        // If weighted Kish channel is enabled and all deduplicated trials carry positive weights:
        if (
          schema.enableWeightedKishChannel === true &&
          weights.length === totalValidTrials &&
          totalValidTrials >= 2
        ) {
          let wSucc = 0;
          let wFail = 0;
          let sumSq = 0;
          for (let i = 0; i < totalValidTrials; i++) {
            const wi = weights[i]!;
            if (outcomes01[i] === 1) {
              wSucc += wi;
            } else {
              wFail += wi;
            }
            sumSq += wi * wi;
          }
          const totalW = wSucc + wFail;
          const nEff = sumSq > 0 ? (totalW * totalW) / sumSq : 0;
          weightedSampleSize = totalValidTrials;
          kishEffectiveSampleSize = nEff;
          availableChannelSet.add('weighted-binary-trials');
          availableChannelSet.add('kish-effective-sample-size');
          itemMethods.push('weighted-kish-effective-binomial');
          itemChannels.push(
            'weighted-binary-trials',
            'kish-effective-sample-size',
          );
          supportedMethodSet.add('weighted-kish-effective-binomial');

          const kishInput: WeightedKishExecutionInput = Object.freeze({
            methodId: 'weighted-kish-effective-binomial',
            outcomeSpace,
            successOutcomeIndex: schema.successOutcomeIndex,
            prior: Object.freeze({
              alpha: schema.prior.alpha,
              beta: schema.prior.beta,
            }),
            observed: Object.freeze({
              weightedSuccessMass: wSucc,
              weightedFailureMass: wFail,
              sumSquaredWeights: sumSq,
              observationCount: totalValidTrials,
            }),
            ...(schema.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: schema.credibleIntervalLevel }
              : {}),
          });
          preparedMethodInputs.set('weighted-kish-effective-binomial', {
            methodId: 'weighted-kish-effective-binomial',
            executionInput: kishInput,
            provenanceIds: Object.freeze([evidenceId]),
            sourceUrls: Object.freeze(mergedCitations.map((c) => c.url)),
          });
        }

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'historical-observations',
          origin: 'caller-submission',
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(itemMethods),
          supportedDataChannels: Object.freeze(itemChannels),
          mergedSourceCitations: Object.freeze(mergedCitations),
          assessmentNote: `Validated ${totalValidTrials} deduplicated binary historical trial(s) (k=${kSuccesses}, n-k=${kFailures}) from ${schema.observations.length} raw report(s).`,
        });
        historicalObservations.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (schema.kind === 'poisson-arrivals') {
        if (
          (schema.eventOutcomeIndex !== 0 && schema.eventOutcomeIndex !== 1) ||
          !isPlainObject(schema.prior) ||
          !isPlainObject(schema.historicalExposure) ||
          !isPlainObject(schema.forecastExposure) ||
          !Array.isArray(schema.events)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') poisson-arrivals schema is malformed`,
          );
        }

        const groupedEvents = new Map<string, PoissonEventObservationRecord[]>();
        for (const ev of schema.events) {
          if (
            typeof ev !== 'object' ||
            ev === null ||
            typeof ev.eventId !== 'string' ||
            ev.eventId.trim().length === 0
          ) {
            continue;
          }
          if (ev.isAiGenerated === true || ev.verifiedEmpirical === false) {
            continue;
          }
          const occMs = isValidIsoDateTime(ev.occurredAt)
            ? parseIsoDateTimeMs(ev.occurredAt)
            : null;
          if (occMs === null || occMs > referenceMs || !isValidHttpUrl(ev.sourceUrl)) {
            continue;
          }
          const key = ev.eventId.trim();
          const list = groupedEvents.get(key) ?? [];
          list.push(ev);
          groupedEvents.set(key, list);
        }

        const mergedCitations: EvidenceSourceCitation[] = [baseCitation];
        const seenUrls = new Set<string>([baseCitation.url]);
        for (const [evKey, reports] of groupedEvents.entries()) {
          const citationsForEvent: EvidenceSourceCitation[] = reports.map((r) =>
            Object.freeze({
              sourceId: evKey,
              publisher: r.publisher.trim(),
              url: r.sourceUrl.trim(),
              publishedAt: r.occurredAt,
            }),
          );
          if (reports.length > 1) {
            deduplicatedEventDiagnostics.push(
              Object.freeze({
                evidenceId,
                eventId: evKey,
                rawReportCount: reports.length,
                deduplicatedCount: 1,
                status: 'deduplicated-consistent',
                reportingSources: Object.freeze(citationsForEvent),
                explanation: `Deduplicated ${reports.length} source reports for arrival event '${evKey}' into 1 Poisson event arrival.`,
              }),
            );
          }
          for (const c of citationsForEvent) {
            if (!seenUrls.has(c.url)) {
              seenUrls.add(c.url);
              mergedCitations.push(c);
            }
          }
        }

        const dedupEventCount = groupedEvents.size;
        const histUnit = schema.historicalExposure.exposureUnit;
        const foreUnit = schema.forecastExposure.exposureUnit ?? histUnit;

        poissonEventCount = dedupEventCount;
        poissonExposureDuration = schema.historicalExposure.exposureDuration;
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('poisson-event-counts');
        availableChannelSet.add('continuous-exposure-duration');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('poisson-gamma-hazard');

        const poissonInput: PoissonGammaExecutionInput = Object.freeze({
          methodId: 'poisson-gamma-hazard',
          outcomeSpace,
          eventOutcomeIndex: schema.eventOutcomeIndex,
          prior: Object.freeze({
            shape: schema.prior.shape,
            rate: schema.prior.rate,
            parameterization: 'shape-rate' as const,
          }),
          observed: Object.freeze({
            eventCount: dedupEventCount,
            exposureDuration: schema.historicalExposure.exposureDuration,
            exposureUnit: histUnit,
          }),
          forecast: Object.freeze({
            exposureDuration: schema.forecastExposure.exposureDuration,
            exposureUnit: foreUnit,
          }),
          exposureUnit: histUnit,
          ...(schema.credibleIntervalLevel !== undefined
            ? { credibleIntervalLevel: schema.credibleIntervalLevel }
            : {}),
        });
        preparedMethodInputs.set('poisson-gamma-hazard', {
          methodId: 'poisson-gamma-hazard',
          executionInput: poissonInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze(mergedCitations.map((c) => c.url)),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'historical-observations',
          origin: 'caller-submission',
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
          supportedDataChannels: Object.freeze([
            'poisson-event-counts',
            'continuous-exposure-duration',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze(mergedCitations),
          assessmentNote: `Validated ${dedupEventCount} deduplicated Poisson arrival event(s) over exposure T=${schema.historicalExposure.exposureDuration} ${histUnit}.`,
        });
        historicalObservations.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (schema.kind === 'multinomial-trials') {
        if (
          !isPlainObject(schema.prior) ||
          !Array.isArray(schema.prior.alpha) ||
          !Array.isArray(schema.observations)
        ) {
          throw new ForecastPipelineRequestError(
            `submittedEvidence[${idx}] ('${evidenceId}') multinomial-trials schema is malformed`,
          );
        }

        const groupedByEvent = new Map<
          string,
          MultinomialHistoricalObservationRecord[]
        >();
        for (const obs of schema.observations) {
          if (
            typeof obs !== 'object' ||
            obs === null ||
            typeof obs.eventId !== 'string' ||
            obs.eventId.trim().length === 0
          ) {
            continue;
          }
          if (obs.isAiGenerated === true || obs.verifiedEmpirical === false) {
            continue;
          }
          const obsMs = isValidIsoDateTime(obs.observedAt)
            ? parseIsoDateTimeMs(obs.observedAt)
            : null;
          if (
            obsMs === null ||
            obsMs > referenceMs ||
            !isValidHttpUrl(obs.sourceUrl) ||
            !Number.isSafeInteger(obs.outcomeIndex) ||
            obs.outcomeIndex < 0 ||
            obs.outcomeIndex >= outcomeCount
          ) {
            continue;
          }
          const key = obs.eventId.trim();
          const list = groupedByEvent.get(key) ?? [];
          list.push(obs);
          groupedByEvent.set(key, list);
        }

        const counts = new Array<number>(outcomeCount).fill(0);
        const mergedCitations: EvidenceSourceCitation[] = [baseCitation];
        const seenUrls = new Set<string>([baseCitation.url]);

        for (const [evKey, reports] of groupedByEvent.entries()) {
          const outcomeIndices = new Set<number>(
            reports.map((r) => r.outcomeIndex),
          );
          const citationsForEvent: EvidenceSourceCitation[] = reports.map((r) =>
            Object.freeze({
              sourceId: evKey,
              publisher: r.publisher.trim(),
              url: r.sourceUrl.trim(),
              publishedAt: r.observedAt,
            }),
          );
          if (outcomeIndices.size > 1) {
            deduplicatedEventDiagnostics.push(
              Object.freeze({
                evidenceId,
                eventId: evKey,
                rawReportCount: reports.length,
                deduplicatedCount: 0,
                status: 'quarantined-conflicting-outcomes',
                reportingSources: Object.freeze(citationsForEvent),
                explanation: `Multinomial event '${evKey}' had conflicting category indices across ${reports.length} reports and was quarantined.`,
              }),
            );
            continue;
          }
          if (reports.length > 1) {
            deduplicatedEventDiagnostics.push(
              Object.freeze({
                evidenceId,
                eventId: evKey,
                rawReportCount: reports.length,
                deduplicatedCount: 1,
                status: 'deduplicated-consistent',
                reportingSources: Object.freeze(citationsForEvent),
                explanation: `Deduplicated ${reports.length} source reports for categorical event '${evKey}' into 1 multinomial observation.`,
              }),
            );
          }
          for (const c of citationsForEvent) {
            if (!seenUrls.has(c.url)) {
              seenUrls.add(c.url);
              mergedCitations.push(c);
            }
          }
          const catIdx = [...outcomeIndices][0]!;
          counts[catIdx] = (counts[catIdx] ?? 0) + 1;
        }

        const totalCount = counts.reduce((a, b) => a + b, 0);
        if (totalCount === 0) {
          const record: PipelineEvidenceProvenanceRecord = Object.freeze({
            evidenceId,
            submittedCategory: 'historical-observations',
            effectiveCategory: 'unsupported-or-unverified-claim',
            origin: 'caller-submission',
            title,
            publisher,
            url,
            publishedAt,
            retrievedAt: referenceTime,
            sourceProvider: 'caller:historical-observations',
            isPrimarySourceVerified: true,
            usableForQuantitativeMethods: false,
            supportedMethodIds: Object.freeze([]),
            supportedDataChannels: Object.freeze([]),
            mergedSourceCitations: Object.freeze(mergedCitations),
            assessmentNote:
              'Zero valid categorical observations remained after provenance and conflict validation.',
          });
          unsupportedOrUnverifiedClaims.push(record);
          allProvenanceRecords.push(record);
          continue;
        }

        multinomialOutcomeCounts = Object.freeze([...counts]);
        hasVerifiableEmpiricalData = true;
        availableChannelSet.add('multinomial-category-counts');
        availableChannelSet.add('prior-hyperparameters');
        supportedMethodSet.add('dirichlet-multinomial-symmetry');

        const dirichletInput: DirichletMultinomialExecutionInput =
          Object.freeze({
            methodId: 'dirichlet-multinomial-symmetry',
            outcomeSpace,
            prior: Object.freeze({
              alpha: Object.freeze([...schema.prior.alpha]),
            }),
            observed: Object.freeze({
              counts: Object.freeze([...counts]),
            }),
            ...(schema.credibleIntervalLevel !== undefined
              ? { credibleIntervalLevel: schema.credibleIntervalLevel }
              : {}),
          });
        preparedMethodInputs.set('dirichlet-multinomial-symmetry', {
          methodId: 'dirichlet-multinomial-symmetry',
          executionInput: dirichletInput,
          provenanceIds: Object.freeze([evidenceId]),
          sourceUrls: Object.freeze(mergedCitations.map((c) => c.url)),
        });

        const record: PipelineEvidenceProvenanceRecord = Object.freeze({
          evidenceId,
          submittedCategory: 'historical-observations',
          effectiveCategory: 'historical-observations',
          origin: 'caller-submission',
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:historical-observations',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'dirichlet-multinomial-symmetry',
          ] as const),
          supportedDataChannels: Object.freeze([
            'multinomial-category-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze(mergedCitations),
          assessmentNote: `Validated ${totalCount} deduplicated multinomial observation(s) across ${outcomeCount} categories ([${counts.join(', ')}]).`,
        });
        historicalObservations.push(record);
        allProvenanceRecords.push(record);
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured binary cohort dataset (successes=${ds.successes}, failures=${ds.failures}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'weighted-binary-cohort-table') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: true,
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
          assessmentNote: `Validated structured weighted binary cohort dataset (n=${ds.observationCount}, n_eff=${nEff.toFixed(4)}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'poisson-exposure-table') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
          supportedDataChannels: Object.freeze([
            'poisson-event-counts',
            'continuous-exposure-duration',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured Poisson exposure dataset (k=${ds.eventCount}, T=${ds.exposureDuration} ${ds.exposureUnit}).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'multinomial-contingency-table') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'dirichlet-multinomial-symmetry',
          ] as const),
          supportedDataChannels: Object.freeze([
            'multinomial-category-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated structured multinomial contingency table ([${ds.counts.join(', ')}]).`,
        });
        structuredNumericalDatasets.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (ds.kind === 'continuous-state-trajectory-table') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:structured-numerical-dataset',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(methods),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous state trajectory dataset (n=${ds.observationCount}, drift=${ds.estimatedDrift}, scale=${ds.estimatedScaleOrVolatility}).`,
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['beta-binomial-conjugate'] as const),
          supportedDataChannels: Object.freeze([
            'binary-trial-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Beta-Binomial sufficient statistics (successes=${stats.successes}, failures=${stats.failures}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'weighted-kish-effective-binomial') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: true,
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
          assessmentNote: `Validated Kish weighted binomial sufficient statistics (n=${stats.observationCount}, n_eff=${nEff.toFixed(4)}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'poisson-gamma-hazard') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze(['poisson-gamma-hazard'] as const),
          supportedDataChannels: Object.freeze([
            'poisson-event-counts',
            'continuous-exposure-duration',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Poisson-Gamma sufficient statistics (k=${stats.eventCount}, T=${stats.exposureDuration} ${stats.exposureUnit}).`,
        });
        statisticalSufficientStatistics.push(record);
        allProvenanceRecords.push(record);
        continue;
      }

      if (stats.targetMethodId === 'dirichlet-multinomial-symmetry') {
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([
            'dirichlet-multinomial-symmetry',
          ] as const),
          supportedDataChannels: Object.freeze([
            'multinomial-category-counts',
            'prior-hyperparameters',
          ] as const),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated Dirichlet-Multinomial sufficient statistics ([${stats.counts.join(', ')}]).`,
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
          title,
          publisher,
          url,
          publishedAt,
          retrievedAt: referenceTime,
          sourceProvider: 'caller:statistical-sufficient-statistics',
          isPrimarySourceVerified: true,
          usableForQuantitativeMethods: true,
          supportedMethodIds: Object.freeze([stats.targetMethodId]),
          supportedDataChannels: Object.freeze(channels),
          mergedSourceCitations: Object.freeze([baseCitation]),
          assessmentNote: `Validated continuous diffusion/barrier sufficient statistics for '${stats.targetMethodId}' (n=${stats.continuousTrajectoryObservations}).`,
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
        `Method '${desc.methodId}' requires verified quantitative empirical evidence (documentary evidence or unverified claims cannot substitute for empirical observations)`,
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
    unsupportedOrUnverifiedClaims: Object.freeze(unsupportedOrUnverifiedClaims),
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

  // Filter availableChannels so failed methods' exclusive channels are removed
  // when rebuilding dependenceDiagnostics, then patch evaluatedMethods:
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
    if (rec.applicable && failedOrSkippedExecutableMethodIds.has(rec.methodId)) {
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

  // Filter connectedComponents and unlinkedSelectedEvidenceMethodIds to surviving applicable methods:
  const survivingEvidenceSet = new Set<ScientificMethodId>(
    evidenceDrivenApplicableMethodIds,
  );
  const survivingApplicableSet = new Set<ScientificMethodId>(
    applicableMethods.map((m) => m.methodId),
  );

  // Rebuild dependenceDiagnostics over surviving methods by invoking planMethodApplicability
  // with channels restricted to surviving methods, or filtering originalPlan.dependenceDiagnostics:
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

  // If beta-binomial-conjugate failed while weighted-kish survived (both share binary channels),
  // filter originalPlan.dependenceDiagnostics directly to surviving evidence methods:
  const filteredComponents = originalPlan.dependenceDiagnostics.connectedComponents
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
 *   Step C: Evidence assessment & event deduplication
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
      hasPositiveExposureScaling: true,
    });

  if (
    horizon.startsAt !== outcomeSpace.horizonStartsAt ||
    horizon.endsAt !== outcomeSpace.horizonEndsAt
  ) {
    throw new ForecastPipelineRequestError(
      `ForecastPipelineRequest.horizon ([${horizon.startsAt}, ${horizon.endsAt}]) must match outcomeSpace horizon ([${outcomeSpace.horizonStartsAt}, ${outcomeSpace.horizonEndsAt}])`,
    );
  }

  const questionIdentity: PipelineQuestionIdentityReport = Object.freeze({
    rawQuestion: resolution.rawQuery,
    normalizedQuestion: resolution.normalizedQuery,
    canonicalQuestion: resolution.draftCanonicalQuestion,
    questionId,
    questionCategory: effectiveCategory,
    ...(request.subdomain !== undefined ? { subdomain: request.subdomain } : {}),
    identity: resolution.identity,
    identityDigest: resolution.identityDigest,
    identityComplete: resolution.identityComplete,
    unresolvedComponents: Object.freeze([...resolution.unresolvedComponents]),
    resolution,
  });

  /* -----------------------------------------------------------------------
     Step B: Evidence collection (`EvidenceHarvester`)
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
     Step C: Evidence assessment & quantitative observation deduplication
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
    ...(request.subdomain !== undefined ? { subdomain: request.subdomain } : {}),
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

    // Applicable method: check whether it has a verified executable implementation:
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

    // Applicable & implemented method: check prepared execution input bundle:
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

    // Execute method inside an isolated try/catch boundary:
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

    // Validate output distribution & outcomeSpace coherence in an isolated try/catch boundary:
    try {
      validateExhaustiveDistribution(executedOutput.outcomes, outcomeSpace.outcomeLabels.length);
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

  // Determine honest footingTier when evidence-driven methods succeeded:
  let synthesisFootingTier: EvidentialFootingTier | undefined =
    request.footingTier;
  if (survivingEvidenceOutputs.length > 0 && synthesisFootingTier === undefined) {
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

  // Determine appropriate abstentionReason if no executable methods succeeded:
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

  // If customWeightsByMethod was provided but some methods failed in Step E,
  // renormalize custom weights over surviving evidence methods if positive:
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

  // Determine overall PipelineExecutionStatus and ForecastKind:
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

  // Merge missing requirements across question identity, planner, and evidence assessment:
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
