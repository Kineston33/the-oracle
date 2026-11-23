/**
 * Official Publication Protocol v1 — domain types.
 *
 * This file defines the vocabulary of the publication lifecycle. It contains no
 * behaviour and no I/O: every rule that depends on these types lives in
 * `publication.ts`, and every rule that needs storage lives in the contract
 * described by `docs/PUBLICATION-API-CONTRACT.md`.
 *
 * The central distinction:
 *
 *   an exploratory query is what a visitor types;
 *   a candidate proposition is a structured reading of that query;
 *   an official prediction is a candidate that passed evaluation AND won the
 *   uniqueness race for its canonical identity.
 *
 * Only the third is published, and nothing in this file lets the first become
 * the third by accident.
 */

import type {
  IsoDateTime,
  PredictionCategory,
  PredictionRecord,
  ResolutionCriteria,
  EvidenceReference,
} from './types.ts';

/* -------------------------------------------------------------------------
   Canonical proposition identity
   ------------------------------------------------------------------------- */

/**
 * The structured identity of a proposition.
 *
 * This is deliberately *not* derived from the wording. Two sentences can share
 * one identity, and two sentences that look similar can carry different ones.
 * Identity is a data structure with typed components, so each part can be
 * compared, disputed and — where possible — proven distinct.
 *
 * Every field is required. An unknown value is written as the explicit `unknown`
 * sentinel rather than omitted, because an omitted field and a consciously
 * unknown field are different claims: the first is silence, the second is a
 * recorded gap.
 */
export interface PropositionIdentity {
  /**
   * Who or what the proposition is about, as a stable, typed descriptor.
   *
   * Examples: `['team:fifa-argentina']` or `['country:AR']`. Not free text:
   * a free-text subject would reintroduce the wording problem this model
   * exists to avoid.
   */
  subject: IdentityTerm;
  /** The event or outcome whose occurrence decides the proposition. */
  event: IdentityTerm;
  /** Any threshold or condition, e.g. `>= 430 ppm` or `win outright`. */
  condition: IdentityTerm;
  /** Geographic or organisational scope. `global` is a value, not a default. */
  geographicScope: IdentityTerm;
  /**
   * The horizon the proposition is *about* — the period in which the outcome can
   * occur. Distinct from `resolutionDate`: a question can ask about 2030 and be
   * resolved in 2031.
   */
  horizon: IdentityTerm;
  /** The date on which the proposition is decided. */
  resolutionDate: IsoDateTime;
  /**
   * The body whose output decides it: a dataset, an official record, a ruling.
   * `unknown` is permitted here only when evaluation records the gap.
   */
  decidingAuthority: IdentityTerm;
}

/**
 * One component of an identity.
 *
 * The `namespace` separates identifier systems: `team:fifa-argentina` and
 * `country:AR` never collide even though both are "Argentina". Values are
 * normalised at construction time, not compared loosely at match time.
 */
export interface IdentityTerm {
  /** The identifier system, e.g. `team`, `country`, `dataset`, `literal`. */
  namespace: string;
  /** The identifier within that system, normalised. */
  id: string;
  /** Set when the term could not be resolved to something specific. */
  unresolved?: true;
}

/**
 * The result of asking whether two propositions are the same.
 *
 * `distinct` is not the absence of a match — it is a positive finding that the
 * two differ in a component that matters. That distinction is what stops an
 * ambiguous pair from being treated as "just different" and published twice.
 */
export type IdentityMatchOutcome =
  | 'equivalent'
  | 'distinct'
  | 'uncertain';

export interface IdentityMatch {
  outcome: IdentityMatchOutcome;
  /**
   * The components that decided the outcome. For `distinct`, the component that
   * differs; for `uncertain`, the components that could not be resolved.
   */
  because: IdentityComponent[];
  /** Human-readable explanation, surfaced to operators and stored in the log. */
  detail: string;
  /** Set only for `equivalent`: the identity both propositions share. */
  canonical?: PropositionIdentity;
}

