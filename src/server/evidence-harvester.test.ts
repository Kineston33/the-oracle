import { describe, expect, it, vi } from 'vitest';
import { isValidIsoDateTime, parseIsoDateTimeMs } from '../data/publication.ts';
import {
  DEFAULT_CATEGORY_PROVIDERS,
  HARD_MAX_RESULTS_PER_PROVIDER,
  HARD_MAX_TOTAL_RESULTS,
  InvalidHarvestRequestError,
  MAX_RESPONSE_BODY_BYTES,
  computeDeterministicEvidenceId,
  computeThematicRelevance,
  createGdeltAdapter,
  createOpenAlexAdapter,
  createWikipediaAdapter,
   harvestEvidence,
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
      expect(paperItem?.sourceType).toBe('peer-reviewed-work');
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

    it('normalizes valid GDELT DOC 2.0 responses when a verifiable publication date is present alongside seendate', async () => {
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

  describe('4. URLs inválidas descartadas', () => {
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

    it('validates validateAndNormalizeEvidenceUrl directly', () => {
      expect(validateAndNormalizeEvidenceUrl('http://127.0.0.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://192.168.1.1/test')).toBeNull();
      expect(validateAndNormalizeEvidenceUrl('https://singlelabel/test')).toBeNull();
      expect(
        validateAndNormalizeEvidenceUrl(
          'HTTPS://Example.COM:443/path/item/?utm_source=x&b=2&a=1#section',
        ),
      ).toBe('https://example.com/path/item?a=1&b=2');
    });
  });

  describe('5. Timeouts', () => {
    it('aborts slow providers using AbortSignal.timeout and reports status="timeout" without throwing', async () => {
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
  });

  describe('6. Errores HTTP y respuestas malformadas o vacías', () => {
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

    it('handles invalid JSON, oversized responses, and empty results safely', async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('openalex.org')) {
          return new Response('{broken-json', { status: 200 });
        }
        if (url.includes('wikipedia.org')) {
          return new Response('x'.repeat(MAX_RESPONSE_BODY_BYTES + 1024), {
            status: 200,
          });
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
      expect(result.providerReports[1].status).toBe('invalid-payload');
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
                  title: ' fusion energy tokamak milestone',
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

  describe('10. No inventar metadatos y no afirmar fuente primaria sin verificación', () => {
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
