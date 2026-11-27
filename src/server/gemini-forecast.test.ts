/**
 * Automated Unit & HTTP Integration Tests for Stage 2B-2A:
 * Server-Side Gemini Provider (`@google/genai`) + Canonical Resolution +
 * Real `runScientificForecastPipeline` Backend Wiring.
 *
 * All Gemini calls are deterministically mocked in-process — zero real API
 * keys are stored or transmitted and zero external Gemini API calls occur.
 */

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ApiError } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCanonicalQuestion } from '../data/question-resolver.ts';
import { predictionRecords } from '../data/records.ts';
import type { PredictionRecord } from '../data/types.ts';
import type { EvidenceHarvestResult } from './evidence-harvester.ts';
import type { OutcomeSpaceDescriptor } from './forecast-types.ts';
import {
  DEFAULT_GEMINI_MAX_ATTEMPTS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GeminiQuestionInterpreter,
  MAX_GEMINI_MAX_ATTEMPTS,
  MAX_GEMINI_TIMEOUT_MS,
  MIN_GEMINI_TIMEOUT_MS,
  QuestionInterpretationError,
  createGeminiQuestionInterpreterFromEnv,
  createOracleApiServer,
  createTrustedEvidenceVerifier,
  createTrustedStructuralSymmetryVerifier,
  executeScientificMethod,
  readGeminiConfigFromEnv,
  redactProviderSecrets,
  redactSecrets,
  validateQuestionInterpretationPayload,
  type ForecastPipelineRequest,
  type GeminiClientLike,
  type PostgresPublicationRegistry,
  type StructuralSymmetryContract,
} from './index.ts';

const FIXED_NOW = '2026-11-27T12:00:00Z';

function buildValidGeminiJsonPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isForecastableProposition: true,
    canonicalQuestionDraft:
      'Will global stationary battery storage exceed 1000 GW before 2031 according to the International Energy Agency?',
    category: 'technology',
    categoryRationale: 'Grid-scale battery storage deployment falls under technology.',
    subject: {
      id: 'battery-storage',
      label: 'Global stationary battery storage',
      namespace: 'subject',
      resolved: true,
      ambiguityNote: null,
    },
    event: {
      id: 'installed-capacity-threshold',
      label: 'Installed capacity threshold',
      namespace: 'event',
      resolved: true,
      ambiguityNote: null,
    },
    condition: {
      id: 'gt-1000-gw',
      label: 'Exceeds 1000 GW',
      operator: 'gt',
      thresholdValue: '1000',
      unit: 'gw',
      resolved: true,
      ambiguityNote: null,
    },
    geographicScope: {
      id: 'global',
      label: 'Global',
      namespace: 'scope',
      resolved: true,
      ambiguityNote: null,
    },
    timeHorizon: {
      label: 'Through 2030',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2030-12-31T23:59:59Z',
      year: 2030,
      resolved: true,
      ambiguityNote: null,
    },
    resolutionDate: {
      isoDateTime: '2030-12-31T23:59:59Z',
      resolved: true,
      ambiguityNote: null,
    },
    decidingAuthority: {
      id: 'iea',
      label: 'International Energy Agency (IEA)',
      namespace: 'authority',
      resolved: true,
      ambiguityNote: null,
    },
    missingComponents: [],
    ambiguousComponents: [],
    clarifyingQuestions: [],
    normalizedSearchQuery: 'global stationary battery storage 1000 GW IEA 2030',
    interpretationLimitations: [
      'Linguistic interpretation parses user intent only and asserts no statistical claim.',
    ],
    ...overrides,
  };
}

function createMockGeminiClient(
  handler: Parameters<GeminiClientLike['models']['generateContent']>[0] extends never
    ? never
    : (
        params: Parameters<GeminiClientLike['models']['generateContent']>[0],
      ) => Promise<Awaited<ReturnType<GeminiClientLike['models']['generateContent']>>>,
): GeminiClientLike {
  return {
    models: {
      generateContent: handler,
    },
  };
}

function createStubRegistry(options?: {
  officialRecords?: readonly PredictionRecord[];
  byIdentity?: ReadonlyMap<string, PredictionRecord>;
}): PostgresPublicationRegistry {
  const officialRecords = [...(options?.officialRecords ?? [])];
  const byIdentity = options?.byIdentity ?? new Map<string, PredictionRecord>();
  return {
    async findByIdentity(identityDigest: string) {
      const rec = byIdentity.get(identityDigest);
      if (!rec) return null;
      return {
        record: rec,
        identityDigest,
      };
    },
    async listOfficialPredictions() {
      return officialRecords;
    },
    async getPredictionById(id: string) {
      return officialRecords.find((r) => r.id === id) ?? null;
    },
    async getPredictionEventsWithVerification() {
      return null;
    },
  } as unknown as PostgresPublicationRegistry;
}

function createStubHarvestResult(query: string, category: PredictionRecord['category']): EvidenceHarvestResult {
  return Object.freeze({
    query,
    category,
    selectedProviders: Object.freeze(['openalex', 'wikipedia'] as const),
    referenceTime: FIXED_NOW,
    executedAt: FIXED_NOW,
    items: Object.freeze([
      {
        id: 'ev-openalex-1234567890abcdef',
        title: 'Utility-Scale Battery Storage Deployment Projections 2020-2026',
        publisher: 'Energy Research Journal',
        url: 'https://example.org/energy-research/battery-storage-2026',
        publishedAt: '2026-06-15T00:00:00Z',
        publishedDate: '2026-06-15T00:00:00Z',
        updatedDate: null,
        indexedDate: '2026-06-16T00:00:00Z',
        temporalBasis: 'published' as const,
        snippet: 'Review of global battery storage deployment.',
        sourceProvider: 'openalex' as const,
        sourceId: 'W123456789',
        kind: 'paper' as const,
        sourceType: 'scholarly-work' as const,
        isPrimarySourceVerified: false,
        primarySourceVerificationNote: 'Bibliographic index only.',
        relevanceScore: 0.78,
        matchedTerms: Object.freeze(['battery', 'storage']),
        provenance: Object.freeze({
          provider: 'openalex' as const,
          adapterVersion: '1.0.0' as const,
          endpointUrl: 'https://api.openalex.org/works',
          httpStatus: 200,
          retrievedAt: FIXED_NOW,
          referenceTime: FIXED_NOW,
          rawSourceId: 'W123456789',
          rawDateFields: Object.freeze({
            published: '2026-06-15',
            updated: null,
            indexed: '2026-06-16',
          }),
          temporalBasis: 'published' as const,
          primarySourceVerified: false,
          primarySourceVerificationNote: 'Bibliographic index only.',
          metadataOrigin: 'http-response-verbatim' as const,
          recordDigest: 'a'.repeat(64),
        }),
      },
    ]),
    discarded: Object.freeze([]),
    providerReports: Object.freeze([
      {
        provider: 'openalex' as const,
        status: 'ok' as const,
        endpointUrl: 'https://api.openalex.org/works',
        httpStatus: 200,
        durationMs: 42,
        rawCandidateCount: 1,
        accepted: Object.freeze([]),
        discarded: Object.freeze([]),
        error: null,
      },
    ]),
    summary: Object.freeze({
      providersQueried: 1,
      providersSucceeded: 1,
      providersFailed: 0,
      rawCandidatesEvaluated: 1,
      totalAccepted: 1,
      totalDiscarded: 0,
    }),
  });
}

