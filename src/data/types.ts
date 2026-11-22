/**
 * THE ORACLE — Domain model
 *
 * These types describe the *target* architecture for official prediction
 * records. The application currently ships only illustrative (DEMO) records;
 * no forecasting engine, immutability guarantee, or public ledger exists yet.
 * The shapes are intentionally strict so that a future backend can adopt them
 * without breaking the interface.
 */

/** ISO-8601 UTC timestamp, e.g. "2026-03-04T09:00:00.000Z". */
export type IsoDateTime = string;

/** Human-readable, permanent record identifier, e.g. "ORC-2026-0007". */
export type PredictionId = string;

export type PredictionCategory =
  | 'geopolitics'
  | 'technology'
  | 'climate'
  | 'economy'
  | 'science'
  | 'health'
  | 'society'
  | 'space';

/**
 * Lifecycle of an official record.
 *
 * - `open`      Published and awaiting its resolution date.
 * - `resolved`  Resolution date reached, criteria applied, outcome recorded.
 * - `annulled`  Withdrawn because the resolution criteria proved invalid.
 *               Annulled records are never deleted; they remain publicly
 *               visible with their original probability intact.
 */
export type PredictionStatus = 'open' | 'resolved' | 'annulled';

export type ResolutionOutcome = 'yes' | 'no' | 'indeterminate';

export type EvidenceKind =
  | 'dataset'
  | 'report'
  | 'official-record'
  | 'paper'
  | 'interview'
  | 'filing';

/**
 * A source reference attached to a record at publication time.
 * Evidence is *frozen* with the record: later sources are added as new
 * revisions or new records, never silently swapped in.
 */
export interface EvidenceReference {
  id: string;
  title: string;
  publisher: string;
  publishedAt: IsoDateTime;
  kind: EvidenceKind;
  url?: string;
  /** Why this source was considered, in the forecaster's own words. */
  note: string;
}

/**
 * The test that decides the question. Written before publication, at a level
 * of precision that a third party could apply without contacting us.
 */
export interface ResolutionCriteria {
  /** The date on which the question is decided. */
  resolveOn: IsoDateTime;
  /** Plain-language rule applied on the resolution date. */
  rule: string;
  /** Named authority or instrument the rule reads from. */
  authority: string;
  /** Foreseeable ambiguities and how they are handled. */
  edgeCases: string[];
}

/**
 * Metadata describing the integrity of a record.
 *
 * `digest` is a SHA-256 hash over the canonical serialization of the record
 * payload. It is computed and checked by this repository's build, but it is
 * NOT yet anchored in a public transparency log or signed by a third party,
 * so it does not by itself constitute independent verification.
 */
export interface IntegrityMetadata {
  algorithm: 'SHA-256';
  /** Lowercase hex digest of the sealed payload. */
  digest: string;
  /**
   * Which payload definition this digest covers.
   *
   * `sealed-payload` — digest over `SealedPayload` only. Publication status and
   *   outcomes live in events and never influence it.
   *
   * `legacy-record` — digest over the whole record as it was modelled before the
   *   payload/event split, status and resolution included. These digests are
   *   preserved exactly as issued; they are verified against the shape they were
   *   actually computed from, and are never recomputed. A record carrying this
   *   value cannot claim that its payload predates its outcome.
   */
  payloadScope: 'sealed-payload' | 'legacy-record';
  /** Monotonic revision number. Revisions add; they never overwrite. */
  revision: number;
  /** Where the record is published. */
  channel: 'public-archive';
  /** Whether an external witness/ledger has attested the digest. */
  anchored: boolean;
}

export interface Resolution {
  resolvedAt: IsoDateTime;
  outcome: ResolutionOutcome;
  /** The deciding evidence, at the moment of resolution. */
  basis: string;
  /** What a reader should understand before comparing probability to outcome. */
  note: string;
}

/* -------------------------------------------------------------------------
   Integrity: sealed payload + append-only events
   ------------------------------------------------------------------------- */

/**
 * A prediction record as the archive *reads* it.
 *
 * The split below is the whole point of the model. A record's content is fixed
 * at publication and sealed; everything that happens afterwards is appended as
 * an event. Nothing that occurs after publication ever rewrites the sealed
 * content.
 */

