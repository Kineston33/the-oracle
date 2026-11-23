/**
 * Publication evaluation, lifecycle, and atomic registry rules (v1.2).
 *
 * Everything in this file is a pure function over a candidate, injected clocks,
 * and a registry contract. There is no persistent storage, no network and no
 * machine clock of its own: the clock is injected, so the same rules produce
 * the same verdicts in tests, in a future backend, and in any audit.
 *
 * The rules this file enforces:
 *   · a plausible-sounding candidate is not a publishable one;
 *   · a manually forged `eligible-for-publication` stage cannot bypass lifecycle
 *     transitions, identity matching, and evaluation;
 *   · a candidate for one proposition cannot publish another proposition's
 *     identity;
 *   · `request.candidateDigest` is verified against `candidateContentDigest`;
 *   · an idempotency key is permanently bound to the canonical digest of the
 *     publication-relevant candidate and request content;
 *   · `publishedAt` and `recordedAt` come from injected clocks with
 *     `recordedAt > publishedAt` (never synthesized by adding +1ms);
 *   · `publishedAt < candidate.horizon.endsAt` and every evidence item's
 *     `publishedAt <= publishedAt`;
 *   · newly constructed official records carry `demo: false` and are validated
 *     separately from the historical demo archive (`validateOfficialRecord`);
 *   · claiming an identity, sealing the initial `PredictionRecord`, and binding
 *     the idempotency outcome occur through a single atomic registry boundary.
 */

import {
  canonicalIdentity,
  compareIdentities,
  identityDigest,
  type AliasTable,
} from './canonical-identity.ts';
import {
  EVENT_ALGORITHM,
  EVENT_SCHEMA_VERSION,
  PUBLISHED_SCOPE,
   SUPPORTED_SCHEMA_VERSIONS,
  canonicalize,
  eventEnvelope,
  sealedPayload,
} from './events.ts';
import { sha256Hex } from './hash.ts';
import { deriveLifecycle } from './lifecycle.ts';
import {
  EVALUATION_REQUIREMENTS,
  LIFECYCLE,
  PUBLISHABLE_STAGE,
  type AtomicPublicationCommit,
  type AtomicPublicationResult,
  type CandidateProposition,
  type EvaluationRequirementId,
  type EvaluationVerdict,
  type IdempotencyLookupResult,
  type IdempotencyRecordResult,
  type PropositionStage,
  type PublicationOutcome,
  type PublicationRegistry,
  type PublicationRequest,
  type RequirementResult,
} from './publication-types.ts';
import type { PredictionRecord, RecordEvent } from './types.ts';
import {
  canonicalKey,
  eventChainProblems,
  findCanonicalCollisions,
  publishedLinkProblems,
  recomputeDeclaredDigest,
} from './validate.ts';

/* -------------------------------------------------------------------------
   Temporal validation
   ------------------------------------------------------------------------- */

const ISO_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * Parse a strict UTC ISO-8601 timestamp into epoch milliseconds.
 *
 * Rejects impossible calendar dates (such as `2026-02-29` or `2030-02-30` or
 * `2030-04-31`) that `Date.parse` / `new Date` would silently roll over into the
 * following month, as well as date-only strings or out-of-range clock fields.
 */
export function parseIsoDateTimeMs(value: string): number | null {
  const match = ISO_UTC_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const ms = match[7] !== undefined ? Number(match[7].padEnd(3, '0')) : 0;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (Number.isNaN(epoch)) return null;

  const date = new Date(epoch);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return epoch;
}

/** True only when `value` is a real calendar UTC ISO-8601 timestamp. */
export function isValidIsoDateTime(value: string): boolean {
  return parseIsoDateTimeMs(value) !== null;
}

/* -------------------------------------------------------------------------
   Lifecycle transitions & anti-forgery attestation
   ------------------------------------------------------------------------- */

export class TransitionError extends Error {}
export class InvalidClockError extends Error {}

export interface EvaluationOptions {
  /**
   * The UTC timestamp at which publication is being evaluated.
   *
   * When supplied (as `publishCandidate` always does from the injected
   * publication clock), `fixed-horizon` requires `publishedAt < horizon.endsAt`
   * and `preserved-evidence-provenance` requires every evidence item's
   * `publishedAt <= publishedAt`. When omitted in standalone evaluation,
   * `candidate.createdAt` is used as the reference timestamp.
   */
  publishedAt?: string;
}

interface LifecycleAttestation {
  stage: PropositionStage;
  contentSnapshot: string;
}

/**
 * Module-private attestation table.
 *
 * A caller that constructs `{ ...candidate, stage: 'eligible-for-publication' }`
 * by hand — or clones and edits a qualified candidate — does not possess an
 * entry in this WeakMap with a matching content snapshot. Only
 * `advanceCandidate` (and `qualifyCandidate`, which delegates to it) can record
 * an attestation, and only after verifying the required stage gates.
 */
const lifecycleAttestations = new WeakMap<CandidateProposition, LifecycleAttestation>();

function candidateContentSnapshot(candidate: CandidateProposition): string {
  return canonicalize({
    candidateId: candidate.candidateId,
    submittedQuery: candidate.submittedQuery,
    proposedQuestion: candidate.proposedQuestion,
    proposedIdentity: candidate.proposedIdentity,
    category: candidate.category,
    probability: candidate.probability,
    rationale: candidate.rationale,
    horizon: candidate.horizon,
    resolutionCriteria: candidate.resolutionCriteria,
    evidence: candidate.evidence,
    disclosedLimitations: candidate.disclosedLimitations,
    inferences: candidate.inferences,
  });
}

/** True only if the lifecycle allows this exact edge. */
export function canTransition(from: PropositionStage, to: PropositionStage): boolean {
  return LIFECYCLE[from].includes(to);
}

/**
 * Move a stage label forward, refusing anything the lifecycle does not allow.
 */
