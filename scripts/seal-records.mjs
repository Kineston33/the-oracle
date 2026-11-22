#!/usr/bin/env node
/**
 * Seal the archive — once, at publication.
 *
 * This script will NOT re-seal a record that already carries a digest for its
 * sealed payload. That is the point: re-sealing a published record would
 * silently replace the proof that its content was fixed at publication with a
 * fresh hash of whatever the content is now, which is exactly the rewrite the
 * product promises never to perform.
 *
 * What it does:
 *   · records with `payloadScope: 'sealed-payload'` and a digest for the
 *     current payload are left untouched (reported as `verified`);
 *   · records whose declared digest does not reproduce are a hard error, and
 *     the script exits non-zero without writing anything;
 *   · records with no digest yet are sealed for the first time (`sealed`).
 *
 * Legacy records (`payloadScope: 'legacy-record'`) are verified against the
 * legacy algorithm — the checksum they were actually issued with — and are
 * never rewritten. Their new event chains are verified too.
 *
 * Usage:
 *   npm run seal -- --refresh-events   regenerate event digests only
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  canonicalize,
  sealedPayload,
  eventEnvelope,
  legacyPayloadShape,
} from '../src/data/events.ts';
import { eventChainProblems } from '../src/data/validate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordsPath = path.join(root, 'src', 'data', 'records.json');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const payloadDigestOf = (record) => sha256(canonicalize(sealedPayload(record)));
const legacyDigestOf = (record) => sha256(canonicalize(legacyPayloadShape(record)));

const eventDigestOf = (event) => sha256(canonicalize(eventEnvelope(event)));

const refreshEvents = process.argv.includes('--refresh-events');

const records = JSON.parse(await readFile(recordsPath, 'utf8'));

const sealed = [];
const verified = [];
const failures = [];
const eventFailures = [];

for (const record of records) {
  const scope = record.integrity?.payloadScope;

  if (!scope) {
    // Nothing declared: this record was never sealed under either model.
    sealed.push(record.id);
    sealed[sealed.length - 1] = record.id;
    const digest = payloadDigestOf(record);
    record.integrity = {
      ...record.integrity,
      digest,
      payloadScope: 'sealed-payload',
    };
  } else {
    const recomputed = scope === 'legacy-record' ? legacyDigestOf(record) : payloadDigestOf(record);
    if (recomputed !== record.integrity.digest) failures.push(record.id);
    else verified.push(record.id);
  }

  if (refreshEvents) {
    for (const event of record.events ?? []) {
      event.digest = eventDigestOf(event);
    }
  }

  // Event digests must reproduce under both modes.
  for (const event of record.events ?? []) {
    if (eventDigestOf(event) !== event.digest) eventFailures.push(`${record.id}/${event.seq}`);
  }

  const chain = eventChainProblems(record);
  if (chain.length > 0) eventFailures.push(...chain);
}

if (failures.length > 0) {
  console.error(`\n  Refusing to write: ${failures.length} record(s) do not match their own digest.`);
  for (const id of failures) console.error(`    · ${id}`);
  console.error('\n  A published record cannot be re-sealed. Restore the content or issue a new revision.\n');
  process.exit(1);
}

if (eventFailures.length > 0) {
  console.error(`\n  Refusing to write: the event chain is inconsistent.`);
  for (const problem of eventFailures) console.error(`    · ${problem}`);
  console.error('\n  Run with --refresh-events only when intentionally rebuilding chains.\n');
  process.exit(1);
}

if (sealed.length === 0 && !refreshEvents) {
  console.log(
    `  Nothing to seal. ${verified.length} records verified against their own digest; ` +
      `no published record was re-sealed.`,
  );
} else {
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  if (sealed.length > 0) console.log(`  Sealed ${sealed.length} previously unsealed record(s).`);
  if (refreshEvents) console.log('  Event digests regenerated.');
  console.log(`  ${verified.length} records verified untouched.`);
}
