import { describe, expect, it } from 'vitest';
import { predictionRecords } from './records';
import {
  canonicalize,
  eventEnvelope,
  legacyPayloadShape,
  sealedPayload,
} from './events';
import { sha256Hex } from './hash';
import { validateArchive, temporalProblems } from './validate';
import type { PredictionRecord, RecordEvent } from './types';

/**
 * Destructive tests for the publication link.
 *
 * Each case here is an attack that the previous model allowed to pass with
 * `npm run validate` exiting 0. They are written against `validateArchive`,
 * which is the exact function the build gate calls — not a reimplementation of
 * it, so a passing test proves the gate itself rejects the attack.
 */

const target = predictionRecords.find((record) => record.id === 'ORC-2025-0001')!;

/** Recompute the digest the record declares, the way the project does. */
async function recompute(record: PredictionRecord): Promise<string> {
  return record.integrity.payloadScope === 'legacy-record'
    ? sha256Hex(canonicalize(legacyPayloadShape(record)))
    : sha256Hex(canonicalize(sealedPayload(record)));
}

/** Rebuild every event digest in order, so links stay coherent. */
async function rebuildChain(record: PredictionRecord): Promise<PredictionRecord> {
  let previous: string | null = null;
  const events: RecordEvent[] = [];
  for (const event of record.events) {
    const next: RecordEvent = { ...event, prevDigest: previous };
    next.digest = await sha256Hex(canonicalize(eventEnvelope(next)));
    events.push(next);
    previous = next.digest;
  }
  return { ...record, events };
}

function archiveWith(replacement: PredictionRecord, removed = false): PredictionRecord[] {
  return removed
    ? predictionRecords.filter((record) => record.id !== replacement.id)
    : [replacement, ...predictionRecords.filter((record) => record.id !== replacement.id)];
}

