/**
 * THE ORACLE — External Verifiable Evidence Harvester (Stage 1)
 *
 * Collects, validates, normalizes, and deduplicates verifiable external evidence
 * from public zero-cost HTTP providers (OpenAlex, Wikipedia API, GDELT) using
 * Node.js native `fetch` and `AbortSignal.timeout`.
 *
 * Architectural guarantees:
 *   1. Zero metadata fabrication: titles, publishers, URLs, and dates must come
 *      exclusively from real HTTP responses. Missing or unverifiable fields
 *      cause the record to be discarded, never filled with placeholders.
 *   2. Strict temporal separation: publication dates (`publishedDate`), update
 *      dates (`updatedDate`), and crawler/repository indexing dates
 *      (`indexedDate`, such as OpenAlex `created_date`, MediaWiki `touched`, or
 *      GDELT `seendate`) are tracked separately. An indexing date is NEVER
 *      treated as a publication or update date.
 *   3. Chronological integrity: every accepted item must have a valid calendar
 *      UTC timestamp (`publishedAt <= referenceTime`). If an item also carries
 *      an `updatedDate`, that update must likewise satisfy
 *      `publishedDate <= updatedDate <= referenceTime`.
 *   4. Primary-source honesty: a source is never labeled as a verified primary
 *      source (`isPrimarySourceVerified: false`) when the upstream provider is
 *      an encyclopedia, news aggregator, or bibliographic index that does not
 *      attest primary authority.
 *   5. Fault isolation & Render Free Tier protection: each provider runs with
 *      `AbortSignal.timeout`, strict result count caps, and response size caps.
 *      A slow or failing provider never aborts the overall harvest.
 */

import { createHash } from 'node:crypto';
import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import type {
  EvidenceKind,
  EvidenceReference,
  IsoDateTime,
  PredictionCategory,
} from '../data/types.ts';

/* -------------------------------------------------------------------------
   Constants & Render Free Tier operational limits
   ------------------------------------------------------------------------- */

export const EVIDENCE_PROVIDERS = ['openalex', 'wikipedia', 'gdelt'] as const;
export type EvidenceProviderId = (typeof EVIDENCE_PROVIDERS)[number];

export const DEFAULT_PROVIDER_TIMEOUT_MS = 4_500;
export const MIN_PROVIDER_TIMEOUT_MS = 100;
export const MAX_PROVIDER_TIMEOUT_MS = 10_000;

export const DEFAULT_MAX_RESULTS_PER_PROVIDER = 5;
export const HARD_MAX_RESULTS_PER_PROVIDER = 10;

export const DEFAULT_MAX_TOTAL_RESULTS = 10;
export const HARD_MAX_TOTAL_RESULTS = 25;

export const DEFAULT_MIN_RELEVANCE_SCORE = 0.15;
export const MAX_RESPONSE_BODY_BYTES = 512 * 1024; // 512 KB cap for Render 512 MB RAM
export const MAX_SNIPPET_LENGTH = 400;

const HARVESTER_USER_AGENT =
  'TheOracle-EvidenceHarvester/1.0 (+https://github.com/Kineston33/the-oracle)';

/**
 * Category-aware default provider routing.
 *
 * Allows the predictive engine to select the most appropriate combination of
 * providers for a question's domain while supporting explicit overrides.
 */
export const DEFAULT_CATEGORY_PROVIDERS: Readonly<
  Record<PredictionCategory, readonly EvidenceProviderId[]>
> = Object.freeze({
  science: Object.freeze(['openalex', 'wikipedia'] as const),
  health: Object.freeze(['openalex', 'wikipedia'] as const),
  climate: Object.freeze(['openalex', 'wikipedia', 'gdelt'] as const),
  space: Object.freeze(['openalex', 'wikipedia', 'gdelt'] as const),
  technology: Object.freeze(['openalex', 'gdelt', 'wikipedia'] as const),
  economy: Object.freeze(['gdelt', 'openalex', 'wikipedia'] as const),
  geopolitics: Object.freeze(['gdelt', 'wikipedia', 'openalex'] as const),
  society: Object.freeze(['gdelt', 'wikipedia', 'openalex'] as const),
});

/* -------------------------------------------------------------------------
   Domain types & interfaces
   ------------------------------------------------------------------------- */

export type EvidenceTemporalBasis = 'published' | 'updated';

export type EvidenceSourceClassification =
  | 'peer-reviewed-work'
  | 'preprint-or-working-paper'
  | 'dataset'
  | 'encyclopedic-reference'
  | 'news-article'
  | 'secondary-report';

export type EvidenceDiscardReason =
  | 'missing-title'
  | 'missing-publisher'
  | 'invalid-url'
  | 'missing-verifiable-date'
  | 'indexing-date-only'
  | 'invalid-date'
  | 'future-date'
  | 'retracted-source'
  | 'low-thematic-relevance'
  | 'duplicate-evidence';

export interface EvidenceProvenanceMetadata {
  readonly provider: EvidenceProviderId;
  readonly adapterVersion: '1.0.0';
  readonly endpointUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: IsoDateTime;
  readonly referenceTime: IsoDateTime;
  readonly rawSourceId: string | null;
  readonly rawDateFields: {
    readonly published: string | null;
    readonly updated: string | null;
    readonly indexed: string | null;
  };
  readonly temporalBasis: EvidenceTemporalBasis;
  readonly primarySourceVerified: boolean;
  readonly primarySourceVerificationNote: string;
  readonly metadataOrigin: 'http-response-verbatim';
  readonly recordDigest: string;
}

export interface HarvestedEvidenceItem {
  /** Deterministic SHA-256 derived identifier (`ev-<provider>-<16hex>`). */
  readonly id: string;
  /** Verbatim title from the upstream HTTP response. */
  readonly title: string;
  /** Verbatim publisher/venue/domain from the upstream HTTP response. */
  readonly publisher: string;
  /** Canonicalized and validated HTTP(S) origin URL. */
  readonly url: string;
  /**
   * Effective verifiable UTC timestamp (`publishedDate ?? updatedDate`),
   * guaranteed `<= referenceTime`. Never populated from an indexing date.
   */
  readonly publishedAt: IsoDateTime;
  /** Explicit publication timestamp if provided by the source; otherwise null. */
  readonly publishedDate: IsoDateTime | null;
  /** Explicit revision/update timestamp if provided by the source; otherwise null. */
  readonly updatedDate: IsoDateTime | null;
  /**
   * Explicit crawler/repository indexing timestamp (e.g. OpenAlex `created_date`,
   * MediaWiki `touched`, GDELT `seendate`). Recorded for audit only; never used
   * as `publishedAt`.
   */
  readonly indexedDate: IsoDateTime | null;
  /** Whether `publishedAt` represents a publication date or an update date. */
  readonly temporalBasis: EvidenceTemporalBasis;
  /** Descriptive snippet extracted from the HTTP response when available. */
  readonly snippet: string | null;
  /** Upstream provider identifier. */
  readonly sourceProvider: EvidenceProviderId;
  /** Upstream record identifier (e.g., OpenAlex work ID, Wikipedia pageid). */
  readonly sourceId: string | null;
  /** Protocol `EvidenceKind` mapping. */
  readonly kind: EvidenceKind;
  /** Granular classification of the source. */
  readonly sourceType: EvidenceSourceClassification;
  /**
   * True only when the upstream provider cryptographically or institutionally
   * verifies that the document is an authoritative primary source.
   */
  readonly isPrimarySourceVerified: boolean;
  /** Explicit explanation of primary-source verification status. */
  readonly primarySourceVerificationNote: string;
  /** Normalized [0, 1] thematic relevance score against the query. */
  readonly relevanceScore: number;
  /** Query/thematic terms matched in this item. */
  readonly matchedTerms: readonly string[];
  /** Full provenance metadata for auditability. */
  readonly provenance: EvidenceProvenanceMetadata;
}

