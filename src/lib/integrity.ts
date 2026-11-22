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

export { canonicalize, sealedPayload };
export type { SealedPayload } from '@/data/types';

/** Constant-time hex comparison helpers for the integrity panel. */
export function shortDigest(digest: string, head = 10, tail = 6): string {
  if (digest.length <= head + tail + 1) return digest;
  return `${digest.slice(0, head)}…${digest.slice(-tail)}`;
}

/**
 * SHA-256 hex digest of a byte array, via Web Crypto.
 *
 * `crypto.subtle` requires a secure context (https or localhost). On an
 * insecure origin the caller receives a rejected promise and the integrity
 * panel reports that verification is unavailable rather than pretending.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable in this context');
  }
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return toHex(new Uint8Array(buffer));
}

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
    const recomputed = await digestEvent(event);
    if (recomputed !== event.digest) broken.push(event.seq);

    const previous = record.events[index - 1];
    const expected = previous ? previous.digest : null;
    if (event.prevDigest !== expected) mislinked.push(event.seq);
  }

  return { ok: broken.length === 0 && mislinked.length === 0, broken, mislinked };
}

/* -------------------------------------------------------------------------
   Deprecated name
   ------------------------------------------------------------------------- */

/**
 * @deprecated Ambiguous: it silently picked whichever payload definition was
 * current. Use `digestPayload` (sealed content) or `verifyRecordDigest` (what a
 * stored digest claims to be).
 *
 * Kept as an alias of `digestPayload` so existing call sites keep compiling,
 * but nothing that needs to re-seal a published record should call it.
 */
export const digestRecord = digestPayload;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
