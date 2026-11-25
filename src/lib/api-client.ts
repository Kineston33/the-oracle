/**
 * Public HTTP API client for THE ORACLE frontend (`GET /v1/predictions`,
 * `GET /v1/predictions/:id`, `GET /v1/predictions/:id/events`, and
 * `GET /v1/questions/resolve`).
 *
 * Connects to the deployed Node.js + PostgreSQL 16 (`oracle_ledger`) backend via
 * same-origin `/v1/*` routes (or `VITE_ORACLE_API_URL` when hosted separately),
 * while falling back cleanly to the local static demo archive in offline or
 * unmocked unit-test environments.
 */

import { deriveLifecycle } from '@/data/lifecycle';
import {
  resolveCanonicalQuestion,
  type CanonicalQuestionResolution,
} from '@/data/question-resolver';
import {
  DEMO_NOTICE,
  filterRecords,
  findRecord,
  predictionRecords,
  sortByPublication,
} from '@/data/records';
import type {
  PredictionCategory,
  PredictionRecord,
  PredictionStatus,
  RecordEvent,
} from '@/data/types';

export interface ArchiveListResponse {
  predictions: PredictionRecord[];
  count: number;
  officialCount: number;
  demoCount: number;
  demoNotice?: string;
  source: 'ledger-api' | 'local-fallback';
}

export interface PredictionDetailResponse {
  prediction: PredictionRecord;
  lifecycle: ReturnType<typeof deriveLifecycle>;
  demoNotice?: string;
  source: 'ledger-api' | 'local-fallback';
}

export interface PredictionEventsApiResponse {
  predictionId: string;
  demo: boolean;
  payloadDigest: string;
  events: RecordEvent[];
  verification: {
    valid: boolean;
    problems: string[];
  };
  source: 'ledger-api' | 'local-fallback';
}

export function getOracleApiBaseUrl(): string {
  const configured =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_ORACLE_API_URL === 'string'
      ? import.meta.env.VITE_ORACLE_API_URL.trim()
      : '';
  return configured.replace(/\/+$/, '');
}

export function isLedgerNetworkEnabled(): boolean {
  if (typeof globalThis.fetch !== 'function') {
    return false;
  }
  const isTestEnv =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.MODE === 'test';
  if (!isTestEnv) {
    return true;
  }
  const hasExplicitBase = getOracleApiBaseUrl().length > 0;
  const isMockedFetch =
    'mock' in globalThis.fetch ||
    (globalThis.fetch as { isMockFunction?: boolean }).isMockFunction === true;
  return hasExplicitBase || isMockedFetch;
}

function shouldAttemptNetworkFetch(): boolean {
  return isLedgerNetworkEnabled();
}

export async function fetchArchivePredictions(params: {
  category?: PredictionCategory | 'all';
  status?: PredictionStatus | 'all';
  query?: string;
  includeDemo?: boolean;
}): Promise<ArchiveListResponse> {
  const category = params.category ?? 'all';
  const status = params.status ?? 'all';
  const query = params.query ?? '';
  const includeDemo = params.includeDemo ?? true;

  if (shouldAttemptNetworkFetch()) {
    try {
      const search = new URLSearchParams();
      if (category !== 'all') search.set('category', category);
      if (status !== 'all') search.set('status', status);
      if (query.trim()) search.set('q', query.trim());
      if (includeDemo) search.set('includeDemo', 'true');

      const qs = search.toString();
      const url = `${getOracleApiBaseUrl()}/v1/predictions${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const body = (await res.json()) as {
          predictions?: PredictionRecord[];
          count?: number;
          officialCount?: number;
          demoCount?: number;
          demoNotice?: string;
        };
        if (Array.isArray(body.predictions)) {
          return {
            predictions: body.predictions,
            count: body.count ?? body.predictions.length,
            officialCount:
              body.officialCount ??
              body.predictions.filter((p) => !p.demo).length,
            demoCount:
              body.demoCount ??
              body.predictions.filter((p) => p.demo).length,
            demoNotice: body.demoNotice,
            source: 'ledger-api',
          };
        }
      }
    } catch {
      // Fall through to local fallback
    }
  }

  if (!includeDemo) {
    return {
      predictions: [],
      count: 0,
      officialCount: 0,
      demoCount: 0,
      source: 'local-fallback',
    };
  }

  const filteredDemo = sortByPublication(
    filterRecords(predictionRecords, { category, status, query }),
    'newest',
  );
  return {
    predictions: filteredDemo,
    count: filteredDemo.length,
    officialCount: 0,
    demoCount: filteredDemo.length,
    demoNotice: DEMO_NOTICE,
    source: 'local-fallback',
  };
}

export async function fetchPredictionDetail(
  id: string,
  options?: { includeDemo?: boolean },
): Promise<PredictionDetailResponse | null> {
  const includeDemo = options?.includeDemo ?? true;

  if (shouldAttemptNetworkFetch()) {
    try {
      const qs = includeDemo ? '?includeDemo=true' : '';
      const url = `${getOracleApiBaseUrl()}/v1/predictions/${encodeURIComponent(id)}${qs}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as {
          prediction?: PredictionRecord;
          demoNotice?: string;
        };
        if (body.prediction) {
          return {
            prediction: body.prediction,
            lifecycle: deriveLifecycle(body.prediction),
            demoNotice: body.demoNotice,
            source: 'ledger-api',
          };
        }
      } else if (res.status === 404) {
        return null;
      }
    } catch {
      // Fall through to local fallback
    }
  }

  if (!includeDemo) {
    return null;
  }

  const demoRecord = findRecord(id);
  if (!demoRecord) {
    return null;
  }
  return {
    prediction: demoRecord,
    lifecycle: deriveLifecycle(demoRecord),
    demoNotice: DEMO_NOTICE,
    source: 'local-fallback',
  };
}

export async function fetchPredictionEventsVerification(
  id: string,
  options?: { includeDemo?: boolean },
): Promise<PredictionEventsApiResponse | null> {
  const includeDemo = options?.includeDemo ?? true;

  if (shouldAttemptNetworkFetch()) {
    try {
      const qs = includeDemo ? '?includeDemo=true' : '';
      const url = `${getOracleApiBaseUrl()}/v1/predictions/${encodeURIComponent(id)}/events${qs}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as Omit<
          PredictionEventsApiResponse,
          'source'
        >;
        if (body && Array.isArray(body.events)) {
          return {
            ...body,
            source: 'ledger-api',
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

export async function fetchCanonicalQuestionResolution(
  question: string,
): Promise<CanonicalQuestionResolution & { source: 'ledger-api' | 'local-fallback' }> {
  if (shouldAttemptNetworkFetch()) {
    try {
      const url = `${getOracleApiBaseUrl()}/v1/questions/resolve?q=${encodeURIComponent(question)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const body = (await res.json()) as CanonicalQuestionResolution;
        if (body && body.identityDigest) {
          return {
            ...body,
            source: 'ledger-api',
          };
        }
      }
    } catch {
      // Fall through to local deterministic resolution
    }
  }

  const localResolution = await resolveCanonicalQuestion(question);
  return {
    ...localResolution,
    source: 'local-fallback',
  };
}