export interface DiscardedEvidenceDiagnostic {
  readonly provider: EvidenceProviderId;
  readonly reason: EvidenceDiscardReason;
  readonly detail: string;
  readonly rawSourceId: string | null;
  readonly rawTitle: string | null;
  readonly rawUrl: string | null;
  readonly rawPublishedDate: string | null;
  readonly rawUpdatedDate: string | null;
  readonly rawIndexedDate: string | null;
}

export type ProviderHarvestStatus =
  | 'ok'
  | 'empty'
  | 'timeout'
  | 'http-error'
  | 'network-error'
  | 'invalid-payload';

export interface ProviderHarvestReport {
  readonly provider: EvidenceProviderId;
  readonly status: ProviderHarvestStatus;
  readonly endpointUrl: string;
  readonly httpStatus: number | null;
  readonly durationMs: number;
  readonly rawCandidateCount: number;
  readonly accepted: readonly HarvestedEvidenceItem[];
  readonly discarded: readonly DiscardedEvidenceDiagnostic[];
  readonly error: string | null;
}

export interface ProviderAdapterContext {
  readonly query: string;
  readonly queryTokens: readonly string[];
  readonly requiredTerms: readonly string[];
  readonly minRelevanceScore: number;
  readonly maxResults: number;
  readonly timeoutMs: number;
  readonly referenceTime: IsoDateTime;
  readonly referenceMs: number;
  readonly retrievedAt: IsoDateTime;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export interface EvidenceProviderAdapter {
  readonly id: EvidenceProviderId;
  harvest(context: ProviderAdapterContext): Promise<ProviderHarvestReport>;
}

export interface EvidenceHarvestRequest {
  /** Search query or canonical question text. */
  readonly query: string;
  /** Optional question category used to select default providers. */
  readonly category?: PredictionCategory | null;
  /** Optional explicit subset/order of providers to query. */
  readonly providers?: readonly EvidenceProviderId[];
  /** Optional custom provider adapter instances (for testing or extension). */
  readonly adapters?: readonly EvidenceProviderAdapter[];
  /** Optional thematic keywords to enrich relevance scoring. */
  readonly thematicKeywords?: readonly string[];
  /** Optional terms that must appear in every accepted item. */
  readonly requiredTerms?: readonly string[];
  /** Minimum thematic relevance score in [0, 1]. Defaults to 0.15. */
  readonly minRelevanceScore?: number;
  /** Max accepted items per provider (clamped to HARD_MAX_RESULTS_PER_PROVIDER). */
  readonly maxResultsPerProvider?: number;
  /** Max total accepted items across all providers (clamped to HARD_MAX_TOTAL_RESULTS). */
  readonly maxTotalResults?: number;
  /** Per-provider HTTP timeout in ms (clamped to [100, 10_000]). */
  readonly timeoutMs?: number;
  /**
   * Server reference UTC timestamp (`serverNow`). Any evidence dated after this
   * instant is discarded. Defaults to `new Date().toISOString()`.
   */
  readonly referenceTime?: IsoDateTime;
  /** Optional custom fetch implementation (defaults to Node native `globalThis.fetch`). */
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Optional outer AbortSignal. */
  readonly signal?: AbortSignal;
}

export interface EvidenceHarvestResult {
  readonly query: string;
  readonly category: PredictionCategory | null;
  readonly selectedProviders: readonly EvidenceProviderId[];
  readonly referenceTime: IsoDateTime;
  readonly executedAt: IsoDateTime;
  readonly items: readonly HarvestedEvidenceItem[];
  readonly discarded: readonly DiscardedEvidenceDiagnostic[];
  readonly providerReports: readonly ProviderHarvestReport[];
  readonly summary: {
    readonly providersQueried: number;
    readonly providersSucceeded: number;
    readonly providersFailed: number;
    readonly rawCandidatesEvaluated: number;
    readonly totalAccepted: number;
    readonly totalDiscarded: number;
  };
}

export class InvalidHarvestRequestError extends Error {}

/* -------------------------------------------------------------------------
   Deterministic IDs, URL validation, and Temporal normalization
   ------------------------------------------------------------------------- */

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

/**
 * Compute a deterministic evidence identifier from the provider and canonical
 * origin URL (plus optional upstream source ID).
 */
export function computeDeterministicEvidenceId(
  provider: EvidenceProviderId,
  canonicalUrl: string,
  sourceId?: string | null,
): string {
  const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : '';
  const payload = `oracle.evidence/v1|${provider}|${canonicalUrl}|${normalizedSourceId}`;
  const hex = createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `ev-${provider}-${hex}`;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '127.0.0.1' ||
    lower === '[::1]' ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost')
  ) {
    return true;
  }
  if (/^127\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(lower)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(lower)) return true;
  return false;
}

/**
 * Validate and canonicalize an external HTTP(S) evidence URL.
 *
 * Returns `null` if `rawUrl` is missing, malformed, uses a non-HTTP(S) scheme,
 * embeds credentials, or points to a localhost/private address.
 */
export function validateAndNormalizeEvidenceUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;
  if (/\s|[\u0000-\u001F\u007F]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname.length === 0 ||
    !hostname.includes('.') ||
    hostname.startsWith('.') ||
    hostname.endsWith('.') ||
    isPrivateOrLocalHostname(hostname)
  ) {
    return null;
  }

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  parsed.hash = '';

  const keptParams: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) continue;
    keptParams.push([key, value]);
  }
  keptParams.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  parsed.search = '';
  for (const [key, value] of keptParams) {
    parsed.searchParams.append(key, value);
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const GDELT_COMPACT_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/;
const ISO_FLEX_FRACTION_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse and normalize a raw provider date string into a strict UTC ISO-8601
 * timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`), verifying real calendar dates via
 * `parseIsoDateTimeMs`.
 *
 * Returns `null` for missing, ambiguous (e.g. year-only `"2026"`), or
 * impossible calendar dates (e.g. `"2026-02-29"` or `"2026-04-31"`).
 */
export function normalizeVerifiableTimestamp(rawValue: unknown): IsoDateTime | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return null;

  // 1. Strict calendar date YYYY-MM-DD (e.g. OpenAlex publication_date)
  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnlyMatch) {
    const candidateIso = `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00.000Z`;
    return isValidIsoDateTime(candidateIso) ? candidateIso : null;
  }

  // 2. GDELT compact timestamp YYYYMMDDTHHMMSSZ or YYYYMMDDHHMMSS
  const gdeltMatch = GDELT_COMPACT_PATTERN.exec(trimmed);
  if (gdeltMatch) {
    const candidateIso = `${gdeltMatch[1]}-${gdeltMatch[2]}-${gdeltMatch[3]}T${gdeltMatch[4]}:${gdeltMatch[5]}:${gdeltMatch[6]}.000Z`;
    return isValidIsoDateTime(candidateIso) ? candidateIso : null;
  }

  // 3. ISO-8601 with Z or explicit numeric timezone offset
  const isoMatch = ISO_FLEX_FRACTION_PATTERN.exec(trimmed);
  if (isoMatch) {
    const prefix = isoMatch[1];
    const fraction = isoMatch[2] ? isoMatch[2].slice(0, 3).padEnd(3, '0') : '000';
    const tz = isoMatch[3];

    if (tz === 'Z') {
      const candidateIso = `${prefix}.${fraction}Z`;
      return isValidIsoDateTime(candidateIso) ? candidateIso : null;
    }

    // Verify the local calendar components before applying offset
    const localCheckIso = `${prefix}.${fraction}Z`;
    const localMs = parseIsoDateTimeMs(localCheckIso);
    if (localMs === null) return null;

    const sign = tz.startsWith('-') ? -1 : 1;
    const tzHours = Number(tz.slice(1, 3));
    const tzMinutes = Number(tz.slice(4, 6));
    if (tzHours > 23 || tzMinutes > 59) return null;

    const offsetMs = sign * (tzHours * 60 + tzMinutes) * 60_000;
    const utcEpoch = localMs - offsetMs;
    const utcIso = new Date(utcEpoch).toISOString();
    return isValidIsoDateTime(utcIso) ? utcIso : null;
  }

  return null;
}

/* -------------------------------------------------------------------------
   Text sanitization & Thematic relevance scoring
   ------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'before',
  'by',
  'can',
  'could',
  'de',
  'del',
  'do',
  'does',
  'el',
  'en',
  'es',
  'for',
  'from',
  'has',
  'have',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'la',
  'las',
  'lo',
  'los',
  'may',
  'might',
  'more',
  'no',
  'not',
  'of',
  'on',
  'or',
  'para',
  'por',
  'que',
  'se',
  'should',
  'sin',
  'so',
  'some',
  'su',
  'sus',
  'than',
  'that',
  'the',
  'their',
  'there',
  'these',
  'this',
  'to',
  'un',
  'una',
  'unas',
  'uno',
  'unos',
  'up',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'would',
  'y',
]);

/**
 * Strip HTML tags, decode basic entities, collapse whitespace, and truncate to
 * `MAX_SNIPPET_LENGTH`. Returns `null` if the resulting text is empty.
 */
export function sanitizeSnippet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const withoutTags = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (withoutTags.length === 0) return null;
  if (withoutTags.length <= MAX_SNIPPET_LENGTH) return withoutTags;
  return `${withoutTags.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

/**
 * Extract normalized lowercase thematic tokens from a query string.
 */
export function extractThematicTokens(
  query: string,
  extraKeywords?: readonly string[],
): string[] {
  const combined = [query, ...(extraKeywords ?? [])].join(' ');
  const rawTokens = combined
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

  return Array.from(new Set(rawTokens));
}

function tokenizeDocumentText(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  return new Set(tokens);
}

function tokenMatchesDocument(queryToken: string, docTokens: Set<string>): boolean {
  if (docTokens.has(queryToken)) return true;
  if (queryToken.length >= 5) {
    const stem = queryToken.slice(0, queryToken.length - 1);
    for (const docToken of docTokens) {
      if (docToken.startsWith(stem) || queryToken.startsWith(docToken.slice(0, -1))) {
        if (docToken.length >= 4) return true;
      }
    }
  }
  return false;
}

/**
 * Score how well an evidence item's title, snippet, and concepts match the
 * query tokens and required terms.
 */
export function computeThematicRelevance(
  title: string,
  snippet: string | null,
  extraTerms: readonly string[],
  queryTokens: readonly string[],
  requiredTerms: readonly string[],
): {
  passed: boolean;
  score: number;
  matchedTerms: string[];
} {
  const titleTokens = tokenizeDocumentText(title);
  const fullTokens = tokenizeDocumentText(
    [title, snippet ?? '', ...extraTerms].join(' '),
  );

  for (const required of requiredTerms) {
    const normalizedReq = required.trim().toLowerCase();
    if (normalizedReq.length === 0) continue;
    const reqTokens = extractThematicTokens(normalizedReq);
    const allReqMatched =
      reqTokens.length > 0 &&
      reqTokens.every((reqToken) => tokenMatchesDocument(reqToken, fullTokens));
    if (!allReqMatched) {
      return { passed: false, score: 0, matchedTerms: [] };
    }
  }

  if (queryTokens.length === 0) {
    return { passed: true, score: 1, matchedTerms: [] };
  }

  const matchedTerms: string[] = [];
  let titleHits = 0;

  for (const token of queryTokens) {
    if (tokenMatchesDocument(token, fullTokens)) {
      matchedTerms.push(token);
      if (tokenMatchesDocument(token, titleTokens)) {
        titleHits += 1;
      }
    }
  }

  if (matchedTerms.length === 0) {
    return { passed: false, score: 0, matchedTerms: [] };
  }

  const baseCoverage = matchedTerms.length / queryTokens.length;
  const titleBoost = (titleHits / queryTokens.length) * 0.25;
  const score = Math.min(1, Number((baseCoverage + titleBoost).toFixed(4)));

  return {
    passed: true,
    score,
    matchedTerms,
  };
}

/* -------------------------------------------------------------------------
   Shared HTTP execution & candidate validation pipeline
   ------------------------------------------------------------------------- */

interface RawExtractedCandidate {
  rawSourceId: string | null;
  rawTitle: unknown;
  rawPublisher: unknown;
  rawUrl: unknown;
  rawPublishedDate: unknown;
  rawUpdatedDate: unknown;
  rawIndexedDate: unknown;
  rawSnippet: unknown;
  extraThematicTerms?: readonly string[];
  retracted?: boolean;
  kind: EvidenceKind;
  sourceType: EvidenceSourceClassification;
  isPrimarySourceVerified: boolean;
  primarySourceVerificationNote: string;
}

function asNonEmptyTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

function asDiagnosticString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function buildRecordDigest(fields: {
  id: string;
  provider: EvidenceProviderId;
  title: string;
  publisher: string;
  url: string;
  publishedAt: IsoDateTime;
  publishedDate: IsoDateTime | null;
  updatedDate: IsoDateTime | null;
  indexedDate: IsoDateTime | null;
  temporalBasis: EvidenceTemporalBasis;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(fields))
    .digest('hex');
}

function validateAndNormalizeCandidate(
  provider: EvidenceProviderId,
  endpointUrl: string,
  httpStatus: number,
  raw: RawExtractedCandidate,
  context: ProviderAdapterContext,
):
  | { ok: true; item: HarvestedEvidenceItem }
  | { ok: false; diagnostic: DiscardedEvidenceDiagnostic } {
  const baseDiag = {
    provider,
    rawSourceId: raw.rawSourceId,
    rawTitle: asDiagnosticString(raw.rawTitle),
    rawUrl: asDiagnosticString(raw.rawUrl),
    rawPublishedDate: asDiagnosticString(raw.rawPublishedDate),
    rawUpdatedDate: asDiagnosticString(raw.rawUpdatedDate),
    rawIndexedDate: asDiagnosticString(raw.rawIndexedDate),
  };

  if (raw.retracted === true) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'retracted-source',
        detail: 'Upstream provider marks this work as retracted.',
      }),
    };
  }

  const title = asNonEmptyTrimmedString(raw.rawTitle);
  if (!title) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'missing-title',
        detail: 'Record was discarded because title is missing or empty in the HTTP response.',
      }),
    };
  }

  const publisher = asNonEmptyTrimmedString(raw.rawPublisher);
  if (!publisher) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'missing-publisher',
        detail:
          'Record was discarded because publisher/venue is missing in the HTTP response; fabricating a publisher is prohibited.',
      }),
    };
  }

  const url = validateAndNormalizeEvidenceUrl(raw.rawUrl);
  if (!url) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'invalid-url',
        detail:
          'Record was discarded because origin URL is missing, malformed, or not a public HTTP(S) URL.',
      }),
    };
  }

  const hasRawPublished = asDiagnosticString(raw.rawPublishedDate) !== null;
  const hasRawUpdated = asDiagnosticString(raw.rawUpdatedDate) !== null;
  const hasRawIndexed = asDiagnosticString(raw.rawIndexedDate) !== null;

  const publishedDate = hasRawPublished
    ? normalizeVerifiableTimestamp(raw.rawPublishedDate)
    : null;
  const updatedDate = hasRawUpdated
    ? normalizeVerifiableTimestamp(raw.rawUpdatedDate)
    : null;
  const indexedDate = hasRawIndexed
    ? normalizeVerifiableTimestamp(raw.rawIndexedDate)
    : null;

  // If the record supplied a publication or update field that failed calendar validation,
  // reject immediately as invalid-date.
  if ((hasRawPublished && publishedDate === null) || (hasRawUpdated && updatedDate === null)) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'invalid-date',
        detail:
          'Record contains a malformed or impossible calendar date in its publication/update fields.',
      }),
    };
  }

  // Requirement 7: Never confuse an indexing date with a publication or update date.
  if (publishedDate === null && updatedDate === null) {
    if (hasRawIndexed) {
      return {
        ok: false,
        diagnostic: Object.freeze({
          ...baseDiag,
          reason: 'indexing-date-only',
          detail:
            'Record only contains a crawler/repository indexing timestamp (e.g. seendate, created_date, or touched) and lacks a verifiable publication or update date.',
        }),
      };
    }
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'missing-verifiable-date',
        detail:
          'Record lacks both a verifiable publication date and a verifiable update date.',
      }),
    };
  }

  const publishedMs = publishedDate !== null ? parseIsoDateTimeMs(publishedDate) : null;
  const updatedMs = updatedDate !== null ? parseIsoDateTimeMs(updatedDate) : null;

  if (publishedMs !== null && updatedMs !== null && updatedMs < publishedMs) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'invalid-date',
        detail: `Update timestamp (${updatedDate}) precedes publication timestamp (${publishedDate}).`,
      }),
    };
  }

  // Requirement 6: Discard any record dated after the server reference time.
  // If an item was published before referenceTime but updated after referenceTime,
  // also discard it to prevent future-information leakage.
  if (
    (publishedMs !== null && publishedMs > context.referenceMs) ||
    (updatedMs !== null && updatedMs > context.referenceMs)
  ) {
    const offending =
      publishedMs !== null && publishedMs > context.referenceMs
        ? publishedDate
        : updatedDate;
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'future-date',
        detail: `Verifiable timestamp (${offending}) is later than the server reference timestamp (${context.referenceTime}).`,
      }),
    };
  }

  const temporalBasis: EvidenceTemporalBasis =
    publishedDate !== null ? 'published' : 'updated';
  const effectivePublishedAt = (publishedDate ?? updatedDate) as IsoDateTime;

  const snippet = sanitizeSnippet(raw.rawSnippet);
  const relevance = computeThematicRelevance(
    title,
    snippet,
    raw.extraThematicTerms ?? [],
    context.queryTokens,
    context.requiredTerms,
  );

  if (!relevance.passed || relevance.score < context.minRelevanceScore) {
    return {
      ok: false,
      diagnostic: Object.freeze({
        ...baseDiag,
        reason: 'low-thematic-relevance',
        detail: `Thematic relevance score (${relevance.score}) is below the required threshold (${context.minRelevanceScore}).`,
      }),
    };
  }

  const id = computeDeterministicEvidenceId(provider, url, raw.rawSourceId);
  const recordDigest = buildRecordDigest({
    id,
    provider,
    title,
    publisher,
    url,
    publishedAt: effectivePublishedAt,
    publishedDate,
    updatedDate,
    indexedDate,
    temporalBasis,
  });

  const provenance: EvidenceProvenanceMetadata = Object.freeze({
    provider,
    adapterVersion: '1.0.0',
    endpointUrl,
    httpStatus,
    retrievedAt: context.retrievedAt,
    referenceTime: context.referenceTime,
    rawSourceId: raw.rawSourceId,
    rawDateFields: Object.freeze({
      published: baseDiag.rawPublishedDate,
      updated: baseDiag.rawUpdatedDate,
      indexed: baseDiag.rawIndexedDate,
    }),
    temporalBasis,
    primarySourceVerified: raw.isPrimarySourceVerified,
    primarySourceVerificationNote: raw.primarySourceVerificationNote,
    metadataOrigin: 'http-response-verbatim',
    recordDigest,
  });

  const item: HarvestedEvidenceItem = Object.freeze({
    id,
    title,
    publisher,
    url,
    publishedAt: effectivePublishedAt,
    publishedDate,
    updatedDate,
    indexedDate,
    temporalBasis,
    snippet,
    sourceProvider: provider,
    sourceId: raw.rawSourceId,
    kind: raw.kind,
    sourceType: raw.sourceType,
    isPrimarySourceVerified: raw.isPrimarySourceVerified,
    primarySourceVerificationNote: raw.primarySourceVerificationNote,
    relevanceScore: relevance.score,
    matchedTerms: Object.freeze([...relevance.matchedTerms]),
    provenance,
  });

  return { ok: true, item };
}

