/**
 * Publication evaluation and lifecycle rules.
 *
 * Everything in this file is a pure function over a candidate and a registry
 * contract. There is no storage, no network and no clock of its own: the clock is
 * injected, so the same rules produce the same verdicts in tests, in a future
 * backend, and in any audit.
 *
 * The rule this file exists to enforce: **a plausible-sounding candidate is not a
 * publishable one**. Each requirement is checked independently and must state a
 * reason, so a rejection says which requirement failed and why, instead of a
 * single opaque "invalid".
 */

import { identityDigest, compareIdentities, type AliasTable } from './canonical-identity.ts';
import {
  EVALUATION_REQUIREMENTS,
  LIFECYCLE,
  PUBLISHABLE_STAGE,
  type CandidateProposition,
  type EvaluationRequirementId,
  type EvaluationVerdict,
  type PropositionStage,
  type PublicationOutcome,
  type PublicationRegistry,
  type PublicationRequest,
  type RequirementResult,
} from './publication-types.ts';

/* -------------------------------------------------------------------------
   Lifecycle transitions
   ------------------------------------------------------------------------- */

export class TransitionError extends Error {}

/** True only if the lifecycle allows this exact edge. */
export function canTransition(from: PropositionStage, to: PropositionStage): boolean {
  return LIFECYCLE[from].includes(to);
}

/**
 * Move a stage forward, refusing anything the lifecycle does not allow.
 *
 * Used by tests and by a future backend; deliberately not a general-purpose
 * "set stage" function, because that would be the footgun this model avoids.
 */
export function advance(from: PropositionStage, to: PropositionStage): PropositionStage {
  if (!canTransition(from, to)) {
    throw new TransitionError(`Lifecycle does not allow ${from} → ${to}`);
  }
  return to;
}

