/**
 * HTTP API & Unified Static SPA Server for THE ORACLE (Official Publication Protocol v1.10).
 *
 * Public read & canonical question endpoints:
 *   · `GET  /v1/health`
 *   · `GET  /v1/predictions`
 *   · `GET  /v1/predictions/:id`
 *   · `GET  /v1/predictions/:id/events`
 *   · `GET  /v1/questions/resolve?q=...`
 *   · `POST /v1/questions/resolve`
 *
 * Trusted operator write endpoints (fail-closed; require `Authorization: Bearer <ORACLE_PUBLICATION_TOKEN>`):
 *   · `POST /v1/publications`
 *   · `POST /v1/predictions/:id/events`
 *
 * Static SPA serving:
 *   · When `staticDir` (e.g. `dist/`) contains a built frontend, serves static assets
 *     and falls back to `dist/index.html` for non-`/v1` SPA routes so a single free
 *     Render web service hosts both the public web interface and the `/v1` API.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, resolve, sep } from 'node:path';
import {
  EVENT_ALGORITHM,
  SUPPORTED_SCHEMA_VERSIONS,
  canonicalize,
  eventEnvelope,
} from '../data/events.ts';
import { sha256Hex } from '../data/hash.ts';
import { deriveLifecycle } from '../data/lifecycle.ts';
import {
  candidateContentDigest,
  evaluateCandidate,
  publishCandidate,
  qualifyCandidate,
} from '../data/publication.ts';
import type {
  CandidateProposition,
  PublicationRequest,
} from '../data/publication-types.ts';
import {
  DEFAULT_ALIAS_TABLE,
  resolveCanonicalQuestion,
} from '../data/question-resolver.ts';
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
  /**
   * Optional high-entropy bearer token (`ORACLE_PUBLICATION_TOKEN`) authorizing
   * trusted server-side calls to `POST /v1/publications` and
   * `POST /v1/predictions/:id/events`. When omitted or mismatched, write endpoints
   * fail closed with HTTP 403 `trusted_server_only`.
   */
  publicationToken?: string;
  /**
   * Optional path to compiled frontend assets (e.g. `dist/`). When present and
   * containing `index.html`, non-`/v1` GET/HEAD requests serve the public SPA.
   */
  staticDir?: string | null;
  /**
   * Optional allowed CORS origin (defaults to `process.env.ORACLE_CORS_ORIGIN ?? '*'`).
   */
  corsOrigin?: string;
}

const VALID_CATEGORIES = new Set<string>(['all', ...CATEGORY_ORDER]);
const VALID_STATUSES = new Set<string>(['all', 'open', 'resolved', 'annulled']);
const MAX_JSON_BODY_BYTES = 256 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function getCorsHeaders(deps: OracleApiServerDeps): Record<string, string> {
  const origin = deps.corsOrigin ?? process.env.ORACLE_CORS_ORIGIN ?? '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
  };
}

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

function isAuthorizedPublicationRequest(
  req: IncomingMessage,
  deps: OracleApiServerDeps,
): boolean {
  const configuredToken = (
    deps.publicationToken ?? process.env.ORACLE_PUBLICATION_TOKEN ?? ''
  ).trim();
  if (configuredToken.length < 16) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return false;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return false;
  }

  const suppliedToken = match[1]!;
  const expectedDigest = createHash('sha256').update(configuredToken).digest();
  const suppliedDigest = createHash('sha256').update(suppliedToken).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      totalBytes += buf.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        rejectBody(new Error('Request body exceeds maximum allowed size (256 KB).'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolveBody({});
          return;
        }
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error('Request body is not valid JSON.'));
      }
    });

    req.on('error', (err) => {
      rejectBody(err);
    });
  });
}