export function advance(from: PropositionStage, to: PropositionStage): PropositionStage {
  if (!canTransition(from, to)) {
    throw new TransitionError(`Lifecycle does not allow ${from} → ${to}`);
  }
  return to;
}

/** True when the stage value is the sole publishable stage. */
export function isPublishable(stage: PropositionStage): boolean {
  return stage === PUBLISHABLE_STAGE;
}

/**
 * True only when `candidate` reached `eligible-for-publication` through
 * `advanceCandidate` / `qualifyCandidate` AND its content has not been mutated
 * since qualification.
 */
export function isVerifiedEligibleCandidate(candidate: CandidateProposition): boolean {
  if (candidate.stage !== PUBLISHABLE_STAGE) return false;
  const attestation = lifecycleAttestations.get(candidate);
  if (!attestation) return false;
  return (
    attestation.stage === PUBLISHABLE_STAGE &&
    attestation.contentSnapshot === candidateContentSnapshot(candidate)
  );
}

/**
 * Advance a candidate proposition one step along `LIFECYCLE`, enforcing gate
 * preconditions and recording an unforgeable attestation for the new stage.
 */
export function advanceCandidate(
  candidate: CandidateProposition,
  to: PropositionStage,
  aliases?: AliasTable,
  options?: EvaluationOptions,
): CandidateProposition {
  if (!canTransition(candidate.stage, to)) {
    throw new TransitionError(`Lifecycle does not allow ${candidate.stage} → ${to}`);
  }

  const snapshot = candidateContentSnapshot(candidate);
  if (
    candidate.stage !== 'exploratory-query' &&
    candidate.stage !== 'candidate-proposition'
  ) {
    const prior = lifecycleAttestations.get(candidate);
    if (!prior || prior.stage !== candidate.stage || prior.contentSnapshot !== snapshot) {
      throw new TransitionError(
        `Cannot advance from unverified or forged stage '${candidate.stage}'`,
      );
    }
  }

  if (candidate.stage === 'identity-matching' && to === 'evaluation') {
    const match = compareIdentities(
      candidate.proposedIdentity,
      candidate.proposedIdentity,
      aliases,
    );
    if (match.outcome !== 'equivalent') {
      throw new TransitionError(
        `Cannot advance to evaluation: proposed identity is ${match.outcome} (${match.detail})`,
      );
    }
  }

  if (candidate.stage === 'evaluation' && to === 'eligible-for-publication') {
    const verdict = evaluateCandidate(candidate, options);
    if (!verdict.eligible) {
      const failed = verdict.results
        .filter((entry) => !entry.passed)
        .map((entry) => entry.id)
        .join(', ');
      throw new TransitionError(
        `Cannot advance to eligible-for-publication: failed requirements (${failed})`,
      );
    }
  }

  const next: CandidateProposition = Object.freeze({
    ...candidate,
    stage: to,
  });
  lifecycleAttestations.set(next, { stage: to, contentSnapshot: snapshot });
  return next;
}

/**
 * Step a draft candidate from `exploratory-query` or `candidate-proposition`
 * through `identity-matching` and `evaluation` to `eligible-for-publication`.
 *
 * Refuses to qualify a candidate that starts at an unattested advanced stage or
 * fails either identity resolution or evaluation.
 */
export function qualifyCandidate(
  candidate: CandidateProposition,
  aliases?: AliasTable,
  options?: EvaluationOptions,
): CandidateProposition {
  let current = candidate;
  if (current.stage === 'exploratory-query') {
    current = advanceCandidate(current, 'candidate-proposition', aliases, options);
  }
  if (current.stage === 'candidate-proposition') {
    current = advanceCandidate(current, 'identity-matching', aliases, options);
  }
  if (current.stage === 'identity-matching') {
    current = advanceCandidate(current, 'evaluation', aliases, options);
  }
  if (current.stage === 'evaluation') {
    current = advanceCandidate(current, 'eligible-for-publication', aliases, options);
    return current;
  }
  if (isVerifiedEligibleCandidate(current)) {
    return current;
  }
  throw new TransitionError(
    `Cannot qualify candidate starting from stage '${current.stage}' without a verified lifecycle history`,
  );
}

/* -------------------------------------------------------------------------
   Evaluation
   ------------------------------------------------------------------------- */

function result(
  id: EvaluationRequirementId,
  passed: boolean,
  reason: string,
): RequirementResult {
  return { id, passed, reason };
}

/**
 * Check a candidate against every publication requirement.
 *
 * Each check is deliberately narrow and states what it saw. Where information is
 * absent the requirement fails with "missing", never with "assumed":
 *
 *   · no probability is a failure, not a default of 0.5;
 *   · no evidence is a failure, not "evidence-free but plausible";
 *   · an unresolved deciding authority is a failure, not "unknown but fine";
 *   · impossible calendar dates, reversed horizons, expired horizons
 *     (`publishedAt >= horizon.endsAt`), inconsistent resolution dates, or
 *     evidence dated after `publishedAt` fail outright.
 */
