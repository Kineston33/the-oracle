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
 *   4. Primary-source & peer-review honesty: a source is never labeled as a
 *      verified primary source (`isPrimarySourceVerified: false`) when the
 *      upstream provider is an encyclopedia, news aggregator, or bibliographic
 *      index that does not attest primary authority. Likewise, an OpenAlex work
 *      is only classified as `peer-reviewed-work` when peer review is explicitly
 *      verified in the payload; otherwise known scholarly types use the neutral
 *      `scholarly-work` classification and unknown types use `unverified-type`.
 *   5. True streaming byte cap & Render Free Tier protection: each provider
 *      runs with `AbortSignal.timeout` enforced across both connection and body
 *      streaming, progressive `ReadableStream` byte counting that immediately
 *      cancels the stream upon exceeding `MAX_RESPONSE_BODY_BYTES`, and strict
 *      result count caps. A slow or failing provider never aborts the harvest.
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
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
export const MAX_RESPONSE_BODY_BYTES = 512 * 1024; // 512 KB streaming cap for Render 512 MB RAM
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
  | 'scholarly-work'
  | 'preprint-or-working-paper'
  | 'dataset'
  | 'encyclopedic-reference'
  | 'news-article'
  | 'secondary-report'
  | 'unverified-type';

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
   Deterministic IDs, IP/URL validation, and Temporal normalization
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

/**
 * Parse a dotted-decimal IPv4 string into its 4 numeric octets `[o0, o1, o2, o3]`.
 * Uses Node's `net.isIP` plus strict octet bounds checking.
 */
function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

/**
 * True when an IPv4 octet tuple falls within any private, loopback, link-local,
 * CGNAT, documentation, benchmarking, multicast, or reserved range.
 */
function isPrivateOrReservedIpv4Octets(
  octets: readonly [number, number, number, number],
): boolean {
  const [o0, o1, o2] = octets;

  // 0.0.0.0/8 — "This" network / unspecified (RFC 1122)
  if (o0 === 0) return true;
  // 10.0.0.0/8 — Private-Use (RFC 1918)
  if (o0 === 10) return true;
  // 100.64.0.0/10 — Shared CGNAT Address Space (RFC 6598)
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;
  // 127.0.0.0/8 — Loopback (RFC 1122)
  if (o0 === 127) return true;
  // 169.254.0.0/16 — Link-Local / Cloud Metadata (RFC 3927)
  if (o0 === 169 && o1 === 254) return true;
  // 172.16.0.0/12 — Private-Use (RFC 1918): 172.16.0.0 – 172.31.255.255
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
  // 192.0.0.0/24 — IETF Protocol Assignments (RFC 6890)
  if (o0 === 192 && o1 === 0 && o2 === 0) return true;
  // 192.0.2.0/24 — TEST-NET-1 Documentation (RFC 5737)
  if (o0 === 192 && o1 === 0 && o2 === 2) return true;
  // 192.168.0.0/16 — Private-Use (RFC 1918)
  if (o0 === 192 && o1 === 168) return true;
  // 198.18.0.0/15 — Benchmarking (RFC 2544)
  if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;
  // 198.51.100.0/24 — TEST-NET-2 Documentation (RFC 5737)
  if (o0 === 198 && o1 === 51 && o2 === 100) return true;
  // 203.0.113.0/24 — TEST-NET-3 Documentation (RFC 5737)
  if (o0 === 203 && o1 === 0 && o2 === 113) return true;
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
  if (o0 >= 224) return true;

  return false;
}

/**
 * Parse a valid IPv6 address (without surrounding brackets or zone id) into
 * its 8 16-bit numeric hextets `[h0, h1, h2, h3, h4, h5, h6, h7]`.
 *
 * Supports compressed `::` notation and embedded trailing IPv4 dotted-quads
 * (such as `::ffff:172.16.0.1` or `::127.0.0.1`).
 */
