/**
 * Canonical serialisation + integrity digests.
 *
 * Two distinct things are hashed here, and conflating them is what the
 * payload/event split exists to prevent:
 *
 *   1. **The sealed payload** — the content fixed at publication. Its digest
 *      must never move once the record is published, no matter how many
 *      resolutions or annulments are appended afterwards.
 *   2. **Events** — each link in the append-only chain, covering its own
 *      envelope plus the previous link's digest.
 *
 * Digests are real SHA-256 over deterministic, key-sorted JSON. They are *not*
 * signatures, and nothing here is anchored in a public log — see
 * `IntegrityMetadata.anchored`.
 *
 * This module is browser-only: hashing goes through Web Crypto so the client
 * bundle contains no Node shim. `scripts/seal-records.mjs` hashes the exact same
 * bytes with `node:crypto`.
 */

import type { PredictionRecord, RecordEvent } from '@/data/types';
import {
  canonicalize,
  eventBytes,
  legacyPayloadBytes,
  payloadBytes,
  sealedPayload,
} from '@/data/events';
import { hasWebCrypto, sha256Hex } from '@/data/hash';
import {
  EVENT_ALGORITHM,
  SUPPORTED_SCHEMA_VERSIONS,
} from '@/data/events';
import { eventChainProblems, publishedLinkProblems } from '@/data/validate';

export { canonicalize, sealedPayload };
export type { SealedPayload } from '@/data/types';

/** Constant-time hex comparison helpers for the integrity panel. */
export function shortDigest(digest: string, head = 10, tail = 6): string {
  if (digest.length <= head + tail + 1) return digest;
  return `${digest.slice(0, head)}…${digest.slice(-tail)}`;
}

/**
 * SHA-256 hex digest, via Web Crypto.
 *
 * `crypto.subtle` requires a secure context (https or localhost). On an
 * insecure origin the caller receives a rejected promise and the integrity
 * panel reports that verification is unavailable rather than pretending.
 *
 * The implementation lives in `data/hash.ts` so the build gate, which runs as a
 * plain Node process with no bundler, hashes exactly the same bytes.
 */
export { sha256Hex } from '@/data/hash';

/**
 * Digest of the sealed payload — the content fixed at publication.
 *
 * Status and outcomes are not part of this, by design.
 */
export async function digestPayload(record: PredictionRecord): Promise<string> {
  return sha256Hex(payloadBytes(record));
}

/**
 * Digest of a record's payload under the pre-split definition, where status and
 * resolution were part of the hashed content.
 *
 * Used only to verify digests that were issued before the split. It is never
 * used to mint a new digest: `scripts/seal-records.mjs` computes this value
 * solely to confirm an existing legacy digest still reproduces.
 */
export async function digestLegacyRecord(record: PredictionRecord): Promise<string> {
  return sha256Hex(legacyPayloadBytes(record));
}

/** Digest of one event, covering its envelope and its predecessor's digest. */
export async function digestEvent(event: RecordEvent): Promise<string> {
  return sha256Hex(eventBytes(event));
}

/**
 * Recompute the digest a record's `integrity.digest` is claimed to be, using the
 * algorithm that record declares.
 *
 * This is the verification entry point. It answers one question only: *does the
 * shipped bytes match the recorded digest, under the algorithm that digest was
 * issued with?* It never produces a replacement value for a published record.
 */
export async function verifyRecordDigest(record: PredictionRecord): Promise<string> {
  return record.integrity.payloadScope === 'legacy-record'
    ? digestLegacyRecord(record)
    : digestPayload(record);
}

export interface ChainVerification {
  ok: boolean;
  /** Sequence labels whose digest does not reproduce. */
  broken: string[];
  /** Events whose link to the predecessor is wrong. */
  mislinked: string[];
}

/**
 * Walk a record's event chain and recompute every digest.
 *
 * Any edit to an event — including its timestamp or body — breaks that event
 * and every link after it, which is what makes the chain tamper-evident rather
 * than merely ordered.
 */
export async function verifyEventChain(record: PredictionRecord): Promise<ChainVerification> {
  const broken: string[] = [];
  const mislinked: string[] = [];

  for (let index = 0; index < record.events.length; index += 1) {
    const event = record.events[index];
    if (event.algorithm !== EVENT_ALGORITHM) {
      broken.push(event.seq);
      continue;
    }
    if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(event.schemaVersion)) {
      broken.push(event.seq);
      continue;
    }
    const recomputed = await digestEvent(event);
    if (recomputed !== event.digest) broken.push(event.seq);

    const previous = record.events[index - 1];
    const expected = previous ? previous.digest : null;
    if (event.prevDigest !== expected) mislinked.push(event.seq);
  }

  return { ok: broken.length === 0 && mislinked.length === 0, broken, mislinked };
}

/* -------------------------------------------------------------------------
   Full verification
   ------------------------------------------------------------------------- */

/**
 * Outcome of one check.
 *
 * `unavailable` is a distinct state on purpose. Three states would tempt a
 * caller to map "could not run" onto "passed"; four make that a deliberate act.
 */
export type CheckStatus = 'pass' | 'fail' | 'unavailable';

export interface CheckResult {
  status: CheckStatus;
  /** What was compared, in words. Always present. */
  detail: string;
}