export function evaluateCandidate(
  candidate: CandidateProposition,
  options?: EvaluationOptions,
): EvaluationVerdict {
  const results: RequirementResult[] = [];
  const referencePublishedAt = options?.publishedAt ?? candidate.createdAt;
  const publishedMs = parseIsoDateTimeMs(referencePublishedAt);

  results.push(
    result(
      'unambiguous-question',
      candidate.proposedQuestion.trim().length > 0 &&
        !/\b(maybe|possibly|might|unclear|either)\b/i.test(candidate.proposedQuestion),
      candidate.proposedQuestion.trim().length === 0
        ? 'No question text was supplied.'
        : 'Question text is present and contains no hedging words.',
    ),
  );

  // Falsifiability is a property a reviewer must assert, not something a string
  // check can prove. The protocol records the assertion; it does not manufacture
  // one, so an absent assertion fails.
  const falsifiable = candidate.inferences.some(
    (inference) => inference.rule === 'falsifiability-review',
  );
  results.push(
    result(
      'falsifiable-proposition',
      falsifiable,
      falsifiable
        ? 'A falsifiability review is recorded on the candidate.'
        : 'No falsifiability review was recorded. This cannot be inferred from wording.',
    ),
  );

  const horizon = candidate.horizon;
  const startMs = horizon ? parseIsoDateTimeMs(horizon.startsAt) : null;
  const endMs = horizon ? parseIsoDateTimeMs(horizon.endsAt) : null;
  const horizonLabelValid = horizon !== null && horizon.label.trim().length > 0;
  const horizonDatesValid = startMs !== null && endMs !== null;
  const horizonOrdered = horizonDatesValid && startMs < endMs;
  const horizonOpenAtPublication =
    horizonOrdered && publishedMs !== null && publishedMs < endMs;
  const horizonPassed = horizonLabelValid && horizonOpenAtPublication;
  let horizonReason: string;
  if (horizon === null) {
    horizonReason = 'No time horizon was fixed.';
  } else if (!horizonLabelValid) {
    horizonReason = 'Time horizon label is empty.';
  } else if (!horizonDatesValid) {
    horizonReason = `Time horizon contains an invalid UTC ISO-8601 timestamp (startsAt='${horizon.startsAt}', endsAt='${horizon.endsAt}').`;
  } else if (!horizonOrdered) {
    horizonReason = `Time horizon start (${horizon.startsAt}) must strictly precede its end (${horizon.endsAt}).`;
  } else if (publishedMs === null) {
    horizonReason = `Publication timestamp '${referencePublishedAt}' is not a valid calendar UTC ISO-8601 timestamp.`;
  } else if (!horizonOpenAtPublication) {
    horizonReason = `Publication timestamp (${referencePublishedAt}) must precede the horizon end (${horizon.endsAt}); the forecast window has already closed.`;
  } else {
    horizonReason = 'Time horizon is fixed, chronologically ordered, and open at publication time.';
  }
  results.push(result('fixed-horizon', horizonPassed, horizonReason));

  const resolutionDate = candidate.proposedIdentity.resolutionDate;
  const resolutionMs = parseIsoDateTimeMs(resolutionDate);
  const criteriaResolveOn = candidate.resolutionCriteria?.resolveOn;
  const criteriaResolveMs =
    criteriaResolveOn !== undefined ? parseIsoDateTimeMs(criteriaResolveOn) : null;
  const criteriaAgrees =
    candidate.resolutionCriteria === null ||
    (criteriaResolveMs !== null && criteriaResolveOn === resolutionDate);
  const afterHorizonEnd =
    resolutionMs !== null &&
    (endMs === null || (resolutionMs >= endMs && (startMs === null || resolutionMs > startMs)));
  const resolutionDatePassed =
    resolutionMs !== null && afterHorizonEnd && criteriaAgrees;
  let resolutionDateReason: string;
  if (!resolutionDate) {
    resolutionDateReason = 'No resolution date was fixed.';
  } else if (resolutionMs === null) {
    resolutionDateReason = `Resolution date '${resolutionDate}' is not a valid calendar UTC ISO-8601 timestamp.`;
  } else if (!afterHorizonEnd) {
    resolutionDateReason = `Resolution date (${resolutionDate}) cannot precede the end of the declared horizon (${horizon?.endsAt ?? ''}).`;
  } else if (!criteriaAgrees) {
    resolutionDateReason = `Resolution criteria resolveOn ('${criteriaResolveOn ?? ''}') does not match proposedIdentity.resolutionDate ('${resolutionDate}').`;
  } else {
    resolutionDateReason = `Resolution date is ${resolutionDate} and is consistent with the horizon and resolution criteria.`;
  }
  results.push(
    result('fixed-resolution-date', resolutionDatePassed, resolutionDateReason),
  );

  results.push(
    result(
      'identified-authority',
      candidate.proposedIdentity.decidingAuthority.unresolved !== true &&
        candidate.proposedIdentity.decidingAuthority.id !== 'unknown',
      candidate.proposedIdentity.decidingAuthority.unresolved === true ||
        candidate.proposedIdentity.decidingAuthority.id === 'unknown'
        ? 'The deciding authority is unresolved.'
        : 'A deciding authority is identified.',
    ),
  );

  const criteria = candidate.resolutionCriteria;
  const criteriaValid =
    criteria !== null &&
    criteria.rule.trim().length > 0 &&
    criteria.authority.trim().length > 0 &&
    parseIsoDateTimeMs(criteria.resolveOn) !== null;
  results.push(
    result(
      'objective-criteria',
      criteriaValid,
      criteria === null
        ? 'No resolution criteria were supplied.'
        : !criteriaValid
          ? 'Resolution criteria are missing a rule, an authority, or a valid resolveOn timestamp.'
          : 'Resolution criteria name a rule, an authority, and a valid resolution date.',
    ),
  );

  const probability = candidate.probability;
  results.push(
    result(
      'probability-in-range',
      probability !== null && Number.isFinite(probability) && probability > 0 && probability < 1,
      probability === null
        ? 'No probability was supplied.'
        : `Probability ${probability} is ${probability > 0 && probability < 1 ? 'inside' : 'outside'} (0, 1).`,
    ),
  );

  results.push(
    result(
      'documented-rationale',
      candidate.rationale !== null && candidate.rationale.trim().length > 0,
      candidate.rationale === null
        ? 'No rationale was documented.'
        : 'A rationale is recorded.',
    ),
  );

  results.push(
    result(
      'recorded-evidence',
      candidate.evidence.length > 0,
      candidate.evidence.length === 0
        ? 'No supporting evidence was recorded.'
        : `${candidate.evidence.length} evidence reference(s) recorded.`,
    ),
  );

  const provenanceFieldsComplete = candidate.evidence.every(
    (item) =>
      isValidIsoDateTime(item.publishedAt) &&
      item.publisher.trim().length > 0 &&
      item.title.trim().length > 0,
  );
  const futureEvidence =
    provenanceFieldsComplete && publishedMs !== null
      ? candidate.evidence.find((item) => {
          const itemMs = parseIsoDateTimeMs(item.publishedAt);
          return itemMs === null || itemMs > publishedMs;
        })
      : undefined;
  const provenanceChronologyValid =
    provenanceFieldsComplete && publishedMs !== null && futureEvidence === undefined;
  let provenanceReason: string;
  if (candidate.evidence.length === 0) {
    provenanceReason = 'No evidence exists, so no provenance can be preserved.';
  } else if (!provenanceFieldsComplete) {
    provenanceReason =
      'At least one evidence item is missing its publisher, title, or a valid UTC publishedAt timestamp.';
  } else if (publishedMs === null) {
    provenanceReason = `Publication timestamp '${referencePublishedAt}' is not a valid calendar UTC ISO-8601 timestamp.`;
  } else if (futureEvidence !== undefined) {
    provenanceReason = `Evidence item '${futureEvidence.id}' publishedAt (${futureEvidence.publishedAt}) is later than the publication timestamp (${referencePublishedAt}).`;
  } else {
    provenanceReason =
      'Every evidence item carries a publisher, a title, and a valid UTC timestamp on or before publication.';
  }
  results.push(
    result(
      'preserved-evidence-provenance',
      candidate.evidence.length > 0 && provenanceChronologyValid,
      provenanceReason,
    ),
  );

  results.push(
    result(
      'disclosed-limitations',
      candidate.disclosedLimitations.length > 0,
      candidate.disclosedLimitations.length === 0
        ? 'No limitations were disclosed. A forecast with no stated limits is not being honest.'
        : `${candidate.disclosedLimitations.length} limitation(s) disclosed.`,
    ),
  );

  const eligible = results.every((entry) => entry.passed);

  const CLARIFIABLE: EvaluationRequirementId[] = [
    'unambiguous-question',
    'fixed-horizon',
    'fixed-resolution-date',
    'identified-authority',
    'objective-criteria',
    'probability-in-range',
    'documented-rationale',
    'recorded-evidence',
    'preserved-evidence-provenance',
    'disclosed-limitations',
    'falsifiable-proposition',
  ];

  return {
    results,
    eligible,
    clarificationsRequired: results
      .filter((entry) => !entry.passed && CLARIFIABLE.includes(entry.id))
      .map((entry) => entry.id),
  };
}