export type IdentityComponent =
  | 'subject'
  | 'event'
  | 'condition'
  | 'geographicScope'
  | 'horizon'
  | 'resolutionDate'
  | 'decidingAuthority';

/* -------------------------------------------------------------------------
   Lifecycle stages
   ------------------------------------------------------------------------- */

/**
 * Every stage a proposition can occupy.
 *
 * The ordering matters: a query enters at `exploratory-query`, and publication is
 * a terminal gate that only `eligible-for-publication` can cross. There is no
 * edge from the first two stages to `officially-published`.
 */
export type PropositionStage =
  /** What a visitor typed. Has no identity and cannot be evaluated. */
  | 'exploratory-query'
  /** Structured into a candidate, but not yet assigned an identity. */
  | 'candidate-proposition'
  /** Identity is being resolved against the registry. Not publishable. */
  | 'identity-matching'
  /** Passed identity resolution; evaluation has not started or is in progress. */
  | 'evaluation'
  /** Evaluation failed, or identity resolution found a conflict. Terminal. */
  | 'rejected-candidate'
  /** Every evaluation requirement passed. The only publishable stage. */
  | 'eligible-for-publication'
  /** An official record exists. Terminal until resolution or annulment. */
  | 'officially-published'
  /** Decided. Terminal. */
  | 'resolved'
  /** Withdrawn under the annulment rules. Terminal. */
  | 'annulled';

/** Stages from which no further transition is possible. */
export const TERMINAL_STAGES = ['rejected-candidate', 'resolved', 'annulled'] as const;

/**
 * The allowed transitions, stated as data.
 *
 * Publication appears exactly once, from exactly one stage. There is no path
 * from `exploratory-query` or `candidate-proposition` to
 * `officially-published`, and that absence is the whole design: a query
 * submitted by a visitor cannot become an official prediction by any sequence of
 * calls.
 *
 * It lives in the types module so tests can assert against the same table the
 * implementation walks, rather than a copy that can drift.
 */
export const LIFECYCLE: Readonly<Record<PropositionStage, readonly PropositionStage[]>> = {
  'exploratory-query': ['candidate-proposition'],
  'candidate-proposition': ['identity-matching', 'rejected-candidate'],
  'identity-matching': ['evaluation', 'rejected-candidate'],
  evaluation: ['eligible-for-publication', 'rejected-candidate'],
  'eligible-for-publication': ['officially-published', 'rejected-candidate'],
  'rejected-candidate': [],
  'officially-published': ['resolved', 'annulled'],
  resolved: [],
  annulled: [],
};

/**
 * The only stage from which a publication command may succeed.
 *
 * Exported as a constant rather than inlined so tests assert against the same
 * value the implementation uses, instead of a copy that can drift.
 */
export const PUBLISHABLE_STAGE = 'eligible-for-publication' as const;

/* -------------------------------------------------------------------------
   Evaluation
   ------------------------------------------------------------------------- */

/**
 * One publication requirement.
 *
 * Each requirement is checked independently and reported independently, because
 * "the candidate failed" is not actionable and "the resolution authority is
 * missing" is.
 */
export type EvaluationRequirementId =
  | 'unambiguous-question'
  | 'falsifiable-proposition'
  | 'fixed-horizon'
  | 'fixed-resolution-date'
  | 'identified-authority'
  | 'objective-criteria'
  | 'probability-in-range'
  | 'documented-rationale'
  | 'recorded-evidence'
  | 'preserved-evidence-provenance'
  | 'disclosed-limitations';

export const EVALUATION_REQUIREMENTS: readonly EvaluationRequirementId[] = [
  'unambiguous-question',
  'falsifiable-proposition',
  'fixed-horizon',
  'fixed-resolution-date',
  'identified-authority',
  'objective-criteria',
  'probability-in-range',
  'documented-rationale',
  'recorded-evidence',
  'preserved-evidence-provenance',
  'disclosed-limitations',
];

export interface RequirementResult {
  id: EvaluationRequirementId;
  passed: boolean;
  /** Why it passed or failed. Required: an empty reason is not an evaluation. */
  reason: string;
}