function createTimeoutAbortSignal(
  timeoutMs: number,
  outerSignal?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!outerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, outerSignal]);
  }
  return timeoutSignal;
}

function isTimeoutOrAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT'
  );
}

async function fetchJsonWithGuardrails(
  provider: EvidenceProviderId,
  endpointUrl: string,
  context: ProviderAdapterContext,
): Promise<
  | { ok: true; httpStatus: number; durationMs: number; data: unknown }
  | { ok: false; report: ProviderHarvestReport }
> {
  const startedAt = Date.now();
  const signal = createTimeoutAbortSignal(context.timeoutMs, context.signal);

  let response: Response;
  try {
    response = await context.fetchImpl(endpointUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': HARVESTER_USER_AGENT,
      },
      signal,
    });
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const isTimeout = isTimeoutOrAbortError(error) || signal.aborted;
    const message =
      error instanceof Error ? error.message : 'Unknown network failure';

    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: isTimeout ? 'timeout' : 'network-error',
        endpointUrl,
        httpStatus: null,
        durationMs,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: isTimeout
          ? `Provider '${provider}' timed out after ${context.timeoutMs}ms (${message}).`
          : `Provider '${provider}' network error: ${message}`,
      }),
    };
  }

  const durationMs = Math.max(0, Date.now() - startedAt);

  if (!response.ok) {
    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: 'http-error',
        endpointUrl,
        httpStatus: response.status,
        durationMs,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: `Provider '${provider}' returned HTTP ${response.status}.`,
      }),
    };
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    const isTimeout = isTimeoutOrAbortError(error) || signal.aborted;
    const message =
      error instanceof Error ? error.message : 'Failed reading response stream';
    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: isTimeout ? 'timeout' : 'network-error',
        endpointUrl,
        httpStatus: response.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: isTimeout
          ? `Provider '${provider}' response body timed out: ${message}`
          : `Provider '${provider}' body read failed: ${message}`,
      }),
    };
  }

  if (Buffer.byteLength(rawText, 'utf8') > MAX_RESPONSE_BODY_BYTES) {
    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: 'invalid-payload',
        endpointUrl,
        httpStatus: response.status,
        durationMs,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: `Provider '${provider}' payload exceeded ${MAX_RESPONSE_BODY_BYTES} bytes limit.`,
      }),
    };
  }

  if (rawText.trim().length === 0) {
    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: 'empty',
        endpointUrl,
        httpStatus: response.status,
        durationMs,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: null,
      }),
    };
  }

  try {
    const data: unknown = JSON.parse(rawText);
    return {
      ok: true,
      httpStatus: response.status,
      durationMs,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Malformed JSON';
    return {
      ok: false,
      report: Object.freeze({
        provider,
        status: 'invalid-payload',
        endpointUrl,
        httpStatus: response.status,
        durationMs,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: `Provider '${provider}' returned invalid JSON: ${message}`,
      }),
    };
  }
}