/** Every requirement id appears exactly once, in canonical order. */
export function verdictIsComplete(verdict: EvaluationVerdict): boolean {
  return (
    verdict.results.length === EVALUATION_REQUIREMENTS.length &&
    verdict.results.every((entry, index) => entry.id === EVALUATION_REQUIREMENTS[index])
  );
}

/* -------------------------------------------------------------------------
   Versioned candidate & request digests + official sealed record construction
   ------------------------------------------------------------------------- */

export const CANDIDATE_CONTENT_SCHEMA = 'oracle.candidate/1' as const;
export const PUBLICATION_REQUEST_SCHEMA = 'oracle.publication-request/1' as const;

function canonicalCandidateContent(
  candidate: CandidateProposition,
  aliases?: AliasTable,
): Record<string, unknown> {
  return {
    candidateId: candidate.candidateId,
    submittedQuery: candidate.submittedQuery,
    proposedQuestion: candidate.proposedQuestion,
    proposedIdentity: canonicalIdentity(candidate.proposedIdentity, aliases),
    category: candidate.category,
    probability: candidate.probability,
    rationale: candidate.rationale,
    horizon: candidate.horizon,
    resolutionCriteria: candidate.resolutionCriteria,
    evidence: candidate.evidence,
    disclosedLimitations: candidate.disclosedLimitations,
    inferences: candidate.inferences,
  };
}

/**
 * Versioned SHA-256 digest of a candidate's publication-relevant content.
 *
 * Computed over `oracle.candidate/1\n` + canonical JSON of all content fields
 * (with `proposedIdentity` resolved through `aliases`).
 */
export async function candidateContentDigest(
  candidate: CandidateProposition,
  aliases?: AliasTable,
): Promise<string> {
  const body = canonicalize(canonicalCandidateContent(candidate, aliases));
  return sha256Hex(`${CANDIDATE_CONTENT_SCHEMA}\n${body}`);
}

/**
 * Versioned SHA-256 digest of the complete publication command.
 *
 * Binds an `idempotencyKey` to every publication-relevant field of both the
 * `CandidateProposition` and the `PublicationRequest` (including the canonical
 * proposition identity, probability, rationale, horizon, resolution criteria,
 * evidence, limitations, inferences, and declared `candidateDigest`). Any
 * difference in content produces a different digest and triggers
 * `idempotency-conflict` when the same key is reused.
 */
export async function publicationRequestDigest(
  candidate: CandidateProposition,
  request: PublicationRequest,
  aliases?: AliasTable,
): Promise<string> {
  const envelope = {
    schema: PUBLICATION_REQUEST_SCHEMA,
    candidate: canonicalCandidateContent(candidate, aliases),
    request: {
      candidateId: request.candidateId,
      identity: canonicalIdentity(request.identity, aliases),
      candidateDigest: request.candidateDigest,
    },
  };
  return sha256Hex(`${PUBLICATION_REQUEST_SCHEMA}\n${canonicalize(envelope)}`);
}