/** True when a publication command could legally succeed from this stage. */
export function isPublishable(stage: PropositionStage): boolean {
  return stage === PUBLISHABLE_STAGE;
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
 *   · an unresolved deciding authority is a failure, not "unknown but fine".
 */
export function evaluateCandidate(candidate: CandidateProposition): EvaluationVerdict {
  const results: RequirementResult[] = [];

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

  results.push(
    result(
      'fixed-horizon',
      candidate.horizon !== null &&
        candidate.horizon.endsAt.length > 0 &&
        candidate.horizon.startsAt.length > 0,
      candidate.horizon === null
        ? 'No time horizon was fixed.'
        : 'Time horizon is fixed with start and end.',
    ),
  );

  const resolutionDate = candidate.proposedIdentity.resolutionDate;
  results.push(
    result(
      'fixed-resolution-date',
      /^\d{4}-\d{2}-\d{2}T/.test(resolutionDate),
      resolutionDate
        ? `Resolution date is ${resolutionDate}.`
        : 'No resolution date was fixed.',
    ),
  );

  results.push(
    result(
      'identified-authority',
      candidate.proposedIdentity.decidingAuthority.unresolved !== true &&
        candidate.proposedIdentity.decidingAuthority.id !== 'unknown',
      candidate.proposedIdentity.decidingAuthority.unresolved === true
        ? 'The deciding authority is unresolved.'
        : 'A deciding authority is identified.',
    ),
  );

  const criteria = candidate.resolutionCriteria;
  results.push(
    result(
      'objective-criteria',
      criteria !== null &&
        criteria.rule.trim().length > 0 &&
        criteria.authority.trim().length > 0,
      criteria === null
        ? 'No resolution criteria were supplied.'
        : 'Resolution criteria name a rule and an authority.',
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

  const provenanceComplete = candidate.evidence.every(
    (item) =>
      item.publishedAt.length > 0 &&
      item.publisher.trim().length > 0 &&
      item.title.trim().length > 0,
  );
  results.push(
    result(
      'preserved-evidence-provenance',
      candidate.evidence.length > 0 && provenanceComplete,
      candidate.evidence.length === 0
        ? 'No evidence exists, so no provenance can be preserved.'
        : provenanceComplete
          ? 'Every evidence item carries a publisher, a title and a timestamp.'
          : 'At least one evidence item is missing its publisher, title or timestamp.',
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

  // A failed requirement that more information could satisfy is a clarification,
  // not a permanent rejection. Distinguishing them is what makes the outcome
  // actionable.
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
   Publication
   ------------------------------------------------------------------------- */

export interface PublicationDeps {
  registry: PublicationRegistry;
  aliases?: AliasTable;
  /** Injected so the protocol has no hidden clock. */
  now: () => string;
  /** Produces the id a newly created record will carry. */
  newPredictionId: (identityDigest: string) => string;
}

/**
 * Attempt to publish a candidate.
 *
 * The order of checks is the contract:
 *
 *   1. stage — a query cannot publish, and neither can a rejected candidate;
 *   2. replay — the same idempotency key returns the same result;
 *   3. existing — an identity already claimed returns the winner, never a new id;
 *   4. identity — uncertainty blocks publication instead of creating a record;
 *   5. evaluation — an invalid candidate cannot be sealed;
 *   6. claim — the atomic step. The registry decides, not this function.
 *
 * Steps 1–5 are cheap and local. Step 6 is the only one that needs real atomicity,
 * and it is deliberately the last thing that happens.
 */
export async function publishCandidate(
  candidate: CandidateProposition,
  request: PublicationRequest,
  deps: PublicationDeps,
): Promise<PublicationOutcome> {
  const aliases = deps.aliases ?? undefined;

  if (!isPublishable(candidate.stage)) {
    return { kind: 'wrong-stage', stage: candidate.stage, required: PUBLISHABLE_STAGE };
  }

  const replay = await deps.registry.findByIdempotencyKey(request.idempotencyKey);
  if (replay) return { kind: 'replayed', original: replay };

  const digest = await identityDigest(request.identity, aliases);

  const existing = await deps.registry.findByIdentity(digest);
  if (existing) {
    const outcome: PublicationOutcome = {
      kind: 'existing',
      predictionId: existing.predictionId,
      identityDigest: digest,
    };
    await deps.registry.recordIdempotencyKey(request.idempotencyKey, outcome);
    return outcome;
  }

  // Identity must be fully resolved before anything is sealed. An unresolved
  // component is not a smaller version of a match; it is a reason not to publish.
  const selfCheck = compareIdentities(request.identity, request.identity, aliases);
  if (selfCheck.outcome !== 'equivalent') {
    const outcome: PublicationOutcome = { kind: 'identity-conflict', match: selfCheck };
    await deps.registry.recordIdempotencyKey(request.idempotencyKey, outcome);
    return outcome;
  }

  const verdict = evaluateCandidate(candidate);
  if (!verdict.eligible) {
    const outcome: PublicationOutcome = { kind: 'rejected', verdict };
    await deps.registry.recordIdempotencyKey(request.idempotencyKey, outcome);
    return outcome;
  }

  const predictionId = deps.newPredictionId(digest);
  const claim = await deps.registry.claimIdentity(digest, predictionId);

  if (claim.status === 'already-claimed') {
    // Lost the race. The winner's record is the official one, and this caller is
    // told so rather than given a second id.
    const outcome: PublicationOutcome = {
      kind: 'existing',
      predictionId: claim.predictionId,
      identityDigest: digest,
    };
    await deps.registry.recordIdempotencyKey(request.idempotencyKey, outcome);
    return outcome;
  }

  const outcome: PublicationOutcome = { kind: 'created', predictionId, identityDigest: digest };
  await deps.registry.recordIdempotencyKey(request.idempotencyKey, outcome);
  return outcome;
}

/**
 * An in-memory registry implementing the contract.
 *
 * Used by tests and by the domain harness. Its `claimIdentity` is not atomic in
 * the presence of real concurrency — JavaScript is single-threaded, so tests can
 * only prove the *contract*, which is what the protocol requires. Real atomicity
 * is a database obligation, documented in PUBLICATION-API-CONTRACT.md.
 */
export class InMemoryRegistry implements PublicationRegistry {
  private readonly claims = new Map<string, string>();
  private readonly idempotency = new Map<string, PublicationOutcome>();

  async claimIdentity(
    identityDigest: string,
    predictionId: string,
  ): Promise<{ status: 'claimed' } | { status: 'already-claimed'; predictionId: string }> {
    const existing = this.claims.get(identityDigest);
    if (existing) return { status: 'already-claimed', predictionId: existing };
    this.claims.set(identityDigest, predictionId);
    return { status: 'claimed' };
  }

  async findByIdentity(identityDigest: string): Promise<{ predictionId: string } | null> {
    const found = this.claims.get(identityDigest);
    return found ? { predictionId: found } : null;
  }

  async findByIdempotencyKey(key: string): Promise<PublicationOutcome | null> {
    return this.idempotency.get(key) ?? null;
  }

  async recordIdempotencyKey(key: string, outcome: PublicationOutcome): Promise<void> {
    if (!this.idempotency.has(key)) this.idempotency.set(key, outcome);
  }

  /** Test helper: how many official records exist. */
  get size(): number {
    return this.claims.size;
  }
}
