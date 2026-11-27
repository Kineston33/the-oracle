/**
 * THE ORACLE — Stage 2A-2.1 / 2A-2.2: Scientific Method Registry
 *
 * Maintains a deterministic, deeply immutable catalog of scientific and
 * mathematical forecasting methods, their statistical assumptions, input
 * data channels, outcome-space compatibility, horizon conditions,
 * computational cost profiles, epistemological claim classifications,
 * dependence/correlation structures, and truthful implementation status.
 *
 * Architectural boundaries:
 *   1. Specification vs. execution honesty: in Stage 2A-2.2, the five
 *      foundational descriptors (`beta-binomial-conjugate`,
 *      `weighted-kish-effective-binomial`, `poisson-gamma-hazard`,
 *      `dirichlet-multinomial-symmetry`, and `structural-uniform-baseline`)
 *      have verified executable adapters (`hasExecutableImplementation: true`,
 *      `implementationStatus: 'implemented-and-verified'`), while the two
 *      continuous diffusion / barrier descriptors (`student-t-terminal-diffusion`
 *      and `first-passage-barrier-diffusion`) remain explicitly unimplemented
 *      (`hasExecutableImplementation: false`,
 *      `implementationStatus: 'registered-specification-only'`).
 *   2. Deep immutability & strict validation: the default registry and any
 *      custom registry constructed via `createScientificMethodRegistry` are
 *      recursively frozen (`Object.freeze`) and reject duplicate method
 *      identifiers, self-referential or duplicate `correlatedWithMethodIds`
 *      entries, dangling references to unregistered methods, and asymmetric
 *      (non-reciprocal) `correlatedWithMethodIds` declarations.
 *   3. Dependence transparency: every method declares its `correlationGroupId`,
 *      `sharedInformationChannels`, `sharedLatentAssumptions`, and reciprocal
 *      `correlatedWithMethodIds` links so downstream stages never mistake
 *      correlated or algebraically related methods (such as binary
 *      `beta-binomial-conjugate` and 2-category `dirichlet-multinomial-symmetry`)
 *      for independent empirical evidence.
 *   4. No artificial horizon cutoffs: horizon constraints are declared only
 *      where mathematically required by the underlying stochastic process
 *      (such as positive time-exposure scaling for continuous-time hazard and
 *      diffusion models).
 */

import type { PredictionCategory } from '../data/types.ts';
import {
  EPISTEMOLOGICAL_TAG_BY_KIND,
  OUTCOME_SPACE_KINDS,
  type CoreScientificMethodId,
  type EpistemologicalClaimDescriptor,
  type EpistemologicalClaimKind,
  type OutcomeSpaceKind,
  type ScientificMethodId,
  type ScientificMethodOutput,
} from './forecast-types.ts';

export const SCIENTIFIC_METHOD_REGISTRY_VERSION = '2A-2.2.0' as const;

export const PREDICTION_CATEGORIES: readonly PredictionCategory[] = Object.freeze([
  'geopolitics',
  'technology',
  'climate',
  'economy',
  'science',
  'health',
  'society',
  'space',
]);

export const CORE_SCIENTIFIC_METHOD_IDS: readonly CoreScientificMethodId[] = Object.freeze([
  'beta-binomial-conjugate',
  'weighted-kish-effective-binomial',
  'poisson-gamma-hazard',
  'dirichlet-multinomial-symmetry',
  'student-t-terminal-diffusion',
  'first-passage-barrier-diffusion',
  'structural-uniform-baseline',
]);

export type ScientificMethodFamily = ScientificMethodOutput['methodFamily'];

export const SCIENTIFIC_METHOD_FAMILIES: readonly ScientificMethodFamily[] = Object.freeze([
  'conjugate-discrete-frequency',
  'weighted-effective-sample',
  'continuous-time-hazard',
  'categorical-exchangeable-symmetry',
  'continuous-stochastic-diffusion',
  'first-passage-boundary',
  'structural-baseline',
  'custom-scientific-method',
]);

export type ScientificMethodRole =
  | 'evidence-driven-model'
  | 'structural-symmetry-baseline';

export type MethodImplementationStatus =
  | 'registered-specification-only'
  | 'planned-not-implemented'
  | 'implemented-and-verified';

export const METHOD_IMPLEMENTATION_STATUSES: readonly MethodImplementationStatus[] =
  Object.freeze([
    'registered-specification-only',
    'planned-not-implemented',
    'implemented-and-verified',
  ]);

/**
 * Canonical input data channels consumed by forecasting methods.
 */
export type MethodDataChannelId =
  | 'binary-trial-counts'
  | 'weighted-binary-trials'
  | 'kish-effective-sample-size'
  | 'poisson-event-counts'
  | 'continuous-exposure-duration'
  | 'multinomial-category-counts'
  | 'continuous-state-trajectory'
  | 'drift-and-scale-estimates'
  | 'tail-degrees-of-freedom'
  | 'absorbing-barrier-specification'
  | 'prior-hyperparameters'
  | 'outcome-partition-symmetry';

export const METHOD_DATA_CHANNEL_IDS: readonly MethodDataChannelId[] = Object.freeze([
  'binary-trial-counts',
  'weighted-binary-trials',
  'kish-effective-sample-size',
  'poisson-event-counts',
  'continuous-exposure-duration',
  'multinomial-category-counts',
  'continuous-state-trajectory',
  'drift-and-scale-estimates',
  'tail-degrees-of-freedom',
  'absorbing-barrier-specification',
  'prior-hyperparameters',
  'outcome-partition-symmetry',
]);

/**
 * Canonical statistical or mathematical assumptions required by registered methods.
 */
export type MethodAssumptionId =
  | 'exchangeable-bernoulli-trials'
  | 'stationary-success-probability'
  | 'non-negative-importance-weights'
  | 'kish-effective-sample-adequacy'
  | 'conditionally-independent-poisson-increments'
  | 'homogeneous-or-known-exposure-intensity'
  | 'exchangeable-multinomial-trials'
  | 'exhaustive-mutually-exclusive-categories'
  | 'stationary-heavy-tailed-increments'
  | 'student-t-terminal-innovation-law'
  | 'continuous-sample-path-no-jump-overshoot'
  | 'constant-drift-and-volatility-to-horizon'
  | 'reflection-principle-absorbing-barrier'
  | 'principle-of-indifference-partition-symmetry';

export const METHOD_ASSUMPTION_IDS: readonly MethodAssumptionId[] = Object.freeze([
  'exchangeable-bernoulli-trials',
  'stationary-success-probability',
  'non-negative-importance-weights',
  'kish-effective-sample-adequacy',
  'conditionally-independent-poisson-increments',
  'homogeneous-or-known-exposure-intensity',
  'exchangeable-multinomial-trials',
  'exhaustive-mutually-exclusive-categories',
  'stationary-heavy-tailed-increments',
  'student-t-terminal-innovation-law',
  'continuous-sample-path-no-jump-overshoot',
  'constant-drift-and-volatility-to-horizon',
  'reflection-principle-absorbing-barrier',
  'principle-of-indifference-partition-symmetry',
]);

export type AssumptionVerificationMode =
  | 'empirical-testable'
  | 'structural-axiomatic'
  | 'domain-modeling-premise';

export interface MethodAssumptionDescriptor {
  readonly id: MethodAssumptionId;
  readonly description: string;
  readonly mandatory: boolean;
  readonly verificationMode: AssumptionVerificationMode;
}

/**
 * Explicit canonical token declaring that a method descriptor applies
 * universally across all scientific subdomains within its declared
 * `applicableCategories`.
 *
 * Universal subdomain applicability is NEVER inferred from an empty array
 * or from arbitrary strings (such as `'all'`, `'any'`, `'universal'`, or `'wildcard'`).
 */
export const UNIVERSAL_SUBDOMAIN_TOKEN = '*' as const;

/**
 * Ambiguous pseudo-wildcard tokens that must never be used or inferred as
 * universal subdomain declarations.
 */
export const FORBIDDEN_PSEUDO_WILDCARD_SUBDOMAINS: readonly string[] = Object.freeze([
  'all',
  'any',
  'universal',
  'wildcard',
  'default',
  'none',
  '**',
]);

export interface MethodDomainDescriptor {
  readonly applicableCategories: readonly PredictionCategory[];
  readonly applicableSubdomains: readonly string[];
  /**
   * When `true` (or when `applicableSubdomains` explicitly includes
   * `UNIVERSAL_SUBDOMAIN_TOKEN` `'*'`), the method is explicitly declared
   * applicable across all subdomains within its `applicableCategories`,
   * including when `input.subdomain` is omitted.
   */
  readonly universalSubdomainApplicability?: boolean;
  readonly mathematicalParadigm: string;
}

export interface MethodMinimumInputConditions {
  readonly requiresVerifiableEmpiricalEvidence: boolean;
  readonly minTotalObservations?: number;
  readonly minEffectiveSampleSize?: number;
  readonly requiresPositiveExposureDuration?: boolean;
  readonly requiresPositiveScaleOrVolatility?: boolean;
  readonly minDegreesOfFreedom?: number;
  readonly maxDegreesOfFreedom?: number;
  readonly requiresInitialStateStrictlyOutsideBarrier?: boolean;
  readonly recommendedMinObservationsForHighConfidence: number;
}