/**
 * Construct a complete, domain-sealed official `PredictionRecord` (`demo: false`)
 * and initial `e0` (`published`) event from an eligible candidate.
 *
 * Requires explicit, valid UTC ISO-8601 `publishedAt` and `recordedAt`
 * timestamps with `recordedAt > publishedAt` (never synthesized by adding +1ms
 * or reading the machine clock).
 *
 * Note on validation boundaries:
 *   · `validateArchive` in `src/data/validate.ts` is the build-time gate for the
 *     static v0.1 illustrative dataset (`src/data/records.json`) and enforces
 *     `demo: true` on every shipped demo record.
 *   · Newly constructed official records carry `demo: false` (they are not
 *     illustrative demos) and are validated by `validateOfficialRecord` /
 *     `validateOfficialArchive` below.
 */
export async function buildSealedPredictionRecord(
  candidate: CandidateProposition,
  predictionId: string,
  publishedAt: string,
  recordedAt: string,
): Promise<PredictionRecord> {
  const publishedMs = parseIsoDateTimeMs(publishedAt);
  if (publishedMs === null) {
    throw new InvalidClockError(
      `publishedAt '${publishedAt}' is not a valid calendar UTC ISO-8601 timestamp.`,
    );
  }
  const recordedMs = parseIsoDateTimeMs(recordedAt);
  if (recordedMs === null) {
    throw new InvalidClockError(
      `recordedAt '${recordedAt}' is not a valid calendar UTC ISO-8601 timestamp.`,
    );
  }
  if (recordedMs <= publishedMs) {
    throw new InvalidClockError(
      `recordedAt (${recordedAt}) must be strictly later than publishedAt/occurredAt (${publishedAt}).`,
    );
  }

  const baseRecord: PredictionRecord = {
    id: predictionId,
    canonicalQuestion: candidate.proposedQuestion,
    title: candidate.proposedQuestion,
    category: candidate.category,
    publishedAt,
    probability: candidate.probability!,
    horizon: candidate.horizon!,
    resolutionCriteria: candidate.resolutionCriteria!,
    evidence: candidate.evidence,
    demo: false,
    sealClaim: 'published-before-outcome',
    events: [],
    integrity: {
      algorithm: 'SHA-256',
      digest: '',
      payloadScope: 'sealed-payload',
      revision: 1,
      channel: 'public-archive',
      anchored: false,
    },
  };

  const payloadDigest = await sha256Hex(canonicalize(sealedPayload(baseRecord)));

  const initialEventDraft: RecordEvent = {
    seq: 'e0',
    kind: 'published',
    occurredAt: publishedAt,
    recordedAt,
    origin: 'observed',
    algorithm: EVENT_ALGORITHM,
    schemaVersion: EVENT_SCHEMA_VERSION,
    scope: PUBLISHED_SCOPE,
    body: {
      payloadDigest,
      payloadScope: 'sealed-payload',
      sealClaim: 'published-before-outcome',
      note: 'Initial official publication sealed under Official Publication Protocol v1.2.',
    },
    digest: '',
    prevDigest: null,
  };

  const e0Digest = await sha256Hex(canonicalize(eventEnvelope(initialEventDraft)));
  const e0: RecordEvent = Object.freeze({
    ...initialEventDraft,
    digest: e0Digest,
  });

  return Object.freeze({
    ...baseRecord,
    events: [e0],
    integrity: Object.freeze({
      ...baseRecord.integrity,
      digest: payloadDigest,
    }),
  });
}

/**
 * Validate a newly constructed official `PredictionRecord` (`demo: false`).
 *
 * Distinct from `validateArchive` in `src/data/validate.ts`, which is the
 * static demo-archive build gate (`demo: true` required). Official records
 * constructed through the publication protocol must carry:
 *   · `demo: false` (never mislabelled as an illustrative demo);
 *   · `integrity.payloadScope === 'sealed-payload'`;
 *   · `sealClaim === 'published-before-outcome'`;
 *   · `integrity.anchored === false` (until a verifiable external witness proof
 *     is implemented);
 *   · valid UTC timestamps with `horizon.startsAt < horizon.endsAt`,
 *     `publishedAt < horizon.endsAt`, `resolutionCriteria.resolveOn >= horizon.endsAt`,
 *     and every `evidence[i].publishedAt <= publishedAt`;
 *   · a reproducing `integrity.digest`, valid publication link (`e0`), and
 *     reproducing schema-2 event digests.
 */
export async function validateOfficialRecord(
  record: PredictionRecord,
): Promise<string[]> {
  return validateOfficialArchive([record]);
}