export interface EvaluationVerdict {
  /** Every requirement, in the canonical order. */
  results: RequirementResult[];
  /** True only when every requirement passed. */
  eligible: boolean;
  /**
   * Requirements that failed *and* could be satisfied by more information, as
   * opposed to being false. These produce `clarification-required` rather than a
   * hard rejection, so an operator knows whether to ask or to discard.
   */
  clarificationsRequired: EvaluationRequirementId[];
}

/* -------------------------------------------------------------------------
   Candidate
   ------------------------------------------------------------------------- */

/**
 * A structured reading of a query, before it has an official identity.
 *
 * `candidate` is intentionally a separate type from the published record. It can
 * be incomplete — that is what `evaluation` is for — and it carries the audit
 * trail of how it was produced, including which parts were inferred.
 */
export interface CandidateProposition {
  /** Stable id within the drafting process. Never becomes a prediction id. */
  candidateId: string;
  /** The wording the visitor supplied. Preserved verbatim for the audit trail. */
  submittedQuery: string;
  /** The wording the candidate proposes to publish. */
  proposedQuestion: string;
  /** The structured identity the candidate claims. */
  proposedIdentity: PropositionIdentity;
  category: PredictionCategory;
  /** Null while unevaluated: an absent probability is not a zero. */
  probability: number | null;
  rationale: string | null;
  horizon: { startsAt: IsoDateTime; endsAt: IsoDateTime; label: string } | null;
  resolutionCriteria: ResolutionCriteria | null;
  evidence: EvidenceReference[];
  /** Known gaps, stated by whoever produced the candidate. */
  disclosedLimitations: string[];
  /** Which parts were inferred rather than supplied, and by what rule. */
  inferences: Inference[];
  stage: PropositionStage;
  createdAt: IsoDateTime;
}

/**
 * A recorded inference, so "the system decided this" is never invisible.
 *
 * A candidate that fills in a resolution date by assuming "end of the named year"
 * must say so, because the assumption is part of what a reader is being asked to
 * trust.
 */
export interface Inference {
  component:
    | IdentityComponent
    | 'category'
    | 'horizon'
    | 'resolutionDate'
    | 'falsifiability-review';
  /** What was inferred, in the form it was inferred. */
  value: string;
  /** The rule that produced it, named so it can be reviewed and changed. */
  rule: string;
}

/* -------------------------------------------------------------------------
   Publication
   ------------------------------------------------------------------------- */

/**
 * Constraints a publication command must satisfy.
 *
 * The command is a *request*. It does not publish by itself: it is checked
 * against these constraints and against the registry before anything is sealed.
 */
export interface PublicationRequest {
  candidateId: string;
  /** Client-generated key used to make retries safe. See the API contract. */
  idempotencyKey: string;
  /** The exact canonical identity the caller believes is unique. */
  identity: PropositionIdentity;
  /** Digest of the candidate as submitted, so a replay cannot swap content. */
  candidateDigest: string;
  requestedAt: IsoDateTime;
}

export type PublicationOutcome =
  /** A new official record was sealed and committed by this command. */
  | {
      kind: 'created';
      predictionId: string;
      identityDigest: string;
      requestDigest: string;
      record: PredictionRecord;
    }
  /** An official record already existed for this identity. First wins. */
  | {
      kind: 'existing';
      predictionId: string;
      identityDigest: string;
      requestDigest: string;
      record?: PredictionRecord;
    }
  /**
   * This exact idempotency key and identical request digest already produced a
   * result.
   *
   * Carries the original outcome verbatim rather than a flattened copy: a replay
   * of a rejection must stay a rejection, and must not be reshaped into something
   * that looks like a publication.
   */
  | { kind: 'replayed'; original: PublicationOutcome }
  /**
   * The idempotency key was reused with different candidate or request content.
   *
   * Never interpreted as a replay and never creates or returns a publication.
   */
  | {
      kind: 'idempotency-conflict';
      idempotencyKey: string;
      existingRequestDigest: string;
      incomingRequestDigest: string;
      detail: string;
    }
  /**
   * The publication request does not match the candidate's id or proposed
   * canonical identity. Rejected before any registry lookup or mutation.
   */
  | {
      kind: 'candidate-mismatch';
      reason: 'candidate-id' | 'proposed-identity';
      detail: string;
      match?: IdentityMatch;
    }
  /** Identity resolution was not confident enough to publish. */
  | { kind: 'identity-conflict'; match: IdentityMatch }
  /** Evaluation did not pass. */
  | { kind: 'rejected'; verdict: EvaluationVerdict }
  /** The candidate is not in a verified publishable stage. */
  | {
      kind: 'wrong-stage';
      stage: PropositionStage;
      required: typeof PUBLISHABLE_STAGE;
      reason: 'invalid-stage' | 'forged-stage';
      detail: string;
    };

