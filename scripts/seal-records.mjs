#!/usr/bin/env node
/**
 * Seal the archive — once, at publication.
 *
 * This script will NOT re-seal a record that already carries a digest. That is
 * the point: re-sealing a published record would silently replace the proof that
 * its content was fixed at publication with a fresh hash of whatever the content
 * is now, which is the rewrite the product promises never to perform.
 *
 * What it does:
 *   · verifies every record against the digest it declares, using the payload
 *     definition it declares (`sealed-payload` or `legacy-record`);
 *   · verifies every event digest and every link, exactly as the build gate does;
 *   · seals, for the first time, records that carry no digest at all;
 *   · exits non-zero without writing anything if any check fails.
 *
 * `--refresh-events` exists for building chains deliberately during a migration.
 * It regenerates event digests only; it never touches a payload digest.
 *
 * There is no `--force`. A published record cannot be re-sealed.
 *
 * Usage:
 *   npm run seal
 *   npm run seal -- --refresh-events
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  canonicalize,
  eventEnvelope,
  legacyPayloadShape,
  sealedPayload,
} from '../src/data/events.ts';
import { sha256Hex } from '../src/data/hash.ts';
import { eventChainProblems, publishedLinkProblems } from '../src/data/validate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordsPath = path.join(root, 'src', 'data', 'records.json');

const payloadDigestOf = (record) =>
  sha256Hex(canonicalize(sealedPayload(record)));
const legacyDigestOf = (record) =>
  sha256Hex(canonicalize(legacyPayloadShape(record)));
const eventDigestOf = (event) =>
  sha256Hex(canonicalize(eventEnvelope(event)));

const refreshEvents = process.argv.includes('--refresh-events');

const records = JSON.parse(await readFile(recordsPath, 'utf8'));

const newlySealed = [];
const verified = [];
const digestFailures = [];
const eventFailures = [];

for (const record of records) {
  const scope = record.integrity?.payloadScope;

  if (!scope) {
    // Never sealed under either model: this is a first publication.
    record.integrity = {
      ...record.integrity,
      digest: await payloadDigestOf(record),
      payloadScope: 'sealed-payload',
    };
    newlySealed.push(record.id);
  } else {
    const recomputed =
      scope === 'legacy-record' ? await legacyDigestOf(record) : await payloadDigestOf(record);
    if (recomputed === record.integrity.digest) verified.push(record.id);
    else digestFailures.push(record.id);
  }

  if (refreshEvents) {
    let previous = null;
    for (const event of record.events ?? []) {
      event.prevDigest = previous;
      event.digest = await eventDigestOf(event);
      previous = event.digest;
    }
  }

  for (const event of record.events ?? []) {
    if ((await eventDigestOf(event)) !== event.digest) {
      eventFailures.push(`${record.id}/${event.seq}: digest does not reproduce`);
    }
  }
  eventFailures.push(...eventChainProblems(record));

  const matches = record.integrity?.digest !== undefined && record.integrity.digest !== null;
  const recomputedForLink =
    matches && scope
      ? scope === 'legacy-record'
        ? await legacyDigestOf(record)
        : await payloadDigestOf(record)
      : null;
  eventFailures.push(
    ...publishedLinkProblems(
      record,
      recomputedForLink !== null && recomputedForLink === record.integrity?.digest,
      recomputedForLink,
    ),
  );
}

if (digestFailures.length > 0) {
  console.error(`\n  Refusing to write: ${digestFailures.length} record(s) do not match their own digest.`);
  for (const id of digestFailures) console.error(`    · ${id}`);
  console.error('\n  A published record cannot be re-sealed. Restore the content or issue a new revision.\n');
  process.exit(1);
}

if (eventFailures.length > 0) {
  console.error('\n  Refusing to write: the publication link or the event chain is inconsistent.');
  for (const problem of eventFailures) console.error(`    · ${problem}`);
  console.error('\n  Run with --refresh-events only when intentionally rebuilding chains.\n');
  process.exit(1);
}

if (newlySealed.length === 0 && !refreshEvents) {
  console.log(
    `  Nothing to seal. ${verified.length} records verified against their own digest and ` +
      `against their publication event; no published record was re-sealed.`,
  );
} else {
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  if (newlySealed.length > 0) {
    console.log(`  Sealed ${newlySealed.length} previously unsealed record(s).`);
  }
  if (refreshEvents) console.log('  Event digests regenerated.');
  console.log(`  ${verified.length} records verified untouched.`);
}