function finalizeAdapterCandidates(
  provider: EvidenceProviderId,
  endpointUrl: string,
  httpStatus: number,
  durationMs: number,
  rawCandidates: readonly RawExtractedCandidate[],
  context: ProviderAdapterContext,
): ProviderHarvestReport {
  const accepted: HarvestedEvidenceItem[] = [];
  const discarded: DiscardedEvidenceDiagnostic[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const seenTitlePublisherDates = new Set<string>();

  for (const raw of rawCandidates) {
    const outcome = validateAndNormalizeCandidate(
      provider,
      endpointUrl,
      httpStatus,
      raw,
      context,
    );
    if (!outcome.ok) {
      discarded.push(outcome.diagnostic);
      continue;
    }

    const item = outcome.item;
    const titlePublisherDateKey = `${item.publisher.toLowerCase()}|${item.title.toLowerCase()}|${item.publishedAt.slice(0, 10)}`;

    if (
      seenUrls.has(item.url) ||
      seenIds.has(item.id) ||
      seenTitlePublisherDates.has(titlePublisherDateKey)
    ) {
      discarded.push(
        Object.freeze({
          provider,
          reason: 'duplicate-evidence',
          detail: `Duplicate evidence item detected within provider '${provider}' for URL '${item.url}'.`,
          rawSourceId: item.sourceId,
          rawTitle: item.title,
          rawUrl: item.url,
          rawPublishedDate: item.provenance.rawDateFields.published,
          rawUpdatedDate: item.provenance.rawDateFields.updated,
          rawIndexedDate: item.provenance.rawDateFields.indexed,
        }),
      );
      continue;
    }

    seenUrls.add(item.url);
    seenIds.add(item.id);
    seenTitlePublisherDates.add(titlePublisherDateKey);
    accepted.push(item);

    if (accepted.length >= context.maxResults) {
      break;
    }
  }

  return Object.freeze({
    provider,
    status: accepted.length > 0 ? 'ok' : 'empty',
    endpointUrl,
    httpStatus,
    durationMs,
    rawCandidateCount: rawCandidates.length,
    accepted: Object.freeze(accepted),
    discarded: Object.freeze(discarded),
    error: null,
  });
}

/* -------------------------------------------------------------------------
   1. OpenAlex Provider Adapter
   ------------------------------------------------------------------------- */

export interface OpenAlexAdapterOptions {
  readonly baseUrl?: string;
}

function reconstructOpenAlexAbstract(invertedIndex: unknown): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object' || Array.isArray(invertedIndex)) {
    return null;
  }

  const entries = Object.entries(invertedIndex as Record<string, unknown>);
  if (entries.length === 0) return null;

  const positionedWords: Array<{ position: number; word: string }> = [];
  for (const [word, positions] of entries) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && Number.isInteger(pos) && pos >= 0 && pos < 5_000) {
        positionedWords.push({ position: pos, word });
      }
    }
  }

  if (positionedWords.length === 0) return null;
  positionedWords.sort((a, b) => a.position - b.position);
  return positionedWords.map((entry) => entry.word).join(' ');
}

function classifyOpenAlexWorkType(rawType: unknown): {
  kind: EvidenceKind;
  sourceType: EvidenceSourceClassification;
} {
  const normalized = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
  if (normalized === 'dataset') {
    return { kind: 'dataset', sourceType: 'dataset' };
  }
  if (normalized === 'report' || normalized === 'standard') {
    return { kind: 'report', sourceType: 'secondary-report' };
  }
  if (normalized === 'preprint' || normalized === 'working-paper') {
    return { kind: 'paper', sourceType: 'preprint-or-working-paper' };
  }
  return { kind: 'paper', sourceType: 'peer-reviewed-work' };
}