function tryServeStaticSpa(
  pathname: string,
  method: string,
  res: ServerResponse,
  staticDir: string | null | undefined,
): boolean {
  if (!staticDir || (method !== 'GET' && method !== 'HEAD')) {
    return false;
  }
  if (pathname === '/v1' || pathname.startsWith('/v1/')) {
    return false;
  }

  const rootDir = resolve(staticDir);
  const indexHtmlPath = resolve(rootDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    return false;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  if (decodedPath.includes('\0')) {
    return false;
  }

  const relativeTarget = decodedPath.replace(/^\/+/, '');
  const candidatePath = resolve(rootDir, relativeTarget);

  if (
    candidatePath !== rootDir &&
    !candidatePath.startsWith(`${rootDir}${sep}`)
  ) {
    return false;
  }

  if (relativeTarget.length > 0 && existsSync(candidatePath)) {
    try {
      const stat = statSync(candidatePath);
      if (stat.isFile()) {
        const ext = extname(candidatePath).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        const isImmutableAsset = relativeTarget.startsWith('assets/');
        const body = readFileSync(candidatePath);
        res.writeHead(200, {
          'content-type': contentType,
          'cache-control': isImmutableAsset
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
          'x-content-type-options': 'nosniff',
        });
        res.end(method === 'HEAD' ? undefined : body);
        return true;
      }
    } catch {
      return false;
    }
  }

  // SPA fallback: only for extensionless client routes (e.g. /, /predictions, /explore)
  const lastSegment = relativeTarget.split('/').pop() ?? '';
  if (lastSegment.includes('.')) {
    return false;
  }

  try {
    const html = readFileSync(indexHtmlPath);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(method === 'HEAD' ? undefined : html);
    return true;
  } catch {
    return false;
  }
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
  const corsHeaders = getCorsHeaders(deps);

  try {
    const rawUrl = req.url ?? '/';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'OPTIONS' && (pathname === '/v1' || pathname.startsWith('/v1/'))) {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // ------------------------------------------------------------------------
    // Trusted Server-Side Write Endpoints (Fail-Closed by Default)
    // ------------------------------------------------------------------------
    if (
      pathname === '/v1/publications' ||
      (method !== 'GET' &&
        method !== 'HEAD' &&
        /^\/v1\/predictions(?:\/[^/]+\/events)?$/.test(pathname))
    ) {
      if (pathname === '/v1/publications' || pathname.endsWith('/events')) {
        if (method !== 'POST' || !isAuthorizedPublicationRequest(req, deps)) {
          sendJson(
            res,
            403,
            {
              error: 'trusted_server_only',
              message:
                'Official publication and terminal event resolution are restricted to trusted server-side execution.',
            },
            corsHeaders,
          );
          return;
        }

        // Authorized POST /v1/publications
        if (pathname === '/v1/publications') {
          let body: Record<string, unknown>;
          try {
            const parsed = await readJsonBody(req);
            if (!parsed || typeof parsed !== 'object') {
              throw new Error('Expected JSON object body.');
            }
            body = parsed as Record<string, unknown>;
          } catch (err) {
            sendJson(
              res,
              400,
              {
                error: 'invalid_json',
                message: err instanceof Error ? err.message : 'Invalid JSON body.',
              },
              corsHeaders,
            );
            return;
          }

          const rawCandidate = body.candidate as CandidateProposition | undefined;
          const idempotencyKey =
            typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
          const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
          const publishedAt =
            typeof body.publishedAt === 'string'
              ? body.publishedAt
              : nowIso;
          const recordedAt =
            typeof body.recordedAt === 'string'
              ? body.recordedAt
              : new Date(Date.now() + 5).toISOString();
          const requestedAt =
            typeof body.requestedAt === 'string' ? body.requestedAt : publishedAt;

          if (!rawCandidate || typeof rawCandidate !== 'object' || !idempotencyKey) {
            sendJson(
              res,
              400,
              {
                error: 'invalid_publication_request',
                message: 'Both candidate and idempotencyKey are required.',
              },
              corsHeaders,
            );
            return;
          }

          // Evaluate candidate against all 11 protocol requirements before qualifying;
          // abstain whenever ambiguity or missing evidence is detected.
          const verdict = evaluateCandidate(rawCandidate, { publishedAt });
          if (!verdict.eligible) {
            const failed = verdict.results.filter((r) => !r.passed);
            sendJson(
              res,
              422,
              {
                error: 'publication_abstained',
                status: 'abstained',
                message:
                  'THE ORACLE abstained from publishing this candidate because one or more mandatory evaluation requirements were not satisfied.',
                verdict,
                abstentionReasons: failed.map((f) => `[${f.id}] ${f.reason}`),
              },
              corsHeaders,
            );
            return;
          }

          const startingCandidate: CandidateProposition = {
            ...rawCandidate,
            stage: 'exploratory-query',
          };
          const qualified = qualifyCandidate(
            startingCandidate,
            DEFAULT_ALIAS_TABLE,
            { publishedAt },
          );
          const candidateDigest = await candidateContentDigest(
            qualified,
            DEFAULT_ALIAS_TABLE,
          );
          const pubRequest: PublicationRequest = {
            candidateId: qualified.candidateId,
            idempotencyKey,
            identity: qualified.proposedIdentity,
            candidateDigest,
            requestedAt,
          };

          const existingOfficial = await deps.registry.listOfficialPredictions();
          const year = new Date(publishedAt).getUTCFullYear() || 2026;
          const yearPrefix = `ORC-${year}-`;
          let maxSeq = 0;
          for (const rec of existingOfficial) {
            if (rec.id.startsWith(yearPrefix)) {
              const num = Number(rec.id.slice(yearPrefix.length));
              if (Number.isInteger(num) && num > maxSeq) {
                maxSeq = num;
              }
            }
          }
          const assignedPredictionId =
            typeof body.predictionId === 'string' &&
            /^ORC-\d{4}-\d{4,}$/.test(body.predictionId.trim())
              ? body.predictionId.trim()
              : `${yearPrefix}${String(maxSeq + 1).padStart(4, '0')}`;

          const outcome = await publishCandidate(
            qualified,
            pubRequest,
            {
              registry: deps.registry,
              aliases: DEFAULT_ALIAS_TABLE,
              now: () => publishedAt,
              recordedAt: () => recordedAt,
              newPredictionId: () => assignedPredictionId,
            },
          );

          const statusCode =
            outcome.kind === 'created'
              ? 201
              : outcome.kind === 'existing' || outcome.kind === 'replayed'
                ? 200
                : outcome.kind === 'identity-conflict' ||
                    outcome.kind === 'idempotency-conflict'
                  ? 409
                  : 422;

          sendJson(
            res,
            statusCode,
            {
              status: outcome.kind,
              outcome,
            },
            corsHeaders,
          );
          return;
        }

        // Authorized POST /v1/predictions/:id/events
        const writeEventsMatch = /^\/v1\/predictions\/([^/]+)\/events$/.exec(pathname);
        if (writeEventsMatch) {
          const predictionId = decodeURIComponent(writeEventsMatch[1]!);
          let body: Record<string, unknown>;
          try {
            const parsed = await readJsonBody(req);
            if (!parsed || typeof parsed !== 'object') {
              throw new Error('Expected JSON object body.');
            }
            body = parsed as Record<string, unknown>;
          } catch (err) {
            sendJson(
              res,
              400,
              {
                error: 'invalid_json',
                message: err instanceof Error ? err.message : 'Invalid JSON body.',
              },
              corsHeaders,
            );
            return;
          }

          const eventType = (body.kind ?? body.type) as
            | 'resolved'
            | 'annulled'
            | undefined;
          const occurredAt =
            typeof body.occurredAt === 'string' ? body.occurredAt.trim() : '';
          const recordedAt =
            typeof body.recordedAt === 'string' ? body.recordedAt.trim() : '';
          const basis = typeof body.basis === 'string' ? body.basis.trim() : '';
          const note = typeof body.note === 'string' ? body.note.trim() : '';
          const reason =
            typeof body.reason === 'string' && body.reason.trim().length > 0
              ? body.reason.trim()
              : basis;
          const outcomeVal = body.outcome as 'yes' | 'no' | undefined;
          const evidenceIds = Array.isArray(body.evidenceIds)
            ? body.evidenceIds.filter((u): u is string => typeof u === 'string')
            : Array.isArray(body.sourceUrls)
              ? body.sourceUrls.filter((u): u is string => typeof u === 'string')
              : [];

          if (
            (eventType !== 'resolved' && eventType !== 'annulled') ||
            !occurredAt ||
            !recordedAt ||
            !basis
          ) {
            sendJson(
              res,
              400,
              {
                error: 'invalid_terminal_event',
                message:
                  "Terminal event requires kind/type ('resolved' | 'annulled'), occurredAt, recordedAt, and basis.",
              },
              corsHeaders,
            );
            return;
          }

          if (
            eventType === 'resolved' &&
            outcomeVal !== 'yes' &&
            outcomeVal !== 'no'
          ) {
            sendJson(
              res,
              400,
              {
                error: 'invalid_resolution_outcome',
                message:
                  "Resolved event requires outcome ('yes' | 'no').",
              },
              corsHeaders,
            );
            return;
          }

          try {
            const updatedRecord = await deps.registry.appendResolutionEvent({
              predictionId,
              kind: eventType,
              occurredAt,
              recordedAt,
              body:
                eventType === 'resolved'
                  ? {
                      outcome: outcomeVal!,
                      basis,
                      note,
                      evidenceIds,
                    }
                  : {
                      reason,
                      basis,
                      note,
                    },
            });
            const appendedEvent =
              updatedRecord.events[updatedRecord.events.length - 1] ?? null;
            sendJson(
              res,
              201,
              {
                predictionId,
                event: appendedEvent,
                prediction: updatedRecord,
                lifecycle: deriveLifecycle(updatedRecord),
              },
              corsHeaders,
            );
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const status = /does not exist/i.test(msg)
              ? 404
              : /already\s+(?:has\s+a\s+terminal|resolved|annulled)|is\s+final|terminal\s+events\s+cannot\s+be\s+followed|append-only|conflict/i.test(
                    msg,
                  )
                ? 409
                : 422;
            sendJson(
              res,
              status,
              {
                error: 'terminal_event_rejected',
                message: msg,
              },
              corsHeaders,
            );
            return;
          }
        }
      }

      sendJson(
        res,
        405,
        {
          error: 'method_not_allowed',
          message: `Method ${method} is not allowed on read-only endpoint ${pathname}.`,
        },
        { Allow: 'GET', ...corsHeaders },
      );
      return;
    }

    // ------------------------------------------------------------------------
    // Centralized Canonical Question Resolution (`GET` or `POST /v1/questions/resolve`)
    // ------------------------------------------------------------------------
    if (pathname === '/v1/questions/resolve') {
      if (method !== 'GET' && method !== 'POST') {
        sendJson(
          res,
          405,
          {
            error: 'method_not_allowed',
            message: `Method ${method} is not allowed on /v1/questions/resolve.`,
          },
          { Allow: 'GET, POST', ...corsHeaders },
        );
        return;
      }

      let rawQuestion = '';
      let includeDemo = parsedUrl.searchParams.get('includeDemo') !== 'false';

      if (method === 'GET') {
        rawQuestion =
          parsedUrl.searchParams.get('q') ??
          parsedUrl.searchParams.get('question') ??
          '';
      } else {
        try {
          const parsed = await readJsonBody(req);
          if (parsed && typeof parsed === 'object') {
            const body = parsed as Record<string, unknown>;
            if (typeof body.question === 'string') {
              rawQuestion = body.question;
            } else if (typeof body.q === 'string') {
              rawQuestion = body.q;
            }
            if (typeof body.includeDemo === 'boolean') {
              includeDemo = body.includeDemo;
            }
          }
        } catch (err) {
          sendJson(
            res,
            400,
            {
              error: 'invalid_json',
              message: err instanceof Error ? err.message : 'Invalid JSON body.',
            },
            corsHeaders,
          );
          return;
        }
      }

      const trimmedQuestion = rawQuestion.trim();
      if (trimmedQuestion.length < 3 || trimmedQuestion.length > 1000) {
        sendJson(
          res,
          400,
          {
            error: 'invalid_question',
            message:
              'Question parameter (q) must be between 3 and 1000 characters.',
          },
          corsHeaders,
        );
        return;
      }

      const preliminary = await resolveCanonicalQuestion(trimmedQuestion);
      const existingMatch = await deps.registry.findByIdentity(
        preliminary.identityDigest,
      );
      const officialRecords = await deps.registry.listOfficialPredictions();
      const archivePool = includeDemo
        ? [...officialRecords, ...predictionRecords]
        : officialRecords;

      const resolution = await resolveCanonicalQuestion(trimmedQuestion, {
        existingOfficialRecord: existingMatch?.record ?? null,
        archivePool,
      });

      sendJson(res, 200, resolution, corsHeaders);
      return;
    }

    // ------------------------------------------------------------------------
    // Static Frontend SPA Serving for Non-`/v1` GET/HEAD Requests
    // ------------------------------------------------------------------------
    if (
      (method === 'GET' || method === 'HEAD') &&
      pathname !== '/v1' &&
      !pathname.startsWith('/v1/')
    ) {
      if (tryServeStaticSpa(pathname, method, res, deps.staticDir)) {
        return;
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(
        res,
        405,
        {
          error: 'method_not_allowed',
          message: `Method ${method} is not allowed.`,
        },
        { Allow: 'GET', ...corsHeaders },
      );
      return;
    }

    // 0. GET /v1/health
    if (pathname === '/v1/health') {
      sendJson(
        res,
        200,
        {
          status: 'ok',
          service: 'the-oracle',
          protocolVersion: '1.10',
          runtimeRole: 'oracle_app',
          demoRecordsAvailable: predictionRecords.length,
        },
        corsHeaders,
      );
      return;
    }

    // 1. GET /v1/predictions
    if (pathname === '/v1/predictions') {
      const identityDigestParam = parsedUrl.searchParams.get('identityDigest');
      if (identityDigestParam !== null) {
        if (!/^[0-9a-f]{64}$/.test(identityDigestParam)) {
          sendJson(
            res,
            400,
            {
              error: 'invalid_identity_digest',
              message:
                'identityDigest query parameter must be a 64-character lowercase hex SHA-256 digest.',
            },
            corsHeaders,
          );
          return;
        }
        const match = await deps.registry.findByIdentity(identityDigestParam);
        const predictions = match?.record ? [match.record] : [];
        sendJson(
          res,
          200,
          {
            predictions,
            count: predictions.length,
            officialCount: predictions.length,
            demoCount: 0,
          },
          corsHeaders,
        );
        return;
      }

      const categoryParam = parsedUrl.searchParams.get('category') ?? 'all';
      const statusParam = parsedUrl.searchParams.get('status') ?? 'all';
      const queryParam =
        parsedUrl.searchParams.get('q') ?? parsedUrl.searchParams.get('query') ?? '';
      const includeDemo = parsedUrl.searchParams.get('includeDemo') === 'true';

      if (!VALID_CATEGORIES.has(categoryParam)) {
        sendJson(
          res,
          400,
          {
            error: 'invalid_category',
            message: `Unsupported category filter '${categoryParam}'.`,
          },
          corsHeaders,
        );
        return;
      }
      if (!VALID_STATUSES.has(statusParam)) {
        sendJson(
          res,
          400,
          {
            error: 'invalid_status',
            message: `Unsupported status filter '${statusParam}'.`,
          },
          corsHeaders,
        );
        return;
      }

      const filter = {
        category: categoryParam as PredictionCategory | 'all',
        status: statusParam as PredictionStatus | 'all',
        query: queryParam,
      };

      const officialPredictions = await deps.registry.listOfficialPredictions(filter);

      if (!includeDemo) {
        sendJson(
          res,
          200,
          {
            predictions: officialPredictions,
            count: officialPredictions.length,
            officialCount: officialPredictions.length,
            demoCount: 0,
          },
          corsHeaders,
        );
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
      sendJson(
        res,
        200,
        {
          predictions: combined,
          count: combined.length,
          officialCount: officialPredictions.length,
          demoCount: demoPredictions.length,
          demoNotice: DEMO_NOTICE,
        },
        corsHeaders,
      );
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
        sendJson(res, 200, officialEvents, corsHeaders);
        return;
      }

      if (includeDemo) {
        const demoRecord = findRecord(predictionId);
        if (demoRecord) {
          const verifiedDemo = await verifyDemoRecordEvents(demoRecord);
          sendJson(res, 200, verifiedDemo, corsHeaders);
          return;
        }
      }

      sendJson(
        res,
        404,
        {
          error: 'not_found',
          message: `Official prediction '${predictionId}' was not found.`,
        },
        corsHeaders,
      );
      return;
    }

    // 3. GET /v1/predictions/:id
    const detailMatch = /^\/v1\/predictions\/([^/]+)$/.exec(pathname);
    if (detailMatch) {
      const predictionId = decodeURIComponent(detailMatch[1]!);
      const includeDemo = parsedUrl.searchParams.get('includeDemo') === 'true';

      const officialRecord = await deps.registry.getPredictionById(predictionId);
      if (officialRecord) {
        sendJson(
          res,
          200,
          {
            prediction: officialRecord,
            lifecycle: deriveLifecycle(officialRecord),
          },
          corsHeaders,
        );
        return;
      }

      if (includeDemo) {
        const demoRecord = findRecord(predictionId);
        if (demoRecord) {
          sendJson(
            res,
            200,
            {
              prediction: demoRecord,
              lifecycle: deriveLifecycle(demoRecord),
              demoNotice: DEMO_NOTICE,
            },
            corsHeaders,
          );
          return;
        }
      }

      sendJson(
        res,
        404,
        {
          error: 'not_found',
          message: `Official prediction '${predictionId}' was not found.`,
        },
        corsHeaders,
      );
      return;
    }

    sendJson(
      res,
      404,
      {
        error: 'not_found',
        message: `Route '${pathname}' was not found.`,
      },
      corsHeaders,
    );
  } catch {
    sendJson(
      res,
      500,
      {
        error: 'internal_error',
        message: 'Internal server error.',
      },
      corsHeaders,
    );
  }
}

export function createOracleApiServer(deps: OracleApiServerDeps): Server {
  return createServer((req, res) => {
    void handleOracleApiRequest(req, res, deps);
  });
}
