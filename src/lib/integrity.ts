/**
 * Canonical serialization + integrity digest.
 *
 * The digest is a real SHA-256 over a deterministic, key-sorted JSON encoding
 * of a record's immutable payload. It is *not* a signature, and it is not yet
 * anchored in a public transparency log — see `IntegrityMetadata`.
 *
 * This module is isomorphic: `crypto.subtle` in the browser, `node:crypto`
 * in tests and scripts.
 */

import type { PredictionRecord } from '@/data/types';

/** Fields that make up the immutable payload of a record. */
export type SealedPayload = Omit<PredictionRecord, 'integrity'>;

/**
 * Deterministically serialize a value: object keys are sorted recursively and
 * `undefined` members are dropped, so the same payload always produces the
 * same bytes regardless of insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const next = source[key];
      if (next === undefined) continue;
      out[key] = sortValue(next);
    }
    return out;
  }
  return value;
}

/** Strip mutable/derived fields and return the payload that is sealed. */
export function sealedPayload(record: PredictionRecord): SealedPayload {
  const { integrity: _integrity, ...rest } = record;
  return rest;
}

/** UTF-8 bytes of the canonical payload. */
export function sealedBytes(record: PredictionRecord): Uint8Array {
  return new TextEncoder().encode(canonicalize(sealedPayload(record)));
}

/** Constant-time hex comparison helpers for the integrity panel. */
export function shortDigest(digest: string, head = 10, tail = 6): string {
  if (digest.length <= head + tail + 1) return digest;
  return `${digest.slice(0, head)}…${digest.slice(-tail)}`;
}

/**
 * SHA-256 hex digest of a byte array, via Web Crypto.
 *
 * This is the only hashing path the application uses. The Node build step
 * (`scripts/seal-records.mjs`) implements the same canonicalization and hashes
 * the same bytes with `node:crypto`, which is why a record sealed offline
 * verifies in the browser. Keeping `node:crypto` out of this module means the
 * client bundle contains no Node shim at all.
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

/** Compute the SHA-256 hex digest of a record payload. */
export async function digestRecord(record: PredictionRecord): Promise<string> {
  return sha256Hex(sealedBytes(record));
}

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