export async function validateOfficialArchive(
  records: readonly PredictionRecord[],
): Promise<string[]> {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) problems.push(`Duplicate record id: ${record.id}`);
    ids.add(record.id);

    if (!/^ORC-\d{4}-\d{4}$/.test(record.id)) {
      problems.push(`Malformed record id: ${record.id}`);
    }
    if (record.demo !== false) {
      problems.push(
        `Official record ${record.id} must have demo: false (demo: true is reserved for illustrative records)`,
      );
    }
    if (record.evidence.length === 0) {
      problems.push(`Record ${record.id} has no evidence`);
    }
    if (record.probability <= 0 || record.probability >= 1) {
      problems.push(`Record ${record.id} has an out-of-range probability`);
    }
    if (!/^[0-9a-f]{64}$/.test(record.integrity.digest)) {
      problems.push(`Record ${record.id} has no valid SHA-256 digest`);
    }

    const publishedMs = parseIsoDateTimeMs(record.publishedAt);
    const startMs = parseIsoDateTimeMs(record.horizon.startsAt);
    const endMs = parseIsoDateTimeMs(record.horizon.endsAt);
    const resolveOnMs = parseIsoDateTimeMs(record.resolutionCriteria.resolveOn);

    if (publishedMs === null) {
      problems.push(`Record ${record.id} has an invalid publishedAt timestamp`);
    }
    if (startMs === null || endMs === null || startMs >= endMs) {
      problems.push(`Record ${record.id} has an invalid or reversed horizon`);
    }
    if (publishedMs !== null && endMs !== null && endMs <= publishedMs) {
      problems.push(`Record ${record.id} ends at or before it was published`);
    }
    if (resolveOnMs === null || (endMs !== null && resolveOnMs < endMs)) {
      problems.push(`Record ${record.id} resolves before its horizon ends`);
    }

    for (const item of record.evidence) {
      const itemMs = parseIsoDateTimeMs(item.publishedAt);
      if (itemMs === null) {
        problems.push(
          `Record ${record.id} evidence '${item.id}' has an invalid publishedAt timestamp`,
        );
      } else if (publishedMs !== null && itemMs > publishedMs) {
        problems.push(
          `Record ${record.id} evidence '${item.id}' postdates publication (${item.publishedAt} > ${record.publishedAt})`,
        );
      }
    }

    const lifecycle = deriveLifecycle(record);
    if (lifecycle.status === 'resolved' && lifecycle.resolution?.outcome === 'indeterminate') {
      problems.push(`Record ${record.id} is resolved with an indeterminate outcome`);
    }
    if (!canonicalKey(record.canonicalQuestion)) {
      problems.push(`Record ${record.id} has an empty canonical question`);
    }
    if (record.integrity.payloadScope !== 'sealed-payload') {
      problems.push(
        `Official record ${record.id} must use payloadScope 'sealed-payload', got '${record.integrity.payloadScope}'`,
      );
    }
    if (record.sealClaim !== 'published-before-outcome') {
      problems.push(
        `Official record ${record.id} must declare sealClaim 'published-before-outcome', got '${record.sealClaim}'`,
      );
    }
    if (record.integrity.algorithm !== 'SHA-256') {
      problems.push(
        `Record ${record.id} declares unknown digest algorithm '${record.integrity.algorithm}'`,
      );
    }
    if (record.integrity.anchored) {
      problems.push(
        `Record ${record.id} claims external anchoring, but no verifiable external witness is implemented`,
      );
    }

    problems.push(...eventChainProblems(record));

    const recomputed = await recomputeDeclaredDigest(record);
    const matches = recomputed === record.integrity.digest;
    problems.push(...publishedLinkProblems(record, matches, recomputed));

    for (const event of record.events) {
      if (
        event.algorithm !== EVENT_ALGORITHM ||
        !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)
      ) {
        continue;
      }
      const recomputedEvent = await sha256Hex(canonicalize(eventEnvelope(event)));
      if (recomputedEvent !== event.digest) {
        problems.push(
          `Record ${record.id} event ${event.seq} digest does not reproduce from its contents`,
        );
      }
    }
  }

  for (const collision of findCanonicalCollisions(records)) {
    problems.push(
      `Canonical question claimed by more than one record without supersession: ${collision.ids.join(', ')}`,
    );
  }

  return problems;
}

/* -------------------------------------------------------------------------
   Publication
   ------------------------------------------------------------------------- */

export interface PublicationDeps {
  registry: PublicationRegistry;
  aliases?: AliasTable;
  /**
   * Injected clock returning UTC ISO-8601 timestamps.
   *
   * Read for `publishedAt` (`e0.occurredAt`) and — when `recordedAt` is not
   * supplied separately — read a second time when recording `e0`.
   */
  now: () => string;
  /**
   * Optional explicit clock for the moment `e0` is recorded into the chain.
   * When omitted, `now()` is invoked a second time. Never synthesized by adding
   * an arbitrary millisecond.
   */
  recordedAt?: () => string;
  /** Produces the id a newly created record will carry. */
  newPredictionId: (identityDigest: string) => string;
}

/**
 * Attempt to publish a candidate.
 *
 * The order of checks is the contract:
 *
 *   1. candidate binding — `request.candidateId === candidate.candidateId` and
 *      `request.identity` must match `candidate.proposedIdentity` under the
 *      alias table before any registry lookup or mutation;
 *   2. stage value — only `eligible-for-publication` may proceed;
 *   3. candidate digest — `request.candidateDigest` must be a 64-char hex
 *      SHA-256 matching `candidateContentDigest(candidate, aliases)`;
 *   4. clock validation — `publishedAt` and `recordedAt` from the injected
 *      clocks must be valid UTC ISO-8601 timestamps with
 *      `recordedAt > publishedAt`;
 *   5. idempotency lookup — a repeated key with identical request digest
 *      replays the original outcome; a repeated key with different content
 *      returns `idempotency-conflict`;
 *   6. identity self-check — any unresolved component blocks publication with
 *      `identity-conflict`;
 *   7. evaluation bound to `publishedAt` — any failed requirement (including
 *      `publishedAt >= horizon.endsAt` or `evidence[i].publishedAt > publishedAt`)
 *      blocks publication with `rejected`;
 *   8. lifecycle attestation — a manually forged `eligible-for-publication`
 *      stage that did not traverse `advanceCandidate` / `qualifyCandidate` is
 *      rejected with `wrong-stage` (`reason: 'forged-stage'`);
 *   9. atomic commit — constructs the `demo: false` sealed `PredictionRecord`
 *      with `(publishedAt, recordedAt)` and calls `registry.commitPublication`.
 */