export function createOpenAlexAdapter(
  options?: OpenAlexAdapterOptions,
): EvidenceProviderAdapter {
  const baseUrl = (options?.baseUrl ?? 'https://api.openalex.org/works').replace(
    /\/+$/,
    '',
  );

  return Object.freeze({
    id: 'openalex' as const,
    async harvest(context: ProviderAdapterContext): Promise<ProviderHarvestReport> {
      const fetchLimit = Math.min(
        HARD_MAX_RESULTS_PER_PROVIDER,
        Math.max(context.maxResults, DEFAULT_MAX_RESULTS_PER_PROVIDER),
      );
      const url = new URL(baseUrl);
      url.searchParams.set('search', context.query);
      url.searchParams.set('per-page', String(fetchLimit));
      url.searchParams.set(
        'select',
        'id,doi,title,display_name,publication_date,created_date,updated_date,type,is_retracted,primary_location,host_venue,abstract_inverted_index,concepts',
      );
      const endpointUrl = url.toString();

      const fetched = await fetchJsonWithGuardrails('openalex', endpointUrl, context);
      if (!fetched.ok) return fetched.report;

      const payload = fetched.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return Object.freeze({
          provider: 'openalex',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'OpenAlex response root is not a JSON object.',
        });
      }

      const rawResults = (payload as { results?: unknown }).results;
      if (!Array.isArray(rawResults)) {
        return Object.freeze({
          provider: 'openalex',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'OpenAlex response is missing a results array.',
        });
      }

      const candidates: RawExtractedCandidate[] = rawResults.map((entry): RawExtractedCandidate => {
        const work =
          entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>)
            : {};

        const primaryLocation =
          work.primary_location && typeof work.primary_location === 'object'
            ? (work.primary_location as Record<string, unknown>)
            : null;
        const primarySource =
          primaryLocation?.source && typeof primaryLocation.source === 'object'
            ? (primaryLocation.source as Record<string, unknown>)
            : null;
        const hostVenue =
          work.host_venue && typeof work.host_venue === 'object'
            ? (work.host_venue as Record<string, unknown>)
            : null;

        const rawTitle = work.title ?? work.display_name;
        const rawPublisher =
          primarySource?.display_name ??
          primarySource?.host_organization_name ??
          hostVenue?.display_name ??
          hostVenue?.publisher ??
          work.publisher ??
          null;

        const rawUrl =
          primaryLocation?.landing_page_url ??
          work.doi ??
          work.url ??
          work.id ??
          null;

        // OpenAlex: `publication_date` is the work's publication date.
        // `created_date` and `updated_date` are OpenAlex indexing timestamps and
        // MUST NEVER be treated as publication or update dates of the work itself.
        const rawPublishedDate = work.publication_date ?? work.published_at ?? null;
        const rawIndexedDate =
          work.created_date ?? work.updated_date ?? work.indexed_date ?? null;

        const reconstructedAbstract = reconstructOpenAlexAbstract(
          work.abstract_inverted_index,
        );
        const rawSnippet = reconstructedAbstract ?? work.abstract ?? work.snippet ?? null;

        const conceptsArray = Array.isArray(work.concepts) ? work.concepts : [];
        const extraThematicTerms: string[] = [];
        for (const concept of conceptsArray) {
          if (concept && typeof concept === 'object') {
            const name = (concept as { display_name?: unknown }).display_name;
            if (typeof name === 'string' && name.trim().length > 0) {
              extraThematicTerms.push(name.trim());
            }
          }
        }

        const { kind, sourceType } = classifyOpenAlexWorkType(work.type);
        const rawSourceId = asDiagnosticString(work.id ?? work.doi);

        return {
          rawSourceId,
          rawTitle,
          rawPublisher,
          rawUrl,
          rawPublishedDate,
          rawUpdatedDate: null,
          rawIndexedDate,
          rawSnippet,
          extraThematicTerms,
          retracted: work.is_retracted === true,
          kind,
          sourceType,
          isPrimarySourceVerified: false,
          primarySourceVerificationNote:
            'OpenAlex provides bibliographic metadata; primary-authority status cannot be verified from catalog aggregation alone.',
        };
      });

      return finalizeAdapterCandidates(
        'openalex',
        endpointUrl,
        fetched.httpStatus,
        fetched.durationMs,
        candidates,
        context,
      );
    },
  });
}

/* -------------------------------------------------------------------------
   2. Wikipedia MediaWiki API Provider Adapter
   ------------------------------------------------------------------------- */

export interface WikipediaAdapterOptions {
  readonly baseUrl?: string;
}

export function createWikipediaAdapter(
  options?: WikipediaAdapterOptions,
): EvidenceProviderAdapter {
  const baseUrl = (
    options?.baseUrl ?? 'https://en.wikipedia.org/w/api.php'
  ).replace(/\/+$/, '');

  return Object.freeze({
    id: 'wikipedia' as const,
    async harvest(context: ProviderAdapterContext): Promise<ProviderHarvestReport> {
      const fetchLimit = Math.min(
        HARD_MAX_RESULTS_PER_PROVIDER,
        Math.max(context.maxResults, DEFAULT_MAX_RESULTS_PER_PROVIDER),
      );
      const url = new URL(baseUrl);
      url.searchParams.set('action', 'query');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', context.query);
      url.searchParams.set('gsrlimit', String(fetchLimit));
      url.searchParams.set('prop', 'info|extracts|revisions');
      url.searchParams.set('inprop', 'url');
      url.searchParams.set('rvprop', 'timestamp');
      url.searchParams.set('exintro', '1');
      url.searchParams.set('explaintext', '1');
      url.searchParams.set('meta', 'siteinfo');
      url.searchParams.set('format', 'json');
      url.searchParams.set('utf8', '1');
      url.searchParams.set('origin', '*');
      const endpointUrl = url.toString();

      const fetched = await fetchJsonWithGuardrails('wikipedia', endpointUrl, context);
      if (!fetched.ok) return fetched.report;

      const payload = fetched.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return Object.freeze({
          provider: 'wikipedia',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'Wikipedia response root is not a JSON object.',
        });
      }

      const queryObj = (payload as { query?: unknown }).query;
      if (queryObj === undefined || queryObj === null) {
        return Object.freeze({
          provider: 'wikipedia',
          status: 'empty',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: null,
        });
      }

      if (typeof queryObj !== 'object' || Array.isArray(queryObj)) {
        return Object.freeze({
          provider: 'wikipedia',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'Wikipedia response query property is malformed.',
        });
      }

      const queryRecord = queryObj as Record<string, unknown>;
      const generalRecord =
        queryRecord.general && typeof queryRecord.general === 'object'
          ? (queryRecord.general as Record<string, unknown>)
          : null;
      const sitePublisher = generalRecord?.sitename ?? null;

      let rawItems: unknown[] = [];
      if (Array.isArray(queryRecord.search)) {
        rawItems = queryRecord.search;
      } else if (Array.isArray(queryRecord.pages)) {
        rawItems = queryRecord.pages;
      } else if (
        queryRecord.pages &&
        typeof queryRecord.pages === 'object' &&
        !Array.isArray(queryRecord.pages)
      ) {
        rawItems = Object.values(queryRecord.pages as Record<string, unknown>);
      }

      const candidates: RawExtractedCandidate[] = rawItems.map((entry): RawExtractedCandidate => {
        const page =
          entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>)
            : {};

        const revisions = Array.isArray(page.revisions) ? page.revisions : [];
        const firstRevision =
          revisions[0] && typeof revisions[0] === 'object'
            ? (revisions[0] as Record<string, unknown>)
            : null;

        // MediaWiki: `timestamp` / `revisions[0].timestamp` is the revision update timestamp.
        // `touched` / `indexed_at` / `crawled_at` is an internal cache/indexing timestamp
        // and MUST NEVER be treated as publication or update date.
        const rawPublishedDate = page.published_at ?? page.created_at ?? null;
        const rawUpdatedDate =
          firstRevision?.timestamp ??
          page.timestamp ??
          page.updated_at ??
          page.last_modified ??
          null;
        const rawIndexedDate =
          page.touched ?? page.indexed_at ?? page.crawled_at ?? null;

        const rawUrl = page.canonicalurl ?? page.fullurl ?? page.url ?? null;
        const rawPublisher = page.publisher ?? sitePublisher ?? null;
        const rawSnippet = page.extract ?? page.snippet ?? page.description ?? null;
        const rawSourceId = asDiagnosticString(page.pageid ?? page.id);

        return {
          rawSourceId,
          rawTitle: page.title ?? null,
          rawPublisher,
          rawUrl,
          rawPublishedDate,
          rawUpdatedDate,
          rawIndexedDate,
          rawSnippet,
          kind: 'report',
          sourceType: 'encyclopedic-reference',
          isPrimarySourceVerified: false,
          primarySourceVerificationNote:
            'Wikipedia is a collaborative tertiary encyclopedia and is never classified as a primary source.',
        };
      });

      return finalizeAdapterCandidates(
        'wikipedia',
        endpointUrl,
        fetched.httpStatus,
        fetched.durationMs,
        candidates,
        context,
      );
    },
  });
}