/* -------------------------------------------------------------------------
   Registry contract (domain-level, storage-agnostic)
   ------------------------------------------------------------------------- */

export type IdempotencyLookupResult =
  | { status: 'miss' }
  | { status: 'match'; requestDigest: string; outcome: PublicationOutcome }
  | {
      status: 'conflict';
      existingRequestDigest: string;
      incomingRequestDigest: string;
    };

export type IdempotencyRecordResult =
  | { status: 'recorded'; outcome: PublicationOutcome }
  | { status: 'replayed'; original: PublicationOutcome }
  | {
      status: 'idempotency-conflict';
      existingRequestDigest: string;
      incomingRequestDigest: string;
    };

export interface AtomicPublicationCommit {
  idempotencyKey: string;
  requestDigest: string;
  identityDigest: string;
  predictionId: string;
  record: PredictionRecord;
}

export type AtomicPublicationResult =
  | { status: 'created'; outcome: Extract<PublicationOutcome, { kind: 'created' }> }
  | { status: 'existing'; outcome: Extract<PublicationOutcome, { kind: 'existing' }> }
  | { status: 'replayed'; original: PublicationOutcome }
  | {
      status: 'idempotency-conflict';
      existingRequestDigest: string;
      incomingRequestDigest: string;
    };

/**
 * What a store must be able to answer for the protocol to hold.
 *
 * These are written as domain operations, not SQL, so the protocol is not tied to
 * a vendor. The commentary in `docs/PUBLICATION-API-CONTRACT.md` maps each to a
 * concrete uniqueness constraint and transaction boundary.
 */
export interface PublicationRegistry {
  /**
   * Atomically bind the idempotency key to `requestDigest`, claim `identityDigest`
   * (or observe the existing winner), persist the sealed `PredictionRecord` +
   * initial `published` event when claiming, and commit the idempotency outcome
   * in a single indivisible operation.
   */
  commitPublication(commit: AtomicPublicationCommit): Promise<AtomicPublicationResult>;

  /**
   * Atomically claim an identity for a new record.
   *
   * MUST be atomic: two concurrent calls with the same `identityDigest` must
   * never both return `claimed`. Exactly one wins; the other observes the winner.
   */
  claimIdentity(
    identityDigest: string,
    predictionId: string,
    record?: PredictionRecord,
  ): Promise<
    | { status: 'claimed' }
    | { status: 'already-claimed'; predictionId: string }
  >;

  /** Look up the official record for an identity, if one exists. */
  findByIdentity(
    identityDigest: string,
  ): Promise<{ predictionId: string; record?: PredictionRecord } | null>;

  /**
   * Look up a prior result for an idempotency key and verify that the bound
   * `requestDigest` matches the incoming request.
   */
  findByIdempotencyKey(
    key: string,
    requestDigest: string,
  ): Promise<IdempotencyLookupResult>;

  /**
   * Atomically record a non-publishing outcome for an idempotency key, bound to
   * `requestDigest`. If the key was already bound, returns `replayed` (same
   * digest) or `idempotency-conflict` (different digest) without overwriting.
   */
  recordIdempotencyKey(
    key: string,
    requestDigest: string,
    outcome: PublicationOutcome,
  ): Promise<IdempotencyRecordResult>;
}
