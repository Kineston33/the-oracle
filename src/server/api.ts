/**
 * Minimal server-side HTTP read API for THE ORACLE (Phase 2A — Official Publication Protocol v1.10).
 *
 * Exposes read-only endpoints backed by `PostgresPublicationRegistry`:
 *   · `GET /v1/predictions`
 *   · `GET /v1/predictions/:id`
 *   · `GET /v1/predictions/:id/events`
 *
 * Official publication (`publishCandidate`) and terminal event resolution
 * (`appendResolutionEvent`) remain strictly restricted to trusted server-side
 * execution and cannot be invoked by unauthenticated public clients.
 * Database credentials (`DATABASE_URL`) are never exposed to the browser.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  EVENT_ALGORITHM,
  SUPPORTED_SCHEMA_VERSIONS,
  canonicalize,
  eventEnvelope,
} from '../data/events.ts';
import { sha256Hex } from '../data/hash.ts';
import { deriveLifecycle } from '../data/lifecycle.ts';
import {
  CATEGORY_ORDER,
  DEMO_NOTICE,
  filterRecords,
  findRecord,
  predictionRecords,
  sortByPublication,
} from '../data/records.ts';
import type {
  PredictionCategory,
  PredictionRecord,
  PredictionStatus,
} from '../data/types.ts';
import {
  eventChainProblems,
  publishedLinkProblems,
  recomputeDeclaredDigest,
} from '../data/validate.ts';
import type {
  PostgresPublicationRegistry,
  PredictionEventsVerification,
} from './postgres-registry.ts';

export interface OracleApiServerDeps {
  registry: PostgresPublicationRegistry;
}

const VALID_CATEGORIES = new Set<string>(['all', ...CATEGORY_ORDER]);
const VALID_STATUSES = new Set<string>(['all', 'open', 'resolved', 'annulled']);

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

async function verifyDemoRecordEvents(
  record: PredictionRecord,
): Promise<PredictionEventsVerification> {
  const problems: string[] = [...eventChainProblems(record)];
  const recomputedPayloadDigest = await recomputeDeclaredDigest(record);
  const payloadMatches = recomputedPayloadDigest === record.integrity.digest;
  problems.push(
    ...publishedLinkProblems(record, payloadMatches, recomputedPayloadDigest),
  );

  for (const event of record.events) {
    if (
      event.algorithm !== EVENT_ALGORITHM ||
      !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)
    ) {
      problems.push(
        `Record ${record.id} event ${event.seq} uses unsupported algorithm or schemaVersion`,
      );
      continue;
    }
    const recomputedEventDigest = await sha256Hex(canonicalize(eventEnvelope(event)));
    if (recomputedEventDigest !== event.digest) {
      problems.push(
        `Record ${record.id} event ${event.seq} digest does not reproduce from its contents`,
      );
    }
  }

  return {
    predictionId: record.id,
    demo: true,
    payloadDigest: record.integrity.digest,
    events: record.events,
    verification: {
      valid: problems.length === 0,
      problems,
    },
  };
}

export async function handleOracleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OracleApiServerDeps,
): Promise<void> {
  try {
    const rawUrl = req.url ?? '/';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    // Explicitly block public HTTP write attempts; publication is restricted to trusted server-side execution
    if (
      pathname === '/v1/publications' ||
      (method !== 'GET' &&
        method !== 'HEAD' &&
        /^\/v1\/predictions(?:\/[^/]+\/events)?$/.test(pathname))
    ) {
      if (pathname === '/v1/publications' || pathname.endsWith('/events')) {
        sendJson(res, 403, {
          error: 'trusted_server_only',
          message:
            'Official publication and terminal event resolution are restricted to trusted server-side execution.',
        });
        return;
      }
      sendJson(
        res,
        405,
        {
          error: 'method_not_allowed',
          message: `Method ${method} is not allowed on read-only endpoint ${pathname}.`,
        },
        { Allow: 'GET' },
      );
      return;
    }

    if (method !== 'GET') {
      sendJson(
        res,
        405,
        {
          error: 'method_not_allowed',
          message: `Method ${method} is not allowed.`,
        },
        { Allow: 'GET' },
      );
      return;
    }

    // 1. GET /v1/predictions
    if (pathname === '/v1/predictions') {
      const identityDigestParam = parsedUrl.searchParams.get('identityDigest');
      if (identityDigestParam !== null) {
        if (!/^[0-9a-f]{64}$/.test(identityDigestParam)) {
          sendJson(res, 400, {
            error: 'invalid_identity_digest',
            message:
              'identityDigest query parameter must be a 64-character lowercase hex SHA-256 digest.',
          });
          return;
        }
        const match = await deps.registry.findByIdentity(identityDigestParam);
        const predictions = match?.record ? [match.record] : [];
        sendJson(res, 200, {
          predictions,
          count: predictions.length,
          officialCount: predictions.length,
          demoCount: 0,
        });
        return;
      }

      const categoryParam = parsedUrl.searchParams.get('category') ?? 'all';
      const statusParam = parsedUrl.searchParams.get('status') ?? 'all';
      const queryParam =
        parsedUrl.searchParams.get('q') ?? parsedUrl.searchParams.get('query') ?? '';
      const includeDemo = parsedUrl.searchParams.get('includeDemo') === 'true';

      if (!VALID_CATEGORIES.has(categoryParam)) {
        sendJson(res, 400, {
          error: 'invalid_category',
          message: `Unsupported category filter '${categoryParam}'.`,
        });
        return;
      }
      if (!VALID_STATUSES.has(statusParam)) {
        sendJson(res, 400, {
          error: 'invalid_status',
          message: `Unsupported status filter '${statusParam}'.`,
        });
        return;
      }

      const filter = {
        category: categoryParam as PredictionCategory | 'all',
        status: statusParam as PredictionStatus | 'all',
        query: queryParam,
      };

      const officialPredictions = await deps.registry.listOfficialPredictions(filter);

      if (!includeDemo) {
        sendJson(res, 200, {
          predictions: officialPredictions,
          count: officialPredictions.length,
          officialCount: officialPredictions.length,
          demoCount: 0,
        });
        return;
      }

      const demoPredictions = sortByPublication(
        filterRecords(predictionRecords, filter),
        'newest',
      );
      const combined = sortByPublication(
        [...officialPredictions, ...demoPredictions],
        'newest',
      );
      sendJson(res, 200, {
        predictions: combined,
        count: combined.length,
        officialCount: officialPredictions.length,
        demoCount: demoPredictions.length,
        demoNotice: DEMO_NOTICE,
      });
      return;
    }

    // 2. GET /v1/predictions/:id/events
    const eventsMatch = /^\/v1\/predictions\/([^/]+)\/events$/.exec(pathname);
    if (eventsMatch) {
      const predictionId = decodeURIComponent(eventsMatch[1]!);
      const includeDemo = parsedUrl.searchParams.get('includeDemo') === 'true';

      const officialEvents =
        await deps.registry.getPredictionEventsWithVerification(predictionId);
      if (officialEvents) {
        sendJson(res, 200, officialEvents);
        return;
      }

      if (includeDemo) {
        const demoRecord = findRecord(predictionId);
        if (demoRecord) {
          const verifiedDemo = await verifyDemoRecordEvents(demoRecord);
          sendJson(res, 200, verifiedDemo);
          return;
        }
      }

      sendJson(res, 404, {
        error: 'not_found',
        message: `Official prediction '${predictionId}' was not found.`,
      });
      return;
    }

    // 3. GET /v1/predictions/:id
    const detailMatch = /^\/v1\/predictions\/([^/]+)$/.exec(pathname);
    if (detailMatch) {
      const predictionId = decodeURIComponent(detailMatch[1]!);
      const includeDemo = parsedUrl.searchParams.get('includeDemo') === 'true';

      const officialRecord = await deps.registry.getPredictionById(predictionId);
      if (officialRecord) {
        sendJson(res, 200, {
          prediction: officialRecord,
          lifecycle: deriveLifecycle(officialRecord),
        });
        return;
      }

      if (includeDemo) {
        const demoRecord = findRecord(predictionId);
        if (demoRecord) {
          sendJson(res, 200, {
            prediction: demoRecord,
            lifecycle: deriveLifecycle(demoRecord),
            demoNotice: DEMO_NOTICE,
          });
          return;
        }
      }

      sendJson(res, 404, {
        error: 'not_found',
        message: `Official prediction '${predictionId}' was not found.`,
      });
      return;
    }

    sendJson(res, 404, {
      error: 'not_found',
      message: `Route '${pathname}' was not found.`,
    });
  } catch {
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Internal server error.',
    });
  }
}

export function createOracleApiServer(deps: OracleApiServerDeps): Server {
  return createServer((req, res) => {
    void handleOracleApiRequest(req, res, deps);
  });
}
