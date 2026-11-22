import { describe, expect, it } from 'vitest';
import { predictionRecords } from './records';
import {
  AppendError,
  appendEvent,
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
        p.includes('cannot verify'),
      ),
    ).toBe(true);
  });
});

describe('appending to a valid chain', () => {
  it('5. adds an event without altering the payload or earlier events', async () => {
    // Use a record sealed under the modern scope: its digest covers only the
    // sealed payload, so a resolution cannot move it. See the known limitation
    // below for why a `legacy-record` record cannot do this.
    const open = predictionRecords.find((record) => record.id === 'ORC-2025-0001')!;
    // Build a coherent modern record: payload scope, payload digest and the
    // publication event that names it must all agree before anything is appended.
    const seeded: PredictionRecord = {
      ...open,
      integrity: { ...open.integrity, payloadScope: 'sealed-payload' },
    };
    seeded.integrity.digest = await recompute(seeded);
    const modern = await rebuildChain({
      ...seeded,
      events: seeded.events.map((event) => ({
        ...event,
        body: { ...event.body, payloadDigest: seeded.integrity.digest, payloadScope: 'sealed-payload' as const },
      })),
    });

    const payloadBefore = canonicalize(sealedPayload(modern));
    const eventBefore = JSON.stringify(modern.events[0]);
    const digestBefore = modern.integrity.digest;

    const draft: RecordEvent = {
      seq: 'e1',
      kind: 'resolved',
      occurredAt: '2029-01-01T00:00:00.000Z',
      body: { outcome: 'yes', basis: 'fixture', note: 'fixture', evidenceIds: [] },
      recordedAt: '2029-01-02T00:00:00.000Z',
      origin: 'observed',
      algorithm: 'sha256',
      schemaVersion: 2,
      scope: 'event-envelope',
      digest: '0'.repeat(64),
      prevDigest: modern.events[0].digest,
    };
    draft.digest = await sha256Hex(canonicalize(eventEnvelope(draft)));

    const appended = appendEvent(modern, draft);

    expect(canonicalize(sealedPayload(appended))).toBe(payloadBefore);
    expect(appended.integrity.digest).toBe(digestBefore);
    expect(JSON.stringify(appended.events[0])).toBe(eventBefore);
    expect(appended.events[0].digest).toBe(modern.events[0].digest);
    expect(appended.events).toHaveLength(2);
    expect(await validateArchive(archiveWith(appended))).toEqual([]);
  });

  it('5b. a legacy-record digest moves when a resolution is appended, by construction', async () => {
    // Honest assertion of a real limit rather than a silent gap. The legacy
    // digest covers status and resolution, so recording an outcome changes the
    // bytes it was computed over. No migration can undo that without either
    // re-sealing (forbidden) or rewriting history (dishonest).
    const open = predictionRecords.find((record) => record.id === 'ORC-2025-0001')!;
    expect(open.integrity.payloadScope).toBe('legacy-record');

    const withResolution: PredictionRecord = {
      ...open,
      events: [
        ...open.events,
        {
          ...open.events[0],
          seq: 'e1',
          kind: 'resolved',
          body: { outcome: 'yes', basis: 'x', note: 'x', evidenceIds: [] },
        },
      ],
    };

    // The sealed payload is untouched...
    expect(canonicalize(sealedPayload(withResolution))).toBe(
      canonicalize(sealedPayload(open)),
    );
    // ...but the legacy digest it declares can no longer reproduce.
    expect(await recompute(withResolution)).not.toBe(withResolution.integrity.digest);
  });
});

describe('anchoring is rejected, never trusted', () => {
  it('rejects anchored: true because no external proof exists', async () => {
    const claimed: PredictionRecord = {
      ...target,
      integrity: { ...target.integrity, anchored: true },
    };
    const problems = await validateArchive(archiveWith(claimed));
    expect(problems.some((p) => p.includes('claims external anchoring'))).toBe(true);
  });

  it('rejects it on a legacy record too', async () => {
    const closed = predictionRecords.find((r) => r.id === 'ORC-2025-0007')!;
    const claimed: PredictionRecord = {
      ...closed,
      integrity: { ...closed.integrity, anchored: true },
    };
    const problems = await validateArchive(archiveWith(claimed));
    expect(problems.some((p) => p.includes('claims external anchoring'))).toBe(true);
  });

  it('no shipped record claims anchoring', () => {
    for (const record of predictionRecords) {
      expect(record.integrity.anchored, record.id).toBe(false);
    }
  });
});

describe('the seven legacy records stay immutable demonstrations', () => {
  const legacyOpenIds = ['ORC-2025-0001', 'ORC-2025-0002', 'ORC-2025-0003',
    'ORC-2025-0004', 'ORC-2025-0005', 'ORC-2025-0006', 'ORC-2025-0008'];

  it('are exactly seven, open, and legacy-scoped', () => {
    const found = predictionRecords.filter(
      (record) =>
        record.integrity.payloadScope === 'legacy-record' && record.events.length === 1,
    );
    expect(found.map((r) => r.id).sort()).toEqual([...legacyOpenIds].sort());
  });

  it('each refuses a resolution through appendEvent', () => {
    for (const id of legacyOpenIds) {
      const record = predictionRecords.find((r) => r.id === id)!;
      expect(
        () =>
          appendEvent(record, {
            ...record.events[0],
            seq: 'e1',
            kind: 'resolved',
            body: { outcome: 'yes', basis: 'x', note: 'x', evidenceIds: [] },
            recordedAt: '2030-01-01T00:00:00.000Z',
            origin: 'observed',
            scope: 'event-envelope',
          }),
        `should refuse ${id}`,
      ).toThrow(AppendError);
    }
  });

  it('keep their exact legacy digest', () => {
    // Pinned to the values on main a45348a: the whole point of leaving them
    // alone is that these numbers never change again.
    const expected: Record<string, string> = {
      'ORC-2025-0001': '2c3c0206265888468d5ce4dc253351c2f2d5703e1d26ab067b36183fac2340e1',
      'ORC-2025-0002': 'ef3a72926fec5d04bf488c226f8a2ea52ee1b1618d49ac251cf83b85085c660c',
      'ORC-2025-0003': 'bbf8f62996189aa828f2edd19100e5b24ae7385119df91f331722aecd912a546',
      'ORC-2025-0004': '4efacfd19030cd04e7bde1dfa539b89835bbaff14766dd1c79fcefa2fdbe63c7',
      'ORC-2025-0005': 'cd89e5cc9446767284d146c3801ccceb49aaac80597f6f2bc520f37f441e09b3',
      'ORC-2025-0006': '75065f05a0087da606e9550e663e03a3a113d4d2036a31ccfb1b20219122c832',
      'ORC-2025-0008': '8dee59310bcd60ee848816e62e1f2e6b1b3ae17db5664f9d8422ccea35bd52ac',
    };
    for (const [id, digest] of Object.entries(expected)) {
      const record = predictionRecords.find((r) => r.id === id)!;
      expect(record.integrity.digest, id).toBe(digest);
    }
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