/* -------------------------------------------------------------------------
   3. GDELT DOC 2.0 API Provider Adapter
   ------------------------------------------------------------------------- */

export interface GdeltAdapterOptions {
  readonly baseUrl?: string;
}

export function createGdeltAdapter(
  options?: GdeltAdapterOptions,
): EvidenceProviderAdapter {
  const baseUrl = (
    options?.baseUrl ?? 'https://api.gdeltproject.org/api/v2/doc/doc'
  ).replace(/\/+$/, '');

  return Object.freeze({
    id: 'gdelt' as const,
    async harvest(context: ProviderAdapterContext): Promise<ProviderHarvestReport> {
      const fetchLimit = Math.min(
        HARD_MAX_RESULTS_PER_PROVIDER,
        Math.max(context.maxResults, DEFAULT_MAX_RESULTS_PER_PROVIDER),
      );
      const url = new URL(baseUrl);
      url.searchParams.set('query', context.query);
      url.searchParams.set('mode', 'ArtList');
      url.searchParams.set('maxrecords', String(fetchLimit));
      url.searchParams.set('format', 'json');
      url.searchParams.set('sort', 'HybridRel');
      const endpointUrl = url.toString();

      const fetched = await fetchJsonWithGuardrails('gdelt', endpointUrl, context);
      if (!fetched.ok) return fetched.report;

      const payload = fetched.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return Object.freeze({
          provider: 'gdelt',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'GDELT response root is not a JSON object.',
        });
      }

      const rawArticles = (payload as { articles?: unknown }).articles;
      if (rawArticles === undefined || rawArticles === null) {
        return Object.freeze({
          provider: 'gdelt',
          status: 'empty',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: null,
        });
      }

      if (!Array.isArray(rawArticles)) {
        return Object.freeze({
          provider: 'gdelt',
          status: 'invalid-payload',
          endpointUrl,
          httpStatus: fetched.httpStatus,
          durationMs: fetched.durationMs,
          rawCandidateCount: 0,
          accepted: Object.freeze([]),
          discarded: Object.freeze([]),
          error: 'GDELT response articles property is not an array.',
        });
      }

      const candidates: RawExtractedCandidate[] = rawArticles.map((entry): RawExtractedCandidate => {
        const article =
          entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>)
            : {};

        // GDELT: `seendate` is when GDELT crawled/indexed the article and MUST
        // be recorded strictly as `indexedDate`, never as `publishedDate`.
        const rawPublishedDate =
          article.published_at ??
          article.publishdate ??
          article.publication_date ??
          article.date_published ??
          article.publishedAt ??
          null;
        const rawUpdatedDate =
          article.updated_at ??
          article.updateddate ??
          article.date_updated ??
          article.updatedAt ??
          null;
        const rawIndexedDate =
          article.seendate ??
          article.indexed_at ??
          article.indexeddate ??
          article.crawled_at ??
          article.indexedAt ??
          null;

        const rawPublisher =
          article.publisher ?? article.source ?? article.domain ?? null;
        const rawSnippet =
          article.snippet ?? article.summary ?? article.description ?? null;
        const rawSourceId = asDiagnosticString(article.id ?? article.url);

        return {
          rawSourceId,
          rawTitle: article.title ?? null,
          rawPublisher,
          rawUrl: article.url ?? null,
          rawPublishedDate,
          rawUpdatedDate,
          rawIndexedDate,
          rawSnippet,
          kind: 'report',
          sourceType: 'news-article',
          isPrimarySourceVerified: false,
          primarySourceVerificationNote:
            'GDELT aggregates secondary news media; primary-source status cannot be verified from news syndication.',
        };
      });

      return finalizeAdapterCandidates(
        'gdelt',
        endpointUrl,
        fetched.httpStatus,
        fetched.durationMs,
        candidates,
        context,
      );
    },
  });
}

/* -------------------------------------------------------------------------
   Provider selection & Harvester orchestration
   ------------------------------------------------------------------------- */

/**
 * Determine the ordered list of evidence providers to query for a given
 * question category or explicit provider list.
 */
