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
  /** Lowercase hex digest of the canonical payload. */
  digest: string;
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

/**
 * A single official prediction record.
 *
 * Invariants for the eventual implementation (documented, not yet enforced by
 * a server):
 *   1. Records are append-only. A correction creates a new revision or record.
 *   2. `probability` is fixed at publication and can never be revised.
 *   3. `resolutionCriteria` is fixed at publication.
 *   4. Every record carries evidence and a resolution authority.
 */
export interface PredictionRecord {
  id: PredictionId;
  /** Canonical phrasing. Equivalent questions must point at this one record. */
  canonicalQuestion: string;
  /** Compact label for dense surfaces (cards, lists). */
  title: string;
  category: PredictionCategory;
  publishedAt: IsoDateTime;
  /** Singular probability, fixed for the life of this revision. */
  probability: number;
  horizon: {
    startsAt: IsoDateTime;
    endsAt: IsoDateTime;
    label: string;
  };
  resolutionCriteria: ResolutionCriteria;
  evidence: EvidenceReference[];
  status: PredictionStatus;
  resolution?: Resolution;
  integrity: IntegrityMetadata;
  /**
   * True for illustrative records that ship with this prototype.
   * The UI must never present a demo record as a real forecast.
   */
  demo: boolean;
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