export interface RecordVerification {
  /** True only when every check passed. */
  ok: boolean;
  /** Human-readable failures, empty when `ok`. */
  problems: string[];
  /** Digest recomputed from the shipped bytes, under the declared scope. */
  computedDigest: string | null;
  /** Whether the recomputed digest equals `integrity.digest`. */
  digestMatches: boolean;
  /** The four checks, reported separately so a UI cannot collapse them. */
  checks: {
    payload: CheckResult;
    publicationLink: CheckResult;
    eventChain: CheckResult;
    anchoring: CheckResult;
  };
}

/**
 * Everything a reader needs to know about one record, in one call.
 *
 * Three things are checked and all three must hold:
 *
 *   1. the sealed payload's digest reproduces under the scope it declares;
 *   2. the `published` event names exactly that digest, and nothing else does;
 *   3. every event digest reproduces and every link points backwards correctly.
 *
 * Checks 1 and 2 are what close the gap that made re-sealing invisible: editing
 * the payload and updating `integrity.digest` alone leaves an event that names
 * the old digest, and rebuilding the event fixes that but cannot forge an
 * anchor. With no external witness, checks 1–3 together prove internal
 * consistency and nothing more — see the returned `problems` wording, which
 * never claims otherwise.
 */
export async function verifyRecordCompletely(
  record: PredictionRecord,
): Promise<RecordVerification> {
  const problems: string[] = [];
  let computedDigest: string | null = null;

  if (!hasWebCrypto()) {
    const unavailable: CheckResult = {
      status: 'unavailable',
      detail: 'Web Crypto is unavailable in this browser, so no digest could be recomputed.',
    };
    return {
      ok: false,
      problems: ['Web Crypto is unavailable, so nothing could be verified.'],
      computedDigest: null,
      digestMatches: false,
      checks: {
        payload: unavailable,
        publicationLink: unavailable,
        eventChain: unavailable,
        anchoring: unavailable,
      },
    };
  }

  try {
    computedDigest = await verifyRecordDigest(record);
  } catch (error) {
    problems.push(`Digest could not be recomputed: ${(error as Error).message}`);
  }

  const digestMatches = computedDigest !== null && computedDigest === record.integrity.digest;
  if (computedDigest !== null && !digestMatches) {
    problems.push(
      `Record ${record.id}: the sealed content no longer matches integrity.digest.`,
    );
  }

  const linkProblems = [
    ...publishedLinkProblems(record, digestMatches, computedDigest),
  ];
  problems.push(...linkProblems);

  const structuralProblems = eventChainProblems(record);
  problems.push(...structuralProblems);

  const chain = await verifyEventChain(record);
  if (!chain.ok) {
    if (chain.broken.length > 0) {
      problems.push(
        `Record ${record.id}: event digest does not reproduce for ${chain.broken.join(', ')}.`,
      );
    }
    if (chain.mislinked.length > 0) {
      problems.push(
        `Record ${record.id}: event link is wrong for ${chain.mislinked.join(', ')}.`,
      );
    }
  }

  const payloadCheck: CheckResult =
    computedDigest === null
      ? { status: 'unavailable', detail: 'The payload digest could not be recomputed.' }
      : digestMatches
        ? {
            status: 'pass',
            detail: 'The sealed payload reproduces the digest the record declares.',
          }
        : {
            status: 'fail',
            detail: 'The sealed payload does not reproduce the digest the record declares.',
          };

  const publicationCheck: CheckResult =
    linkProblems.length === 0
      ? {
          status: 'pass',
          detail: 'The publication event names the digest of the shipped payload.',
        }
      : {
          status: 'fail',
          detail: linkProblems[0],
        };

  const chainFailed = !chain.ok || structuralProblems.length > 0;
  const eventChainCheck: CheckResult = chainFailed
    ? {
        status: 'fail',
        detail:
          [...structuralProblems, ...chain.broken.map((seq) => `event ${seq} digest does not reproduce`), ...chain.mislinked.map((seq) => `event ${seq} link is wrong`)][0] ??
          'The event chain is not consistent.',
      }
    : {
        status: 'pass',
        detail: `All ${record.events.length} event digest(s) and link(s) reproduce.`,
      };

  // Anchoring can never pass in this build.
  //
  // `integrity.anchored` is a boolean the record carries; a boolean is a claim,
  // not a proof. Treating it as a pass meant a one-character edit in the JSON
  // produced a green "externally witnessed" tick. No anchoring mechanism is
  // implemented, and there is no external proof to check, so the honest result
  // is `unavailable` — even when the flag says otherwise. The validator rejects
  // such a record outright, so this is the second line of defence rather than
  // the first.
  const anchoringClaimed = record.integrity.anchored;
  // A record that claims anchoring it cannot prove is not internally consistent,
  // so the claim has to reach the verdict. Without this the panel would show
  // "anchoring failed" beside "everything verifies", which is exactly the kind
  // of contradiction that makes a green tick untrustworthy.
  if (anchoringClaimed) {
    problems.push(
      `Record ${record.id} claims external anchoring, but no verifiable external proof exists.`,
    );
  }
  const anchoringCheck: CheckResult = anchoringClaimed
    ? {
        status: 'fail',
        detail:
          'This record claims external anchoring, but no verifiable external proof is implemented or checked. The claim cannot be honoured.',
      }
    : {
        status: 'unavailable',
        detail:
          'No external witness or transparency log has countersigned this digest. Internal consistency is not third-party attestation.',
      };

  return {
    ok: problems.length === 0,
    problems,
    computedDigest,
    digestMatches,
    checks: {
      payload: payloadCheck,
      publicationLink: publicationCheck,
      eventChain: eventChainCheck,
      anchoring: anchoringCheck,
    },
  };
}