/**
 * Exactly the information fixed at publication. This is what a digest covers.
 *
 * Nothing here may ever be revisited: a correction produces a new revision or a
 * new record, never an edit to an existing seal.
 */
export interface SealedPayload {
  id: PredictionId;
  canonicalQuestion: string;
  title: string;
  category: PredictionCategory;
  publishedAt: IsoDateTime;
  probability: number;
  horizon: {
    startsAt: IsoDateTime;
    endsAt: IsoDateTime;
    label: string;
  };
  resolutionCriteria: ResolutionCriteria;
  evidence: EvidenceReference[];
  /** True for illustrative records. Never presented as a real forecast. */
  demo: boolean;
  /**
   * What this payload's digest actually demonstrates.
   *
   * `self-consistent` — the sealed bytes match the shipped record. It does NOT
   *   follow that the payload existed before the outcome was known: records
   *   sealed after their resolution fall into this class, and saying otherwise
   *   would assert a provenance nobody witnessed.
   *
   * `published-before-outcome` — the payload was sealed during the publication
   *   step, before any resolution or annulment event existed. Records sealed
   *   under this model carry it, and it is true by construction.
   */
  sealClaim: SealClaim;
}

export type SealClaim = 'self-consistent' | 'published-before-outcome';

/** Body of the event that accompanies a publication. */
export interface PublishedEventBody {
  /**
   * Digest of the payload this event publishes, computed under `payloadScope`.
   *
   * For records sealed under the legacy model this is the legacy digest — which
   * covers the outcome too — and `payloadScope` says so. Storing the scope here
   * is what stops the two being confused later.
   */
  payloadDigest: string;
  /** The payload definition `payloadDigest` was computed over. */
  payloadScope: IntegrityMetadata['payloadScope'];
  /** How the payload was sealed. Mirrors `SealedPayload.sealClaim`. */
  sealClaim: SealClaim;
  note: string;
}

/** Body of a resolution event. Never touches the sealed payload. */
export interface ResolvedEventBody {
  outcome: Exclude<ResolutionOutcome, 'indeterminate'>;
  basis: string;
  note: string;
  /** Evidence the resolution rests on. Appended, never swapped in. */
  evidenceIds: string[];
}

/** Body of an annulment event. Never touches the sealed payload. */
export interface AnnulledEventBody {
  reason: string;
  basis: string;
  note: string;
}

export type RecordEventBody = PublishedEventBody | ResolvedEventBody | AnnulledEventBody;

export type RecordEventKind = 'published' | 'resolved' | 'annulled';

/**
 * How an event came to be in this archive.
 *
 * - `migrated` — the event was constructed when the payload/event model was
 *   introduced, from fields that already existed on the record (`publishedAt`,
 *   `resolution.resolvedAt`). The chain did not exist at `occurredAt`.
 * - `observed` — the event was written while the thing happened, under this
 *   model. Only these events are contemporaneous with their `occurredAt`.
 *
 * Never derive one from the other. A migrated event is a faithful restatement of
 * a recorded date, not a witness that anything happened on that date.
 */
export type EventOrigin = 'migrated' | 'observed';

/**
 * One link in a record's append-only event chain.
 *
 * `digest` covers `{ schema, algorithm, scope, seq, kind, occurredAt, body,
 * prevDigest }`, so the chain is ordered and tamper-evident: changing any event
 * invalidates it and every event after it. Adding an event appends a link; it
 * never alters an earlier one.
 *
 * The declaration fields exist so a digest never has to be interpreted by
 * convention. A verifier reading a single event knows which hash produced it,
 * which scheme version it belongs to, and exactly which bytes it covers.
 */