export function selectProvidersForCategory(
  category?: PredictionCategory | null,
  requestedProviders?: readonly EvidenceProviderId[],
): EvidenceProviderId[] {
  if (requestedProviders && requestedProviders.length > 0) {
    const deduplicated: EvidenceProviderId[] = [];
    for (const provider of requestedProviders) {
      if (
        (EVIDENCE_PROVIDERS as readonly string[]).includes(provider) &&
        !deduplicated.includes(provider)
      ) {
        deduplicated.push(provider);
      }
    }
    if (deduplicated.length > 0) return deduplicated;
  }

  if (category && category in DEFAULT_CATEGORY_PROVIDERS) {
    return [...DEFAULT_CATEGORY_PROVIDERS[category]];
  }

  return [...EVIDENCE_PROVIDERS];
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Execute a multi-provider verifiable evidence harvest.
 *
 * Isolates provider failures, enforces `AbortSignal.timeout`, deduplicates
 * across providers, discards future/missing/indexing-only timestamps, and
 * returns a frozen audit report.
 */
export async function harvestEvidence(
  request: EvidenceHarvestRequest,
): Promise<EvidenceHarvestResult> {
  const query = typeof request.query === 'string' ? request.query.trim() : '';
  if (query.length === 0) {
    throw new InvalidHarvestRequestError('Evidence harvest query must be a non-empty string.');
  }

  const executedAt = new Date().toISOString();
  const referenceTime = request.referenceTime ?? executedAt;
  const referenceMs = parseIsoDateTimeMs(referenceTime);
  if (referenceMs === null) {
    throw new InvalidHarvestRequestError(
      `referenceTime '${referenceTime}' is not a valid calendar UTC ISO-8601 timestamp.`,
    );
  }

  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new InvalidHarvestRequestError('No native fetch implementation is available.');
  }

  const maxResultsPerProvider = clampInteger(
    request.maxResultsPerProvider,
    DEFAULT_MAX_RESULTS_PER_PROVIDER,
    1,
    HARD_MAX_RESULTS_PER_PROVIDER,
  );
  const maxTotalResults = clampInteger(
    request.maxTotalResults,
    DEFAULT_MAX_TOTAL_RESULTS,
    1,
    HARD_MAX_TOTAL_RESULTS,
  );
  const timeoutMs = clampInteger(
    request.timeoutMs,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    MIN_PROVIDER_TIMEOUT_MS,
    MAX_PROVIDER_TIMEOUT_MS,
  );
  const minRelevanceScore =
    request.minRelevanceScore !== undefined && Number.isFinite(request.minRelevanceScore)
      ? Math.min(1, Math.max(0, request.minRelevanceScore))
      : DEFAULT_MIN_RELEVANCE_SCORE;

  const selectedProviders = selectProvidersForCategory(
    request.category ?? null,
    request.providers,
  );

  const builtInAdapters: Record<EvidenceProviderId, EvidenceProviderAdapter> = {
    openalex: createOpenAlexAdapter(),
    wikipedia: createWikipediaAdapter(),
    gdelt: createGdeltAdapter(),
  };

  if (request.adapters) {
    for (const custom of request.adapters) {
      builtInAdapters[custom.id] = custom;
    }
  }

  const queryTokens = extractThematicTokens(query, request.thematicKeywords);
  const requiredTerms = request.requiredTerms ? [...request.requiredTerms] : [];

  const adapterContext: ProviderAdapterContext = Object.freeze({
    query,
    queryTokens: Object.freeze(queryTokens),
    requiredTerms: Object.freeze(requiredTerms),
    minRelevanceScore,
    maxResults: maxResultsPerProvider,
    timeoutMs,
    referenceTime,
    referenceMs,
    retrievedAt: executedAt,
    fetchImpl,
    signal: request.signal,
  });

  const settledReports = await Promise.allSettled(
    selectedProviders.map((providerId) => {
      const adapter = builtInAdapters[providerId];
      return adapter.harvest(adapterContext);
    }),
  );

  const providerReports: ProviderHarvestReport[] = settledReports.map(
    (result, index): ProviderHarvestReport => {
      const providerId = selectedProviders[index];
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : 'Unhandled adapter exception';
      return Object.freeze({
        provider: providerId,
        status: 'network-error',
        endpointUrl: '',
        httpStatus: null,
        durationMs: 0,
        rawCandidateCount: 0,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: message,
      });
    },
  );

  // Merge, cross-provider deduplicate, sort by relevance & recency, and cap total results
  const allDiscardDiagnostics: DiscardedEvidenceDiagnostic[] = [];
  const mergedCandidates: HarvestedEvidenceItem[] = [];

  for (const report of providerReports) {
    for (const diag of report.discarded) {
      allDiscardDiagnostics.push(diag);
    }
    for (const item of report.accepted) {
      mergedCandidates.push(item);
    }
  }

  mergedCandidates.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    if (a.temporalBasis !== b.temporalBasis) {
      return a.temporalBasis === 'published' ? -1 : 1;
    }
    const aMs = parseIsoDateTimeMs(a.publishedAt) ?? 0;
    const bMs = parseIsoDateTimeMs(b.publishedAt) ?? 0;
    if (bMs !== aMs) return bMs - aMs;
    return a.id.localeCompare(b.id);
  });

  const deduplicatedItems: HarvestedEvidenceItem[] = [];
  const globalSeenUrls = new Set<string>();
  const globalSeenIds = new Set<string>();
  const globalSeenTitlePublisherDate = new Set<string>();

  for (const item of mergedCandidates) {
    const titlePublisherDateKey = `${item.publisher.toLowerCase()}|${item.title.toLowerCase()}|${item.publishedAt.slice(0, 10)}`;
    if (
      globalSeenUrls.has(item.url) ||
      globalSeenIds.has(item.id) ||
      globalSeenTitlePublisherDate.has(titlePublisherDateKey)
    ) {
      allDiscardDiagnostics.push(
        Object.freeze({
          provider: item.sourceProvider,
          reason: 'duplicate-evidence',
          detail: `Cross-provider duplicate evidence discarded for URL '${item.url}'.`,
          rawSourceId: item.sourceId,
          rawTitle: item.title,
          rawUrl: item.url,
          rawPublishedDate: item.provenance.rawDateFields.published,
          rawUpdatedDate: item.provenance.rawDateFields.updated,
          rawIndexedDate: item.provenance.rawDateFields.indexed,
        }),
      );
      continue;
    }

    globalSeenUrls.add(item.url);
    globalSeenIds.add(item.id);
    globalSeenTitlePublisherDate.add(titlePublisherDateKey);
    deduplicatedItems.push(item);

    if (deduplicatedItems.length >= maxTotalResults) {
      break;
    }
  }

  const providersSucceeded = providerReports.filter(
    (report) => report.status === 'ok' || report.status === 'empty',
  ).length;
  const providersFailed = providerReports.length - providersSucceeded;
  const rawCandidatesEvaluated = providerReports.reduce(
    (sum, report) => sum + report.rawCandidateCount,
    0,
  );

  return Object.freeze({
    query,
    category: request.category ?? null,
    selectedProviders: Object.freeze(selectedProviders),
    referenceTime,
    executedAt,
    items: Object.freeze(deduplicatedItems),
    discarded: Object.freeze(allDiscardDiagnostics),
    providerReports: Object.freeze(providerReports),
    summary: Object.freeze({
      providersQueried: providerReports.length,
      providersSucceeded,
      providersFailed,
      rawCandidatesEvaluated,
      totalAccepted: deduplicatedItems.length,
      totalDiscarded: allDiscardDiagnostics.length,
    }),
  });
}

/* -------------------------------------------------------------------------
   Anti-hallucination EvidenceReference binding for Publication Protocol
   ------------------------------------------------------------------------- */

/**
 * Convert a verified `HarvestedEvidenceItem` into a frozen protocol
 * `EvidenceReference`.
 *
 * `id`, `title`, `publisher`, `publishedAt`, `kind`, and `url` are copied
 * verbatim from the verified HTTP harvest item and cannot be overridden.
 */
export function toEvidenceReference(
  item: HarvestedEvidenceItem,
  forecasterNote?: string,
): EvidenceReference {
  const customNote =
    typeof forecasterNote === 'string' ? forecasterNote.trim() : '';
  const defaultNote = item.snippet
    ? `Harvested from ${item.sourceProvider} (${item.temporalBasis} ${item.publishedAt.slice(0, 10)}): ${item.snippet}`
    : `Harvested from ${item.sourceProvider} (${item.temporalBasis} ${item.publishedAt.slice(0, 10)}).`;

  return Object.freeze({
    id: item.id,
    title: item.title,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    kind: item.kind,
    url: item.url,
    note: customNote.length > 0 ? customNote : defaultNote,
  });
}

/**
 * Bind downstream LLM evidence selections strictly by their deterministic `id`
 * against a completed `EvidenceHarvestResult`.
 *
 * Prevents any future model from inventing or modifying `title`, `publisher`,
 * `publishedAt`, `url`, or `kind`: any unrecognized `id` is rejected and any
 * extra fields supplied by the caller are ignored.
 */
export function selectVerifiedEvidenceReferences(
  harvestResult: EvidenceHarvestResult,
  selections: ReadonlyArray<{ readonly id: string; readonly note?: string }>,
): EvidenceReference[] {
  const byId = new Map<string, HarvestedEvidenceItem>();
  for (const item of harvestResult.items) {
    byId.set(item.id, item);
  }

  const references: EvidenceReference[] = [];
  const seenIds = new Set<string>();

  for (const selection of selections) {
    if (!selection || typeof selection.id !== 'string') continue;
    const trimmedId = selection.id.trim();
    if (seenIds.has(trimmedId)) continue;

    const verifiedItem = byId.get(trimmedId);
    if (!verifiedItem) {
      continue;
    }

    seenIds.add(trimmedId);
    references.push(toEvidenceReference(verifiedItem, selection.note));
  }

  return references;
}