export async function publishCandidate(
  candidate: CandidateProposition,
  request: PublicationRequest,
  deps: PublicationDeps,
): Promise<PublicationOutcome> {
  const aliases = deps.aliases ?? undefined;

  // 1a. Bind candidateId before touching the registry.
  if (request.candidateId !== candidate.candidateId) {
    return {
      kind: 'candidate-mismatch',
      reason: 'candidate-id',
      detail: `Request candidateId '${request.candidateId}' does not match candidate.candidateId '${candidate.candidateId}'.`,
    };
  }

  // 1b. Bind request.identity to candidate.proposedIdentity under the alias table
  // before touching the registry.
  const canonicalProposed = canonicalIdentity(candidate.proposedIdentity, aliases);
  const canonicalRequested = canonicalIdentity(request.identity, aliases);
  const identityBindingMatch = compareIdentities(
    candidate.proposedIdentity,
    request.identity,
    aliases,
  );
  if (
    identityBindingMatch.outcome === 'distinct' ||
    canonicalize(canonicalProposed) !== canonicalize(canonicalRequested)
  ) {
    return {
      kind: 'candidate-mismatch',
      reason: 'proposed-identity',
      detail:
        'Request identity does not match the candidate proposedIdentity under the configured alias table.',
      match: identityBindingMatch,
    };
  }

  // 2. Stage value check before touching the registry.
  if (!isPublishable(candidate.stage)) {
    return {
      kind: 'wrong-stage',
      stage: candidate.stage,
      required: PUBLISHABLE_STAGE,
      reason: 'invalid-stage',
      detail: `Candidate is in stage '${candidate.stage}', but publication requires '${PUBLISHABLE_STAGE}'.`,
    };
  }

  // 3. Verify request.candidateDigest against candidateContentDigest before
  // touching the registry.
  const [expectedCandidateDigest, requestDigest, digest] = await Promise.all([
    candidateContentDigest(candidate, aliases),
    publicationRequestDigest(candidate, request, aliases),
    identityDigest(request.identity, aliases),
  ]);

  if (request.candidateDigest.trim().length === 0) {
    return {
      kind: 'candidate-digest-mismatch',
      reason: 'missing',
      expectedDigest: expectedCandidateDigest,
      receivedDigest: request.candidateDigest,
      detail: 'PublicationRequest.candidateDigest is missing.',
    };
  }
  if (!/^[0-9a-f]{64}$/.test(request.candidateDigest)) {
    return {
      kind: 'candidate-digest-mismatch',
      reason: 'malformed',
      expectedDigest: expectedCandidateDigest,
      receivedDigest: request.candidateDigest,
      detail: `PublicationRequest.candidateDigest '${request.candidateDigest}' is not a 64-character lowercase hex SHA-256 digest.`,
    };
  }
  if (request.candidateDigest !== expectedCandidateDigest) {
    return {
      kind: 'candidate-digest-mismatch',
      reason: 'mismatch',
      expectedDigest: expectedCandidateDigest,
      receivedDigest: request.candidateDigest,
      detail:
        'PublicationRequest.candidateDigest does not match candidateContentDigest(candidate, aliases).',
    };
  }

  // 4. Obtain and validate injected publication and recording timestamps before
  // touching the registry.
  const publishedAt = deps.now();
  const recordedAt = deps.recordedAt ? deps.recordedAt() : deps.now();
  const publishedMs = parseIsoDateTimeMs(publishedAt);
  const recordedMs = parseIsoDateTimeMs(recordedAt);
  if (publishedMs === null || recordedMs === null || recordedMs <= publishedMs) {
    let clockDetail: string;
    if (publishedMs === null) {
      clockDetail = `Injected clock returned invalid publishedAt timestamp '${publishedAt}'.`;
    } else if (recordedMs === null) {
      clockDetail = `Injected clock returned invalid recordedAt timestamp '${recordedAt}'.`;
    } else {
      clockDetail = `Injected clock returned non-increasing timestamps: recordedAt (${recordedAt}) must be strictly later than publishedAt (${publishedAt}).`;
    }
    return {
      kind: 'invalid-clock',
      publishedAt,
      recordedAt,
      detail: clockDetail,
    };
  }

  // 5. Idempotency check bound to requestDigest.
  const prior = await deps.registry.findByIdempotencyKey(
    request.idempotencyKey,
    requestDigest,
  );
  if (prior.status === 'match') {
    return { kind: 'replayed', original: prior.outcome };
  }
  if (prior.status === 'conflict') {
    return {
      kind: 'idempotency-conflict',
      idempotencyKey: request.idempotencyKey,
      existingRequestDigest: prior.existingRequestDigest,
      incomingRequestDigest: prior.incomingRequestDigest,
      detail: `Idempotency key '${request.idempotencyKey}' is already bound to a different request digest.`,
    };
  }

  // 6. Identity self-check: uncertainty blocks publication.
  const selfCheck = compareIdentities(request.identity, request.identity, aliases);
  if (selfCheck.outcome !== 'equivalent') {
    const outcome: PublicationOutcome = { kind: 'identity-conflict', match: selfCheck };
    const recorded = await deps.registry.recordIdempotencyKey(
      request.idempotencyKey,
      requestDigest,
      outcome,
    );
    if (recorded.status === 'replayed') {
      return { kind: 'replayed', original: recorded.original };
    }
    if (recorded.status === 'idempotency-conflict') {
      return {
        kind: 'idempotency-conflict',
        idempotencyKey: request.idempotencyKey,
        existingRequestDigest: recorded.existingRequestDigest,
        incomingRequestDigest: recorded.incomingRequestDigest,
        detail: `Idempotency key '${request.idempotencyKey}' was concurrently bound to a different request digest.`,
      };
    }
    return outcome;
  }

  // 7. Evaluation gate bound to the actual publication timestamp `publishedAt`.
  const verdict = evaluateCandidate(candidate, { publishedAt });
  if (!verdict.eligible) {
    const outcome: PublicationOutcome = { kind: 'rejected', verdict };
    const recorded = await deps.registry.recordIdempotencyKey(
      request.idempotencyKey,
      requestDigest,
      outcome,
    );
    if (recorded.status === 'replayed') {
      return { kind: 'replayed', original: recorded.original };
    }
    if (recorded.status === 'idempotency-conflict') {
      return {
        kind: 'idempotency-conflict',
        idempotencyKey: request.idempotencyKey,
        existingRequestDigest: recorded.existingRequestDigest,
        incomingRequestDigest: recorded.incomingRequestDigest,
        detail: `Idempotency key '${request.idempotencyKey}' was concurrently bound to a different request digest.`,
      };
    }
    return outcome;
  }

  // 8. Anti-forgery lifecycle attestation check.
  if (!isVerifiedEligibleCandidate(candidate)) {
    return {
      kind: 'wrong-stage',
      stage: candidate.stage,
      required: PUBLISHABLE_STAGE,
      reason: 'forged-stage',
      detail:
        'Candidate stage eligible-for-publication was forged or modified without traversing the verified lifecycle transitions.',
    };
  }

  // 9. Build the non-demo sealed official record with `(publishedAt, recordedAt)`
  // and execute the single atomic registry commit.
  const predictionId = deps.newPredictionId(digest);
  const sealedRecord = await buildSealedPredictionRecord(
    candidate,
    predictionId,
    publishedAt,
    recordedAt,
  );

  const commitResult = await deps.registry.commitPublication({
    idempotencyKey: request.idempotencyKey,
    requestDigest,
    identityDigest: digest,
    predictionId,
    record: sealedRecord,
  });

  if (commitResult.status === 'replayed') {
    return { kind: 'replayed', original: commitResult.original };
  }
  if (commitResult.status === 'idempotency-conflict') {
    return {
      kind: 'idempotency-conflict',
      idempotencyKey: request.idempotencyKey,
      existingRequestDigest: commitResult.existingRequestDigest,
      incomingRequestDigest: commitResult.incomingRequestDigest,
      detail: `Idempotency key '${request.idempotencyKey}' was bound to a different request digest during concurrent execution.`,
    };
  }

  return commitResult.outcome;
}