export interface RecordEvent {
  /** Deterministic position: 'e0', 'e1', … Assigned at append time. */
  seq: string;
  kind: RecordEventKind;
  /**
   * The date the event is *declared* to have happened. For a migrated event this
   * is the date the archive already recorded; it is not an observation date.
   */
  occurredAt: IsoDateTime;
  body: RecordEventBody;
  /**
   * When this event was written into the archive.
   *
   * For migrated events this is provably later than `occurredAt`: a migrated
   * chain could not have existed before the model that defines events. The
   * validator enforces `recordedAt > max(occurredAt)` per record, which is a
   * real property of the data rather than an invented timestamp.
   */
  recordedAt: IsoDateTime;
  origin: EventOrigin;
  /**
   * Digest algorithm. `sha256` is the only value this build accepts; an unknown
   * value is a validation failure, not a fallback.
   */
  algorithm: 'sha256';
  /** Scheme version of this envelope. Bumping it changes every event digest. */
  schemaVersion: 1;
  /**
   * Exactly what `digest` covers.
   *
   * `published-payload` — the digest of the sealed payload (for a
   *   `sealed-payload` record) or of the legacy whole-record shape (for a
   *   `legacy-record` record). Same bytes as `integrity.digest`.
   * `event-envelope` — the event envelope itself, chained to its predecessor.
   * `event-envelope+published-payload` — both, for the `published` event, so
   *   the chain is bound to the payload by a single hash.
   */
  scope: EventDigestScope;
  /** Lowercase hex digest over the declared scope. */
  digest: string;
  /** Digest of the previous event, or null for the first ('published'). */
  prevDigest: string | null;
}

export type EventDigestScope =
  | 'published-payload'
  | 'event-envelope'
  | 'event-envelope+published-payload';

/**
 * A single official prediction record.
 */
export interface PredictionRecord extends SealedPayload {
  /** Everything that happened after publication, oldest first. Append-only. */
  events: RecordEvent[];
  /**
   * Digest of the sealed payload as shipped.
   *
   * For records sealed under the legacy model this digest also covers the
   * status and resolution that were present at sealing time, which is why
   * `legacyDigest` records are verified with the legacy algorithm.
   */
  integrity: IntegrityMetadata;
}

/** Aggregates shown on archive-wide surfaces. */
export interface ArchiveSummary {
  published: number;
  open: number;
  resolved: number;
  annulled: number;
  hitRate: number | null;
}

/* -------------------------------------------------------------------------
   Trends — emerging signals
   ------------------------------------------------------------------------- */

export type TrendDirection = 'rising' | 'steady' | 'cooling';

export type TrendCategory =
  | 'infrastructure'
  | 'science'
  | 'markets'
  | 'climate'
  | 'society'
  | 'regulation';

export interface TrendSignal {
  id: string;
  name: string;
  category: TrendCategory;
  /** One-sentence description of the observed shift. */
  summary: string;
  /** Why the signal is early, and what would falsify it. */
  tension: string;
  direction: TrendDirection;
  /** Composite 0–100 index from the illustrative dataset. */
  signalStrength: number;
  /** Change in the index over the trailing 90 days, in points. */
  velocity: number;
  /** 0–100 confidence in the signal's persistence. Illustrative. */
  confidence: number;
  evidenceCount: number;
  region: string;
  horizon: string;
  /** Index points over the trailing 8 quarters — illustrative shape only. */
  series: number[];
  /** Related canonical questions in the archive (IDs). */
  relatedPredictions: PredictionId[];
  demo: boolean;
}

/* -------------------------------------------------------------------------
   Exploration
   ------------------------------------------------------------------------- */

export type ExplorationIntent = 'forecast' | 'compare' | 'resolve';

export interface SuggestedQuestion {
  id: string;
  question: string;
  category: PredictionCategory;
  intent: ExplorationIntent;
  note: string;
}

/**
 * The result of parsing a user's free-text question in the client.
 * This is a transparent heuristic, not a language model and not a forecast.
 */
export interface QuestionReading {
  raw: string;
  normalized: string;
  tokens: string[];
  category: PredictionCategory | null;
  /** Detected or inferred resolution year, if any. */
  horizonYear: number | null;
  /** Lexical similarity matches against the demo archive. */
  matches: Array<{ record: PredictionRecord; score: number }>;
  /** Draft resolution considerations surfaced to the user. */
  considerations: string[];
  /** Notes about what the reading could not determine. */
  caveats: string[];
}

/** A question the visitor chose to keep. Stored locally, never transmitted. */
export interface LocalDraft {
  id: string;
  question: string;
  category: PredictionCategory | null;
  createdAt: IsoDateTime;
  saved: boolean;
}