function parseIpv6Hextets(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;

  let normalized = ip.toLowerCase();

  // If the IPv6 address has a trailing dotted-quad IPv4 (e.g. ::ffff:172.16.0.1),
  // convert the final IPv4 portion into two 16-bit hex groups.
  const lastColonIdx = normalized.lastIndexOf(':');
  if (lastColonIdx !== -1 && normalized.slice(lastColonIdx + 1).includes('.')) {
    const ipv4Tail = normalized.slice(lastColonIdx + 1);
    const octets = parseIpv4Octets(ipv4Tail);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, lastColonIdx + 1)}${high}:${low}`;
  }

  const doubleColonParts = normalized.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (segment: string): number[] | null => {
    if (segment.length === 0) return [];
    const tokens = segment.split(':');
    const values: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      const parsed = Number.parseInt(token, 16);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) return null;
      values.push(parsed);
    }
    return values;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSegmentList(doubleColonParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseSegmentList(doubleColonParts[0]);
  const right = parseSegmentList(doubleColonParts[1]);
  if (!left || !right) return null;

  const missingGroups = 8 - (left.length + right.length);
  if (missingGroups < 1) return null;

  return [...left, ...new Array<number>(missingGroups).fill(0), ...right];
}

function extractEmbeddedIpv4OctetsFromHextets(
  highHextet: number,
  lowHextet: number,
): [number, number, number, number] {
  return [
    (highHextet >> 8) & 0xff,
    highHextet & 0xff,
    (lowHextet >> 8) & 0xff,
    lowHextet & 0xff,
  ];
}

/**
 * True when an 8-hextet IPv6 address is non-public, reserved, or non-globally-routable
 * according to the IANA IPv6 Global Unicast (`2000::/3`) & IANA IPv6 Special-Purpose
 * Address Registries (RFC 4291, RFC 6890, RFC 7343, RFC 9374, RFC 9602, RFC 9637).
 *
 * Policy:
 *   1. Explicitly evaluate IPv4-embedding transition prefixes outside `2000::/3`
 *      (`::ffff:0:0/96` IPv4-mapped, `::/96` IPv4-compatible excluding `::/128`
 *      and `::1/128`, `::ffff:0:0:0/96` IPv4-translated, and `64:ff9b::/96`
 *      Well-Known NAT64) by validating their embedded 32-bit IPv4 address against
 *      `isPrivateOrReservedIpv4Octets`.
 *   2. Enforce a positive Global Unicast allowlist (`2000::/3`, i.e.,
 *      `(h[0] & 0xe000) === 0x2000`, `2000::`–`3fff:ffff:...`). Every other
 *      prefix outside `2000::/3` (including `::/128`, `::1/128`, `100::/64`
 *      Discard-Only, `64:ff9b:1::/48` Local NAT64, `5f00::/16` SRv6 SIDs,
 *      `fc00::/7` Unique-Local, `fe80::/10` Link-Local, `fec0::/10` Site-Local,
 *      `ff00::/8` Multicast, and all IETF reserved/unallocated blocks such as
 *      `0200::/7`, `0400::/6`, `4000::/3`, `8000::/3`, `c000::/3`, `e000::/4`)
 *      is rejected.
 *   3. Within `2000::/3`, reject all IANA Special-Purpose Address Registry
 *      exceptions and non-routable ranges:
 *        - `2001:0000::/32` (Teredo, RFC 4380): validate both the XOR-obfuscated
 *          client IPv4 (`h[6] ^ 0xffff, h[7] ^ 0xffff`) and server IPv4 (`h[2], h[3]`).
 *        - `2001:0000::/23` (`2001:0001::`–`2001:01ff:ffff:...`, IETF Protocol
 *          Assignments, RFC 2928): includes PCP/TURN/SRP Anycast (`2001:1::/32`),
 *          Benchmarking (`2001:2::/48`, RFC 5180), AMT (`2001:3::/32`, RFC 7450),
 *          AS112-v6 (`2001:4:112::/48`, RFC 7535), Deprecated ORCHID
 *          (`2001:10::/28`, RFC 4843), ORCHIDv2 (`2001:20::/28`, RFC 7343), and
 *          DRIP DETs (`2001:30::/28`, RFC 9374).
 *        - `2001:db8::/32` (Documentation, RFC 3849).
 *        - `2002::/16` (6to4, RFC 3056): validate the embedded IPv4 in `h[1], h[2]`.
 *        - `2620:4f:8000::/48` (Direct Delegation AS112 Service, RFC 7534).
 *        - `3fff::/20` (Documentation, RFC 9637).
 */
function isPrivateOrReservedIpv6Hextets(h: readonly number[]): boolean {
  if (h.length !== 8) return true;

  // 1. Unspecified ::/128 & Loopback ::1/128
  if (h.every((group) => group === 0)) return true;
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    h[6] === 0 &&
    h[7] === 1
  ) {
    return true;
  }

  // 2. IPv4-mapped IPv6 ::ffff:0:0/96 (RFC 4291)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  ) {
    const octets = extractEmbeddedIpv4OctetsFromHextets(h[6], h[7]);
    return isPrivateOrReservedIpv4Octets(octets);
  }

  // 3. IPv4-compatible IPv6 ::/96 (deprecated RFC 4291, e.g. ::127.0.0.1)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0 &&
    (h[6] !== 0 || h[7] > 1)
  ) {
    const octets = extractEmbeddedIpv4OctetsFromHextets(h[6], h[7]);
    return isPrivateOrReservedIpv4Octets(octets);
  }

  // 4. IPv4-translated IPv6 ::ffff:0:0:0/96 (RFC 2765)
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0xffff &&
    h[5] === 0
  ) {
    const octets = extractEmbeddedIpv4OctetsFromHextets(h[6], h[7]);
    return isPrivateOrReservedIpv4Octets(octets);
  }

  // 5. NAT64 Well-Known Prefix 64:ff9b::/96 (RFC 6052)
  //    Note: Local-Use NAT64 64:ff9b:1::/48 (RFC 8215) falls through and is rejected.
  if (
    h[0] === 0x0064 &&
    h[1] === 0xff9b &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0
  ) {
    const octets = extractEmbeddedIpv4OctetsFromHextets(h[6], h[7]);
    return isPrivateOrReservedIpv4Octets(octets);
  }

  // 6. Positive allowlist: require IANA Global Unicast 2000::/3 (0x2000..0x3fff)
  if ((h[0] & 0xe000) !== 0x2000) {
    return true;
  }

  // 7. Special-Purpose exceptions inside 2000::/3:

  // 7a. IETF Protocol Assignments 2001:0000::/23 (h[0] === 0x2001 && h[1] in 0x0000..0x01ff)
  if (h[0] === 0x2001 && (h[1] & 0xfe00) === 0x0000) {
    // Teredo 2001:0000::/32 (RFC 4380): embeds server IPv4 in h[2..3] and
    // XOR-obfuscated client IPv4 in h[6..7].
    if (h[1] === 0x0000) {
      const clientOctets = extractEmbeddedIpv4OctetsFromHextets(
        h[6] ^ 0xffff,
        h[7] ^ 0xffff,
      );
      if (isPrivateOrReservedIpv4Octets(clientOctets)) {
        return true;
      }
      if (h[2] !== 0 || h[3] !== 0) {
        const serverOctets = extractEmbeddedIpv4OctetsFromHextets(h[2], h[3]);
        if (isPrivateOrReservedIpv4Octets(serverOctets)) {
          return true;
        }
      }
      return false;
    }

    // All other sub-allocations in 2001:0000::/23 (0x0001..0x01ff) — including
    // Anycast 2001:1::/32, Benchmarking 2001:2::/48, AMT 2001:3::/32,
    // AS112-v6 2001:4:112::/48, ORCHID 2001:10::/28, ORCHIDv2 2001:20::/28,
    // and DRIP DETs 2001:30::/28 — are non-routable / special-purpose:
    return true;
  }

  // 7b. Documentation 2001:db8::/32 (RFC 3849)
  if (h[0] === 0x2001 && h[1] === 0x0db8) {
    return true;
  }

  // 7c. 6to4 2002::/16 (RFC 3056) — embeds IPv4 in h[1] and h[2]
  if (h[0] === 0x2002) {
    const octets = extractEmbeddedIpv4OctetsFromHextets(h[1], h[2]);
    return isPrivateOrReservedIpv4Octets(octets);
  }

  // 7d. Direct Delegation AS112 Service 2620:4f:8000::/48 (RFC 7534)
  if (h[0] === 0x2620 && h[1] === 0x004f && h[2] === 0x8000) {
    return true;
  }

  // 7e. Documentation 3fff::/20 (RFC 9637)
  if (h[0] === 0x3fff && (h[1] & 0xf000) === 0x0000) {
    return true;
  }

  return false;
}

const RESERVED_LOCAL_DOMAIN_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
  '.intranet',
  '.lan',
] as const;

/**
 * Determine whether a hostname or IP literal (IPv4, IPv6, or IPv4-mapped IPv6)
 * points to a local, loopback, link-local, unique-local, or private network
 * destination.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.length === 0) return true;

  // Unwrap bracketed IPv6 literal if present
  const unbracketed =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;

  // Any IPv6 scoped zone identifier (e.g. fe80::1%eth0 or fe80::1%25eth0) is local
  if (unbracketed.includes('%')) {
    return true;
  }

  // 1. Check IPv4 literal via exact octet parsing
  const ipv4Octets = parseIpv4Octets(unbracketed);
  if (ipv4Octets !== null) {
    return isPrivateOrReservedIpv4Octets(ipv4Octets);
  }

  // 2. Check IPv6 literal via exact 8-hextet parsing
  const ipv6Hextets = parseIpv6Hextets(unbracketed);
  if (ipv6Hextets !== null) {
    return isPrivateOrReservedIpv6Hextets(ipv6Hextets);
  }

  // If brackets were used around something that is not a valid IPv6 literal, reject
  if (trimmed.startsWith('[') || trimmed.endsWith(']') || unbracketed.includes(':')) {
    return true;
  }

  // 3. Check reserved local DNS names
  if (
    unbracketed === 'localhost' ||
    unbracketed === 'local' ||
    unbracketed === 'localdomain' ||
    unbracketed === 'internal' ||
    unbracketed === 'home.arpa'
  ) {
    return true;
  }

  for (const suffix of RESERVED_LOCAL_DOMAIN_SUFFIXES) {
    if (unbracketed.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

function isValidPublicDomainName(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  if (hostname.startsWith('.') || hostname.endsWith('.')) return false;

  const labels = hostname.split('.');
  if (labels.length < 2) return false;

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) {
      return false;
    }
  }

  const tld = labels[labels.length - 1];
  // RFC 1123 / ICANN: top-level domain label cannot be all-numeric (prevents malformed IPv4s like 127.0.0.999)
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    return false;
  }

  return true;
}

/**
 * Validate and canonicalize an external HTTP(S) evidence URL.
 *
 * Returns `null` if `rawUrl` is missing, malformed, uses a non-HTTP(S) scheme,
 * embeds credentials, or points to a localhost/private IPv4 or IPv6 address.
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
  if (hostname.length === 0 || isPrivateOrLocalHostname(hostname)) {
    return null;
  }

  const isBracketedIpv6 = hostname.startsWith('[') && hostname.endsWith(']');
  if (isBracketedIpv6) {
    if (parseIpv6Hextets(hostname.slice(1, -1)) === null) {
      return null;
    }
  } else if (parseIpv4Octets(hostname) === null) {
    if (!isValidPublicDomainName(hostname)) {
      return null;
    }
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
   Shared HTTP execution (streaming byte cap) & candidate validation pipeline
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

function createTimeoutError(timeoutMs: number): Error {
  const err = new Error(`Operation timed out after ${timeoutMs}ms`);
  err.name = 'TimeoutError';
  return err;
}

/**
 * Progressively read `response.body` via its `ReadableStream`, counting bytes
 * as each chunk arrives and immediately cancelling the stream if the cumulative
 * byte count exceeds `maxBytes` or if `signal` aborts during the read.
 *
 * Always releases the reader lock in `finally`.
 */
async function readResponseBodyWithByteLimit(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<
  | { status: 'ok'; text: string; byteLength: number }
  | { status: 'too-large'; byteLength: number }
> {
  if (signal.aborted) {
    throw createTimeoutError(timeoutMs);
  }

  if (!response.body) {
    return { status: 'ok', text: '', byteLength: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  let abortReject: ((reason: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortReject = reject;
  });

  const onAbort = () => {
    const err = createTimeoutError(timeoutMs);
    void reader.cancel(err).catch(() => undefined);
    if (abortReject) {
      abortReject(err);
    }
  };

  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) {
        throw createTimeoutError(timeoutMs);
      }

      const { done, value } = await Promise.race([
        reader.read(),
        abortPromise,
      ]);

      if (signal.aborted) {
        throw createTimeoutError(timeoutMs);
      }

      if (done) {
        break;
      }

      if (value && value.byteLength > 0) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader
            .cancel(`Response body exceeded ${maxBytes} bytes limit`)
            .catch(() => undefined);
          return { status: 'too-large', byteLength: totalBytes };
        }
        chunks.push(value);
      }
    }

    if (chunks.length === 0) {
      return { status: 'ok', text: '', byteLength: 0 };
    }

    const decoder = new TextDecoder('utf-8');
    if (chunks.length === 1) {
      return {
        status: 'ok',
        text: decoder.decode(chunks[0]),
        byteLength: totalBytes,
      };
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      status: 'ok',
      text: decoder.decode(merged),
      byteLength: totalBytes,
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Reader lock was already released
    }
  }
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

  if (!response.ok) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    const durationMs = Math.max(0, Date.now() - startedAt);
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

  let bodyResult:
    | { status: 'ok'; text: string; byteLength: number }
    | { status: 'too-large'; byteLength: number };
  try {
    bodyResult = await readResponseBodyWithByteLimit(
      response,
      MAX_RESPONSE_BODY_BYTES,
      context.timeoutMs,
      signal,
    );
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
          ? `Provider '${provider}' response body timed out after ${context.timeoutMs}ms: ${message}`
          : `Provider '${provider}' body read failed: ${message}`,
      }),
    };
  }

  const durationMs = Math.max(0, Date.now() - startedAt);

  if (bodyResult.status === 'too-large') {
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
        error: `Provider '${provider}' payload exceeded ${MAX_RESPONSE_BODY_BYTES} bytes limit (stopped at ${bodyResult.byteLength} bytes).`,
      }),
    };
  }

  const rawText = bodyResult.text;
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

export interface OpenAlexWorkClassificationInput {
  readonly type?: unknown;
  readonly isPeerReviewed?: unknown;
  readonly sourceType?: unknown;
  readonly sourceIsPeerReviewed?: unknown;
  readonly publishedVersion?: unknown;
}

export interface OpenAlexWorkClassification {
  readonly kind: EvidenceKind;
  readonly sourceType: EvidenceSourceClassification;
  readonly reportedWorkType: string | null;
  readonly peerReviewVerified: boolean;
}

const KNOWN_OPENALEX_SCHOLARLY_TYPES = new Set([
  'article',
  'journal-article',
  'review',
  'book-chapter',
  'book',
  'dissertation',
  'monograph',
  'proceedings-article',
]);

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

/**
 * Classify an OpenAlex work while strictly distinguishing:
 *   1. The work type reported by OpenAlex (`reportedWorkType`).
 *   2. Whether peer-review status has been explicitly verified (`peerReviewVerified`).
 *   3. Unknown or unverifiable work types (`unverified-type`).
 *
 * Never assigns `peer-reviewed-work` automatically to unknown types or to
 * `article` records whose peer-review condition has not been demonstrated.
 */
export function classifyOpenAlexWorkType(
  input: OpenAlexWorkClassificationInput | unknown,
): OpenAlexWorkClassification {
  const details: OpenAlexWorkClassificationInput =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as OpenAlexWorkClassificationInput)
      : { type: input };

  const rawType =
    typeof details.type === 'string' ? details.type.trim().toLowerCase() : '';
  const reportedWorkType = rawType.length > 0 ? rawType : null;

  if (reportedWorkType === 'dataset') {
    return Object.freeze({
      kind: 'dataset',
      sourceType: 'dataset',
      reportedWorkType,
      peerReviewVerified: false,
    });
  }

  if (reportedWorkType === 'report' || reportedWorkType === 'standard') {
    return Object.freeze({
      kind: 'report',
      sourceType: 'secondary-report',
      reportedWorkType,
      peerReviewVerified: false,
    });
  }

  if (
    reportedWorkType === 'preprint' ||
    reportedWorkType === 'working-paper' ||
    reportedWorkType === 'posted-content'
  ) {
    return Object.freeze({
      kind: 'paper',
      sourceType: 'preprint-or-working-paper',
      reportedWorkType,
      peerReviewVerified: false,
    });
  }

  if (reportedWorkType !== null && KNOWN_OPENALEX_SCHOLARLY_TYPES.has(reportedWorkType)) {
    const normalizedSourceType =
      typeof details.sourceType === 'string'
        ? details.sourceType.trim().toLowerCase()
        : '';
    const normalizedVersion =
      typeof details.publishedVersion === 'string'
        ? details.publishedVersion.trim()
        : '';

    const explicitlyPeerReviewed =
      details.isPeerReviewed === true ||
      (details.sourceIsPeerReviewed === true &&
        (normalizedSourceType === 'journal' || normalizedSourceType === 'conference') &&
        (normalizedVersion === 'publishedVersion' || normalizedVersion === 'acceptedVersion'));

    return Object.freeze({
      kind: 'paper',
      sourceType: explicitlyPeerReviewed ? 'peer-reviewed-work' : 'scholarly-work',
      reportedWorkType,
      peerReviewVerified: explicitlyPeerReviewed,
    });
  }

  return Object.freeze({
    kind: 'report',
    sourceType: 'unverified-type',
    reportedWorkType,
    peerReviewVerified: false,
  });
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

        const { kind, sourceType } = classifyOpenAlexWorkType({
          type: work.type,
          isPeerReviewed: work.is_peer_reviewed ?? work.peer_reviewed,
          sourceType: primarySource?.type ?? hostVenue?.type,
          sourceIsPeerReviewed:
            primarySource?.is_peer_reviewed ?? hostVenue?.is_peer_reviewed,
          publishedVersion: primaryLocation?.version ?? work.version,
        });
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

/**
 * Create a GDELT DOC 2.0 API (`mode=ArtList&format=json`) adapter.
 *
 * Real GDELT DOC 2.0 `ArtList` JSON response structure per item in `articles`:
 *   - `url`: article origin URL
 *   - `url_mobile`: mobile article URL (often `""`)
 *   - `title`: article headline
 *   - `seendate`: UTC timestamp (`YYYYMMDDTHHMMSSZ`) when GDELT's crawler
 *     discovered/indexed the article — this is strictly an **indexing date**
 *     (`indexedDate`), NEVER a publication date (`publishedDate`).
 *   - `socialimage`: preview image URL
 *   - `domain`: publisher domain (e.g. `"reuters.com"`)
 *   - `language`: article language (e.g. `"English"`)
 *   - `sourcecountry`: country of origin
 *
 * Temporal field mapping:
 *   - Publication date (`rawPublishedDate`): `published_at`, `publishdate`,
 *     `publication_date`, `date_published`, `publishedAt`.
 *   - Update date (`rawUpdatedDate`): `updated_at`, `updateddate`,
 *     `date_updated`, `updatedAt`.
 *   - Indexing date (`rawIndexedDate`): `seendate`, `indexed_at`, `indexeddate`,
 *     `crawled_at`, `indexedAt`.
 *
 * Because unenriched GDELT DOC 2.0 `ArtList` responses only return `seendate`
 * (indexing timestamp) and do not include a verifiable article publication or
 * update timestamp, standard unenriched GDELT `ArtList` entries are discarded
 * with `reason: 'indexing-date-only'`. Dates and metadata are never fabricated.
 */
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
