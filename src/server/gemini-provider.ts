/**
 * THE ORACLE — Server-Side Gemini Provider Adapter (`@google/genai`) (Stage 2B-2A)
 *
 * Implements `QuestionInterpreterProvider` using Google's official `@google/genai`
 * SDK strictly on the Node.js server runtime.
 *
 * Security & Epistemological Guarantees:
 *   1. Server-only credentials: reads `GEMINI_API_KEY` and `GEMINI_MODEL` solely
 *      from `process.env` (or test-injected options). Never exposes keys to
 *      browser bundles, logs, errors, or API responses.
 *   2. Safe startup without API key: when `GEMINI_API_KEY` is unset/empty,
 *      the provider initializes cleanly in `status: 'unconfigured'`, reports
 *      AI-assisted question interpretation unavailable, and fails closed on calls.
 *   3. Strictly bounded execution: enforces per-request `timeoutMs` via both
 *      SDK `httpOptions.timeout` and `AbortSignal.timeout`, bounded SDK retries
 *      (`maxAttempts <= 3`), bounded `maxOutputTokens`, `temperature: 0`, and
 *      bounded response payload size.
 *   4. No autonomous tools / URL fetching / evidence fabrication: calls Gemini
 *      with NO tools (`googleSearch`, `urlContext`, `codeExecution` omitted) and
 *      structured JSON Schema (`QUESTION_INTERPRETATION_JSON_SCHEMA`) validated
 *      by `validateQuestionInterpretationPayload`.
 */

import { ApiError, GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import {
  QUESTION_INTERPRETATION_JSON_SCHEMA,
  QUESTION_INTERPRETATION_SYSTEM_INSTRUCTION,
  QuestionInterpretationError,
  buildQuestionInterpretationUserPrompt,
  validateQuestionInterpretationPayload,
  type QuestionInterpretationProviderMetadata,
  type QuestionInterpretationRequest,
  type QuestionInterpretationResult,
  type QuestionInterpreterProvider,
} from './question-interpreter.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash' as const;
export const DEFAULT_GEMINI_TIMEOUT_MS = 12_000 as const;
export const MIN_GEMINI_TIMEOUT_MS = 1_000 as const;
export const MAX_GEMINI_TIMEOUT_MS = 30_000 as const;
export const DEFAULT_GEMINI_MAX_ATTEMPTS = 2 as const;
export const MAX_GEMINI_MAX_ATTEMPTS = 3 as const;
export const DEFAULT_GEMINI_MAX_OUTPUT_TOKENS = 1_024 as const;
export const MAX_GEMINI_RESPONSE_CHARS = 65_536 as const;

const VALID_MODEL_PATTERN = /^[a-zA-Z0-9._:/-]{3,128}$/;

export interface GeminiGenerateContentResultLike {
  readonly text?: string;
  readonly candidates?: ReadonlyArray<{
    readonly finishReason?: string;
  }>;
  readonly promptFeedback?: {
    readonly blockReason?: string;
    readonly blockReasonMessage?: string;
  };
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly totalTokenCount?: number;
  };
}

export interface GeminiModelsClientLike {
  generateContent(
    params: GenerateContentParameters,
  ): Promise<GeminiGenerateContentResultLike>;
}

export interface GeminiClientLike {
  readonly models: GeminiModelsClientLike;
}

export interface GeminiProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxOutputTokens: number;
}

export interface GeminiQuestionInterpreterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly maxOutputTokens?: number;
  readonly client?: GeminiClientLike;
  readonly createClient?: (config: GeminiProviderConfig) => GeminiClientLike;
  readonly now?: () => string;
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num)) {
    return fallback;
  }
  const intVal = Math.trunc(num);
  return Math.max(min, Math.min(max, intVal));
}