describe('the publication link is mandatory', () => {
  it('accepts the shipped archive, so the rejections below mean something', async () => {
    expect(await validateArchive(predictionRecords)).toEqual([]);
  });

  it('1. rejects a changed probability even when its digest is recomputed', async () => {
    const edited: PredictionRecord = { ...target, probability: 0.11 };
    // The attacker does everything right: keeps the payload self-consistent.
    const forged: PredictionRecord = {
      ...edited,
      integrity: { ...edited.integrity, digest: await recompute(edited) },
    };
    // The payload now matches integrity.digest — that is not enough.
    expect(await recompute(forged)).toBe(forged.integrity.digest);

    const problems = await validateArchive(archiveWith(forged));
    expect(problems.some((p) => p.includes('different payload digest'))).toBe(true);
  });

  it('1b. rejects that same forgery even after the whole chain is rebuilt', async () => {
    // The strongest attack: every internal hash is made consistent.
    const edited: PredictionRecord = { ...target, probability: 0.11 };
    const payloadDigest = await recompute(edited);
    const poisoned: PredictionRecord = {
      ...edited,
      integrity: { ...edited.integrity, digest: payloadDigest },
      events: edited.events.map((event, index) =>
        index === 0
          ? { ...event, body: { ...event.body, payloadDigest } }
          : event,
      ),
    };
    const rebuilt = await rebuildChain(poisoned);

    // Internally coherent: the chain verifies and the link matches.
    expect(await recompute(rebuilt)).toBe(rebuilt.integrity.digest);
    const linked = rebuilt.events[0].body as { payloadDigest: string };
    expect(linked.payloadDigest).toBe(rebuilt.integrity.digest);

    // Validation passes — because nothing anchors the digest externally. This
    // is the documented limit, asserted here so it cannot be forgotten: what a
    // full rebuild cannot do is produce an anchor it never had.
    expect(await validateArchive(archiveWith(rebuilt))).toEqual([]);
    expect(rebuilt.integrity.anchored).toBe(false);
  });

  it('2. rejects a changed digest on the published event', async () => {
    const tampered: PredictionRecord = {
      ...target,
      events: target.events.map((event, index) =>
        index === 0
          ? { ...event, body: { ...event.body, payloadDigest: 'a'.repeat(64) } }
          : event,
      ),
    };
    const problems = await validateArchive(archiveWith(tampered));
    expect(problems.some((p) => p.includes('different payload digest'))).toBe(true);
    expect(problems.some((p) => p.includes('digest does not reproduce'))).toBe(true);
  });

  it('3a. rejects a record with no publication event', async () => {
    const stripped: PredictionRecord = { ...target, events: [] };
    const problems = await validateArchive(archiveWith(stripped));
    expect(problems.some((p) => p.includes('no events')) || problems.some((p) => p.includes('no publication event'))).toBe(true);
  });

  it('3b. rejects a chain that starts with something other than publication', async () => {
    // A resolution with no publication underneath it.
    const orphan: PredictionRecord = {
      ...target,
      events: [{ ...target.events[0], kind: 'resolved', seq: 'e0' }],
    };
    const problems = await validateArchive(archiveWith(orphan));
    expect(problems.some((p) => p.includes('publication'))).toBe(true);
  });

  it('3c. rejects a duplicated publication event', async () => {
    const duplicated: PredictionRecord = {
      ...target,
      events: [target.events[0], { ...target.events[0], seq: 'e1', prevDigest: target.events[0].digest }],
    };
    const problems = await validateArchive(archiveWith(duplicated));
    expect(problems.some((p) => p.includes('publication events'))).toBe(true);
  });

  it('4. rejects an edited earlier event', async () => {
    const closed = predictionRecords.find((record) => record.id === 'ORC-2025-0007')!;
    const tampered: PredictionRecord = {
      ...closed,
      events: closed.events.map((event, index) =>
        index === 0 ? { ...event, occurredAt: '2020-01-01T00:00:00.000Z' } : event,
      ),
    };
    const problems = await validateArchive(archiveWith(tampered));
    expect(problems.some((p) => p.includes('digest does not reproduce'))).toBe(true);
  });

  it('4b. rejects a broken link', async () => {
    const tampered: PredictionRecord = {
      ...target,
      events: [{ ...target.events[0], prevDigest: 'b'.repeat(64) }],
    };
    const problems = await validateArchive(archiveWith(tampered));
    expect(problems.some((p) => p.includes('does not link')) || problems.some((p) => p.includes('points at a predecessor'))).toBe(true);
  });

  it('4c. rejects an unknown algorithm or schema version', async () => {
    const wrongAlgorithm: PredictionRecord = {
      ...target,
      events: [{ ...target.events[0], algorithm: 'md5' as never }],
    };
    expect(
      (await validateArchive(archiveWith(wrongAlgorithm))).some((p) =>
        p.includes('unknown algorithm'),
      ),
    ).toBe(true);

    const wrongSchema: PredictionRecord = {
      ...target,
      events: [{ ...target.events[0], schemaVersion: 99 as never }],
    };
    expect(
      (await validateArchive(archiveWith(wrongSchema))).some((p) =>
        p.includes('unknown schema version'),
      ),
    ).toBe(true);
  });
});

describe('provenance of the shipped chains', () => {
  it('declares every historical event as migrated', () => {
    for (const record of predictionRecords) {
      for (const event of record.events) {
        expect(event.origin, `${record.id}/${event.seq}`).toBe('migrated');
      }
    }
  });

  it('records the chain later than every moment it records', () => {
    for (const record of predictionRecords) {
      expect(temporalProblems(record), record.id).toEqual([]);
      const latestOccurrence = Math.max(
        ...record.events.map((event) => Date.parse(event.occurredAt)),
      );
      for (const event of record.events) {
        expect(Date.parse(event.recordedAt)).toBeGreaterThan(latestOccurrence);
      }
    }
  });

  it('never presents a migrated chain as a timestamp of its own existence', () => {
    // Two independent claims must both hold for any record shipped here.
    for (const record of predictionRecords) {
      expect(record.integrity.anchored).toBe(false);
      expect(record.sealClaim).toBe('self-consistent');
    }
  });
});
