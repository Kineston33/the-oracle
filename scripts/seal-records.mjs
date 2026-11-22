#!/usr/bin/env node
/**
 * Seal the demo archive.
 *
 * Computes the SHA-256 digest of each record's canonical payload and writes it
 * back into `src/data/records.json` under `integrity.digest`. Run with
 * `npm run seal` after editing any record.
 *
 * This is NOT a notarization step. It only guarantees that the digest embedded
 * in the repository matches the record it ships with, so the UI's integrity
 * panel is honest about what it can and cannot prove.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordsPath = path.join(root, 'src', 'data', 'records.json');

function canonicalize(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

export function digestOf(record) {
  const { integrity, ...payload } = record;
  void integrity;
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

const records = JSON.parse(await readFile(recordsPath, 'utf8'));
let changed = 0;

const sealed = records.map((record) => {
  const digest = digestOf(record);
  if (record.integrity.digest !== digest) changed += 1;
  return { ...record, integrity: { ...record.integrity, digest } };
});

await writeFile(recordsPath, `${JSON.stringify(sealed, null, 2)}\n`, 'utf8');

console.log(
  `Sealed ${sealed.length} records (${changed} digest${changed === 1 ? '' : 's'} updated).`,
);
for (const record of sealed) {
  console.log(`  ${record.id}  ${record.integrity.digest.slice(0, 16)}…  ${record.title}`);
}