export function normalizeGeminiModelName(
  rawModel: string | undefined,
  fallback: string = DEFAULT_GEMINI_MODEL,
): string {
  const trimmed = (rawModel ?? '').trim();
  if (!trimmed) {
    return fallback;
  }
  if (!VALID_MODEL_PATTERN.test(trimmed)) {
    throw new RangeError(
      'Invalid GEMINI_MODEL value: expected alphanumeric/dash/dot/slash model identifier (3-128 chars).',
    );
  }
  return trimmed;
}

/**
 * Scrubs API keys, bearer tokens, query-string keys, and database credentials
 * so provider failures can never leak secrets to logs, errors, or HTTP responses.
 */
export function redactProviderSecrets(
  input: string,
  extraSecret?: string,
): string {
  let out = input;
  if (extraSecret && extraSecret.length >= 6) {
    out = out.split(extraSecret).join('[REDACTED]');
  }
  return out
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/([?&](?:key|api_key|apiKey)=)[^&\s'"]+/gi, '$1[REDACTED]')
    .replace(/(x-goog-api-key[:=]\s*)[^\s,;'"}\]]+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s,;'"}\]]+/gi, '$1[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, 'postgresql://[REDACTED]');
}

export function readGeminiConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GeminiProviderConfig {
  const apiKey = (env.GEMINI_API_KEY ?? '').trim();
  const model = normalizeGeminiModelName(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
  const timeoutMs = clampInt(
    env.GEMINI_TIMEOUT_MS,
    DEFAULT_GEMINI_TIMEOUT_MS,
    MIN_GEMINI_TIMEOUT_MS,
    MAX_GEMINI_TIMEOUT_MS,
  );
  const maxAttempts = clampInt(
    env.GEMINI_MAX_ATTEMPTS,
    DEFAULT_GEMINI_MAX_ATTEMPTS,
    1,
    MAX_GEMINI_MAX_ATTEMPTS,
  );
  return Object.freeze({
    apiKey,
    model,
    timeoutMs,
    maxAttempts,
    maxOutputTokens: DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
  });
}

function defaultCreateGeminiClient(config: GeminiProviderConfig): GeminiClientLike {
  return new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: {
      timeout: config.timeoutMs,
      retryOptions: {
        attempts: config.maxAttempts,
        initialDelay: 0.25,
        maxDelay: 1.5,
        expBase: 2.0,
        jitter: 0.25,
      },
    },
  });
}

function isModelUnavailableMessage(message: string): boolean {
  return (
    /model[^\n]*(?:not\s+found|unavailable|deprecated|does\s+not\s+exist|not\s+supported|unsupported)|(?:unsupported|unknown)\s+model|response_?(?:json_?)?schema[^\n]*(?:not\s+supported|unsupported)|structured\s+output[^\n]*(?:not\s+supported|unsupported)/i.test(
      message,
    )
  );
}

function mapProviderFailure(
  err: unknown,
  providerId: string,
  secretKey: string,
  configuredModel: string,
): QuestionInterpretationError {
  if (err instanceof QuestionInterpretationError) {
    return err;
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  const safeMsg = redactProviderSecrets(rawMsg, secretKey);

  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new QuestionInterpretationError({
      code: 'provider_timeout',
      providerId,
      message: 'Gemini question interpretation request timed out.',
      retryable: true,
      httpStatus: 504,
      details: [safeMsg],
    });
  }

  const apiStatus =
    err instanceof ApiError
      ? err.status
      : typeof (err as { status?: unknown })?.status === 'number'
        ? ((err as { status: number }).status)
        : null;

  if (apiStatus !== null) {
    if (apiStatus === 408 || apiStatus === 504) {
      return new QuestionInterpretationError({
        code: 'provider_timeout',
        providerId,
        message: 'Gemini upstream request timed out.',
        retryable: true,
        httpStatus: 504,
        details: [`HTTP ${apiStatus}: ${safeMsg}`],
      });
    }
    if (apiStatus === 429) {
      return new QuestionInterpretationError({
        code: 'provider_rate_limited',
        providerId,
        message: 'Gemini rate limit or quota exceeded.',
        retryable: true,
        httpStatus: 429,
        details: [`HTTP 429: ${safeMsg}`],
      });
    }
    if (apiStatus === 401 || apiStatus === 403) {
      return new QuestionInterpretationError({
        code: 'provider_auth_error',
        providerId,
        message:
          'Upstream Gemini provider rejected server credentials or permissions.',
        retryable: false,
        httpStatus: 502,
        details: [`HTTP ${apiStatus}`],
      });
    }
    if (
      apiStatus === 404 ||
      apiStatus === 410 ||
      (apiStatus === 400 && isModelUnavailableMessage(safeMsg))
    ) {
      return new QuestionInterpretationError({
        code: 'provider_model_unavailable',
        providerId,
        message: `Configured Gemini model '${configuredModel}' is unavailable or does not support generateContent structured JSON schema output (HTTP ${apiStatus}); no fallback model was used.`,
        retryable: false,
        httpStatus: 502,
        details: [`model=${configuredModel}`, `HTTP ${apiStatus}: ${safeMsg}`],
      });
    }
    return new QuestionInterpretationError({
      code: 'provider_upstream_error',
      providerId,
      message: `Gemini upstream error (HTTP ${apiStatus}).`,
      retryable: apiStatus >= 500,
      httpStatus: 502,
      details: [`HTTP ${apiStatus}: ${safeMsg}`],
    });
  }

  if (isModelUnavailableMessage(safeMsg)) {
    return new QuestionInterpretationError({
      code: 'provider_model_unavailable',
      providerId,
      message: `Configured Gemini model '${configuredModel}' is unavailable or unsupported; no fallback model was used.`,
      retryable: false,
      httpStatus: 502,
      details: [`model=${configuredModel}`, safeMsg],
    });
  }

  if (
    /resource_exhausted|quota|rate limit/i.test(safeMsg)
  ) {
    return new QuestionInterpretationError({
      code: 'provider_rate_limited',
      providerId,
      message: 'Gemini rate limit or quota exceeded.',
      retryable: true,
      httpStatus: 429,
      details: [safeMsg],
    });
  }

  if (
    /api[ _-]?key|unauthenticated|permission[ _-]?denied/i.test(safeMsg)
  ) {
    return new QuestionInterpretationError({
      code: 'provider_auth_error',
      providerId,
      message: 'Upstream Gemini authentication failed.',
      retryable: false,
      httpStatus: 502,
      details: ['Upstream authentication/permission rejection.'],
    });
  }

  if (/timed?\s*out|timeout|aborted/i.test(safeMsg)) {
    return new QuestionInterpretationError({
      code: 'provider_timeout',
      providerId,
      message: 'Gemini question interpretation request timed out.',
      retryable: true,
      httpStatus: 504,
      details: [safeMsg],
    });
  }

  if (/econnreset|econnrefused|enotfound|etimedout|network|fetch failed|socket/i.test(safeMsg)) {
    return new QuestionInterpretationError({
      code: 'provider_network_error',
      providerId,
      message: 'Network error while communicating with Gemini API.',
      retryable: true,
      httpStatus: 502,
      details: [safeMsg],
    });
  }

  return new QuestionInterpretationError({
    code: 'provider_upstream_error',
    providerId,
    message: `Gemini request failed: ${safeMsg}`,
    retryable: false,
    httpStatus: 502,
    details: [safeMsg],
  });
}

export class GeminiQuestionInterpreter implements QuestionInterpreterProvider {
  readonly providerId = 'gemini' as const;
  private readonly config: GeminiProviderConfig;
  private readonly injectedClient: GeminiClientLike | undefined;
  private readonly createClientFn: (config: GeminiProviderConfig) => GeminiClientLike;
  private readonly nowFn: () => string;
  private cachedClient: GeminiClientLike | null = null;

  constructor(options: GeminiQuestionInterpreterOptions = {}) {
    const apiKey = (options.apiKey ?? '').trim();
    const model = normalizeGeminiModelName(options.model, DEFAULT_GEMINI_MODEL);
    const timeoutMs = clampInt(
      options.timeoutMs,
      DEFAULT_GEMINI_TIMEOUT_MS,
      MIN_GEMINI_TIMEOUT_MS,
      MAX_GEMINI_TIMEOUT_MS,
    );
    const maxAttempts = clampInt(
      options.maxAttempts,
      DEFAULT_GEMINI_MAX_ATTEMPTS,
      1,
      MAX_GEMINI_MAX_ATTEMPTS,
    );
    const maxOutputTokens = clampInt(
      options.maxOutputTokens,
      DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
      256,
      2_048,
    );

    this.config = Object.freeze({
      apiKey,
      model,
      timeoutMs,
      maxAttempts,
      maxOutputTokens,
    });
    this.injectedClient = options.client;
    this.createClientFn = options.createClient ?? defaultCreateGeminiClient;
    this.nowFn =
      options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  }

  get model(): string | null {
    return this.isConfigured() ? this.config.model : null;
  }

  isConfigured(): boolean {
    return this.injectedClient !== undefined || this.config.apiKey.length > 0;
  }

  getStatus(): QuestionInterpretationProviderMetadata {
    const configured = this.isConfigured();
    if (!configured) {
      return Object.freeze({
        providerId: this.providerId,
        model: null,
        configured: false,
        status: 'unconfigured',
        reason:
          'GEMINI_API_KEY is not configured on the server; AI-assisted question interpretation is unavailable.',
      });
    }
    return Object.freeze({
      providerId: this.providerId,
      model: this.config.model,
      configured: true,
      status: 'ready',
    });
  }

  private resolveClient(): GeminiClientLike {
    if (this.injectedClient) {
      return this.injectedClient;
    }
    if (!this.config.apiKey) {
      throw new QuestionInterpretationError({
        code: 'provider_unconfigured',
        providerId: this.providerId,
        message:
          'AI-assisted forecasting is unavailable because GEMINI_API_KEY is not configured on the server.',
        retryable: false,
        httpStatus: 503,
      });
    }
    if (!this.cachedClient) {
      this.cachedClient = this.createClientFn(this.config);
    }
    return this.cachedClient;
  }

  async interpretQuestion(
    request: QuestionInterpretationRequest,
  ): Promise<QuestionInterpretationResult> {
    if (!this.isConfigured()) {
      throw new QuestionInterpretationError({
        code: 'provider_unconfigured',
        providerId: this.providerId,
        message:
          'AI-assisted forecasting is unavailable because GEMINI_API_KEY is not configured on the server.',
        retryable: false,
        httpStatus: 503,
      });
    }

    const trimmedQuestion = request.question.trim();
    if (trimmedQuestion.length < 3 || trimmedQuestion.length > 1000) {
      throw new QuestionInterpretationError({
        code: 'invalid_request',
        providerId: this.providerId,
        message: 'Question must be between 3 and 1000 characters.',
        retryable: false,
        httpStatus: 400,
      });
    }

    const client = this.resolveClient();
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const abortSignal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    const startedMs = Date.now();
    let rawResponse: GeminiGenerateContentResultLike;
    try {
      rawResponse = await client.models.generateContent({
        model: this.config.model,
        contents: buildQuestionInterpretationUserPrompt(
          trimmedQuestion,
          request.referenceTime,
        ),
        config: {
          systemInstruction: QUESTION_INTERPRETATION_SYSTEM_INSTRUCTION,
          temperature: 0,
          maxOutputTokens: this.config.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: QUESTION_INTERPRETATION_JSON_SCHEMA,
          abortSignal,
          httpOptions: {
            timeout: this.config.timeoutMs,
            retryOptions: {
              attempts: this.config.maxAttempts,
              initialDelay: 0.25,
              maxDelay: 1.5,
              expBase: 2.0,
              jitter: 0.25,
            },
          },
        },
      });
    } catch (err) {
      throw mapProviderFailure(
        err,
        this.providerId,
        this.config.apiKey,
        this.config.model,
      );
    }

    const latencyMs = Math.max(0, Date.now() - startedMs);

    if (rawResponse.promptFeedback?.blockReason) {
      throw new QuestionInterpretationError({
        code: 'provider_upstream_error',
        providerId: this.providerId,
        message: `Gemini blocked prompt evaluation (${rawResponse.promptFeedback.blockReason}).`,
        retryable: false,
        httpStatus: 502,
        details: rawResponse.promptFeedback.blockReasonMessage
          ? [redactProviderSecrets(rawResponse.promptFeedback.blockReasonMessage, this.config.apiKey)]
          : [],
      });
    }

    const finishReason = rawResponse.candidates?.[0]?.finishReason;
    if (
      finishReason !== undefined &&
      finishReason !== 'STOP' &&
      finishReason !== 'FINISH_REASON_UNSPECIFIED'
    ) {
      throw new QuestionInterpretationError({
        code:
          finishReason === 'MAX_TOKENS'
            ? 'provider_malformed_json'
            : 'provider_upstream_error',
        providerId: this.providerId,
        message: `Gemini did not complete structured generation cleanly (finishReason='${finishReason}').`,
        retryable: false,
        httpStatus: 502,
        details: [`finishReason=${finishReason}`],
      });
    }

    const rawText = typeof rawResponse.text === 'string' ? rawResponse.text.trim() : '';
    if (!rawText) {
      throw new QuestionInterpretationError({
        code: 'provider_empty_output',
        providerId: this.providerId,
        message: 'Gemini returned an empty response body.',
        retryable: true,
        httpStatus: 502,
      });
    }

    if (rawText.length > MAX_GEMINI_RESPONSE_CHARS) {
      throw new QuestionInterpretationError({
        code: 'provider_schema_violation',
        providerId: this.providerId,
        message: `Gemini response exceeded maximum allowed payload length (${MAX_GEMINI_RESPONSE_CHARS} chars).`,
        retryable: false,
        httpStatus: 502,
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      throw new QuestionInterpretationError({
        code: 'provider_malformed_json',
        providerId: this.providerId,
        message: 'Gemini returned non-JSON or malformed JSON output.',
        retryable: false,
        httpStatus: 502,
      });
    }

    const interpretation = validateQuestionInterpretationPayload(parsedJson, {
      question: trimmedQuestion,
      referenceTime: request.referenceTime,
      providerId: this.providerId,
    });

    const usage = rawResponse.usageMetadata;
    return Object.freeze({
      providerId: this.providerId,
      model: this.config.model,
      interpretedAt: this.nowFn(),
      latencyMs,
      interpretation,
      ...(usage
        ? {
            tokenUsage: Object.freeze({
              ...(usage.promptTokenCount !== undefined
                ? { promptTokens: usage.promptTokenCount }
                : {}),
              ...(usage.candidatesTokenCount !== undefined
                ? { outputTokens: usage.candidatesTokenCount }
                : {}),
              ...(usage.totalTokenCount !== undefined
                ? { totalTokens: usage.totalTokenCount }
                : {}),
            }),
          }
        : {}),
    });
  }
}

export function createGeminiQuestionInterpreterFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: Partial<GeminiQuestionInterpreterOptions> = {},
): GeminiQuestionInterpreter {
  const envConfig = readGeminiConfigFromEnv(env);
  return new GeminiQuestionInterpreter({
    apiKey: overrides.apiKey ?? envConfig.apiKey,
    model: overrides.model ?? envConfig.model,
    timeoutMs: overrides.timeoutMs ?? envConfig.timeoutMs,
    maxAttempts: overrides.maxAttempts ?? envConfig.maxAttempts,
    maxOutputTokens: overrides.maxOutputTokens ?? envConfig.maxOutputTokens,
    ...(overrides.client !== undefined ? { client: overrides.client } : {}),
    ...(overrides.createClient !== undefined
      ? { createClient: overrides.createClient }
      : {}),
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
  });
}
