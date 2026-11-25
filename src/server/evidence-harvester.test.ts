import { describe, expect, it, vi } from 'vitest';
import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import {
  DEFAULT_CATEGORY_PROVIDERS,
  HARD_MAX_RESULTS_PER_PROVIDER,
  HARD_MAX_TOTAL_RESULTS,
  InvalidHarvestRequestError,
  MAX_RESPONSE_BODY_BYTES,
  classifyOpenAlexWorkType,
  computeDeterministicEvidenceId,
  computeThematicRelevance,
  createGdeltAdapter,
  createOpenAlexAdapter,
  createWikipediaAdapter,
  harvestEvidence,
  isPrivateOrLocalHostname,
  normalizeVerifiableTimestamp,
  selectProvidersForCategory,
  selectVerifiedEvidenceReferences,
  toEvidenceReference,
  validateAndNormalizeEvidenceUrl,
} from './evidence-harvester.ts';

const SERVER_REFERENCE_TIME = '2026-06-15T12:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EvidenceHarvester — Stage 1', () => {
  describe('1. Respuestas válidas de cada proveedor', () => {
    it('normalizes valid OpenAlex works, reconstructs inverted-index abstracts, and preserves provenance', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        expect(url).toContain('api.openalex.org/works');
        return jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W4391234567',
              doi: 'https://doi.org/10.1038/s41558-026-01999-x',
              title: 'Global atmospheric carbon dioxide concentrations and 2030 pathways',
              publication_date: '2026-03-10',
              created_date: '2026-03-12',
              updated_date: '2026-04-01T08:30:00.000000Z',
              type: 'article',
              is_retracted: false,
              primary_location: {
                landing_page_url: 'https://doi.org/10.1038/s41558-026-01999-x',
                source: {
                  display_name: 'Nature Climate Change',
                  host_organization_name: 'Springer Nature',
                },
              },
              abstract_inverted_index: {
                Atmospheric: [0],
                carbon: [1],
                dioxide: [2],
                concentrations: [3],
                continued: [4],
                rising: [5],
                in: [6],
                early: [7],
                '2026.': [8],
              },
              concepts: [{ display_name: 'Carbon dioxide' }, { display_name: 'Climatology' }],
            },
            {
              id: 'https://openalex.org/W4397654321',
              doi: 'https://doi.org/10.5281/zenodo.998877',
              title: 'Mauna Loa atmospheric carbon dioxide dataset 2026',
              publication_date: '2026-05-01',
              created_date: '2026-05-03',
              type: 'dataset',
              is_retracted: false,
              primary_location: {
                landing_page_url: 'https://doi.org/10.5281/zenodo.998877',
                source: {
                  display_name: 'Zenodo',
                },
              },
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'Will atmospheric carbon dioxide concentrations exceed threshold by 2030?',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.summary.providersQueried).toBe(1);
      expect(result.summary.providersSucceeded).toBe(1);
      expect(result.summary.totalAccepted).toBe(2);
      expect(result.items).toHaveLength(2);

      const paperItem = result.items.find((item) => item.kind === 'paper');
      const datasetItem = result.items.find((item) => item.kind === 'dataset');

      expect(paperItem).toBeDefined();
      expect(paperItem?.title).toBe(
        'Global atmospheric carbon dioxide concentrations and 2030 pathways',
      );
      expect(paperItem?.publisher).toBe('Nature Climate Change');
      expect(paperItem?.url).toBe('https://doi.org/10.1038/s41558-026-01999-x');
      expect(paperItem?.publishedAt).toBe('2026-03-10T00:00:00.000Z');
      expect(paperItem?.publishedDate).toBe('2026-03-10T00:00:00.000Z');
      expect(paperItem?.updatedDate).toBeNull();
      expect(paperItem?.indexedDate).toBe('2026-03-12T00:00:00.000Z');
      expect(paperItem?.temporalBasis).toBe('published');
      expect(paperItem?.snippet).toBe(
        'Atmospheric carbon dioxide concentrations continued rising in early 2026.',
      );
      expect(paperItem?.sourceProvider).toBe('openalex');
      // Peer review is not explicitly attested in standard OpenAlex article payload:
      expect(paperItem?.sourceType).toBe('scholarly-work');
      expect(paperItem?.isPrimarySourceVerified).toBe(false);
      expect(paperItem?.provenance.metadataOrigin).toBe('http-response-verbatim');

      expect(datasetItem).toBeDefined();
      expect(datasetItem?.kind).toBe('dataset');
      expect(datasetItem?.sourceType).toBe('dataset');
      expect(datasetItem?.publisher).toBe('Zenodo');
    });

    it('normalizes valid Wikipedia MediaWiki API responses with revision timestamps and HTML-sanitized snippets', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        expect(url).toContain('en.wikipedia.org/w/api.php');
        return jsonResponse({
          query: {
            general: {
              sitename: 'Wikipedia',
            },
            pages: {
              '12345': {
                pageid: 12345,
                title: 'Carbon dioxide in Earth atmosphere',
                canonicalurl:
                  'https://en.wikipedia.org/wiki/Carbon_dioxide_in_Earth_atmosphere',
                touched: '2026-06-14T22:00:00Z',
                revisions: [
                  {
                    timestamp: '2026-05-20T16:45:12Z',
                  },
                ],
                extract:
                  '<p><b>Carbon dioxide</b> in Earth&apos;s atmosphere is a trace greenhouse gas measured at Mauna Loa.</p>',
              },
            },
          },
        });
      });

      const result = await harvestEvidence({
        query: 'Carbon dioxide in Earth atmosphere Mauna Loa',
        providers: ['wikipedia'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.summary.totalAccepted).toBe(1);
      const item = result.items[0];
      expect(item.sourceProvider).toBe('wikipedia');
      expect(item.title).toBe('Carbon dioxide in Earth atmosphere');
      expect(item.publisher).toBe('Wikipedia');
      expect(item.url).toBe(
        'https://en.wikipedia.org/wiki/Carbon_dioxide_in_Earth_atmosphere',
      );
      expect(item.publishedAt).toBe('2026-05-20T16:45:12.000Z');
      expect(item.publishedDate).toBeNull();
      expect(item.updatedDate).toBe('2026-05-20T16:45:12.000Z');
      expect(item.indexedDate).toBe('2026-06-14T22:00:00.000Z');
      expect(item.temporalBasis).toBe('updated');
      expect(item.snippet).toBe(
        "Carbon dioxide in Earth's atmosphere is a trace greenhouse gas measured at Mauna Loa.",
      );
      expect(item.kind).toBe('report');
      expect(item.sourceType).toBe('encyclopedic-reference');
      expect(item.isPrimarySourceVerified).toBe(false);
    });

    it('normalizes GDELT responses when a verifiable publication date is present alongside seendate', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        expect(url).toContain('api.gdeltproject.org/api/v2/doc/doc');
        return jsonResponse({
          articles: [
            {
              url: 'https://www.reuters.com/markets/europe/ecb-monetary-policy-inflation-2026-04-18/',
              title: 'European Central Bank monetary policy review targets inflation in 2026',
              domain: 'reuters.com',
              publishdate: '2026-04-18T13:15:00Z',
              seendate: '20260418T140000Z',
              snippet:
                'The European Central Bank kept benchmark interest rates steady amid moderating eurozone inflation.',
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'European Central Bank monetary policy inflation 2026',
        providers: ['gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.summary.totalAccepted).toBe(1);
      const item = result.items[0];
      expect(item.sourceProvider).toBe('gdelt');
      expect(item.title).toBe(
        'European Central Bank monetary policy review targets inflation in 2026',
      );
      expect(item.publisher).toBe('reuters.com');
      expect(item.url).toBe(
        'https://www.reuters.com/markets/europe/ecb-monetary-policy-inflation-2026-04-18',
      );
      expect(item.publishedAt).toBe('2026-04-18T13:15:00.000Z');
      expect(item.publishedDate).toBe('2026-04-18T13:15:00.000Z');
      expect(item.updatedDate).toBeNull();
      expect(item.indexedDate).toBe('2026-04-18T14:00:00.000Z');
      expect(item.temporalBasis).toBe('published');
      expect(item.kind).toBe('report');
      expect(item.sourceType).toBe('news-article');
      expect(item.isPrimarySourceVerified).toBe(false);
    });

    it('handles the real unenriched GDELT DOC 2.0 ArtList schema by recording seendate as indexedDate and discarding records lacking a verifiable publication/update date', async () => {
      // Exact schema returned by https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json:
      // { url, url_mobile, title, seendate, socialimage, domain, language, sourcecountry }
      const realGdeltArtListFixture = {
        articles: [
          {
            url: 'https://www.reuters.com/markets/europe/ecb-monetary-policy-inflation-2026-04-18/',
            url_mobile: 'https://www.reuters.com/markets/europe/ecb-monetary-policy-inflation-2026-04-18/amp/',
            title: 'European Central Bank monetary policy review targets inflation in 2026',
            seendate: '20260418T140000Z',
            socialimage: 'https://www.reuters.com/resizer/v2/sample.jpg',
            domain: 'reuters.com',
            language: 'English',
            sourcecountry: 'United Kingdom',
          },
          {
            url: 'https://www.bloomberg.com/news/articles/2026-04-19/eurozone-inflation-outlook',
            url_mobile: '',
            title: 'Eurozone inflation outlook steady before European Central Bank meeting',
            seendate: '20260419T093000Z',
            socialimage: '',
            domain: 'bloomberg.com',
            language: 'English',
            sourcecountry: 'United States',
          },
        ],
      };

      const result = await harvestEvidence({
        query: 'European Central Bank monetary policy inflation 2026',
        providers: ['gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: async () => jsonResponse(realGdeltArtListFixture),
      });

      // Must NOT fabricate publication dates or promote seendate to publishedAt:
      expect(result.items).toHaveLength(0);
      expect(result.providerReports).toHaveLength(1);
      expect(result.providerReports[0].status).toBe('empty');
      expect(result.providerReports[0].rawCandidateCount).toBe(2);
      expect(result.discarded).toHaveLength(2);

      for (const diag of result.discarded) {
        expect(diag.provider).toBe('gdelt');
        expect(diag.reason).toBe('indexing-date-only');
        expect(diag.rawPublishedDate).toBeNull();
        expect(diag.rawUpdatedDate).toBeNull();
        expect(diag.rawIndexedDate).toMatch(/^2026041[89]T\d{6}Z$/);
      }
    });
  });

  describe('2. Fechas futuras descartadas', () => {
    it('discards records whose publication or update date is after referenceTime', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return jsonResponse({
            results: [
              {
                id: 'https://openalex.org/W1',
                title: 'Semiconductor lithography forecast report',
                publication_date: '2026-06-16', // 1 day after SERVER_REFERENCE_TIME
                primary_location: {
                  landing_page_url: 'https://example.org/future-paper',
                  source: { display_name: 'IEEE Journal' },
                },
              },
              {
                id: 'https://openalex.org/W2',
                title: 'Semiconductor lithography baseline study',
                publication_date: '2026-06-15', // On reference day (00:00:00.000Z <= 12:00:00.000Z)
                primary_location: {
                  landing_page_url: 'https://example.org/valid-paper',
                  source: { display_name: 'IEEE Journal' },
                },
              },
            ],
          });
        }
        if (url.includes('wikipedia.org')) {
          return jsonResponse({
            query: {
              general: { sitename: 'Wikipedia' },
              pages: [
                {
                  pageid: 100,
                  title: 'Semiconductor lithography',
                  canonicalurl: 'https://en.wikipedia.org/wiki/Semiconductor_lithography',
                  // Published in the past, but updated 5 minutes AFTER SERVER_REFERENCE_TIME
                  published_at: '2025-01-10T00:00:00Z',
                  timestamp: '2026-06-15T12:05:00Z',
                  extract: 'Semiconductor lithography overview.',
                },
              ],
            },
          });
        }
        return jsonResponse({
          articles: [
            {
              url: 'https://news.example.com/semiconductor-future',
              title: 'Semiconductor lithography market update',
              domain: 'news.example.com',
              publishdate: '2026-07-01T00:00:00Z',
              seendate: '20260615T100000Z',
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'Semiconductor lithography',
        providers: ['openalex', 'wikipedia', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].url).toBe('https://example.org/valid-paper');

      const futureDiscards = result.discarded.filter(
        (diag) => diag.reason === 'future-date',
      );
      expect(futureDiscards).toHaveLength(3);

      for (const item of result.items) {
        expect(isValidIsoDateTime(item.publishedAt)).toBe(true);
        const itemMs = parseIsoDateTimeMs(item.publishedAt);
        const refMs = parseIsoDateTimeMs(SERVER_REFERENCE_TIME);
        expect(itemMs).not.toBeNull();
        expect(refMs).not.toBeNull();
        expect(itemMs!).toBeLessThanOrEqual(refMs!);
      }
    });
  });

  describe('3. Fechas ausentes e inválidas descartadas', () => {
    it('discards records with missing dates or impossible calendar dates', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async () =>
        jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W-no-date',
              title: 'Quantum computing error correction benchmark',
              publication_date: null,
              primary_location: {
                landing_page_url: 'https://example.org/no-date',
                source: { display_name: 'Physical Review' },
              },
            },
            {
              id: 'https://openalex.org/W-impossible-leap',
              title: 'Quantum computing error correction architecture',
              publication_date: '2026-02-29', // 2026 is not a leap year
              primary_location: {
                landing_page_url: 'https://example.org/impossible-date',
                source: { display_name: 'Physical Review' },
              },
            },
            {
              id: 'https://openalex.org/W-year-only',
              title: 'Quantum computing error correction review',
              publication_date: '2026', // Year-only is ambiguous, not a full calendar date
              primary_location: {
                landing_page_url: 'https://example.org/year-only',
                source: { display_name: 'Physical Review' },
              },
            },
          ],
        }),
      );

      const result = await harvestEvidence({
        query: 'Quantum computing error correction',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.discarded).toHaveLength(3);
      expect(result.discarded.map((d) => d.reason)).toEqual([
        'missing-verifiable-date',
        'invalid-date',
        'invalid-date',
      ]);
    });

    it('validates normalizeVerifiableTimestamp across edge cases', () => {
      expect(normalizeVerifiableTimestamp('2026-02-28')).toBe(
        '2026-02-28T00:00:00.000Z',
      );
      expect(normalizeVerifiableTimestamp('2026-02-29')).toBeNull();
      expect(normalizeVerifiableTimestamp('2026-04-31T10:00:00Z')).toBeNull();
      expect(normalizeVerifiableTimestamp('20260510T093015Z')).toBe(
        '2026-05-10T09:30:15.000Z',
      );
      expect(normalizeVerifiableTimestamp('2026-05-10T11:30:15+02:00')).toBe(
        '2026-05-10T09:30:15.000Z',
      );
      expect(normalizeVerifiableTimestamp('')).toBeNull();
      expect(normalizeVerifiableTimestamp(null)).toBeNull();
    });
  });

  describe('4. URLs inválidas y validación completa de IP privadas / públicas', () => {
    it('discards records with missing, non-HTTP(S), localhost, credentialed, or malformed URLs', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async () =>
        jsonResponse({
          articles: [
            {
              url: '',
              title: 'Global trade tariffs analysis',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
            {
              url: 'javascript:alert(1)',
              title: 'Global trade tariffs report',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
            {
              url: 'ftp://files.example.com/tariffs.pdf',
              title: 'Global trade tariffs dataset',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
            {
              url: 'http://localhost:8080/internal-tariffs',
              title: 'Global trade tariffs internal note',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
            {
              url: 'https://admin:secret@trade.example.com/report',
              title: 'Global trade tariffs private report',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
            {
              url: '/relative/path/tariffs',
              title: 'Global trade tariffs relative URL',
              domain: 'trade.example.com',
              publishdate: '2026-03-01T10:00:00Z',
            },
          ],
        }),
      );

      const result = await harvestEvidence({
        query: 'Global trade tariffs',
        providers: ['gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.discarded).toHaveLength(6);
      expect(result.discarded.every((d) => d.reason === 'invalid-url')).toBe(true);
    });

    it('rejects the full IPv4 172.16.0.0/12 range and other private/reserved IPv4 blocks while allowing public IPv4s', () => {
      // 172.16.0.0/12 boundaries and interior addresses
      expect(isPrivateOrLocalHostname('172.16.0.0')).toBe(true);
      expect(isPrivateOrLocalHostname('172.16.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('172.20.15.200')).toBe(true);
      expect(isPrivateOrLocalHostname('172.31.255.254')).toBe(true);
      expect(isPrivateOrLocalHostname('172.31.255.255')).toBe(true);

      expect(validateAndNormalizeEvidenceUrl('http://172.16.0.1/data')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://172.24.10.5/data')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://172.31.255.255/data')).toBeNull();

      // Immediately adjacent public IPv4 addresses outside 172.16.0.0/12
      expect(isPrivateOrLocalHostname('172.15.255.255')).toBe(false);
      expect(isPrivateOrLocalHostname('172.32.0.0')).toBe(false);
      expect(isPrivateOrLocalHostname('172.32.0.1')).toBe(false);
      expect(validateAndNormalizeEvidenceUrl('https://172.15.255.255/report')).toBe(
        'https://172.15.255.255/report',
      );
      expect(validateAndNormalizeEvidenceUrl('https://172.32.0.1/report')).toBe(
        'https://172.32.0.1/report',
      );

      // Other private, loopback, link-local, CGNAT, multicast, and reserved IPv4 blocks
      expect(validateAndNormalizeEvidenceUrl('http://0.0.0.0/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://10.0.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://10.255.255.254/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://100.64.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://100.127.255.254/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://127.0.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://127.255.255.254/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://192.168.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://192.168.255.255/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://224.0.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://255.255.255.255/test')).toBeNull();

      // Public IPv4 addresses
      expect(validateAndNormalizeEvidenceUrl('https://93.184.216.34/article')).toBe(
        'https://93.184.216.34/article',
      );
      expect(validateAndNormalizeEvidenceUrl('https://8.8.8.8/dns')).toBe(
        'https://8.8.8.8/dns',
      );
      expect(validateAndNormalizeEvidenceUrl('https://100.63.255.255/public')).toBe(
        'https://100.63.255.255/public',
      );
      expect(validateAndNormalizeEvidenceUrl('https://100.128.0.1/public')).toBe(
        'https://100.128.0.1/public',
      );
    });

    it('rejects local, loopback, link-local, unique-local, and private IPv4-mapped IPv6 addresses while allowing public IPv6 and public domains', () => {
      // Loopback & Unspecified IPv6
      expect(isPrivateOrLocalHostname('::1')).toBe(true);
      expect(isPrivateOrLocalHostname('[::1]')).toBe(true);
      expect(isPrivateOrLocalHostname('0:0:0:0:0:0:0:1')).toBe(true);
      expect(isPrivateOrLocalHostname('::')).toBe(true);
      expect(validateAndNormalizeEvidenceUrl('http://[::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::]/test')).toBeNull();

      // Link-Local IPv6 (fe80::/10 -> fe80:: through febf::) and scoped zone IDs
      expect(isPrivateOrLocalHostname('fe80::1')).toBe(true);
      expect(isPrivateOrLocalHostname('fe9a::1234')).toBe(true);
      expect(isPrivateOrLocalHostname('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
      expect(isPrivateOrLocalHostname('fe80::1%eth0')).toBe(true);
      expect(validateAndNormalizeEvidenceUrl('http://[fe80::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[febf::1]/test')).toBeNull();

      // Unique-Local IPv6 (fc00::/7 -> fc00:: through fdff::) & Site-Local (fec0::/10)
      expect(isPrivateOrLocalHostname('fc00::1')).toBe(true);
      expect(isPrivateOrLocalHostname('fd00::1')).toBe(true);
      expect(isPrivateOrLocalHostname('fd12:3456:789a:1::1')).toBe(true);
      expect(isPrivateOrLocalHostname('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
      expect(isPrivateOrLocalHostname('fec0::1')).toBe(true);
      expect(validateAndNormalizeEvidenceUrl('https://[fc00::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[fd12:3456:789a::1]/test')).toBeNull();

      // IPv4-mapped IPv6 (::ffff:0:0/96), IPv4-compatible, NAT64, 6to4, and Teredo with private IPv4
      expect(isPrivateOrLocalHostname('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:172.16.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:172.31.255.255')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateOrLocalHostname('::127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('64:ff9b::10.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('64:ff9b::172.16.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('64:ff9b:1::1')).toBe(true); // RFC 8215 Local-Use NAT64
      expect(isPrivateOrLocalHostname('2002:ac10:1::1')).toBe(true); // 6to4 with 172.16.0.1
      expect(isPrivateOrLocalHostname('2002:c0a8:101::1')).toBe(true); // 6to4 with 192.168.1.1
      // Teredo (2001:0000::/32): client IPv4 is XORed with 0xffff in last 32 bits:
      // 127.0.0.1 (0x7f00:0x0001) XOR 0xffff = 0x80ff:0xfffe
      expect(isPrivateOrLocalHostname('2001:0:4136:e378:8000:63bf:80ff:fffe')).toBe(
        true,
      );
      // Teredo with private server IPv4 10.0.0.1 (0x0a00:0x0001) even if client IPv4 is public
      expect(isPrivateOrLocalHostname('2001:0:0a00:0001:8000:63bf:a247:27dd')).toBe(
        true,
      );

      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:127.0.0.1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:10.0.0.1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:172.16.0.1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:172.31.255.255]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:192.168.1.1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('http://[::ffff:169.254.169.254]/test')).toBeNull();

      // IANA IPv6 Special-Purpose Address Registry: ORCHID, ORCHIDv2, DRIP DETs, IETF Protocol Assignments, Documentation, AS112, SRv6, Discard-Only, and Reserved blocks
      // Deprecated ORCHID 2001:10::/28 (RFC 4843)
      expect(isPrivateOrLocalHostname('2001:10::1')).toBe(true);
      expect(isPrivateOrLocalHostname('2001:1f:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(
        true,
      );
      expect(validateAndNormalizeEvidenceUrl('https://[2001:10::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[2001:1a::beef]/test')).toBeNull();

      // ORCHIDv2 2001:20::/28 (RFC 7343)
      expect(isPrivateOrLocalHostname('2001:20::1')).toBe(true);
      expect(isPrivateOrLocalHostname('2001:2f:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(
        true,
      );
      expect(validateAndNormalizeEvidenceUrl('https://[2001:20::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[2001:28::cafe]/test')).toBeNull();

      // DRIP DETs 2001:30::/28 (RFC 9374) & other IETF Protocol Assignments in 2001::/23
      expect(isPrivateOrLocalHostname('2001:30::1')).toBe(true);
      expect(isPrivateOrLocalHostname('2001:3f:ffff::1')).toBe(true);
      expect(isPrivateOrLocalHostname('2001:1::1')).toBe(true); // PCP Anycast
      expect(isPrivateOrLocalHostname('2001:1::2')).toBe(true); // TURN Anycast
      expect(isPrivateOrLocalHostname('2001:1::3')).toBe(true); // DNS-SD SRP Anycast
      expect(isPrivateOrLocalHostname('2001:2::1')).toBe(true); // Benchmarking 2001:2::/48
      expect(isPrivateOrLocalHostname('2001:3::1')).toBe(true); // AMT 2001:3::/32
      expect(isPrivateOrLocalHostname('2001:4:112::1')).toBe(true); // AS112-v6 2001:4:112::/48
      expect(isPrivateOrLocalHostname('2001:1ff:ffff::1')).toBe(true); // End of 2001::/23
      expect(validateAndNormalizeEvidenceUrl('https://[2001:30::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[2001:2::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[2001:3::1]/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[2001:4:112::1]/test')).toBeNull();

      // Documentation prefixes: 2001:db8::/32 (RFC 3849) & 3fff::/20 (RFC 9637)
      expect(isPrivateOrLocalHostname('2001:db8::1')).toBe(true);
      expect(isPrivateOrLocalHostname('2001:db8:ffff::1')).toBe(true);
      expect(isPrivateOrLocalHostname('3fff::1')).toBe(true);
      expect(isPrivateOrLocalHostname('3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(
        true,
      );
      expect(validateAndNormalizeEvidenceUrl('https://[2001:db8::1]/doc')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[3fff::1]/doc')).toBeNull();

      // Direct Delegation AS112 Service 2620:4f:8000::/48 (RFC 7534)
      expect(isPrivateOrLocalHostname('2620:4f:8000::1')).toBe(true);
      expect(
        validateAndNormalizeEvidenceUrl('https://[2620:4f:8000::1]/as112'),
      ).toBeNull();

      // Discard-Only 100::/64 (RFC 6666), SRv6 SIDs 5f00::/16 (RFC 9602), and unallocated non-2000::/3 blocks
      expect(isPrivateOrLocalHostname('100::1')).toBe(true);
      expect(isPrivateOrLocalHostname('5f00::1')).toBe(true);
      expect(isPrivateOrLocalHostname('0200::1')).toBe(true);
      expect(isPrivateOrLocalHostname('0400::1')).toBe(true);
      expect(isPrivateOrLocalHostname('4000::1')).toBe(true);
      expect(isPrivateOrLocalHostname('8000::1')).toBe(true);
      expect(isPrivateOrLocalHostname('c000::1')).toBe(true);
      expect(isPrivateOrLocalHostname('e000::1')).toBe(true);
      expect(validateAndNormalizeEvidenceUrl('https://[100::1]/discard')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[5f00::1]/srv6')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://[4000::1]/reserved')).toBeNull();

      // IPv4-mapped, NAT64, 6to4, and Teredo with PUBLIC IPv4 addresses must be allowed
      expect(isPrivateOrLocalHostname('::ffff:93.184.216.34')).toBe(false);
      expect(isPrivateOrLocalHostname('::ffff:172.15.255.255')).toBe(false);
      expect(isPrivateOrLocalHostname('::ffff:172.32.0.1')).toBe(false);
      expect(isPrivateOrLocalHostname('64:ff9b::93.184.216.34')).toBe(false);
      expect(isPrivateOrLocalHostname('2002:5db8:d822::1')).toBe(false); // 6to4 with 93.184.216.34
      // Teredo with public server 65.54.227.120 (0x4136:0xe378) and public client 93.184.216.34 (0x5db8:0xd822 XOR 0xffff = 0xa247:0x27dd)
      expect(
        isPrivateOrLocalHostname('2001:0:4136:e378:8000:63bf:a247:27dd'),
      ).toBe(false);
      expect(
        validateAndNormalizeEvidenceUrl('https://[::ffff:93.184.216.34]/public'),
      ).toBe('https://[::ffff:5db8:d822]/public');

      // Global unicast public IPv6 addresses across RIR allocations must be allowed
      expect(
        isPrivateOrLocalHostname('2606:2800:220:1:248:1893:25c8:1946'),
      ).toBe(false);
      expect(isPrivateOrLocalHostname('2001:4860:4860::8888')).toBe(false);
      expect(isPrivateOrLocalHostname('2606:4700:4700::1111')).toBe(false);
      expect(isPrivateOrLocalHostname('2a00:1450:4001:81b::200e')).toBe(false);
      expect(isPrivateOrLocalHostname('2400:cb00:2048:1::c629:d7a2')).toBe(false);
      expect(isPrivateOrLocalHostname('2800:3f0:4002:800::200e')).toBe(false);
      expect(isPrivateOrLocalHostname('2c0f:fb50:4002:800::200e')).toBe(false);
      expect(isPrivateOrLocalHostname('2620:4f:8001::1')).toBe(false); // Outside 2620:4f:8000::/48 AS112
      expect(
        validateAndNormalizeEvidenceUrl(
          'https://[2606:2800:220:1:248:1893:25c8:1946]/report',
        ),
      ).toBe('https://[2606:2800:220:1:248:1893:25c8:1946]/report');
      expect(
        validateAndNormalizeEvidenceUrl('https://[2001:4860:4860::8888]/dns'),
      ).toBe('https://[2001:4860:4860::8888]/dns');

      // Public domains that start with numbers or IP-like substrings must NOT trigger false positives
      expect(isPrivateOrLocalHostname('172.example.com')).toBe(false);
      expect(isPrivateOrLocalHostname('172-16.example.com')).toBe(false);
      expect(isPrivateOrLocalHostname('fe80.example.org')).toBe(false);
      expect(isPrivateOrLocalHostname('fc00.example.org')).toBe(false);
      expect(isPrivateOrLocalHostname('localhost.example.com')).toBe(false);
      expect(isPrivateOrLocalHostname('10.org')).toBe(false);
      expect(
        validateAndNormalizeEvidenceUrl(
          'HTTPS://172.Example.COM:443/path/item/?utm_source=x&b=2&a=1#section',
        ),
      ).toBe('https://172.example.com/path/item?a=1&b=2');
      expect(
        validateAndNormalizeEvidenceUrl('https://fe80.example.org/paper'),
      ).toBe('https://fe80.example.org/paper');
      expect(
        validateAndNormalizeEvidenceUrl('https://localhost.example.com/paper'),
      ).toBe('https://localhost.example.com/paper');
      expect(validateAndNormalizeEvidenceUrl('https://singlelabel/test')).toBeNull();
    });
  });

  describe('5. Timeouts (en conexión y durante la lectura del stream)', () => {
    it('aborts slow connection providers using AbortSignal.timeout and reports status="timeout" without throwing', async () => {
      const slowFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
        expect(init?.signal).toBeDefined();
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            reject(err);
            return;
          }
          signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            reject(err);
          });
        });
      });

      const result = await harvestEvidence({
        query: 'Solar photovoltaic capacity additions 2026',
        providers: ['openalex'],
        timeoutMs: 120,
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: slowFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.providerReports).toHaveLength(1);
      expect(result.providerReports[0].status).toBe('timeout');
      expect(result.providerReports[0].error).toMatch(/timed out/i);
      expect(result.summary.providersFailed).toBe(1);
    });

    it('enforces timeout during response body stream reading, cancels the stream, and releases the reader lock', async () => {
      const encoder = new TextEncoder();
      const cancelSpy = vi.fn();
      let firstChunkSent = false;
      const stallingStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!firstChunkSent) {
            firstChunkSent = true;
            controller.enqueue(encoder.encode('{"results":['));
            return;
          }
          // Stall indefinitely on the second chunk until timeout cancels the reader
          return new Promise<void>(() => {
            // Never resolves
          });
        },
        cancel(reason) {
          cancelSpy(reason);
        },
      });

      const stallingStreamFetch: typeof globalThis.fetch = vi.fn(async () => {
        return new Response(stallingStream, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await harvestEvidence({
        query: 'Solar photovoltaic capacity additions 2026',
        providers: ['openalex'],
        timeoutMs: 120,
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: stallingStreamFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.providerReports).toHaveLength(1);
      expect(result.providerReports[0].status).toBe('timeout');
      expect(result.providerReports[0].httpStatus).toBe(200);
      expect(result.providerReports[0].error).toMatch(/response body timed out/i);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(stallingStream.locked).toBe(false);
    });
  });

  describe('6. Límite progresivo del cuerpo HTTP (ReadableStream), errores HTTP y JSON malformado', () => {
    it('reads a multi-chunk ReadableStream within MAX_RESPONSE_BODY_BYTES and parses valid JSON', async () => {
      const payloadJson = JSON.stringify({
        results: [
          {
            id: 'https://openalex.org/W-stream-ok',
            title: 'Arctic sea ice extent seasonal forecast model',
            publication_date: '2026-04-05',
            primary_location: {
              landing_page_url: 'https://cryosphere.example.org/arctic-2026',
              source: { display_name: 'The Cryosphere' },
            },
          },
        ],
      });
      const bytes = new TextEncoder().encode(payloadJson);
      const chunkSize = 25;

      const chunkedStreamFetch: typeof globalThis.fetch = vi.fn(async () => {
        let offset = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= bytes.byteLength) {
              controller.close();
              return;
            }
            const nextChunk = bytes.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            controller.enqueue(nextChunk);
          },
        });
        return new Response(stream, { status: 200 });
      });

      const result = await harvestEvidence({
        query: 'Arctic sea ice extent seasonal forecast',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: chunkedStreamFetch,
      });

      expect(result.providerReports[0].status).toBe('ok');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe(
        'Arctic sea ice extent seasonal forecast model',
      );
    });

    it('immediately cancels ReadableStream reading and releases the reader lock as soon as received bytes exceed MAX_RESPONSE_BODY_BYTES', async () => {
      const chunkBytes = 100 * 1024; // 100 KB per chunk
      const totalPlannedChunks = 30; // 3 MB total if not cancelled early
      let pulledChunks = 0;
      const cancelSpy = vi.fn();
      const oversizedStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulledChunks >= totalPlannedChunks) {
            controller.close();
            return;
          }
          pulledChunks += 1;
          const chunk = new Uint8Array(chunkBytes);
          chunk.fill(0x61); // 'a'
          controller.enqueue(chunk);
        },
        cancel(reason) {
          cancelSpy(reason);
        },
      });

      const oversizedStreamFetch: typeof globalThis.fetch = vi.fn(async () => {
        return new Response(oversizedStream, { status: 200 });
      });

      const result = await harvestEvidence({
        query: 'Arctic sea ice extent minimum',
        providers: ['wikipedia'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: oversizedStreamFetch,
      });

      // 512 KB = 524,288 bytes. With 100 KB (102,400 byte) chunks, the 6th read reaches
      // 614,400 bytes and immediately triggers cancellation without reading the remaining chunks.
      expect(pulledChunks).toBeLessThanOrEqual(7);
      expect(pulledChunks).toBeLessThan(totalPlannedChunks);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(oversizedStream.locked).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.providerReports[0].status).toBe('invalid-payload');
      expect(result.providerReports[0].error).toContain(
        `exceeded ${MAX_RESPONSE_BODY_BYTES} bytes limit (stopped at 614400 bytes)`,
      );
    });

    it('handles HTTP 429/500/503 responses gracefully and records httpStatus', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return new Response('Rate limit exceeded', { status: 429 });
        }
        if (url.includes('wikipedia.org')) {
          return new Response('Service Unavailable', { status: 503 });
        }
        return new Response('Internal Server Error', { status: 500 });
      });

      const result = await harvestEvidence({
        query: 'Global semiconductor supply chain',
        providers: ['openalex', 'wikipedia', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.summary.providersFailed).toBe(3);
      expect(result.providerReports.map((r) => [r.provider, r.status, r.httpStatus])).toEqual([
        ['openalex', 'http-error', 429],
        ['wikipedia', 'http-error', 503],
        ['gdelt', 'http-error', 500],
      ]);
    });

    it('handles invalid JSON and empty responses safely', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return new Response('{broken-json', { status: 200 });
        }
        if (url.includes('wikipedia.org')) {
          return new Response('   ', { status: 200 });
        }
        return jsonResponse({ articles: [] });
      });

      const result = await harvestEvidence({
        query: 'Arctic sea ice extent minimum',
        providers: ['openalex', 'wikipedia', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.providerReports[0].status).toBe('invalid-payload');
      expect(result.providerReports[1].status).toBe('empty');
      expect(result.providerReports[2].status).toBe('empty');
    });
  });

  describe('7. Un proveedor caído mientras los demás funcionan', () => {
    it('continues harvesting from healthy providers when one provider fails or times out', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          throw new Error('ECONNREFUSED api.openalex.org');
        }
        if (url.includes('wikipedia.org')) {
          return jsonResponse({
            query: {
              general: { sitename: 'Wikipedia' },
              pages: [
                {
                  pageid: 777,
                  title: 'Fusion energy tokamak milestone',
                  canonicalurl: 'https://en.wikipedia.org/wiki/Fusion_energy_tokamak',
                  timestamp: '2026-04-12T09:00:00Z',
                  extract: 'Tokamak fusion energy experiments achieved plasma confinement milestones.',
                },
              ],
            },
          });
        }
        return jsonResponse({
          articles: [
            {
              url: 'https://www.nature.com/articles/d41586-026-fusion-tokamak',
              title: 'Tokamak fusion energy plasma milestone confirmed by laboratory',
              domain: 'nature.com',
              publishdate: '2026-05-02T11:30:00Z',
              seendate: '20260502T120000Z',
              snippet: 'Researchers verified fusion energy plasma confinement duration.',
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'Tokamak fusion energy plasma milestone',
        providers: ['openalex', 'wikipedia', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.summary.providersQueried).toBe(3);
      expect(result.summary.providersSucceeded).toBe(2);
      expect(result.summary.providersFailed).toBe(1);
      expect(result.items).toHaveLength(2);

      const openAlexReport = result.providerReports.find(
        (r) => r.provider === 'openalex',
      );
      expect(openAlexReport?.status).toBe('network-error');
      expect(openAlexReport?.error).toContain('ECONNREFUSED');
    });
  });

  describe('8. Resultados duplicados', () => {
    it('deduplicates identical canonical URLs within a provider and across providers', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return jsonResponse({
            results: [
              {
                id: 'https://openalex.org/W100',
                title: 'Global lithium battery production report 2026',
                publication_date: '2026-03-15',
                primary_location: {
                  landing_page_url:
                    'https://energy.example.org/lithium-report-2026/?utm_source=openalex#top',
                  source: { display_name: 'Energy Institute' },
                },
              },
              {
                id: 'https://openalex.org/W100-dup',
                title: 'Global lithium battery production report 2026',
                publication_date: '2026-03-15',
                primary_location: {
                  landing_page_url: 'https://energy.example.org/lithium-report-2026',
                  source: { display_name: 'Energy Institute' },
                },
              },
            ],
          });
        }
        return jsonResponse({
          articles: [
            {
              url: 'https://energy.example.org/lithium-report-2026?fbclid=12345',
              title: 'Global lithium battery production report 2026',
              domain: 'energy.example.org',
              publishdate: '2026-03-15T00:00:00Z',
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'Global lithium battery production 2026',
        providers: ['openalex', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].url).toBe(
        'https://energy.example.org/lithium-report-2026',
      );

      const duplicates = result.discarded.filter(
        (d) => d.reason === 'duplicate-evidence',
      );
      expect(duplicates).toHaveLength(2);
    });
  });

  describe('9. ID determinista', () => {
    it('produces identical deterministic IDs across repeated runs and distinct IDs for different inputs', async () => {
      const idA1 = computeDeterministicEvidenceId(
        'openalex',
        'https://doi.org/10.1038/nature12345',
        'https://openalex.org/W12345',
      );
      const idA2 = computeDeterministicEvidenceId(
        'openalex',
        'https://doi.org/10.1038/nature12345',
        'https://openalex.org/W12345',
      );
      const idB = computeDeterministicEvidenceId(
        'gdelt',
        'https://doi.org/10.1038/nature12345',
        'https://openalex.org/W12345',
      );

      expect(idA1).toBe(idA2);
      expect(idA1).toMatch(/^ev-openalex-[0-9a-f]{16}$/);
      expect(idB).toMatch(/^ev-gdelt-[0-9a-f]{16}$/);
      expect(idA1).not.toBe(idB);

      const payload = {
        results: [
          {
            id: 'https://openalex.org/W555',
            title: 'Antarctic ice sheet mass balance observations',
            publication_date: '2026-01-20',
            primary_location: {
              landing_page_url: 'https://doi.org/10.1038/antarctic-2026',
              source: { display_name: 'Nature Geoscience' },
            },
          },
        ],
      };

      const run1 = await harvestEvidence({
        query: 'Antarctic ice sheet mass balance',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: async () => jsonResponse(payload),
      });
      const run2 = await harvestEvidence({
        query: 'Antarctic ice sheet mass balance',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: async () => jsonResponse(payload),
      });

      expect(run1.items[0].id).toBe(run2.items[0].id);
      expect(run1.items[0].provenance.recordDigest).toBe(
        run2.items[0].provenance.recordDigest,
      );
    });
  });

  describe('10. No inventar metadatos, clasificación rigurosa de OpenAlex y no afirmar fuente primaria sin verificación', () => {
    it('discards records missing title or publisher instead of inventing placeholders', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async () =>
        jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W-missing-publisher',
              title: 'Artificial general intelligence compute scaling laws',
              publication_date: '2026-02-15',
              primary_location: {
                landing_page_url: 'https://example.org/no-publisher',
                source: null,
              },
            },
            {
              id: 'https://openalex.org/W-missing-title',
              title: '   ',
              publication_date: '2026-02-15',
              primary_location: {
                landing_page_url: 'https://example.org/no-title',
                source: { display_name: 'ArXiv' },
              },
            },
            {
              id: 'https://openalex.org/W-retracted',
              title: 'Artificial general intelligence retracted claim',
              publication_date: '2026-02-15',
              is_retracted: true,
              primary_location: {
                landing_page_url: 'https://example.org/retracted',
                source: { display_name: 'Journal of AI' },
              },
            },
          ],
        }),
      );

      const result = await harvestEvidence({
        query: 'Artificial general intelligence compute scaling',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.discarded.map((d) => d.reason)).toEqual([
        'missing-publisher',
        'missing-title',
        'retracted-source',
      ]);
    });

    it('classifies OpenAlex work types accurately without assuming unverified peer review or unknown types', async () => {
      // 1. Known scholarly work ('article') WITHOUT verified peer review -> 'scholarly-work'
      expect(classifyOpenAlexWorkType('article')).toEqual({
        kind: 'paper',
        sourceType: 'scholarly-work',
        reportedWorkType: 'article',
        peerReviewVerified: false,
      });
      expect(
        classifyOpenAlexWorkType({
          type: 'article',
          sourceType: 'repository',
          sourceIsPeerReviewed: false,
          publishedVersion: 'submittedVersion',
        }),
      ).toEqual({
        kind: 'paper',
        sourceType: 'scholarly-work',
        reportedWorkType: 'article',
        peerReviewVerified: false,
      });

      // 2. Known scholarly work ('article') WITH verified peer review -> 'peer-reviewed-work'
      expect(
        classifyOpenAlexWorkType({
          type: 'article',
          sourceType: 'journal',
          sourceIsPeerReviewed: true,
          publishedVersion: 'publishedVersion',
        }),
      ).toEqual({
        kind: 'paper',
        sourceType: 'peer-reviewed-work',
        reportedWorkType: 'article',
        peerReviewVerified: true,
      });

      // 3. Known specialized types: dataset, preprint, report
      expect(classifyOpenAlexWorkType('dataset')).toEqual({
        kind: 'dataset',
        sourceType: 'dataset',
        reportedWorkType: 'dataset',
        peerReviewVerified: false,
      });
      expect(classifyOpenAlexWorkType('preprint')).toEqual({
        kind: 'paper',
        sourceType: 'preprint-or-working-paper',
        reportedWorkType: 'preprint',
        peerReviewVerified: false,
      });
      expect(classifyOpenAlexWorkType('report')).toEqual({
        kind: 'report',
        sourceType: 'secondary-report',
        reportedWorkType: 'report',
        peerReviewVerified: false,
      });

      // 4. Unknown, non-scholarly, or missing types -> 'unverified-type', never 'peer-reviewed-work'
      expect(classifyOpenAlexWorkType('paratext')).toEqual({
        kind: 'report',
        sourceType: 'unverified-type',
        reportedWorkType: 'paratext',
        peerReviewVerified: false,
      });
      expect(classifyOpenAlexWorkType('unknown-custom-type')).toEqual({
        kind: 'report',
        sourceType: 'unverified-type',
        reportedWorkType: 'unknown-custom-type',
        peerReviewVerified: false,
      });
      expect(classifyOpenAlexWorkType(null)).toEqual({
        kind: 'report',
        sourceType: 'unverified-type',
        reportedWorkType: null,
        peerReviewVerified: false,
      });

      // End-to-end verification through harvestEvidence
      const result = await harvestEvidence({
        query: 'Hydrogen electrolyzer efficiency',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: async () =>
          jsonResponse({
            results: [
              {
                id: 'https://openalex.org/W-unverified-article',
                title: 'Hydrogen electrolyzer efficiency in industrial trials',
                publication_date: '2026-02-01',
                type: 'article',
                primary_location: {
                  landing_page_url: 'https://example.org/h2-article',
                  source: { display_name: 'Energy Preprints' },
                },
              },
              {
                id: 'https://openalex.org/W-verified-peer-review',
                title: 'Hydrogen electrolyzer efficiency peer-reviewed benchmark',
                publication_date: '2026-02-10',
                type: 'article',
                primary_location: {
                  landing_page_url: 'https://example.org/h2-peer-reviewed',
                  version: 'publishedVersion',
                  source: {
                    display_name: 'Nature Energy',
                    type: 'journal',
                    is_peer_reviewed: true,
                  },
                },
              },
              {
                id: 'https://openalex.org/W-unknown-type',
                title: 'Hydrogen electrolyzer efficiency supplementary paratext',
                publication_date: '2026-02-15',
                type: 'paratext',
                primary_location: {
                  landing_page_url: 'https://example.org/h2-paratext',
                  source: { display_name: 'Energy Catalog' },
                },
              },
            ],
          }),
      });

      expect(result.items).toHaveLength(3);
      const unverifiedArticle = result.items.find((i) =>
        i.url.endsWith('/h2-article'),
      );
      const verifiedArticle = result.items.find((i) =>
        i.url.endsWith('/h2-peer-reviewed'),
      );
      const unknownTypeItem = result.items.find((i) =>
        i.url.endsWith('/h2-paratext'),
      );

      expect(unverifiedArticle?.sourceType).toBe('scholarly-work');
      expect(unverifiedArticle?.isPrimarySourceVerified).toBe(false);

      expect(verifiedArticle?.sourceType).toBe('peer-reviewed-work');
      expect(verifiedArticle?.isPrimarySourceVerified).toBe(false);

      expect(unknownTypeItem?.sourceType).toBe('unverified-type');
      expect(unknownTypeItem?.kind).toBe('report');
      expect(unknownTypeItem?.isPrimarySourceVerified).toBe(false);
    });

    it('freezes harvested items and prevents downstream LLM selections from fabricating metadata', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async () =>
        jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W900',
              title: 'Verified central bank digital currency pilot analysis',
              publication_date: '2026-04-10',
              primary_location: {
                landing_page_url: 'https://bis.example.org/cbdc-pilot-2026',
                source: { display_name: 'Bank for International Settlements' },
              },
            },
          ],
        }),
      );

      const harvest = await harvestEvidence({
        query: 'central bank digital currency pilot',
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(harvest.items).toHaveLength(1);
      const item = harvest.items[0];
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.provenance)).toBe(true);
      expect(item.isPrimarySourceVerified).toBe(false);

      // Simulate a downstream model trying to pass an invented ID and trying to
      // inject fabricated title/publisher/url/publishedAt properties on a valid ID:
      const attemptedSelections = [
        {
          id: 'ev-openalex-hallucinated0000',
          note: 'Invented reference that does not exist in harvest.',
        },
        {
          id: item.id,
          title: 'FABRICATED LLM TITLE',
          publisher: 'FABRICATED PUBLISHER',
          publishedAt: '2099-01-01T00:00:00.000Z',
          url: 'https://fabricated.example.com/fake',
          note: 'Selected because it documents the 2026 CBDC settlement trial.',
        } as unknown as { id: string; note: string },
      ];

      const verifiedRefs = selectVerifiedEvidenceReferences(
        harvest,
        attemptedSelections,
      );

      expect(verifiedRefs).toHaveLength(1);
      expect(verifiedRefs[0].id).toBe(item.id);
      expect(verifiedRefs[0].title).toBe(
        'Verified central bank digital currency pilot analysis',
      );
      expect(verifiedRefs[0].publisher).toBe('Bank for International Settlements');
      expect(verifiedRefs[0].publishedAt).toBe('2026-04-10T00:00:00.000Z');
      expect(verifiedRefs[0].url).toBe('https://bis.example.org/cbdc-pilot-2026');
      expect(verifiedRefs[0].note).toBe(
        'Selected because it documents the 2026 CBDC settlement trial.',
      );
      expect(Object.isFrozen(verifiedRefs[0])).toBe(true);

      const directRef = toEvidenceReference(item);
      expect(directRef.title).toBe(item.title);
      expect(directRef.publisher).toBe(item.publisher);
    });
  });

  describe('11. No confundir fecha de indexación con fecha de publicación', () => {
    it('discards records from OpenAlex, Wikipedia, and GDELT that only carry indexing/crawling dates', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return jsonResponse({
            results: [
              {
                id: 'https://openalex.org/W-index-only',
                title: 'Global sovereign debt restructuring analysis',
                // No publication_date; only OpenAlex indexing timestamps:
                publication_date: null,
                created_date: '2026-05-01',
                updated_date: '2026-05-02T10:00:00Z',
                primary_location: {
                  landing_page_url: 'https://imf.example.org/debt-paper',
                  source: { display_name: 'IMF Economic Review' },
                },
              },
            ],
          });
        }
        if (url.includes('wikipedia.org')) {
          return jsonResponse({
            query: {
              general: { sitename: 'Wikipedia' },
              pages: [
                {
                  pageid: 321,
                  title: 'Sovereign debt restructuring',
                  canonicalurl:
                    'https://en.wikipedia.org/wiki/Sovereign_debt_restructuring',
                  // No revision timestamp or published_at; only MediaWiki page cache `touched`:
                  touched: '2026-06-01T08:00:00Z',
                  extract: 'Sovereign debt restructuring overview.',
                },
              ],
            },
          });
        }
        return jsonResponse({
          articles: [
            {
              url: 'https://ft.example.com/sovereign-debt-2026',
              title: 'Sovereign debt restructuring talks continue in 2026',
              domain: 'ft.example.com',
              // GDELT `seendate` is when GDELT crawled/indexed the article, NOT publication date:
              seendate: '20260515T093000Z',
            },
          ],
        });
      });

      const result = await harvestEvidence({
        query: 'Sovereign debt restructuring',
        providers: ['openalex', 'wikipedia', 'gdelt'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(0);
      expect(result.discarded).toHaveLength(3);
      expect(result.discarded.map((d) => [d.provider, d.reason])).toEqual([
        ['openalex', 'indexing-date-only'],
        ['wikipedia', 'indexing-date-only'],
        ['gdelt', 'indexing-date-only'],
      ]);
    });
  });

  describe('12. Relevancia temática, selección por categoría y límites de Render', () => {
    it('filters out off-topic items below minRelevanceScore or missing requiredTerms', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async () =>
        jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W-relevant',
              title: 'Argentina annual inflation consumer price index trajectory 2026',
              publication_date: '2026-04-01',
              primary_location: {
                landing_page_url: 'https://econ.example.org/argentina-cpi-2026',
                source: { display_name: 'Latin American Economic Review' },
              },
            },
            {
              id: 'https://openalex.org/W-irrelevant',
              title: 'Medieval pottery glazes in twelfth century Normandy',
              publication_date: '2026-04-01',
              primary_location: {
                landing_page_url: 'https://history.example.org/normandy-pottery',
                source: { display_name: 'Historical Ceramics Journal' },
              },
            },
          ],
        }),
      );

      const result = await harvestEvidence({
        query: 'Will Argentina annual inflation fall below 40% in 2026?',
        requiredTerms: ['argentina', 'inflation'],
        providers: ['openalex'],
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: mockFetch,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toContain('Argentina annual inflation');
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reason).toBe('low-thematic-relevance');

      const scoreCheck = computeThematicRelevance(
        'Medieval pottery glazes',
        null,
        [],
        ['argentina', 'inflation'],
        ['argentina'],
      );
      expect(scoreCheck.passed).toBe(false);
    });

    it('routes providers by PredictionCategory and enforces Render result caps and request validation', async () => {
      expect(selectProvidersForCategory('science')).toEqual(
        DEFAULT_CATEGORY_PROVIDERS.science,
      );
      expect(selectProvidersForCategory('geopolitics')).toEqual(
        DEFAULT_CATEGORY_PROVIDERS.geopolitics,
      );
      expect(
        selectProvidersForCategory('science', ['gdelt', 'openalex', 'gdelt']),
      ).toEqual(['gdelt', 'openalex']);

      await expect(
        harvestEvidence({
          query: '   ',
          referenceTime: SERVER_REFERENCE_TIME,
        }),
      ).rejects.toThrow(InvalidHarvestRequestError);

      await expect(
        harvestEvidence({
          query: 'Valid query',
          referenceTime: '2026-02-29T00:00:00.000Z',
        }),
      ).rejects.toThrow(InvalidHarvestRequestError);

      // Verify hard caps on results per provider and total results
      const manyResults = Array.from({ length: 20 }, (_, idx) => ({
        id: `https://openalex.org/W${idx + 1}`,
        title: `Climate emissions scenario study number ${idx + 1}`,
        publication_date: '2026-03-01',
        primary_location: {
          landing_page_url: `https://climate.example.org/study-${idx + 1}`,
          source: { display_name: 'Climate Journal' },
        },
      }));

      const cappedResult = await harvestEvidence({
        query: 'Climate emissions scenario study',
        providers: ['openalex'],
        maxResultsPerProvider: 999,
        maxTotalResults: 999,
        referenceTime: SERVER_REFERENCE_TIME,
        fetchImpl: async () => jsonResponse({ results: manyResults }),
      });

      expect(cappedResult.items.length).toBeLessThanOrEqual(
        HARD_MAX_RESULTS_PER_PROVIDER,
      );
      expect(cappedResult.items.length).toBeLessThanOrEqual(HARD_MAX_TOTAL_RESULTS);

      // Direct adapter instantiation test
      const openAlex = createOpenAlexAdapter({ baseUrl: 'https://api.openalex.org/works' });
      const wiki = createWikipediaAdapter({ baseUrl: 'https://en.wikipedia.org/w/api.php' });
      const gdelt = createGdeltAdapter({
        baseUrl: 'https://api.gdeltproject.org/api/v2/doc/doc',
      });
      expect(openAlex.id).toBe('openalex');
      expect(wiki.id).toBe('wikipedia');
      expect(gdelt.id).toBe('gdelt');
    });
  });
});