/**
 * In-memory reference implementation of `PublicationRegistry`.
 *
 * Used by tests to verify the domain contract:
 *   · `commitPublication` checks the idempotency key, claims the canonical
 *     identity (or resolves the existing winner), stores the sealed
 *     `PredictionRecord`, and records the idempotency entry in a single
 *     synchronous critical section with no `await` points in between.
 *   · Because JavaScript is single-threaded and this store lives in process
 *     memory, it proves the domain ordering and state invariants, NOT
 *     distributed multi-process atomicity or crash durability. Production
 *     deployments must enforce the same contract via a relational ACID
 *     transaction (`docs/PUBLICATION-API-CONTRACT.md`).
 */
export class InMemoryRegistry implements PublicationRegistry {
  private readonly claims = new Map<
    string,
    { predictionId: string; record?: PredictionRecord }
  >();
  private readonly idempotency = new Map<
    string,
    { requestDigest: string; outcome: PublicationOutcome }
  >();

  async commitPublication(
    commit: AtomicPublicationCommit,
  ): Promise<AtomicPublicationResult> {
    const existingIdem = this.idempotency.get(commit.idempotencyKey);
    if (existingIdem) {
      if (existingIdem.requestDigest === commit.requestDigest) {
        return { status: 'replayed', original: existingIdem.outcome };
      }
      return {
        status: 'idempotency-conflict',
        existingRequestDigest: existingIdem.requestDigest,
        incomingRequestDigest: commit.requestDigest,
      };
    }

    const existingClaim = this.claims.get(commit.identityDigest);
    if (existingClaim) {
      const outcome: Extract<PublicationOutcome, { kind: 'existing' }> = {
        kind: 'existing',
        predictionId: existingClaim.predictionId,
        identityDigest: commit.identityDigest,
        requestDigest: commit.requestDigest,
        ...(existingClaim.record ? { record: existingClaim.record } : {}),
      };
      this.idempotency.set(commit.idempotencyKey, {
        requestDigest: commit.requestDigest,
        outcome,
      });
      return { status: 'existing', outcome };
    }

    this.claims.set(commit.identityDigest, {
      predictionId: commit.predictionId,
      record: commit.record,
    });
    const outcome: Extract<PublicationOutcome, { kind: 'created' }> = {
      kind: 'created',
      predictionId: commit.predictionId,
      identityDigest: commit.identityDigest,
      requestDigest: commit.requestDigest,
      record: commit.record,
    };
    this.idempotency.set(commit.idempotencyKey, {
      requestDigest: commit.requestDigest,
      outcome,
    });
    return { status: 'created', outcome };
  }

  async claimIdentity(
    identityDigest: string,
    predictionId: string,
    record?: PredictionRecord,
  ): Promise<{ status: 'claimed' } | { status: 'already-claimed'; predictionId: string }> {
    const existing = this.claims.get(identityDigest);
    if (existing) return { status: 'already-claimed', predictionId: existing.predictionId };
    this.claims.set(identityDigest, { predictionId, record });
    return { status: 'claimed' };
  }

  async findByIdentity(
    identityDigest: string,
  ): Promise<{ predictionId: string; record?: PredictionRecord } | null> {
    const found = this.claims.get(identityDigest);
    if (!found) return null;
    return {
      predictionId: found.predictionId,
      ...(found.record ? { record: found.record } : {}),
    };
  }

  async findByIdempotencyKey(
    key: string,
    requestDigest: string,
  ): Promise<IdempotencyLookupResult> {
    const existing = this.idempotency.get(key);
    if (!existing) return { status: 'miss' };
    if (existing.requestDigest === requestDigest) {
      return {
        status: 'match',
        requestDigest: existing.requestDigest,
        outcome: existing.outcome,
      };
    }
    return {
      status: 'conflict',
      existingRequestDigest: existing.requestDigest,
      incomingRequestDigest: requestDigest,
    };
  }

  async recordIdempotencyKey(
    key: string,
    requestDigest: string,
    outcome: PublicationOutcome,
  ): Promise<IdempotencyRecordResult> {
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.requestDigest === requestDigest) {
        return { status: 'replayed', original: existing.outcome };
      }
      return {
        status: 'idempotency-conflict',
        existingRequestDigest: existing.requestDigest,
        incomingRequestDigest: requestDigest,
      };
    }
    this.idempotency.set(key, { requestDigest, outcome });
    return { status: 'recorded', outcome };
  }

  /** Test helper: how many official records exist. */
  get size(): number {
    return this.claims.size;
  }
}
