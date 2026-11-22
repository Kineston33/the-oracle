#!/usr/bin/env node
/**
 * Validate the archive before it is built or published.
 *
 * Runs the same rules the test suite exercises, but against the records that
 * actually ship — so a duplicate canonical question cannot reach production
 * just because nobody ran the tests.
 *
 * Wired into `npm run build` and `npm run seal`. Exits non-zero on any problem.
 *
 * Node 22 can import the TypeScript module directly. `validate.ts` imports no
 * JSON and no DOM, which is why this works without a bundler.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { assertArchiveShape, findCanonicalCollisions } from '../src/data/validate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordsPath = path.join(root, 'src', 'data', 'records.json');

const records = JSON.parse(await readFile(recordsPath, 'utf8'));
const problems = assertArchiveShape(records);

if (problems.length > 0) {
  console.error(`\n  Archive validation failed — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`    · ${problem}`);
  console.error('\n  Refusing to continue. Fix the records, then re-run.\n');
  process.exit(1);
}

const collisions = findCanonicalCollisions(records);
const unique = new Set(records.map((record) => record.canonicalQuestion)).size;

console.log(
  `  Archive valid: ${records.length} records, ${unique} canonical questions, ` +
    `${collisions.length} collisions.`,
);