export interface MethodDataRequirementsDescriptor {
  readonly requiredInputChannels: readonly MethodDataChannelId[];
  readonly optionalInputChannels: readonly MethodDataChannelId[];
  readonly minimumConditions: MethodMinimumInputConditions;
}

export interface MethodOutcomeSpaceCompatibility {
  readonly supportedKinds: readonly OutcomeSpaceKind[];
  readonly minOutcomes: number;
  readonly maxOutcomes: number | null;
  readonly requiresPartitionThresholds: boolean;
  readonly requiresBarrierSpecification: boolean;
}

export interface HorizonConstraintDescriptor {
  /**
   * True only when the mathematical model imposes an explicit minimum or
   * maximum horizon duration `[minHorizonMs, maxHorizonMs]`.
   * Per Principle F, arbitrary calendar horizon cutoffs are forbidden.
   */
  readonly constrained: boolean;
  readonly minHorizonMs?: number;
  readonly maxHorizonMs?: number;
  /**
   * True when the model's rate, drift, or volatility parameters scale with
   * continuous elapsed time `Delta_t = horizonEndsAt - horizonStartsAt > 0`.
   */
  readonly requiresPositiveExposureRateScaling: boolean;
  readonly scientificJustification: string;
}

export type ComputationalComplexityClass =
  | 'O(1)-closed-form'
  | 'O(K)-categorical-closed-form'
  | 'O(N)-weighted-aggregation'
  | 'O(I)-iterative-special-function'
  | 'O(M*I)-quadrature-or-series';

export type ComputationalCostTier = 'low' | 'moderate' | 'high';

export interface ComputationalCostProfile {
  readonly complexityClass: ComputationalComplexityClass;
  readonly costTier: ComputationalCostTier;
  readonly requiresIterativeSpecialFunctions: boolean;
  readonly deterministic: true;
  readonly maxMemoryKbEstimate: number;
}

export interface MethodDependenceProfile {
  readonly correlationGroupId: string;
  readonly sharedInformationChannels: readonly MethodDataChannelId[];
  readonly sharedLatentAssumptions: readonly MethodAssumptionId[];
  readonly correlatedWithMethodIds: readonly ScientificMethodId[];
  readonly independenceWarning: string;
}

export interface ScientificMethodDescriptor {
  readonly methodId: ScientificMethodId;
  readonly name: string;
  readonly summary: string;
  readonly methodFamily: ScientificMethodFamily;
  readonly role: ScientificMethodRole;
  readonly domain: MethodDomainDescriptor;
  readonly requiredData: MethodDataRequirementsDescriptor;
  readonly outcomeSpaceCompatibility: MethodOutcomeSpaceCompatibility;
  readonly requiredAssumptions: readonly MethodAssumptionDescriptor[];
  readonly horizonConstraints: HorizonConstraintDescriptor;
  readonly computationalProfile: ComputationalCostProfile;
  readonly epistemologicalClaims: readonly EpistemologicalClaimDescriptor[];
  readonly knownLimitations: readonly string[];
  readonly failureConditions: readonly string[];
  readonly dependenceProfile: MethodDependenceProfile;
  readonly hasExecutableImplementation: boolean;
  readonly implementationStatus: MethodImplementationStatus;
}

export interface ScientificMethodRegistry {
  readonly version: string;
  readonly size: number;
  readonly methodIds: readonly ScientificMethodId[];
  readonly descriptors: readonly ScientificMethodDescriptor[];
  get(methodId: ScientificMethodId): ScientificMethodDescriptor | undefined;
  getOrThrow(methodId: ScientificMethodId): ScientificMethodDescriptor;
  has(methodId: string): boolean;
  listAll(): readonly ScientificMethodDescriptor[];
  listByFamily(family: ScientificMethodFamily): readonly ScientificMethodDescriptor[];
  listByOutcomeSpaceKind(kind: OutcomeSpaceKind): readonly ScientificMethodDescriptor[];
  listByCorrelationGroup(correlationGroupId: string): readonly ScientificMethodDescriptor[];
}

/* -------------------------------------------------------------------------
   Deep freeze & runtime validation helpers
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

export function isValidScientificMethodId(value: unknown): value is ScientificMethodId {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    return false;
  }
  if ((CORE_SCIENTIFIC_METHOD_IDS as readonly string[]).includes(value)) {
    return true;
  }
  if (value.startsWith('custom:')) {
    const suffix = value.slice('custom:'.length);
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suffix);
  }
  return false;
}

/**
 * Validates whether a string is a canonical scientific subdomain identifier
 * (kebab-case alphanumeric slug that is not a forbidden pseudo-wildcard).
 * Does NOT accept `UNIVERSAL_SUBDOMAIN_TOKEN` (`'*'`); use
 * `hasUniversalSubdomainApplicability` for descriptor wildcard inspection.
 */
export function isValidSubdomainIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    return false;
  }
  if (value === UNIVERSAL_SUBDOMAIN_TOKEN) {
    return false;
  }
  if (FORBIDDEN_PSEUDO_WILDCARD_SUBDOMAINS.includes(value.toLowerCase())) {
    return false;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/**
 * Returns `true` if and only if a validated `MethodDomainDescriptor` explicitly
 * declares universal subdomain applicability via `universalSubdomainApplicability: true`
 * or by including `UNIVERSAL_SUBDOMAIN_TOKEN` (`'*'`) in a non-empty
 * `applicableSubdomains` array.
 *
 * Never infers universal applicability from an empty array or arbitrary strings.
 */
export function hasUniversalSubdomainApplicability(
  domain: MethodDomainDescriptor,
): boolean {
  if (
    !domain ||
    !Array.isArray(domain.applicableSubdomains) ||
    domain.applicableSubdomains.length === 0
  ) {
    return false;
  }
  return (
    domain.universalSubdomainApplicability === true ||
    domain.applicableSubdomains.includes(UNIVERSAL_SUBDOMAIN_TOKEN)
  );
}

function assertNonEmptyTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new RangeError(
      `${fieldName} must be a non-empty trimmed string, received ${String(value)}`,
    );
  }
  return value;
}

function assertNonEmptyStringArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues?: readonly T[],
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RangeError(`${fieldName} must be a non-empty array`);
  }
  const seen = new Set<string>();
  const copy: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = assertNonEmptyTrimmedString(value[i], `${fieldName}[${i}]`);
    if (allowedValues !== undefined && !(allowedValues as readonly string[]).includes(item)) {
      throw new RangeError(
        `${fieldName}[${i}] ('${item}') is not one of [${allowedValues.join(', ')}]`,
      );
    }
    if (seen.has(item)) {
      throw new RangeError(`${fieldName} contains duplicate entry '${item}'`);
    }
    seen.add(item);
    copy.push(item as T);
  }
  return Object.freeze(copy);
}

function assertOptionalStringArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues?: readonly T[],
): readonly T[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${fieldName} must be an array`);
  }
  const seen = new Set<string>();
  const copy: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = assertNonEmptyTrimmedString(value[i], `${fieldName}[${i}]`);
    if (allowedValues !== undefined && !(allowedValues as readonly string[]).includes(item)) {
      throw new RangeError(
        `${fieldName}[${i}] ('${item}') is not one of [${allowedValues.join(', ')}]`,
      );
    }
    if (seen.has(item)) {
      throw new RangeError(`${fieldName} contains duplicate entry '${item}'`);
    }
    seen.add(item);
    copy.push(item as T);
  }
  return Object.freeze(copy);
}

/**
 * Validates at runtime that a `ScientificMethodDescriptor` is structurally,
 * mathematically, and epistemologically coherent, and returns a deeply frozen
 * clone.
 */
export function validateScientificMethodDescriptor(
  value: unknown,
): ScientificMethodDescriptor {
  if (!isPlainObject(value)) {
    throw new RangeError('ScientificMethodDescriptor must be a non-null object');
  }

  const methodId = value.methodId;
  if (!isValidScientificMethodId(methodId)) {
    throw new RangeError(
      `Invalid ScientificMethodDescriptor.methodId '${String(methodId)}': must be a core method ID or 'custom:<kebab-case-id>'`,
    );
  }

  const name = assertNonEmptyTrimmedString(value.name, `${methodId}.name`);
  const summary = assertNonEmptyTrimmedString(value.summary, `${methodId}.summary`);

  const methodFamily = value.methodFamily;
  if (
    typeof methodFamily !== 'string' ||
    !(SCIENTIFIC_METHOD_FAMILIES as readonly string[]).includes(methodFamily)
  ) {
    throw new RangeError(
      `${methodId}.methodFamily must be a valid ScientificMethodFamily, received ${String(methodFamily)}`,
    );
  }

  const role = value.role;
  if (role !== 'evidence-driven-model' && role !== 'structural-symmetry-baseline') {
    throw new RangeError(
      `${methodId}.role must be 'evidence-driven-model' or 'structural-symmetry-baseline', received ${String(role)}`,
    );
  }

  if (methodId === 'structural-uniform-baseline' && role !== 'structural-symmetry-baseline') {
    throw new RangeError(
      `structural-uniform-baseline must have role 'structural-symmetry-baseline'`,
    );
  }
  if (methodId !== 'structural-uniform-baseline' && methodFamily === 'structural-baseline' && role !== 'structural-symmetry-baseline') {
    throw new RangeError(
      `${methodId} with family 'structural-baseline' must have role 'structural-symmetry-baseline'`,
    );
  }

  // Domain validation
  if (!isPlainObject(value.domain)) {
    throw new RangeError(`${methodId}.domain must be an object`);
  }
  const applicableCategories = assertNonEmptyStringArray(
    value.domain.applicableCategories,
    `${methodId}.domain.applicableCategories`,
    PREDICTION_CATEGORIES,
  );
  const applicableSubdomains = assertNonEmptyStringArray(
    value.domain.applicableSubdomains,
    `${methodId}.domain.applicableSubdomains`,
  );
  for (let i = 0; i < applicableSubdomains.length; i++) {
    const sub = applicableSubdomains[i]!;
    if (sub !== UNIVERSAL_SUBDOMAIN_TOKEN && !isValidSubdomainIdentifier(sub)) {
      throw new RangeError(
        `${methodId}.domain.applicableSubdomains[${i}] ('${sub}') must be a canonical kebab-case subdomain identifier or UNIVERSAL_SUBDOMAIN_TOKEN ('*'); arbitrary or pseudo-wildcard strings are forbidden`,
      );
    }
  }
  const universalSubdomainApplicability = value.domain.universalSubdomainApplicability;
  if (
    universalSubdomainApplicability !== undefined &&
    typeof universalSubdomainApplicability !== 'boolean'
  ) {
    throw new RangeError(
      `${methodId}.domain.universalSubdomainApplicability must be a boolean when provided`,
    );
  }
  if (
    universalSubdomainApplicability === false &&
    applicableSubdomains.includes(UNIVERSAL_SUBDOMAIN_TOKEN)
  ) {
    throw new RangeError(
      `Contradictory domain declaration on '${methodId}': universalSubdomainApplicability is false, but applicableSubdomains includes UNIVERSAL_SUBDOMAIN_TOKEN ('*')`,
    );
  }
  const mathematicalParadigm = assertNonEmptyTrimmedString(
    value.domain.mathematicalParadigm,
    `${methodId}.domain.mathematicalParadigm`,
  );

  // Required data validation
  if (!isPlainObject(value.requiredData)) {
    throw new RangeError(`${methodId}.requiredData must be an object`);
  }
  const requiredInputChannels = assertNonEmptyStringArray(
    value.requiredData.requiredInputChannels,
    `${methodId}.requiredData.requiredInputChannels`,
    METHOD_DATA_CHANNEL_IDS,
  );
  const optionalInputChannels = assertOptionalStringArray(
    value.requiredData.optionalInputChannels,
    `${methodId}.requiredData.optionalInputChannels`,
    METHOD_DATA_CHANNEL_IDS,
  );
  for (const ch of optionalInputChannels) {
    if (requiredInputChannels.includes(ch)) {
      throw new RangeError(
        `${methodId}.requiredData channel '${ch}' cannot be both required and optional`,
      );
    }
  }
  if (!isPlainObject(value.requiredData.minimumConditions)) {
    throw new RangeError(`${methodId}.requiredData.minimumConditions must be an object`);
  }
  const minCondRaw = value.requiredData.minimumConditions;
  if (typeof minCondRaw.requiresVerifiableEmpiricalEvidence !== 'boolean') {
    throw new RangeError(
      `${methodId}.requiredData.minimumConditions.requiresVerifiableEmpiricalEvidence must be a boolean`,
    );
  }
  if (
    role === 'structural-symmetry-baseline' &&
    minCondRaw.requiresVerifiableEmpiricalEvidence === true
  ) {
    throw new RangeError(
      `${methodId} has role 'structural-symmetry-baseline' and cannot claim requiresVerifiableEmpiricalEvidence: true`,
    );
  }
  if (
    role === 'evidence-driven-model' &&
    minCondRaw.requiresVerifiableEmpiricalEvidence === false
  ) {
    throw new RangeError(
      `${methodId} has role 'evidence-driven-model' and must require verifiable empirical evidence`,
    );
  }
  if (
    typeof minCondRaw.recommendedMinObservationsForHighConfidence !== 'number' ||
    !Number.isFinite(minCondRaw.recommendedMinObservationsForHighConfidence) ||
    minCondRaw.recommendedMinObservationsForHighConfidence < 0
  ) {
    throw new RangeError(
      `${methodId}.requiredData.minimumConditions.recommendedMinObservationsForHighConfidence must be a finite non-negative number`,
    );
  }

  if (
    minCondRaw.minTotalObservations !== undefined &&
    (typeof minCondRaw.minTotalObservations !== 'number' ||
      !Number.isFinite(minCondRaw.minTotalObservations) ||
      minCondRaw.minTotalObservations < 0)
  ) {
    throw new RangeError(
      `${methodId}.requiredData.minimumConditions.minTotalObservations must be a finite non-negative number`,
    );
  }
  if (
    minCondRaw.minEffectiveSampleSize !== undefined &&
    (typeof minCondRaw.minEffectiveSampleSize !== 'number' ||
      !Number.isFinite(minCondRaw.minEffectiveSampleSize) ||
      minCondRaw.minEffectiveSampleSize <= 0)
  ) {
    throw new RangeError(
      `${methodId}.requiredData.minimumConditions.minEffectiveSampleSize must be a finite positive number`,
    );
  }

  // Outcome space compatibility validation
  if (!isPlainObject(value.outcomeSpaceCompatibility)) {
    throw new RangeError(`${methodId}.outcomeSpaceCompatibility must be an object`);
  }
  const oscRaw = value.outcomeSpaceCompatibility;
  const supportedKinds = assertNonEmptyStringArray(
    oscRaw.supportedKinds,
    `${methodId}.outcomeSpaceCompatibility.supportedKinds`,
    OUTCOME_SPACE_KINDS,
  );
  if (
    typeof oscRaw.minOutcomes !== 'number' ||
    !Number.isSafeInteger(oscRaw.minOutcomes) ||
    oscRaw.minOutcomes < 2
  ) {
    throw new RangeError(
      `${methodId}.outcomeSpaceCompatibility.minOutcomes must be an integer >= 2`,
    );
  }
  if (
    oscRaw.maxOutcomes !== null &&
    (typeof oscRaw.maxOutcomes !== 'number' ||
      !Number.isSafeInteger(oscRaw.maxOutcomes) ||
      oscRaw.maxOutcomes < oscRaw.minOutcomes)
  ) {
    throw new RangeError(
      `${methodId}.outcomeSpaceCompatibility.maxOutcomes must be null or an integer >= minOutcomes`,
    );
  }
  if (
    typeof oscRaw.requiresPartitionThresholds !== 'boolean' ||
    typeof oscRaw.requiresBarrierSpecification !== 'boolean'
  ) {
    throw new RangeError(
      `${methodId}.outcomeSpaceCompatibility requires boolean requiresPartitionThresholds and requiresBarrierSpecification`,
    );
  }

  // Required assumptions validation
  if (!Array.isArray(value.requiredAssumptions) || value.requiredAssumptions.length === 0) {
    throw new RangeError(`${methodId}.requiredAssumptions must be a non-empty array`);
  }
  const seenAssumptions = new Set<string>();
  const validatedAssumptions: MethodAssumptionDescriptor[] = [];
  for (let i = 0; i < value.requiredAssumptions.length; i++) {
    const rawAssumption = value.requiredAssumptions[i];
    if (!isPlainObject(rawAssumption)) {
      throw new RangeError(`${methodId}.requiredAssumptions[${i}] must be an object`);
    }
    const id = assertNonEmptyTrimmedString(
      rawAssumption.id,
      `${methodId}.requiredAssumptions[${i}].id`,
    );
    if (!(METHOD_ASSUMPTION_IDS as readonly string[]).includes(id)) {
      throw new RangeError(
        `${methodId}.requiredAssumptions[${i}].id ('${id}') is not a recognized MethodAssumptionId`,
      );
    }
    if (seenAssumptions.has(id)) {
      throw new RangeError(
        `${methodId}.requiredAssumptions contains duplicate assumption '${id}'`,
      );
    }
    seenAssumptions.add(id);
    const description = assertNonEmptyTrimmedString(
      rawAssumption.description,
      `${methodId}.requiredAssumptions[${i}].description`,
    );
    if (typeof rawAssumption.mandatory !== 'boolean') {
      throw new RangeError(
        `${methodId}.requiredAssumptions[${i}].mandatory must be a boolean`,
      );
    }
    const verificationMode = rawAssumption.verificationMode;
    if (
      verificationMode !== 'empirical-testable' &&
      verificationMode !== 'structural-axiomatic' &&
      verificationMode !== 'domain-modeling-premise'
    ) {
      throw new RangeError(
        `${methodId}.requiredAssumptions[${i}].verificationMode is invalid: ${String(verificationMode)}`,
      );
    }
    validatedAssumptions.push(
      Object.freeze({
        id: id as MethodAssumptionId,
        description,
        mandatory: rawAssumption.mandatory,
        verificationMode,
      }),
    );
  }

  // Horizon constraints validation
  if (!isPlainObject(value.horizonConstraints)) {
    throw new RangeError(`${methodId}.horizonConstraints must be an object`);
  }
  const hcRaw = value.horizonConstraints;
  if (
    typeof hcRaw.constrained !== 'boolean' ||
    typeof hcRaw.requiresPositiveExposureRateScaling !== 'boolean'
  ) {
    throw new RangeError(
      `${methodId}.horizonConstraints requires boolean constrained and requiresPositiveExposureRateScaling`,
    );
  }
  const scientificJustification = assertNonEmptyTrimmedString(
    hcRaw.scientificJustification,
    `${methodId}.horizonConstraints.scientificJustification`,
  );
  if (hcRaw.constrained) {
    const hasMin = hcRaw.minHorizonMs !== undefined;
    const hasMax = hcRaw.maxHorizonMs !== undefined;
    if (!hasMin && !hasMax) {
      throw new RangeError(
        `${methodId}.horizonConstraints with constrained: true must specify minHorizonMs and/or maxHorizonMs`,
      );
    }
    if (
      hasMin &&
      (typeof hcRaw.minHorizonMs !== 'number' ||
        !Number.isFinite(hcRaw.minHorizonMs) ||
        hcRaw.minHorizonMs <= 0)
    ) {
      throw new RangeError(
        `${methodId}.horizonConstraints.minHorizonMs must be a finite positive number`,
      );
    }
    if (
      hasMax &&
      (typeof hcRaw.maxHorizonMs !== 'number' ||
        !Number.isFinite(hcRaw.maxHorizonMs) ||
        hcRaw.maxHorizonMs <= 0)
    ) {
      throw new RangeError(
        `${methodId}.horizonConstraints.maxHorizonMs must be a finite positive number`,
      );
    }
    if (
      hasMin &&
      hasMax &&
      (hcRaw.minHorizonMs as number) > (hcRaw.maxHorizonMs as number)
    ) {
      throw new RangeError(
        `${methodId}.horizonConstraints requires minHorizonMs <= maxHorizonMs`,
      );
    }
  } else if (hcRaw.minHorizonMs !== undefined || hcRaw.maxHorizonMs !== undefined) {
    throw new RangeError(
      `${methodId}.horizonConstraints with constrained: false must not set minHorizonMs or maxHorizonMs`,
    );
  }

  // Computational profile validation
  if (!isPlainObject(value.computationalProfile)) {
    throw new RangeError(`${methodId}.computationalProfile must be an object`);
  }
  const cpRaw = value.computationalProfile;
  const validComplexities: readonly ComputationalComplexityClass[] = [
    'O(1)-closed-form',
    'O(K)-categorical-closed-form',
    'O(N)-weighted-aggregation',
    'O(I)-iterative-special-function',
    'O(M*I)-quadrature-or-series',
  ];
  if (
    typeof cpRaw.complexityClass !== 'string' ||
    !validComplexities.includes(cpRaw.complexityClass as ComputationalComplexityClass)
  ) {
    throw new RangeError(
      `${methodId}.computationalProfile.complexityClass is invalid: ${String(cpRaw.complexityClass)}`,
    );
  }
  if (
    cpRaw.costTier !== 'low' &&
    cpRaw.costTier !== 'moderate' &&
    cpRaw.costTier !== 'high'
  ) {
    throw new RangeError(
      `${methodId}.computationalProfile.costTier must be 'low', 'moderate', or 'high'`,
    );
  }
  if (typeof cpRaw.requiresIterativeSpecialFunctions !== 'boolean') {
    throw new RangeError(
      `${methodId}.computationalProfile.requiresIterativeSpecialFunctions must be a boolean`,
    );
  }
  if (cpRaw.deterministic !== true) {
    throw new RangeError(
      `${methodId}.computationalProfile.deterministic must be true`,
    );
  }
  if (
    typeof cpRaw.maxMemoryKbEstimate !== 'number' ||
    !Number.isFinite(cpRaw.maxMemoryKbEstimate) ||
    cpRaw.maxMemoryKbEstimate <= 0
  ) {
    throw new RangeError(
      `${methodId}.computationalProfile.maxMemoryKbEstimate must be a finite positive number`,
    );
  }

  // Epistemological claims validation
  if (!Array.isArray(value.epistemologicalClaims) || value.epistemologicalClaims.length === 0) {
    throw new RangeError(`${methodId}.epistemologicalClaims must be a non-empty array`);
  }
  const validatedClaims: EpistemologicalClaimDescriptor[] = [];
  for (let i = 0; i < value.epistemologicalClaims.length; i++) {
    const rawClaim = value.epistemologicalClaims[i];
    if (!isPlainObject(rawClaim)) {
      throw new RangeError(`${methodId}.epistemologicalClaims[${i}] must be an object`);
    }
    const kind = rawClaim.kind as EpistemologicalClaimKind;
    const expectedTag = EPISTEMOLOGICAL_TAG_BY_KIND[kind];
    if (!expectedTag || rawClaim.tag !== expectedTag) {
      throw new RangeError(
        `${methodId}.epistemologicalClaims[${i}] has mismatched kind '${String(rawClaim.kind)}' and tag '${String(rawClaim.tag)}'`,
      );
    }
    const statement = assertNonEmptyTrimmedString(
      rawClaim.statement,
      `${methodId}.epistemologicalClaims[${i}].statement`,
    );
    const validityCondition =
      rawClaim.validityCondition !== undefined
        ? assertNonEmptyTrimmedString(
            rawClaim.validityCondition,
            `${methodId}.epistemologicalClaims[${i}].validityCondition`,
          )
        : undefined;
    const errorBound =
      rawClaim.errorBound !== undefined
        ? assertNonEmptyTrimmedString(
            rawClaim.errorBound,
            `${methodId}.epistemologicalClaims[${i}].errorBound`,
          )
        : undefined;
    validatedClaims.push(
      Object.freeze({
        kind,
        tag: expectedTag,
        statement,
        ...(validityCondition !== undefined ? { validityCondition } : {}),
        ...(errorBound !== undefined ? { errorBound } : {}),
      }),
    );
  }

  const knownLimitations = assertNonEmptyStringArray(
    value.knownLimitations,
    `${methodId}.knownLimitations`,
  );
  const failureConditions = assertNonEmptyStringArray(
    value.failureConditions,
    `${methodId}.failureConditions`,
  );

  // Dependence profile validation
  if (!isPlainObject(value.dependenceProfile)) {
    throw new RangeError(`${methodId}.dependenceProfile must be an object`);
  }
  const dpRaw = value.dependenceProfile;
  const correlationGroupId = assertNonEmptyTrimmedString(
    dpRaw.correlationGroupId,
    `${methodId}.dependenceProfile.correlationGroupId`,
  );
  const sharedInformationChannels = assertNonEmptyStringArray(
    dpRaw.sharedInformationChannels,
    `${methodId}.dependenceProfile.sharedInformationChannels`,
    METHOD_DATA_CHANNEL_IDS,
  );
  const sharedLatentAssumptions = assertNonEmptyStringArray(
    dpRaw.sharedLatentAssumptions,
    `${methodId}.dependenceProfile.sharedLatentAssumptions`,
    METHOD_ASSUMPTION_IDS,
  );
  if (!Array.isArray(dpRaw.correlatedWithMethodIds)) {
    throw new RangeError(
      `${methodId}.dependenceProfile.correlatedWithMethodIds must be an array`,
    );
  }
  const seenCorr = new Set<string>();
  const correlatedWithMethodIds: ScientificMethodId[] = [];
  for (let i = 0; i < dpRaw.correlatedWithMethodIds.length; i++) {
    const corrId = dpRaw.correlatedWithMethodIds[i];
    if (!isValidScientificMethodId(corrId)) {
      throw new RangeError(
        `${methodId}.dependenceProfile.correlatedWithMethodIds[${i}] is invalid: ${String(corrId)}`,
      );
    }
    if (corrId === methodId) {
      throw new RangeError(
        `${methodId}.dependenceProfile.correlatedWithMethodIds must not contain self ('${methodId}')`,
      );
    }
    if (seenCorr.has(corrId)) {
      throw new RangeError(
        `${methodId}.dependenceProfile.correlatedWithMethodIds contains duplicate '${corrId}'`,
      );
    }
    seenCorr.add(corrId);
    correlatedWithMethodIds.push(corrId);
  }
  const independenceWarning = assertNonEmptyTrimmedString(
    dpRaw.independenceWarning,
    `${methodId}.dependenceProfile.independenceWarning`,
  );

  // Implementation honesty validation
  const hasExecutableImplementation = value.hasExecutableImplementation;
  if (typeof hasExecutableImplementation !== 'boolean') {
    throw new RangeError(
      `${methodId}.hasExecutableImplementation must be a boolean`,
    );
  }
  const implementationStatus = value.implementationStatus;
  if (
    typeof implementationStatus !== 'string' ||
    !(METHOD_IMPLEMENTATION_STATUSES as readonly string[]).includes(implementationStatus)
  ) {
    throw new RangeError(
      `${methodId}.implementationStatus must be one of [${METHOD_IMPLEMENTATION_STATUSES.join(', ')}], received ${String(implementationStatus)}`,
    );
  }
  if (
    hasExecutableImplementation &&
    implementationStatus !== 'implemented-and-verified'
  ) {
    throw new RangeError(
      `Implementation honesty violation for '${methodId}': hasExecutableImplementation cannot be true when implementationStatus is '${implementationStatus}'`,
    );
  }
  if (
    !hasExecutableImplementation &&
    implementationStatus === 'implemented-and-verified'
  ) {
    throw new RangeError(
      `Implementation honesty violation for '${methodId}': implementationStatus cannot be 'implemented-and-verified' when hasExecutableImplementation is false`,
    );
  }

  const descriptor: ScientificMethodDescriptor = {
    methodId,
    name,
    summary,
    methodFamily: methodFamily as ScientificMethodFamily,
    role,
    domain: {
      applicableCategories,
      applicableSubdomains,
      ...(universalSubdomainApplicability !== undefined
        ? { universalSubdomainApplicability }
        : {}),
      mathematicalParadigm,
    },
    requiredData: {
      requiredInputChannels,
      optionalInputChannels,
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: minCondRaw.requiresVerifiableEmpiricalEvidence,
        ...(minCondRaw.minTotalObservations !== undefined
          ? { minTotalObservations: minCondRaw.minTotalObservations as number }
          : {}),
        ...(minCondRaw.minEffectiveSampleSize !== undefined
          ? { minEffectiveSampleSize: minCondRaw.minEffectiveSampleSize as number }
          : {}),
        ...(minCondRaw.requiresPositiveExposureDuration !== undefined
          ? {
              requiresPositiveExposureDuration: Boolean(
                minCondRaw.requiresPositiveExposureDuration,
              ),
            }
          : {}),
        ...(minCondRaw.requiresPositiveScaleOrVolatility !== undefined
          ? {
              requiresPositiveScaleOrVolatility: Boolean(
                minCondRaw.requiresPositiveScaleOrVolatility,
              ),
            }
          : {}),
        ...(minCondRaw.minDegreesOfFreedom !== undefined
          ? { minDegreesOfFreedom: Number(minCondRaw.minDegreesOfFreedom) }
          : {}),
        ...(minCondRaw.maxDegreesOfFreedom !== undefined
          ? { maxDegreesOfFreedom: Number(minCondRaw.maxDegreesOfFreedom) }
          : {}),
        ...(minCondRaw.requiresInitialStateStrictlyOutsideBarrier !== undefined
          ? {
              requiresInitialStateStrictlyOutsideBarrier: Boolean(
                minCondRaw.requiresInitialStateStrictlyOutsideBarrier,
              ),
            }
          : {}),
        recommendedMinObservationsForHighConfidence:
          minCondRaw.recommendedMinObservationsForHighConfidence,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds,
      minOutcomes: oscRaw.minOutcomes,
      maxOutcomes: oscRaw.maxOutcomes as number | null,
      requiresPartitionThresholds: oscRaw.requiresPartitionThresholds,
      requiresBarrierSpecification: oscRaw.requiresBarrierSpecification,
    },
    requiredAssumptions: validatedAssumptions,
    horizonConstraints: {
      constrained: hcRaw.constrained,
      ...(hcRaw.minHorizonMs !== undefined
        ? { minHorizonMs: hcRaw.minHorizonMs as number }
        : {}),
      ...(hcRaw.maxHorizonMs !== undefined
        ? { maxHorizonMs: hcRaw.maxHorizonMs as number }
        : {}),
      requiresPositiveExposureRateScaling: hcRaw.requiresPositiveExposureRateScaling,
      scientificJustification,
    },
    computationalProfile: {
      complexityClass: cpRaw.complexityClass as ComputationalComplexityClass,
      costTier: cpRaw.costTier,
      requiresIterativeSpecialFunctions: cpRaw.requiresIterativeSpecialFunctions,
      deterministic: true,
      maxMemoryKbEstimate: cpRaw.maxMemoryKbEstimate,
    },
    epistemologicalClaims: validatedClaims,
    knownLimitations,
    failureConditions,
    dependenceProfile: {
      correlationGroupId,
      sharedInformationChannels,
      sharedLatentAssumptions,
      correlatedWithMethodIds,
      independenceWarning,
    },
    hasExecutableImplementation,
    implementationStatus: implementationStatus as MethodImplementationStatus,
  };

  return deepFreeze(descriptor);
}

/* -------------------------------------------------------------------------
   Canonical Core Method Descriptors (7 Registered Core Methods)
   ------------------------------------------------------------------------- */

const CORE_METHOD_DESCRIPTORS_RAW: readonly ScientificMethodDescriptor[] = [
  {
    methodId: 'beta-binomial-conjugate',
    name: 'Beta-Binomial Conjugate Reference Updater',
    summary:
      'Updates a Beta(alpha_0, beta_0) conjugate prior with exchangeable binary trial counts (k successes, n - k failures) to produce the posterior predictive Bernoulli distribution and exact regularized incomplete beta credible intervals.',
    methodFamily: 'conjugate-discrete-frequency',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: PREDICTION_CATEGORIES,
      applicableSubdomains: [
        'binary-event-occurrence',
        'historical-base-rate-estimation',
        'clinical-and-scientific-replication-rates',
        'policy-and-institutional-pass-fail-outcomes',
        'geopolitical-or-conflict-incident-rates',
      ],
      mathematicalParadigm:
        'De Finetti exchangeable Bernoulli sequence with Beta(alpha, beta) conjugate posterior',
    },
    requiredData: {
      requiredInputChannels: ['binary-trial-counts'],
      optionalInputChannels: ['prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 1,
        recommendedMinObservationsForHighConfidence: 10,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary'],
      minOutcomes: 2,
      maxOutcomes: 2,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'exchangeable-bernoulli-trials',
        description:
          'Historical binary trials are exchangeable (or conditionally independent given latent success rate theta).',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'stationary-success-probability',
        description:
          'The latent Bernoulli success parameter theta remains stationary between the historical reference class and the target forecast horizon.',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: false,
      scientificJustification:
        'Models discrete trial resolution over a well-defined binary event window without imposing arbitrary wall-clock duration cutoffs.',
    },
    computationalProfile: {
      complexityClass: 'O(I)-iterative-special-function',
      costTier: 'low',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 32,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'Posterior mean alpha / (alpha + beta) and epistemic parameter variance alpha * beta / ((alpha + beta)^2 * (alpha + beta + 1)) are exact under exchangeable Bernoulli trials with a Beta prior.',
        validityCondition: 'Exchangeable binary reference trials and stationary success parameter.',
      },
      {
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement:
          'Parametric credible interval quantiles use inverseRegularizedIncompleteBeta with safeguarded Newton-Halley refinement in binary64.',
        errorBound: 'Relative tolerance <= 1e-13 in interior normal binary64 regime.',
      },
    ],
    knownLimitations: [
      'Does not discount non-stationary regime shifts or time-varying hazard intensities.',
      'Treats all historical trials with equal weight; overstates effective precision when observations are clustered or importance-weighted.',
      'Small sample sizes (n < 10) remain sensitive to prior hyperparameter specification.',
    ],
    failureConditions: [
      'Non-binary outcome space (K != 2) or continuous barrier-crossing formulation.',
      'Strong serial correlation, regime break, or structural non-exchangeability across historical trials.',
      'Zero empirical trial observations when an evidence-driven base rate is required.',
    ],
    dependenceProfile: {
      correlationGroupId: 'bernoulli-frequency-family',
      sharedInformationChannels: ['binary-trial-counts', 'multinomial-category-counts'],
      sharedLatentAssumptions: [
        'exchangeable-bernoulli-trials',
        'stationary-success-probability',
      ],
      correlatedWithMethodIds: [
        'weighted-kish-effective-binomial',
        'dirichlet-multinomial-symmetry',
      ],
      independenceWarning:
        'Shares the historical binary reference class with weighted-kish-effective-binomial and is algebraically related on binary outcome spaces (K = 2) to dirichlet-multinomial-symmetry; downstream synthesis must never treat these methods as independent votes.',
    },
    hasExecutableImplementation: true,
    implementationStatus: 'implemented-and-verified',
  },
  {
    methodId: 'weighted-kish-effective-binomial',
    name: 'Kish Effective-Sample Weighted Binomial Updater',
    summary:
      'Adjusts relevance-, recency-, or design-weighted binary observations using Kish effective sample size n_eff = (sum w_i)^2 / sum(w_i^2) before conjugate Beta pseudo-count updating so variance and credible intervals reflect weight concentration.',
    methodFamily: 'weighted-effective-sample',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: PREDICTION_CATEGORIES,
      applicableSubdomains: [
        'binary-event-occurrence',
        'historical-base-rate-estimation',
        'clinical-and-scientific-replication-rates',
        'policy-and-institutional-pass-fail-outcomes',
        'geopolitical-or-conflict-incident-rates',
        'heterogeneous-reference-classes',
        'recency-weighted-historical-frequencies',
        'clustered-or-stratified-empirical-evidence',
      ],
      mathematicalParadigm:
        'Design-effect adjusted pseudo-likelihood Beta-Binomial updating under Kish effective sample size',
    },
    requiredData: {
      requiredInputChannels: ['weighted-binary-trials', 'kish-effective-sample-size'],
      optionalInputChannels: ['binary-trial-counts', 'prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 2,
        minEffectiveSampleSize: 1,
        recommendedMinObservationsForHighConfidence: 10,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary'],
      minOutcomes: 2,
      maxOutcomes: 2,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'non-negative-importance-weights',
        description:
          'Observation weights w_i >= 0 are deterministic or exogenous to the realized outcomes and have strictly positive sum.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'kish-effective-sample-adequacy',
        description:
          'Second-moment Kish design-effect scaling adequately summarizes variance inflation from heterogeneous observation weights.',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
      {
        id: 'stationary-success-probability',
        description:
          'Weighted reference trials estimate a well-defined target success probability applicable to the forecast horizon.',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: false,
      scientificJustification:
        'Temporal relevance decay is encoded through explicit observation weights rather than hard calendar horizon cutoffs.',
    },
    computationalProfile: {
      complexityClass: 'O(N)-weighted-aggregation',
      costTier: 'low',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 48,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-mathematical-identity',
        tag: 'IME',
        statement:
          'Kish effective sample size n_eff = (sum w_i)^2 / sum(w_i^2) satisfies 1 <= n_eff <= n with equality if and only if all positive weights are identical.',
      },
      {
        kind: 'operational-design-heuristic',
        tag: 'HDO',
        statement:
          'Scaling Beta pseudo-counts by n_eff preserves first- and second-moment variance inflation under heterogeneous weights as a quasi-posterior approximation.',
        validityCondition: 'Non-negative exogenous weights with bounded coefficient of variation.',
      },
    ],
    knownLimitations: [
      'Quasi-posterior Beta scaling is an operational design heuristic [HDO] rather than a full hierarchical likelihood over weight-generating covariates.',
      'Extreme weight concentration (n_eff << 2) yields wide epistemic intervals dominated by the prior.',
    ],
    failureConditions: [
      'Non-binary outcome space (K != 2).',
      'Negative, NaN, or identically zero observation weights, or claimed n_eff > n.',
      'Endogenous outcome-dependent weights that induce selection bias.',
    ],
    dependenceProfile: {
      correlationGroupId: 'bernoulli-frequency-family',
      sharedInformationChannels: ['weighted-binary-trials', 'binary-trial-counts'],
      sharedLatentAssumptions: ['stationary-success-probability'],
      correlatedWithMethodIds: ['beta-binomial-conjugate'],
      independenceWarning:
        'Strongly correlated with beta-binomial-conjugate when both operate on the same underlying binary trial corpus.',
    },
    hasExecutableImplementation: true,
    implementationStatus: 'implemented-and-verified',
  },
  {
    methodId: 'poisson-gamma-hazard',
    name: 'Poisson-Gamma Continuous-Time Hazard & Negative-Binomial Predictive Model',
    summary:
      'Models discrete event arrivals over continuous exposure duration T via a Poisson process with Gamma(alpha_0, beta_0) conjugate rate prior, yielding an exact Negative-Binomial predictive survival probability P(N(Delta_t) = 0) and occurrence probability P(N(Delta_t) >= 1) over the forecast horizon.',
    methodFamily: 'continuous-time-hazard',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: PREDICTION_CATEGORIES,
      applicableSubdomains: [
        'binary-event-occurrence',
        'policy-and-institutional-pass-fail-outcomes',
        'rare-event-arrival-hazards',
        'geopolitical-or-conflict-incident-rates',
        'climate-and-natural-hazard-recurrence',
        'system-outage-or-cyber-incident-arrival',
        'epidemiological-outbreak-emergence',
      ],
      mathematicalParadigm:
        'Continuous-time inhomogeneous/homogeneous Poisson counting process with conjugate Gamma intensity prior',
    },
    requiredData: {
      requiredInputChannels: ['poisson-event-counts', 'continuous-exposure-duration'],
      optionalInputChannels: ['prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 0,
        requiresPositiveExposureDuration: true,
        recommendedMinObservationsForHighConfidence: 5,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary'],
      minOutcomes: 2,
      maxOutcomes: 2,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'conditionally-independent-poisson-increments',
        description:
          'Event counts in disjoint time intervals are conditionally independent Poisson random variables given latent hazard intensity lambda > 0.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'homogeneous-or-known-exposure-intensity',
        description:
          'Cumulative hazard over the forecast horizon scales predictably with positive exposure duration Delta_t.',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: true,
      scientificJustification:
        'Requires strictly positive forecast horizon duration Delta_t > 0 and positive historical exposure duration T > 0 so the dimensionless exposure ratio r = Delta_t / (beta_0 + T) is well-defined.',
    },
    computationalProfile: {
      complexityClass: 'O(I)-iterative-special-function',
      costTier: 'low',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 32,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'Posterior rate lambda | (k, T) ~ Gamma(alpha_0 + k, beta_0 + T) and zero-event survival probability (1 + Delta_t / (beta_0 + T))^-(alpha_0 + k) are exact under the Poisson-Gamma model.',
        validityCondition: 'Conditionally independent Poisson increments and stationary intensity scale.',
      },
      {
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement:
          'Posterior rate credible intervals use inverseRegularizedGammaQ and log1mexp dual-channel survival evaluation in binary64.',
        errorBound: 'Relative error <= 1e-13 across normal and subnormal probability regimes.',
      },
    ],
    knownLimitations: [
      'Underestimates clustering variance when events follow a self-exciting Hawkes process or regime-switching intensity.',
      'Extrapolating over horizons Delta_t >> T amplifies uncertainty in the latent rate parameter.',
    ],
    failureConditions: [
      'Non-binary outcome space or zero/negative historical exposure duration T <= 0.',
      'Deterministic calendar-scheduled events that violate counting-process increment assumptions.',
    ],
    dependenceProfile: {
      correlationGroupId: 'counting-process-hazard-family',
      sharedInformationChannels: ['poisson-event-counts', 'continuous-exposure-duration'],
      sharedLatentAssumptions: [
        'conditionally-independent-poisson-increments',
        'homogeneous-or-known-exposure-intensity',
      ],
      correlatedWithMethodIds: [],
      independenceWarning:
        'When Poisson event counts are derived by thresholding the same underlying time series used by diffusion models, cross-family dependence must be audited.',
    },
    hasExecutableImplementation: true,
    implementationStatus: 'implemented-and-verified',
  },
  {
    methodId: 'dirichlet-multinomial-symmetry',
    name: 'Dirichlet-Multinomial Conjugate Categorical Forecaster',
    summary:
      'Updates a Dirichlet(alpha_1, ..., alpha_K) conjugate prior with K-category multinomial observation counts (n_1, ..., n_K) to produce an exhaustive K-outcome predictive simplex, marginal Beta(alpha_k, alpha_0 - alpha_k) epistemic variances, and marginal credible intervals.',
    methodFamily: 'categorical-exchangeable-symmetry',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: PREDICTION_CATEGORIES,
      applicableSubdomains: [
        'binary-event-occurrence',
        'policy-and-institutional-pass-fail-outcomes',
        'geopolitical-or-conflict-incident-rates',
        'multi-outcome-categorical-events',
        'institutional-or-electoral-plurality-outcomes',
        'discretized-regime-classifications',
        'multi-branch-scientific-or-technological-milestones',
        'macroeconomic-and-financial-indicators',
        'climate-temperature-and-emissions-trajectories',
      ],
      mathematicalParadigm:
        'Exchangeable K-category multinomial sequence with conjugate Dirichlet simplex posterior',
    },
    requiredData: {
      requiredInputChannels: ['multinomial-category-counts'],
      optionalInputChannels: ['prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 1,
        recommendedMinObservationsForHighConfidence: 15,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary', 'categorical-exhaustive', 'discretized-continuous-partition'],
      minOutcomes: 2,
      maxOutcomes: 64,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'exchangeable-multinomial-trials',
        description:
          'Historical categorical realizations are exchangeable draws from a K-dimensional categorical distribution.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'exhaustive-mutually-exclusive-categories',
        description:
          'The K outcome labels form a mutually exclusive and collectively exhaustive partition of the event space.',
        mandatory: true,
        verificationMode: 'structural-axiomatic',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: false,
      scientificJustification:
        'Applies to any discrete resolution horizon where the K-category partition is fixed and exhaustive.',
    },
    computationalProfile: {
      complexityClass: 'O(K)-categorical-closed-form',
      costTier: 'low',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 64,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'Marginal posterior Beta(alpha_k + n_k, sum_{j!=k}(alpha_j + n_j)) moments and predictive probabilities p_k = (alpha_k + n_k) / sum_j(alpha_j + n_j) are exact under Dirichlet-Multinomial conjugacy.',
        validityCondition: 'Exchangeable multinomial trials over an exhaustive K-partition.',
      },
    ],
    knownLimitations: [
      'Standard Dirichlet covariance is purely negative across categories and does not encode metric ordering across discretized continuous bins.',
      'Sensitive to artificial splitting or merging of rare categories unless prior concentration is partition-invariant.',
    ],
    failureConditions: [
      'First-passage absorbing barrier problems where pathwise stopping time governs the outcome.',
      'Mismatch between multinomial count vector length and outcomeSpace.outcomeLabels.length.',
    ],
    dependenceProfile: {
      correlationGroupId: 'dirichlet-categorical-family',
      sharedInformationChannels: ['multinomial-category-counts', 'binary-trial-counts'],
      sharedLatentAssumptions: [
        'exchangeable-multinomial-trials',
        'exhaustive-mutually-exclusive-categories',
      ],
      correlatedWithMethodIds: ['beta-binomial-conjugate'],
      independenceWarning:
        'For binary outcome spaces (K = 2), the 2-category Dirichlet-Multinomial model is mathematically related to Beta-Binomial and may produce equivalent predictive distributions when observing identical binary counts under compatible priors; never treat both as independent votes.',
    },
    hasExecutableImplementation: true,
    implementationStatus: 'implemented-and-verified',
  },
  {
    methodId: 'student-t-terminal-diffusion',
    name: 'Heavy-Tailed Student-t Terminal State Diffusion Forecaster',
    summary:
      'Models the terminal value X(T) of a continuous state variable at horizon T under drift mu, volatility/scale sigma, and heavy-tailed Student-t(nu) innovations, mapping terminal thresholds into binary or discretized-partition probabilities via dual-channel central/noncentral Student-t CDFs.',
    methodFamily: 'continuous-stochastic-diffusion',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: [
        'economy',
        'climate',
        'technology',
        'science',
        'health',
        'space',
        'geopolitics',
        'society',
      ],
      applicableSubdomains: [
        'macroeconomic-and-financial-indicators',
        'climate-temperature-and-emissions-trajectories',
        'continuous-physical-or-orbital-telemetry',
        'epidemiological-or-demographic-continuous-indices',
      ],
      mathematicalParadigm:
        'Continuous-state location-scale diffusion with heavy-tailed Student-t(nu) terminal distribution',
    },
    requiredData: {
      requiredInputChannels: [
        'continuous-state-trajectory',
        'drift-and-scale-estimates',
        'tail-degrees-of-freedom',
      ],
      optionalInputChannels: ['prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 5,
        requiresPositiveScaleOrVolatility: true,
        minDegreesOfFreedom: 1,
        maxDegreesOfFreedom: 2000,
        recommendedMinObservationsForHighConfidence: 30,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary', 'discretized-continuous-partition'],
      minOutcomes: 2,
      maxOutcomes: 64,
      requiresPartitionThresholds: true,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'stationary-heavy-tailed-increments',
        description:
          'State increments over the forecast horizon exhibit stationary location-scale scaling with finite positive scale sigma > 0.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'student-t-terminal-innovation-law',
        description:
          'Standardized terminal innovations follow a central or noncentral Student-t distribution with nu in [1, 2000] degrees of freedom.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'constant-drift-and-volatility-to-horizon',
        description:
          'Estimated drift and scale parameters remain valid over the elapsed horizon Delta_t without structural regime breaks.',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: true,
      scientificJustification:
        'Requires positive elapsed horizon Delta_t > 0 so terminal scale sigma * sqrt(Delta_t) > 0 is strictly positive and non-degenerate.',
    },
    computationalProfile: {
      complexityClass: 'O(M*I)-quadrature-or-series',
      costTier: 'high',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 256,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'Terminal bin probabilities F_t(z_{k}) - F_t(z_{k-1}) are exact under the specified location-scale Student-t terminal innovation law.',
        validityCondition: 'Stationary Student-t terminal innovations with nu in [1, 2000].',
      },
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'Noncentral Student-t tail evaluation uses log-space concavity bounds [IME] evaluated in binary64 [EBM], Kahan-Neumaier panel summation [ANC], and adaptive 8-point Gauss-Legendre quadrature [EBM].',
        errorBound: 'Unified total relative error budget <= 1e-12.',
      },
    ],
    knownLimitations: [
      'Evaluates only the terminal distribution at horizonEndsAt; does NOT account for intra-horizon barrier absorption before horizonEndsAt.',
      'Parameter uncertainty in (mu, sigma, nu) grows rapidly when trajectory sample size is small (n < 30).',
    ],
    failureConditions: [
      'Path-dependent first-passage-before-horizon questions (where crossing a barrier prior to T decides the outcome).',
      'Missing partition thresholds, non-positive volatility/scale (sigma <= 0), or degrees of freedom outside [1, 2000].',
    ],
    dependenceProfile: {
      correlationGroupId: 'ito-continuous-diffusion-family',
      sharedInformationChannels: [
        'continuous-state-trajectory',
        'drift-and-scale-estimates',
      ],
      sharedLatentAssumptions: ['constant-drift-and-volatility-to-horizon'],
      correlatedWithMethodIds: ['first-passage-barrier-diffusion'],
      independenceWarning:
        'Shares continuous state trajectory and drift/volatility estimates with first-passage-barrier-diffusion; never treat both as independent sources of empirical evidence.',
    },
    hasExecutableImplementation: false,
    implementationStatus: 'registered-specification-only',
  },
  {
    methodId: 'first-passage-barrier-diffusion',
    name: 'Continuous-Time Drift-Diffusion First-Passage Barrier Forecaster',
    summary:
      'Computes the probability that a continuous-time drift-diffusion process X(t) = X_0 + mu * t + sigma * W(t) crosses an absorbing upper or lower barrier B at any time t in (horizonStartsAt, horizonEndsAt] via the inverse-Gaussian reflection identity in log/erfcx space.',
    methodFamily: 'first-passage-boundary',
    role: 'evidence-driven-model',
    domain: {
      applicableCategories: [
        'economy',
        'climate',
        'technology',
        'science',
        'health',
        'space',
        'geopolitics',
        'society',
      ],
      applicableSubdomains: [
        'threshold-breach-before-deadline',
        'macroeconomic-or-price-level-barrier-crossing',
        'climate-anomaly-threshold-exceedance',
        'engineering-or-orbital-safety-margin-breach',
      ],
      mathematicalParadigm:
        'Continuous-path Ito drift-diffusion hitting-time distribution via Girsanov/reflection principle (Inverse Gaussian law)',
    },
    requiredData: {
      requiredInputChannels: [
        'continuous-state-trajectory',
        'drift-and-scale-estimates',
        'absorbing-barrier-specification',
      ],
      optionalInputChannels: ['prior-hyperparameters'],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: true,
        minTotalObservations: 5,
        requiresPositiveScaleOrVolatility: true,
        requiresInitialStateStrictlyOutsideBarrier: true,
        recommendedMinObservationsForHighConfidence: 30,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['first-passage-before-horizon'],
      minOutcomes: 2,
      maxOutcomes: 2,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: true,
    },
    requiredAssumptions: [
      {
        id: 'continuous-sample-path-no-jump-overshoot',
        description:
          'State trajectories have continuous sample paths so barrier crossing occurs without discontinuous jump overshoot.',
        mandatory: true,
        verificationMode: 'empirical-testable',
      },
      {
        id: 'constant-drift-and-volatility-to-horizon',
        description:
          'Drift mu and volatility sigma > 0 remain constant across the barrier-monitoring interval (horizonStartsAt, horizonEndsAt].',
        mandatory: true,
        verificationMode: 'domain-modeling-premise',
      },
      {
        id: 'reflection-principle-absorbing-barrier',
        description:
          'The barrier level B is continuously monitored and absorbing across the entire horizon window.',
        mandatory: true,
        verificationMode: 'structural-axiomatic',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: true,
      scientificJustification:
        'Requires strictly positive monitoring window Delta_t > 0 and positive diffusion scale sigma * sqrt(Delta_t) > 0 for the Bachelier-Levy first-passage CDF.',
    },
    computationalProfile: {
      complexityClass: 'O(I)-iterative-special-function',
      costTier: 'moderate',
      requiresIterativeSpecialFunctions: true,
      deterministic: true,
      maxMemoryKbEstimate: 64,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-under-explicit-model',
        tag: 'EBM',
        statement:
          'First-passage probability P(tau_B <= T) = Phi((-d + mu*T)/(sigma*sqrt(T))) + exp(2*mu*d/sigma^2) * Phi((-d - mu*T)/(sigma*sqrt(T))) is exact for Brownian motion with drift.',
        validityCondition: 'Continuous paths, constant drift mu, constant volatility sigma > 0, and d = |B - X_0| > 0.',
      },
      {
        kind: 'controlled-numerical-approximation',
        tag: 'ANC',
        statement:
          'Evaluates the complementary reflection sum in log/erfcx space via erfcxDiffPositive and Laplace-Stieltjes continued fraction enclosures to prevent catastrophic cancellation when mu * d / sigma^2 is large.',
        errorBound: 'Certified relative enclosure <= 1e-13 for Stieltjes CF factor.',
      },
    ],
    knownLimitations: [
      'Continuous-path reflection underestimates or overestimates hitting probabilities when the underlying process has discrete jump discontinuities (Levy jumps) or discrete-time monitoring only.',
      'Highly sensitive to volatility misspecification near the barrier.',
    ],
    failureConditions: [
      'Terminal-only outcome spaces that ignore intra-horizon crossings, or categorical K > 2 spaces.',
      'Initial state X_0 already at or beyond the absorbing barrier B at horizonStartsAt.',
      'Zero or negative volatility sigma <= 0.',
    ],
    dependenceProfile: {
      correlationGroupId: 'ito-continuous-diffusion-family',
      sharedInformationChannels: [
        'continuous-state-trajectory',
        'drift-and-scale-estimates',
      ],
      sharedLatentAssumptions: ['constant-drift-and-volatility-to-horizon'],
      correlatedWithMethodIds: ['student-t-terminal-diffusion'],
      independenceWarning:
        'Shares continuous state trajectory and drift/volatility estimates with student-t-terminal-diffusion.',
    },
    hasExecutableImplementation: false,
    implementationStatus: 'registered-specification-only',
  },
  {
    methodId: 'structural-uniform-baseline',
    name: 'Maximum-Entropy Structural Symmetry Baseline',
    summary:
      'Assigns the maximum-entropy uniform distribution p_k = 1 / K across an exhaustive K-outcome partition under explicit partition-symmetry assumptions. Serves strictly as a zero-evidence structural reference baseline and never as empirical evidence.',
    methodFamily: 'structural-baseline',
    role: 'structural-symmetry-baseline',
    domain: {
      applicableCategories: PREDICTION_CATEGORIES,
      universalSubdomainApplicability: true,
      applicableSubdomains: [
        UNIVERSAL_SUBDOMAIN_TOKEN,
        'maximum-entropy-structural-reference',
        'symmetry-invariant-finite-partitions',
        'cold-start-ignorance-prior-benchmark',
      ],
      mathematicalParadigm:
        'Jaynes maximum Shannon entropy H(p) = ln(K) under permutation symmetry of exhaustive outcome labels',
    },
    requiredData: {
      requiredInputChannels: ['outcome-partition-symmetry'],
      optionalInputChannels: [],
      minimumConditions: {
        requiresVerifiableEmpiricalEvidence: false,
        recommendedMinObservationsForHighConfidence: 0,
      },
    },
    outcomeSpaceCompatibility: {
      supportedKinds: ['binary', 'categorical-exhaustive'],
      minOutcomes: 2,
      maxOutcomes: 64,
      requiresPartitionThresholds: false,
      requiresBarrierSpecification: false,
    },
    requiredAssumptions: [
      {
        id: 'exhaustive-mutually-exclusive-categories',
        description:
          'The K outcomes form a mutually exclusive and collectively exhaustive finite partition.',
        mandatory: true,
        verificationMode: 'structural-axiomatic',
      },
      {
        id: 'principle-of-indifference-partition-symmetry',
        description:
          'The outcome partition is symmetric and non-arbitrary (not constructed by asymmetrically subdividing continuous intervals or path-dependent stopping boundaries).',
        mandatory: true,
        verificationMode: 'structural-axiomatic',
      },
    ],
    horizonConstraints: {
      constrained: false,
      requiresPositiveExposureRateScaling: false,
      scientificJustification:
        'Purely structural maximum-entropy reference over the finite outcome partition; invariant to horizon length.',
    },
    computationalProfile: {
      complexityClass: 'O(1)-closed-form',
      costTier: 'low',
      requiresIterativeSpecialFunctions: false,
      deterministic: true,
      maxMemoryKbEstimate: 8,
    },
    epistemologicalClaims: [
      {
        kind: 'exact-mathematical-identity',
        tag: 'IME',
        statement:
          'The uniform distribution p_k = 1 / K uniquely maximizes Shannon entropy H(p) = ln(K) over the K-simplex under permutation invariance.',
        validityCondition: 'Finite exhaustive partition with symmetric label exchangeability.',
      },
    ],
    knownLimitations: [
      'Contains zero empirical information (effectiveSampleSize = 0) and must NEVER be presented as an empirically calibrated or evidence-backed forecast.',
      'Not partition-invariant under arbitrary refinement of continuous thresholds or absorbing barriers.',
    ],
    failureConditions: [
      'Discretized continuous partitions with asymmetric bin widths or first-passage barrier problems where label symmetry is scientifically false.',
      'Caller explicitly forbids non-evidential structural baselines.',
    ],
    dependenceProfile: {
      correlationGroupId: 'structural-symmetry-baseline-family',
      sharedInformationChannels: ['outcome-partition-symmetry'],
      sharedLatentAssumptions: [
        'exhaustive-mutually-exclusive-categories',
        'principle-of-indifference-partition-symmetry',
      ],
      correlatedWithMethodIds: [],
      independenceWarning:
        'Carries zero empirical sample size; must be kept separate from evidence-driven methods and must never inflate effectiveIndependentMethodCount.',
    },
    hasExecutableImplementation: true,
    implementationStatus: 'implemented-and-verified',
  },
];

/**
 * Constructs a validated, deeply immutable `ScientificMethodRegistry` from an
 * ordered list of method descriptors.
 *
 * Validates every descriptor via `validateScientificMethodDescriptor` and
 * enforces registry-wide integrity:
 *   1. Non-empty descriptor list.
 *   2. Unique `methodId` across all descriptors (rejects duplicates).
 *   3. Referential integrity of `dependenceProfile.correlatedWithMethodIds`
 *      (every referenced method must exist in the registry).
 *   4. Reciprocal symmetry of `dependenceProfile.correlatedWithMethodIds`
 *      (if method A lists method B, method B must also list method A;
 *      asymmetric declarations are rejected without silent repair).
 */
export function createScientificMethodRegistry(
  descriptors: readonly unknown[],
  version: string = SCIENTIFIC_METHOD_REGISTRY_VERSION,
): ScientificMethodRegistry {
  const validatedVersion = assertNonEmptyTrimmedString(version, 'registry.version');
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new RangeError('ScientificMethodRegistry requires a non-empty array of descriptors');
  }

  const byId = new Map<ScientificMethodId, ScientificMethodDescriptor>();
  const orderedDescriptors: ScientificMethodDescriptor[] = [];
  const orderedIds: ScientificMethodId[] = [];

  for (let i = 0; i < descriptors.length; i++) {
    const validated = validateScientificMethodDescriptor(descriptors[i]);
    if (byId.has(validated.methodId)) {
      throw new RangeError(
        `Duplicate ScientificMethodId '${validated.methodId}' at index ${i}: registry forbids duplicate method identifiers`,
      );
    }
    byId.set(validated.methodId, validated);
    orderedDescriptors.push(validated);
    orderedIds.push(validated.methodId);
  }

  // Verify that all referenced correlatedWithMethodIds exist in the registry
  // and that every declared correlation link is reciprocal (symmetric):
  for (const desc of orderedDescriptors) {
    for (const corrId of desc.dependenceProfile.correlatedWithMethodIds) {
      const peer = byId.get(corrId);
      if (!peer) {
        throw new RangeError(
          `Descriptor '${desc.methodId}' references unknown correlatedWithMethodId '${corrId}'`,
        );
      }
      if (!peer.dependenceProfile.correlatedWithMethodIds.includes(desc.methodId)) {
        throw new RangeError(
          `Asymmetric correlation relationship: '${desc.methodId}' declares correlatedWithMethodIds containing '${corrId}', but '${corrId}' does not declare '${desc.methodId}' in correlatedWithMethodIds`,
        );
      }
    }
  }

  const frozenDescriptors = Object.freeze(orderedDescriptors);
  const frozenIds = Object.freeze(orderedIds);

  const registry: ScientificMethodRegistry = {
    version: validatedVersion,
    size: frozenDescriptors.length,
    methodIds: frozenIds,
    descriptors: frozenDescriptors,
    get(methodId: ScientificMethodId): ScientificMethodDescriptor | undefined {
      return byId.get(methodId);
    },
    getOrThrow(methodId: ScientificMethodId): ScientificMethodDescriptor {
      const found = byId.get(methodId);
      if (!found) {
        throw new RangeError(
          `ScientificMethodId '${String(methodId)}' is not registered in ScientificMethodRegistry (v${validatedVersion})`,
        );
      }
      return found;
    },
    has(methodId: string): boolean {
      return byId.has(methodId as ScientificMethodId);
    },
    listAll(): readonly ScientificMethodDescriptor[] {
      return frozenDescriptors;
    },
    listByFamily(family: ScientificMethodFamily): readonly ScientificMethodDescriptor[] {
      return Object.freeze(
        frozenDescriptors.filter((d) => d.methodFamily === family),
      );
    },
    listByOutcomeSpaceKind(kind: OutcomeSpaceKind): readonly ScientificMethodDescriptor[] {
      return Object.freeze(
        frozenDescriptors.filter((d) =>
          d.outcomeSpaceCompatibility.supportedKinds.includes(kind),
        ),
      );
    },
    listByCorrelationGroup(
      correlationGroupId: string,
    ): readonly ScientificMethodDescriptor[] {
      return Object.freeze(
        frozenDescriptors.filter(
          (d) => d.dependenceProfile.correlationGroupId === correlationGroupId,
        ),
      );
    },
  };

  return Object.freeze(registry);
}

/**
 * Default immutable registry containing the 7 core scientific forecasting
 * methods specified in THE ORACLE Consolidated Mathematical Specification.
 */
export const DEFAULT_SCIENTIFIC_METHOD_REGISTRY: ScientificMethodRegistry =
  createScientificMethodRegistry(
    CORE_METHOD_DESCRIPTORS_RAW,
    SCIENTIFIC_METHOD_REGISTRY_VERSION,
  );