async function startTestHttpServer(
  deps: Parameters<typeof createOracleApiServer>[0],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createOracleApiServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((res, rej) => {
        server.close((err) => (err ? rej(err) : res()));
      }),
  };
}

describe('Stage 2B-2A — Gemini Question Interpreter & Scientific Forecast Backend', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  describe('1. Config, Unconfigured Fail-Closed Behavior & Secret Redaction', () => {
    it('reads env config safely with bounded defaults and never crashes when GEMINI_API_KEY is unset', async () => {
      expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');

      const cfg = readGeminiConfigFromEnv({});
      expect(cfg.apiKey).toBe('');
      expect(cfg.model).toBe('gemini-3.8-flash');
      expect(cfg.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(cfg.timeoutMs).toBe(DEFAULT_GEMINI_TIMEOUT_MS);
      expect(cfg.maxAttempts).toBe(DEFAULT_GEMINI_MAX_ATTEMPTS);

      const clamped = readGeminiConfigFromEnv({
        GEMINI_MODEL: 'gemini-2.5-pro',
        GEMINI_TIMEOUT_MS: '9999999',
        GEMINI_MAX_ATTEMPTS: '99',
      });
      expect(clamped.model).toBe('gemini-2.5-pro');
      expect(clamped.timeoutMs).toBe(MAX_GEMINI_TIMEOUT_MS);
      expect(clamped.maxAttempts).toBe(MAX_GEMINI_MAX_ATTEMPTS);

      const minClamped = readGeminiConfigFromEnv({
        GEMINI_TIMEOUT_MS: '5',
        GEMINI_MAX_ATTEMPTS: '0',
      });
      expect(minClamped.timeoutMs).toBe(MIN_GEMINI_TIMEOUT_MS);
      expect(minClamped.maxAttempts).toBe(1);

      expect(() =>
        readGeminiConfigFromEnv({ GEMINI_MODEL: 'bad model name with spaces!' }),
      ).toThrow(RangeError);

      const unconfigured = createGeminiQuestionInterpreterFromEnv({});
      expect(unconfigured.isConfigured()).toBe(false);
      expect(unconfigured.model).toBeNull();
      expect(unconfigured.getStatus()).toEqual({
        providerId: 'gemini',
        model: null,
        configured: false,
        status: 'unconfigured',
        reason:
          'GEMINI_API_KEY is not configured on the server; AI-assisted question interpretation is unavailable.',
      });

      await expect(
        unconfigured.interpretQuestion({
          question: 'Will battery storage exceed 1000 GW by 2030?',
          referenceTime: FIXED_NOW,
        }),
      ).rejects.toMatchObject({
        name: 'QuestionInterpretationError',
        code: 'provider_unconfigured',
        httpStatus: 503,
        retryable: false,
      });
    });

    it('scrubs Gemini keys, query keys, headers, and postgres URIs cleanly from error text', () => {
      const fakeSecret = 'AIzaSyTestDummySecretKey1234567890abcd';
      const raw =
        `Failed GET https://generativelanguage.googleapis.com/v1?key=${fakeSecret} ` +
        `x-goog-api-key: ${fakeSecret} Authorization: Bearer supersecret123 ` +
        `postgresql://oracle_app:topsecret@db.internal:5432/neondb`;

      const redacted = redactProviderSecrets(raw, fakeSecret);
      expect(redacted).not.toContain(fakeSecret);
      expect(redacted).not.toContain('supersecret123');
      expect(redacted).not.toContain('topsecret');

      const alsoRedacted = redactSecrets(raw);
      expect(alsoRedacted).not.toContain(fakeSecret);
      expect(alsoRedacted).not.toContain('topsecret');
    });

    it('passes strict bounded config, JSON schema, and zero tools to Gemini client factory', async () => {
      let capturedConfig: Record<string, unknown> | undefined;
      let capturedParams: Parameters<GeminiClientLike['models']['generateContent']>[0] | undefined;

      const interpreter = createGeminiQuestionInterpreterFromEnv(
        {
          GEMINI_API_KEY: 'AIzaSyFakeTestKeyForUnitTestOnly12345678',
          GEMINI_TIMEOUT_MS: '7500',
          GEMINI_MAX_ATTEMPTS: '2',
        },
        {
          now: () => FIXED_NOW,
          createClient: (cfg) => {
            capturedConfig = { ...cfg };
            return createMockGeminiClient(async (params) => {
              capturedParams = params;
              return {
                text: JSON.stringify(buildValidGeminiJsonPayload()),
                candidates: [{ finishReason: 'STOP' }],
                usageMetadata: {
                  promptTokenCount: 120,
                  candidatesTokenCount: 85,
                  totalTokenCount: 205,
                },
              };
            });
          },
        },
      );

      expect(interpreter.isConfigured()).toBe(true);
      expect(interpreter.getStatus()).toEqual({
        providerId: 'gemini',
        model: 'gemini-3.8-flash',
        configured: true,
        status: 'ready',
      });

      const result = await interpreter.interpretQuestion({
        question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
        referenceTime: FIXED_NOW,
      });

      expect(capturedConfig?.model).toBe('gemini-3.8-flash');
      expect(capturedConfig?.timeoutMs).toBe(7500);
      expect(capturedConfig?.maxAttempts).toBe(2);
      expect(capturedParams?.model).toBe('gemini-3.8-flash');
      expect(capturedParams?.config?.temperature).toBe(0);
      expect(capturedParams?.config?.responseMimeType).toBe('application/json');
      expect(capturedParams?.config?.responseJsonSchema).toBeDefined();
      expect(capturedParams?.config?.tools).toBeUndefined();
      expect(capturedParams?.config?.httpOptions?.retryOptions?.attempts).toBe(2);
      expect(result.model).toBe('gemini-3.8-flash');
      expect(result.tokenUsage).toEqual({
        promptTokens: 120,
        outputTokens: 85,
        totalTokens: 205,
      });
      expect(result.interpretation.subject.id).toBe('battery-storage');
    });

    it('serializes gemini-3.8-flash generateContent with structured JSON schema via real @google/genai client and never silently falls back on model unavailability', async () => {
      const requestedUrls: string[] = [];
      const requestedBodies: Array<Record<string, unknown>> = [];
      const originalFetch = globalThis.fetch;

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (!url.startsWith('https://generativelanguage.googleapis.com/')) {
            return originalFetch(input, init);
          }
          requestedUrls.push(url);
          const rawBody =
            typeof init?.body === 'string'
              ? init.body
              : input instanceof Request
                ? await input.clone().text()
                : '{}';
          requestedBodies.push(JSON.parse(rawBody) as Record<string, unknown>);

          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: JSON.stringify(buildValidGeminiJsonPayload()) }],
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        });

      try {
        // Default env uses gemini-3.8-flash with structured JSON schema
        const sdkDefaultInterpreter = createGeminiQuestionInterpreterFromEnv(
          {
            GEMINI_API_KEY: 'AIzaSyFakeSdkFetchKeyForUnitTest1234567',
          },
          { now: () => FIXED_NOW },
        );
        const okRes = await sdkDefaultInterpreter.interpretQuestion({
          question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
          referenceTime: FIXED_NOW,
        });

        expect(okRes.model).toBe('gemini-3.8-flash');
        expect(requestedUrls).toHaveLength(1);
        expect(requestedUrls[0]).toContain('/models/gemini-3.8-flash:generateContent');
        expect(requestedUrls[0]).not.toContain('gemini-2.5-flash');

        const genCfg = requestedBodies[0]?.generationConfig as Record<string, unknown>;
        expect(genCfg?.temperature).toBe(0);
        expect(genCfg?.maxOutputTokens).toBe(1024);
        expect(genCfg?.responseMimeType).toBe('application/json');
        expect(genCfg?.responseJsonSchema).toBeDefined();
        expect(requestedBodies[0]?.tools).toBeUndefined();
        expect(requestedBodies[0]?.routingConfig).toBeUndefined();
        expect(requestedBodies[0]?.modelSelectionConfig).toBeUndefined();

        // Now verify an unavailable model returns HTTP 404 -> clear provider_model_unavailable error with ZERO silent fallback
        requestedUrls.length = 0;
        fetchSpy.mockImplementation(async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (!url.startsWith('https://generativelanguage.googleapis.com/')) {
            return originalFetch(input, init);
          }
          requestedUrls.push(url);
          return new Response(
            JSON.stringify({
              error: {
                code: 404,
                message: 'models/gemini-3.8-flash is not found for API version v1beta.',
                status: 'NOT_FOUND',
              },
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        });

        const sdkUnavailableInterpreter = createGeminiQuestionInterpreterFromEnv(
          {
            GEMINI_API_KEY: 'AIzaSyFakeSdkFetchKeyForUnitTest1234567',
            GEMINI_MODEL: 'gemini-3.8-flash',
          },
          { now: () => FIXED_NOW },
        );

        await expect(
          sdkUnavailableInterpreter.interpretQuestion({
            question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
            referenceTime: FIXED_NOW,
          }),
        ).rejects.toMatchObject({
          name: 'QuestionInterpretationError',
          code: 'provider_model_unavailable',
          httpStatus: 502,
          retryable: false,
        });

        // Crucial: strictly ONE request to gemini-3.8-flash; NEVER fell back silently to gemini-2.5-flash or any other model
        expect(requestedUrls).toHaveLength(1);
        expect(requestedUrls[0]).toContain('/models/gemini-3.8-flash:generateContent');
        expect(requestedUrls.some((u) => u.includes('gemini-2.5-flash'))).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('2. Anti-Hallucination Validator & Provider Error Mapping', () => {
    it('rejects hallucinated probabilities, citations, observations, and URLs emitted by model', () => {
      expect(() =>
        validateQuestionInterpretationPayload(
          {
            ...buildValidGeminiJsonPayload(),
            probability: 0.74,
          },
          { question: 'test?', referenceTime: FIXED_NOW, providerId: 'gemini' },
        ),
      ).toThrowError(QuestionInterpretationError);

      try {
        validateQuestionInterpretationPayload(
          {
            ...buildValidGeminiJsonPayload(),
            evidence: [{ url: 'https://example.org/fake' }],
          },
          { question: 'test?', referenceTime: FIXED_NOW, providerId: 'gemini' },
        );
      } catch (err) {
        expect(err).toBeInstanceOf(QuestionInterpretationError);
        expect((err as QuestionInterpretationError).code).toBe('provider_prohibited_claim');
      }

      try {
        validateQuestionInterpretationPayload(
          buildValidGeminiJsonPayload({
            normalizedSearchQuery: 'https://169.254.169.254/latest/meta-data battery storage',
          }),
          { question: 'test?', referenceTime: FIXED_NOW, providerId: 'gemini' },
        );
        expect.unreachable('Expected URL in normalizedSearchQuery to be rejected');
      } catch (err) {
        expect((err as QuestionInterpretationError).code).toBe('provider_prohibited_claim');
      }
    });

    it('demotes optimistic unknown identifiers & incoherent resolution dates fail-closed', () => {
      const validated = validateQuestionInterpretationPayload(
        buildValidGeminiJsonPayload({
          decidingAuthority: {
            id: 'unknown',
            label: 'Unknown authority',
            namespace: 'authority',
            resolved: true,
            ambiguityNote: null,
          },
          resolutionDate: {
            isoDateTime: '2029-01-01T00:00:00Z',
            resolved: true,
            ambiguityNote: null,
          },
        }),
        { question: 'Will battery storage exceed 1000 GW by 2030?', referenceTime: FIXED_NOW },
      );

      expect(validated.decidingAuthority.resolved).toBe(false);
      expect(validated.decidingAuthority.id).toBeNull();
      expect(validated.resolutionDate.resolved).toBe(false);
      expect(validated.missingComponents).toContain('decidingAuthority');
      expect(validated.missingComponents).toContain('resolutionDate');
    });

    it('maps Gemini timeouts, 429 rate limits, 401 auth errors (with secret scrubbing), malformed JSON, and truncated responses', async () => {
      const secretKey = 'AIzaSyDoNotLeakThisFakeSecretKey98765432';

      const makeProvider = (
        impl: Parameters<typeof createMockGeminiClient>[0],
      ) =>
        new GeminiQuestionInterpreter({
          apiKey: secretKey,
          model: 'gemini-3.8-flash',
          client: createMockGeminiClient(impl),
        });

      // Model unavailable / unsupported structured output -> clear provider_model_unavailable without silent fallback
      let callCount = 0;
      const calledModels: string[] = [];
      await expect(
        makeProvider(async (params) => {
          callCount += 1;
          calledModels.push(String(params.model));
          throw new ApiError({
            status: 404,
            message: 'models/gemini-3.8-flash is not found or not supported for generateContent.',
          });
        }).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_model_unavailable',
        httpStatus: 502,
        retryable: false,
      });
      expect(callCount).toBe(1);
      expect(calledModels).toEqual(['gemini-3.8-flash']);

      await expect(
        makeProvider(async () => {
          throw new ApiError({
            status: 400,
            message: 'responseJsonSchema is not supported for this model.',
          });
        }).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_model_unavailable',
        httpStatus: 502,
        retryable: false,
      });

      // Timeout
      const timeoutErr = Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
      await expect(
        makeProvider(async () => {
          throw timeoutErr;
        }).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_timeout',
        httpStatus: 504,
        retryable: true,
      });

      // Rate limit 429
      await expect(
        makeProvider(async () => {
          throw new ApiError({ status: 429, message: 'RESOURCE_EXHAUSTED quota exceeded' });
        }).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_rate_limited',
        httpStatus: 429,
        retryable: true,
      });

      // Auth error 401 with embedded key in upstream text -> key NEVER leaked!
      try {
        await makeProvider(async () => {
          throw new ApiError({
            status: 401,
            message: `API key not valid: ${secretKey}`,
          });
        }).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW });
        expect.unreachable('Should have failed auth');
      } catch (err) {
        const qErr = err as QuestionInterpretationError;
        expect(qErr.code).toBe('provider_auth_error');
        expect(qErr.httpStatus).toBe(502);
        expect(qErr.message).not.toContain(secretKey);
        expect(JSON.stringify(qErr.details)).not.toContain(secretKey);
      }

      // Malformed JSON
      await expect(
        makeProvider(async () => ({
          text: '{"subject": { truncated',
          candidates: [{ finishReason: 'STOP' }],
        })).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_malformed_json',
        httpStatus: 502,
      });

      // Truncated MAX_TOKENS
      await expect(
        makeProvider(async () => ({
          text: JSON.stringify(buildValidGeminiJsonPayload()),
          candidates: [{ finishReason: 'MAX_TOKENS' }],
        })).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_malformed_json',
        httpStatus: 502,
      });

      // Empty output
      await expect(
        makeProvider(async () => ({
          text: '   ',
          candidates: [{ finishReason: 'STOP' }],
        })).interpretQuestion({ question: 'Will X happen in 2029?', referenceTime: FIXED_NOW }),
      ).rejects.toMatchObject({
        code: 'provider_empty_output',
        httpStatus: 502,
      });
    });
  });

  describe('3. Full HTTP Endpoint Integration (`GET /v1/health`, `GET /v1/forecasts/status`, `POST /v1/forecasts`)', () => {
    it('starts and serves safely without GEMINI_API_KEY while returning 503 provider-unavailable on POST /v1/forecasts', async () => {
      const { baseUrl, close } = await startTestHttpServer({
        registry: createStubRegistry(),
        questionInterpreter: createGeminiQuestionInterpreterFromEnv({}),
      });
      cleanups.push(close);

      const healthRes = await fetch(`${baseUrl}/v1/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as Record<string, unknown>;
      expect(healthJson.status).toBe('ok');
      expect(healthJson.aiInterpretation).toMatchObject({
        providerId: 'gemini',
        model: null,
        configured: false,
        status: 'unconfigured',
      });

      const statusRes = await fetch(`${baseUrl}/v1/forecasts/status`);
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as Record<string, unknown>;
      expect(statusJson.aiInterpretation).toMatchObject({
        configured: false,
        status: 'unconfigured',
      });

      // Deterministic question resolution still works cleanly without GEMINI_API_KEY
      const detRes = await fetch(
        `${baseUrl}/v1/questions/resolve?q=${encodeURIComponent(
          'Will global stationary battery storage exceed 1000 GW by 2030 per IEA?',
        )}`,
      );
      expect(detRes.status).toBe(200);

      // AI forecast endpoint explicitly reports unavailable rather than faking Gemini
      const forecastRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030?',
        }),
      });
      expect(forecastRes.status).toBe(503);
      const forecastJson = (await forecastRes.json()) as Record<string, unknown>;
      expect(forecastJson.outcomeKind).toBe('provider-unavailable');
      expect(forecastJson.error).toBe('ai_provider_unconfigured');
      expect(forecastJson.pipelineInvoked).toBe(false);
    });

    it('runs Gemini interpretation -> canonical resolution -> real scientific pipeline -> honest abstention with documentary-only evidence', async () => {
      const interpreter = new GeminiQuestionInterpreter({
        apiKey: 'AIzaSyFakeTestKeyForIntegrationOnly00011',
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => ({
          text: JSON.stringify(buildValidGeminiJsonPayload()),
          candidates: [{ finishReason: 'STOP' }],
        })),
      });

      const { baseUrl, close } = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: interpreter,
        forecastPipelineDependencies: {
          evidenceHarvester: async (req) =>
            createStubHarvestResult(req.query, req.category ?? 'technology'),
        },
      });
      cleanups.push(close);

      const res = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:
            'Will global stationary battery storage exceed 1000 GW by 2030 according to IEA?',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.outcomeKind).toBe('honest-abstention');
      expect(body.isEmpiricalForecast).toBe(false);
      expect(body.forecastKind).toBe('abstained');
      expect(body.pipelineStatus).toBe('honest-abstention');
      expect(body.pipelineInvoked).toBe(true);
      expect(body.probabilityDistribution).toBeNull();
      expect(body.footingTier).toBe('insufficient-basis-abstain');

      const canonical = body.canonicalResolution as Record<string, unknown>;
      expect(canonical.identityComplete).toBe(true);
      const detExpected = await resolveCanonicalQuestion(
        'Will global stationary battery storage exceed 1000 GW by 2030 according to IEA?',
        { now: new Date(FIXED_NOW) },
      );
      expect(canonical.identityDigest).toBe(detExpected.identityDigest);

      const pipeline = body.pipeline as {
        evidenceCollection: {
          retrievedEvidenceCount: number;
          validatedQuantitativeEvidenceCount: number;
        };
      };
      expect(pipeline.evidenceCollection.retrievedEvidenceCount).toBe(1);
      // Documentary articles MUST NOT become fake statistical sample sizes!
      expect(pipeline.evidenceCollection.validatedQuantitativeEvidenceCount).toBe(0);
    });

    it('deduplicates equivalent cross-language phrasing to existing official ledger record via canonical identityDigest', async () => {
      const spanishQuestion =
        '¿Superará la capacidad instalada global de almacenamiento estacionario en baterías los 1000 GW en 2030 según la IEA?';
      const englishRef = await resolveCanonicalQuestion(
        'Will global stationary battery storage exceed 1000 GW by 2030 according to IEA?',
        { now: new Date(FIXED_NOW) },
      );
      const mockOfficialRecord: PredictionRecord = {
        ...predictionRecords[0]!,
        id: 'ORC-2026-0042',
        canonicalQuestion:
          'Will global stationary battery storage exceed 1000 GW by 2030 per IEA?',
        category: 'technology',
        demo: false,
      };

      const byIdentity = new Map<string, PredictionRecord>([
        [englishRef.identityDigest, mockOfficialRecord],
      ]);

      const interpreter = new GeminiQuestionInterpreter({
        apiKey: 'AIzaSyFakeTestKeyForIntegrationOnly00022',
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => ({
          text: JSON.stringify(buildValidGeminiJsonPayload()),
          candidates: [{ finishReason: 'STOP' }],
        })),
      });

      const { baseUrl, close } = await startTestHttpServer({
        registry: createStubRegistry({
          officialRecords: [mockOfficialRecord],
          byIdentity,
        }),
        now: () => FIXED_NOW,
        questionInterpreter: interpreter,
        forecastHarvestDefaults: { skipRemoteHarvest: true },
      });
      cleanups.push(close);

      const res = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: spanishQuestion }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        canonicalResolution: {
          identityDigest: string;
          autonomousDecision: string;
          existingOfficialRecord: { id: string } | null;
        };
      };
      expect(body.canonicalResolution.identityDigest).toBe(englishRef.identityDigest);
      expect(body.canonicalResolution.autonomousDecision).toBe('deduplicated-official');
      expect(body.canonicalResolution.existingOfficialRecord?.id).toBe('ORC-2026-0042');
    });

    it('abstains honestly without fabricated precision when horizon/threshold/authority are missing or expired', async () => {
      // Missing horizon & threshold
      const incompleteInterpreter = new GeminiQuestionInterpreter({
        apiKey: 'AIzaSyFakeTestKeyForIntegrationOnly00033',
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => ({
          text: JSON.stringify({
            isForecastableProposition: true,
            canonicalQuestionDraft: 'Will artificial intelligence transform medicine?',
            category: 'health',
            categoryRationale: 'Medical applications of AI.',
            subject: {
              id: 'artificial-intelligence',
              label: 'Artificial intelligence',
              namespace: 'subject',
              resolved: true,
              ambiguityNote: null,
            },
            event: {
              id: null,
              label: null,
              namespace: 'event',
              resolved: false,
              ambiguityNote: 'Unspecified measurable outcome.',
            },
            condition: {
              id: null,
              label: null,
              operator: 'unresolved',
              thresholdValue: null,
              unit: null,
              resolved: false,
              ambiguityNote: 'No quantitative threshold specified.',
            },
            geographicScope: {
              id: null,
              label: null,
              namespace: 'scope',
              resolved: false,
              ambiguityNote: 'Geographic scope omitted.',
            },
            timeHorizon: {
              label: null,
              startsAt: null,
              endsAt: null,
              year: null,
              resolved: false,
              ambiguityNote: 'No deadline specified.',
            },
            resolutionDate: {
              isoDateTime: null,
              resolved: false,
              ambiguityNote: 'No resolution date specified.',
            },
            decidingAuthority: {
              id: null,
              label: null,
              namespace: 'authority',
              resolved: false,
              ambiguityNote: 'No deciding authority specified.',
            },
            missingComponents: [
              'event',
              'condition',
              'geographicScope',
              'horizon',
              'resolutionDate',
              'decidingAuthority',
            ],
            ambiguousComponents: [
              { component: 'condition', reason: 'Transform is qualitative and unfalsifiable.' },
            ],
            clarifyingQuestions: [
              'What measurable metric defines transformation?',
              'By what UTC deadline should this proposition resolve?',
            ],
            normalizedSearchQuery: 'artificial intelligence medicine clinical deployment',
            interpretationLimitations: ['Missing measurable threshold and horizon.'],
          }),
          candidates: [{ finishReason: 'STOP' }],
        })),
      });

      const server1 = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: incompleteInterpreter,
      });
      cleanups.push(server1.close);

      const res1 = await fetch(`${server1.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Will artificial intelligence transform medicine?' }),
      });
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as Record<string, unknown>;
      expect(body1.outcomeKind).toBe('honest-abstention');
      expect(body1.isEmpiricalForecast).toBe(false);
      expect(body1.probabilityDistribution).toBeNull();
      expect(body1.pipelineInvoked).toBe(false);
      expect(body1.missingComponents).toContain('horizon');
      expect(body1.clarifyingQuestions).toEqual([
        'What measurable metric defines transformation?',
        'By what UTC deadline should this proposition resolve?',
      ]);

      // Expired horizon (ends in 2020 relative to FIXED_NOW=2026)
      const expiredInterpreter = new GeminiQuestionInterpreter({
        apiKey: 'AIzaSyFakeTestKeyForIntegrationOnly00044',
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => ({
          text: JSON.stringify(
            buildValidGeminiJsonPayload({
              timeHorizon: {
                label: 'Through 2020',
                startsAt: '2019-01-01T00:00:00Z',
                endsAt: '2020-12-31T23:59:59Z',
                year: 2020,
                resolved: true,
                ambiguityNote: null,
              },
              resolutionDate: {
                isoDateTime: '2020-12-31T23:59:59Z',
                resolved: true,
                ambiguityNote: null,
              },
            }),
          ),
          candidates: [{ finishReason: 'STOP' }],
        })),
      });
      const server2 = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: expiredInterpreter,
      });
      cleanups.push(server2.close);

      const res2 = await fetch(`${server2.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will atmospheric CO2 exceed 415 ppm in 2020?',
        }),
      });
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as Record<string, unknown>;
      expect(body2.outcomeKind).toBe('honest-abstention');
      expect(body2.abstentionReason).toBe('expired-horizon');
      expect(body2.isEmpiricalForecast).toBe(false);
      expect(body2.pipelineInvoked).toBe(false);
    });

    it('produces empirical-forecast, structural-baseline-forecast, partial-execution, and pipeline-failure distinctly via real pipeline', async () => {
      const makeInterp = () =>
        new GeminiQuestionInterpreter({
          apiKey: 'AIzaSyFakeTestKeyForIntegrationOnly00055',
          now: () => FIXED_NOW,
          client: createMockGeminiClient(async () => ({
            text: JSON.stringify(buildValidGeminiJsonPayload()),
            candidates: [{ finishReason: 'STOP' }],
          })),
        });

      const verifiedBetaSubmission: NonNullable<
        ForecastPipelineRequest['submittedEvidence']
      >[number] = {
        category: 'historical-observations',
        evidenceId: 'obs-iea-battery-cohort',
        title: 'IEA Annual Battery Storage Trial Cohorts',
        publisher: 'IEA',
        url: 'https://example.org/iea/battery-cohorts',
        publishedAt: '2026-10-01T00:00:00Z',
        observationSchema: {
          kind: 'binary-trials',
          successOutcomeIndex: 0,
          prior: { alpha: 1, beta: 1 },
          observations: [
            {
              eventId: 'trial-1',
              outcome: 'success',
              observedAt: '2026-05-01T00:00:00Z',
              publisher: 'IEA',
              sourceUrl: 'https://example.org/iea/trial-1',
            },
            {
              eventId: 'trial-2',
              outcome: 'success',
              observedAt: '2026-06-01T00:00:00Z',
              publisher: 'IEA',
              sourceUrl: 'https://example.org/iea/trial-2',
            },
            {
              eventId: 'trial-3',
              outcome: 'failure',
              observedAt: '2026-07-01T00:00:00Z',
              publisher: 'IEA',
              sourceUrl: 'https://example.org/iea/trial-3',
            },
          ],
        },
      };

      const evidenceVerifier = createTrustedEvidenceVerifier({
        verifierId: 'trusted-test-evidence-verifier',
        verifiedEvidenceIds: ['obs-iea-battery-cohort'],
        primarySourceEvidenceIds: ['obs-iea-battery-cohort'],
      });

      // 1. Empirical forecast
      const empServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: makeInterp(),
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        forecastPipelineDependencies: { evidenceVerifier },
        serverPipelineRequestDefaults: {
          assumptions: {
            verifiedAssumptions: [
              'exchangeable-bernoulli-trials',
              'stationary-success-probability',
            ],
          },
          submittedEvidence: [verifiedBetaSubmission],
        },
      });
      cleanups.push(empServer.close);

      const empRes = await fetch(`${empServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
        }),
      });
      expect(empRes.status).toBe(200);
      const empBody = (await empRes.json()) as {
        outcomeKind: string;
        isEmpiricalForecast: boolean;
        forecastKind: string;
        partialExecution: boolean;
        probabilityDistribution: Array<{ probability: number }> | null;
        pipeline: { methods: { executedMethodIds: string[] } };
      };
      expect(empBody.outcomeKind).toBe('empirical-forecast');
      expect(empBody.isEmpiricalForecast).toBe(true);
      expect(empBody.forecastKind).toBe('empirical-forecast');
      expect(empBody.partialExecution).toBe(false);
      // Beta(1 + 2, 1 + 1) => mean 3/5 = 0.6 for Yes
      expect(empBody.probabilityDistribution?.[0]?.probability).toBeCloseTo(0.6, 10);
      expect(empBody.pipeline.methods.executedMethodIds).toEqual([
        'beta-binomial-conjugate',
      ]);

      // 2. Structural baseline forecast (strictly non-empirical)
      const symOutcomeSpace: OutcomeSpaceDescriptor = {
        kind: 'categorical-exhaustive',
        outcomeLabels: ['Sector A', 'Sector B'],
        horizonStartsAt: '2026-01-01T00:00:00Z',
        horizonEndsAt: '2030-12-31T23:59:59Z',
        eventDefinitionHash: `sha256:${'b'.repeat(64)}`,
      };
      const symmetryContract: StructuralSymmetryContract = {
        basisKind: 'transitive-permutation-group',
        generatingPermutations: [[1, 0]],
        microstateCountsPerOutcome: [1, 1],
        formalInvariant: {
          groupName: 'Z_2 Exchange Symmetry',
          invariantObservable: 'Symmetric sector partition',
          derivationReference: 'ref-symmetric-partition-test',
        },
      };
      const symmetryVerifier = createTrustedStructuralSymmetryVerifier({
        verifierId: 'trusted-test-symmetry-verifier',
        approvedDerivationReferences: ['ref-symmetric-partition-test'],
      });
      const baseServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: makeInterp(),
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        forecastPipelineDependencies: { symmetryVerifier },
        serverPipelineRequestDefaults: {
          outcomeSpace: symOutcomeSpace,
          structuralSymmetryContract: symmetryContract,
          assumptions: { allowStructuralBaseline: true },
        },
      });
      cleanups.push(baseServer.close);

      const baseRes = await fetch(`${baseServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Which symmetric sector leads deployment by 2030?',
        }),
      });
      expect(baseRes.status).toBe(200);
      const baseBody = (await baseRes.json()) as Record<string, unknown>;
      expect(baseBody.outcomeKind).toBe('structural-baseline-forecast');
      expect(baseBody.isEmpiricalForecast).toBe(false);
      expect(baseBody.forecastKind).toBe('structural-baseline-only');
      expect(baseBody.nonEmpiricalBaselineNotice).toBeTypeOf('string');

      // 3. Partial execution (2 applicable methods, 1 fails in isolation)
      const secondEmpiricalSubmission: NonNullable<
        ForecastPipelineRequest['submittedEvidence']
      >[number] = {
        category: 'statistical-sufficient-statistics',
        evidenceId: 'stat-poisson-battery',
        title: 'Poisson Milestone Arrivals',
        publisher: 'IEA',
        url: 'https://example.org/iea/poisson',
        publishedAt: '2026-10-01T00:00:00Z',
        statistics: {
          targetMethodId: 'poisson-gamma-hazard',
          eventCount: 2,
          exposureDuration: 2,
          exposureUnit: 'year',
          forecastExposureDuration: 1,
          forecastExposureUnit: 'year',
          eventOutcomeIndex: 0,
          prior: { shape: 1, rate: 1 },
        },
      };
      const bothVerifier = createTrustedEvidenceVerifier({
        verifierId: 'trusted-both-verifier',
        verifiedEvidenceIds: ['obs-iea-battery-cohort', 'stat-poisson-battery'],
        primarySourceEvidenceIds: ['obs-iea-battery-cohort', 'stat-poisson-battery'],
      });
      const partialServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: makeInterp(),
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        forecastPipelineDependencies: {
          evidenceVerifier: bothVerifier,
          methodExecutor: (input, reg) => {
            if (input.methodId === 'poisson-gamma-hazard') {
              throw new Error('Simulated numerical convergence failure in poisson-gamma');
            }
            return executeScientificMethod(input, reg);
          },
        },
        serverPipelineRequestDefaults: {
          horizon: {
            startsAt: '2026-01-01T00:00:00Z',
            endsAt: '2030-12-31T23:59:59Z',
            referenceTime: FIXED_NOW,
            hasPositiveExposureScaling: true,
          },
          assumptions: {
            verifiedAssumptions: [
              'exchangeable-bernoulli-trials',
              'stationary-success-probability',
              'conditionally-independent-poisson-increments',
              'homogeneous-or-known-exposure-intensity',
            ],
          },
          submittedEvidence: [verifiedBetaSubmission, secondEmpiricalSubmission],
        },
      });
      cleanups.push(partialServer.close);

      const partialRes = await fetch(`${partialServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
        }),
      });
      expect(partialRes.status).toBe(200);
      const partialBody = (await partialRes.json()) as {
        outcomeKind: string;
        partialExecution: boolean;
        isEmpiricalForecast: boolean;
        pipeline: {
          methods: {
            executedMethodIds: string[];
            methodExecutionFailures: Array<{ methodId: string }>;
          };
        };
      };
      expect(partialBody.outcomeKind).toBe('partial-execution');
      expect(partialBody.partialExecution).toBe(true);
      expect(partialBody.isEmpiricalForecast).toBe(true);
      expect(partialBody.pipeline.methods.executedMethodIds).toEqual([
        'beta-binomial-conjugate',
      ]);
      expect(partialBody.pipeline.methods.methodExecutionFailures).toHaveLength(1);
      expect(partialBody.pipeline.methods.methodExecutionFailures[0]?.methodId).toBe(
        'poisson-gamma-hazard',
      );

      // 4. Total scientific pipeline failure (`failed-execution` -> 500 `pipeline-failure`)
      const failServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: makeInterp(),
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        forecastPipelineDependencies: {
          evidenceVerifier,
          methodExecutor: () => {
            throw new Error('Simulated catastrophic numerical breakdown');
          },
        },
        serverPipelineRequestDefaults: {
          assumptions: {
            verifiedAssumptions: [
              'exchangeable-bernoulli-trials',
              'stationary-success-probability',
            ],
          },
          submittedEvidence: [verifiedBetaSubmission],
        },
      });
      cleanups.push(failServer.close);

      const failRes = await fetch(`${failServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
        }),
      });
      expect(failRes.status).toBe(500);
      const failBody = (await failRes.json()) as Record<string, unknown>;
      expect(failBody.outcomeKind).toBe('pipeline-failure');
      expect(failBody.error).toBe('scientific_pipeline_execution_failed');
      expect(failBody.isEmpiricalForecast).toBe(false);
    });

    it('rejects invalid questions, bare URLs, untrusted caller fields, oversized bodies, provider failures, and concurrency bursts', async () => {
      const secretKey = 'AIzaSyFakeTestKeyForSecurityTests1234567';
      let mode: 'ok' | 'gibberish' | 'rate-limit' | 'slow' = 'ok';
      let releaseSlow: () => void = () => {};

      const interpreter = new GeminiQuestionInterpreter({
        apiKey: secretKey,
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => {
          if (mode === 'rate-limit') {
            throw new ApiError({
              status: 429,
              message: `Quota exhausted for key=${secretKey}`,
            });
          }
          if (mode === 'slow') {
            await new Promise<void>((res) => {
              releaseSlow = res;
            });
          }
          if (mode === 'gibberish') {
            return {
              text: JSON.stringify({
                isForecastableProposition: false,
                canonicalQuestionDraft: null,
                category: null,
                categoryRationale: null,
                subject: {
                  id: null,
                  label: null,
                  namespace: 'subject',
                  resolved: false,
                  ambiguityNote: 'Not a question.',
                },
                event: {
                  id: null,
                  label: null,
                  namespace: 'event',
                  resolved: false,
                  ambiguityNote: 'Not a question.',
                },
                condition: {
                  id: null,
                  label: null,
                  operator: 'unresolved',
                  thresholdValue: null,
                  unit: null,
                  resolved: false,
                  ambiguityNote: null,
                },
                geographicScope: {
                  id: null,
                  label: null,
                  namespace: 'scope',
                  resolved: false,
                  ambiguityNote: null,
                },
                timeHorizon: {
                  label: null,
                  startsAt: null,
                  endsAt: null,
                  year: null,
                  resolved: false,
                  ambiguityNote: null,
                },
                resolutionDate: {
                  isoDateTime: null,
                  resolved: false,
                  ambiguityNote: null,
                },
                decidingAuthority: {
                  id: null,
                  label: null,
                  namespace: 'authority',
                  resolved: false,
                  ambiguityNote: null,
                },
                missingComponents: [
                  'subject',
                  'event',
                  'condition',
                  'geographicScope',
                  'horizon',
                  'resolutionDate',
                  'decidingAuthority',
                ],
                ambiguousComponents: [],
                clarifyingQuestions: ['Please ask a falsifiable question about a future event.'],
                normalizedSearchQuery: 'unknown',
                interpretationLimitations: ['Input is not a forecasting proposition.'],
              }),
              candidates: [{ finishReason: 'STOP' }],
            };
          }
          return {
            text: JSON.stringify(buildValidGeminiJsonPayload()),
            candidates: [{ finishReason: 'STOP' }],
          };
        }),
      });

      const { baseUrl, close } = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: interpreter,
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        maxConcurrentForecasts: 1,
      });
      cleanups.push(close);

      // Too short question
      const shortRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      expect(shortRes.status).toBe(400);
      expect(((await shortRes.json()) as Record<string, unknown>).outcomeKind).toBe(
        'invalid-question',
      );

      // Bare URL / SSRF prevention
      const urlRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'https://169.254.169.254/latest/meta-data',
        }),
      });
      expect(urlRes.status).toBe(400);
      expect(((await urlRes.json()) as Record<string, unknown>).error).toBe(
        'url_not_permitted',
      );

      // Untrusted caller evidence/URL injection blocked
      const untrustedRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will battery storage exceed 1000 GW by 2030?',
          evidenceUrls: ['http://127.0.0.1:8080/internal'],
        }),
      });
      expect(untrustedRes.status).toBe(400);
      expect(((await untrustedRes.json()) as Record<string, unknown>).error).toBe(
        'untrusted_input_rejected',
      );

      // Oversized body (> 16 KB) rejected with 413
      const oversizedRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'x'.repeat(20_000) }),
      });
      expect(oversizedRes.status).toBe(413);

      // Empty body & malformed JSON rejected with 400 invalid-question
      const emptyRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });
      expect(emptyRes.status).toBe(400);
      expect(((await emptyRes.json()) as Record<string, unknown>).outcomeKind).toBe(
        'invalid-question',
      );

      const badJsonRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json',
      });
      expect(badJsonRes.status).toBe(400);
      expect(((await badJsonRes.json()) as Record<string, unknown>).error).toBe(
        'invalid_json',
      );

      // Wrong method
      const deleteRes = await fetch(`${baseUrl}/v1/forecasts`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(405);

      // Gibberish non-question -> invalid-question
      mode = 'gibberish';
      const gibRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hello world test phrase' }),
      });
      expect(gibRes.status).toBe(400);
      expect(((await gibRes.json()) as Record<string, unknown>).error).toBe(
        'not_a_forecasting_question',
      );

      // Provider rate limit -> 429 provider-failure, zero key leakage
      mode = 'rate-limit';
      const rateRes = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030?',
        }),
      });
      expect(rateRes.status).toBe(429);
      const rateText = await rateRes.text();
      expect(rateText).not.toContain(secretKey);
      expect(JSON.parse(rateText).outcomeKind).toBe('provider-failure');

      // Concurrency bound (maxConcurrentForecasts = 1)
      mode = 'slow';
      const firstInFlight = fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030?',
        }),
      });
      await new Promise((r) => setTimeout(r, 25));
      const secondBlocked = await fetch(`${baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030?',
        }),
      });
      expect(secondBlocked.status).toBe(429);
      expect(secondBlocked.headers.get('retry-after')).toBe('5');
      expect(((await secondBlocked.json()) as Record<string, unknown>).error).toBe(
        'server_busy',
      );

      releaseSlow();
      const firstDone = await firstInFlight;
      expect(firstDone.status).toBe(200);
    });

    it('keeps distinct sub-year horizons separate and maps ForecastPipelineRequestError cleanly to 422 pipeline-failure', async () => {
      const subYearInterp = new GeminiQuestionInterpreter({
        apiKey: 'AIzaSyFakeTestKeyForSubYearHorizon00066',
        now: () => FIXED_NOW,
        client: createMockGeminiClient(async () => ({
          text: JSON.stringify(
            buildValidGeminiJsonPayload({
              subject: {
                id: 'us-cpi-yoy',
                label: 'US CPI YoY',
                namespace: 'subject',
                resolved: true,
                ambiguityNote: null,
              },
              event: {
                id: 'monthly-cpi-release',
                label: 'Monthly CPI Release',
                namespace: 'event',
                resolved: true,
                ambiguityNote: null,
              },
              condition: {
                id: 'lt-2-5-pct',
                label: 'Below 2.5%',
                operator: 'lt',
                thresholdValue: '2.5',
                unit: 'pct',
                resolved: true,
                ambiguityNote: null,
              },
              geographicScope: {
                id: 'us',
                label: 'United States',
                namespace: 'scope',
                resolved: true,
                ambiguityNote: null,
              },
              timeHorizon: {
                label: 'Before March 2027',
                startsAt: '2026-11-27T00:00:00Z',
                endsAt: '2027-02-28T23:59:59Z',
                year: 2027,
                resolved: true,
                ambiguityNote: null,
              },
              resolutionDate: {
                isoDateTime: '2027-03-15T13:30:00Z',
                resolved: true,
                ambiguityNote: null,
              },
              decidingAuthority: {
                id: 'bls',
                label: 'U.S. Bureau of Labor Statistics',
                namespace: 'authority',
                resolved: true,
                ambiguityNote: null,
              },
              category: 'economy',
            }),
          ),
          candidates: [{ finishReason: 'STOP' }],
        })),
      });

      const subYearServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: subYearInterp,
        forecastHarvestDefaults: { skipRemoteHarvest: true },
      });
      cleanups.push(subYearServer.close);

      const subRes = await fetch(`${subYearServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will US CPI fall below 2.5% before March 2027 per BLS?',
        }),
      });
      expect(subRes.status).toBe(200);
      const subBody = (await subRes.json()) as {
        outcomeKind: string;
        canonicalResolution: {
          identityComplete: boolean;
          identity: { horizon: { id: string } };
        };
      };
      expect(subBody.outcomeKind).toBe('honest-abstention');
      expect(subBody.canonicalResolution.identityComplete).toBe(true);
      expect(subBody.canonicalResolution.identity.horizon.id).toBe('by-2027-02-28');

      // ForecastPipelineRequestError (e.g. invalid server-side custom weights) -> 422 pipeline-failure
      const reqErrServer = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: subYearInterp,
        forecastHarvestDefaults: { skipRemoteHarvest: true },
        serverPipelineRequestDefaults: {
          customWeightsByMethod: {
            'nonexistent-method': 1.0,
          },
        },
      });
      cleanups.push(reqErrServer.close);

      const reqErrRes = await fetch(`${reqErrServer.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will US CPI fall below 2.5% before March 2027 per BLS?',
        }),
      });
      expect(reqErrRes.status).toBe(422);
      const reqErrBody = (await reqErrRes.json()) as Record<string, unknown>;
      expect(reqErrBody.outcomeKind).toBe('pipeline-failure');
      expect(reqErrBody.error).toBe('scientific_pipeline_request_rejected');
      expect(reqErrBody.pipelineInvoked).toBe(true);
    });

    it('returns explicit 502 provider_model_unavailable on POST /v1/forecasts without silently falling back to older models', async () => {
      const attemptedModels: string[] = [];
      const unavailableInterp = createGeminiQuestionInterpreterFromEnv(
        {
          GEMINI_API_KEY: 'AIzaSyFakeTestKeyForUnavailableModel007',
          // Omitted GEMINI_MODEL -> defaults to gemini-3.8-flash
        },
        {
          now: () => FIXED_NOW,
          client: createMockGeminiClient(async (params) => {
            attemptedModels.push(String(params.model));
            throw new ApiError({
              status: 404,
              message: `models/${String(params.model)} is not found`,
            });
          }),
        },
      );

      const server = await startTestHttpServer({
        registry: createStubRegistry(),
        now: () => FIXED_NOW,
        questionInterpreter: unavailableInterp,
        forecastHarvestDefaults: { skipRemoteHarvest: true },
      });
      cleanups.push(server.close);

      const healthRes = await fetch(`${server.baseUrl}/v1/forecasts/status`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as {
        aiInterpretation: { model: string | null; status: string };
      };
      expect(healthBody.aiInterpretation.model).toBe('gemini-3.8-flash');
      expect(healthBody.aiInterpretation.status).toBe('ready');

      const postRes = await fetch(`${server.baseUrl}/v1/forecasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Will global battery storage exceed 1000 GW by 2030 per IEA?',
        }),
      });

      expect(postRes.status).toBe(502);
      const postBody = (await postRes.json()) as Record<string, unknown>;
      expect(postBody.outcomeKind).toBe('provider-failure');
      expect(postBody.error).toBe('provider_model_unavailable');
      expect(postBody.retryable).toBe(false);
      expect(postBody.pipelineInvoked).toBe(false);
      expect(String(postBody.message)).toContain('gemini-3.8-flash');
      expect(String(postBody.message)).toContain('no fallback');
      expect(attemptedModels).toEqual(['gemini-3.8-flash']);
    });
  });
});
