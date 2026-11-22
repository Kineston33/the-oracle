/**
 * Hashing primitives shared by every verifier in this repository.
 *
 * The build gate (`scripts/validate-archive.mjs`), the sealing script and the
 * browser panel must all compute digests over identical bytes. One
 * implementation is the only way to guarantee that: a second one would drift,
 * and a verifier that disagrees with the sealer proves nothing.
 *
 * Hashing goes through Web Crypto (`crypto.subtle`), which is a global in Node
 * 20+, in the browser, and in Vitest's Node environment. That is why this module
 * can run unbundled under `node` *and* ship to the client without a Node shim.
 *
 * No imports with path aliases or `.ts` extensions: this file is reachable from
 * both the bundler and a plain `node` process.
 */

/** True when a usable Web Crypto implementation is present. */
export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

/** SHA-256, lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  if (!hasWebCrypto()) {
    throw new Error('Web Crypto is unavailable in this context');
  }
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return toHex(new Uint8Array(digest));
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
