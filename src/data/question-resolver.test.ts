import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALIAS_TABLE,
  resolveCanonicalQuestion,
} from './question-resolver.ts';
import { compareIdentities } from './canonical-identity.ts';
import { predictionRecords } from './records.ts';

describe('Centralized Canonical Question Resolver & Abstention Engine', () => {
  const fixedNow = new Date('2026-06-01T00:00:00Z');

  it('produces identical canonical identity and identityDigest for equivalent phrasings across aliases', async () => {
    const q1 = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW in 2028 according to the IEA?',
      { now: fixedNow },
    );
    const q2 = await resolveCanonicalQuestion(
      'According to the International Energy Agency, will worldwide grid battery storage pass 1200 gigawatts by 2028?',
      { now: fixedNow },
    );

    expect(q1.identityComplete).toBe(true);
    expect(q2.identityComplete).toBe(true);
    expect(q1.unresolvedComponents).toEqual([]);
    expect(q2.unresolvedComponents).toEqual([]);
    expect(q1.identity).toEqual(q2.identity);
    expect(q1.identityDigest).toBe(q2.identityDigest);
    expect(
      compareIdentities(q1.identity, q2.identity, DEFAULT_ALIAS_TABLE).outcome,
    ).toBe('equivalent');
  });

  it('produces distinct canonical identities when threshold, horizon, or deciding authority differs', async () => {
    const base = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW in 2028 according to the IEA?',
      { now: fixedNow },
    );
    const diffThreshold = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,500 GW in 2028 according to the IEA?',
      { now: fixedNow },
    );
    const diffHorizon = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW in 2030 according to the IEA?',
      { now: fixedNow },
    );

    expect(base.identityDigest).not.toBe(diffThreshold.identityDigest);
    expect(base.identityDigest).not.toBe(diffHorizon.identityDigest);
    expect(
      compareIdentities(base.identity, diffThreshold.identity, DEFAULT_ALIAS_TABLE)
        .outcome,
    ).toBe('distinct');
    expect(
      compareIdentities(base.identity, diffHorizon.identity, DEFAULT_ALIAS_TABLE)
        .outcome,
    ).toBe('distinct');
  });

  it('abstains when deciding authority, horizon, or quantitative threshold is missing or ambiguous', async () => {
    const missingAuth = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW before 2029?',
      { now: fixedNow },
    );
    expect(missingAuth.identityComplete).toBe(false);
    expect(missingAuth.unresolvedComponents).toContain('decidingAuthority');
    expect(missingAuth.autonomousDecision).toBe('abstain');
    expect(missingAuth.abstentionReasons.join(' ')).toMatch(/decidingAuthority/);

    const vagueQuery = await resolveCanonicalQuestion(
      'Will artificial intelligence improve society significantly soon?',
      { now: fixedNow },
    );
    expect(vagueQuery.identityComplete).toBe(false);
    expect(vagueQuery.autonomousDecision).toBe('abstain');
    expect(vagueQuery.unresolvedComponents).toEqual(
      expect.arrayContaining([
        'subject',
        'event',
        'condition',
        'geographicScope',
        'horizon',
        'resolutionDate',
        'decidingAuthority',
      ]),
    );
  });

  it('abstains even when identity is complete if primary evidence and calibrated probability are absent', async () => {
    const resolved = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW in 2028 according to the IEA?',
      { now: fixedNow },
    );
    expect(resolved.identityComplete).toBe(true);
    // Exploratory query has no probability, rationale, or evidence bundle yet -> must abstain
    expect(resolved.evaluation.eligible).toBe(false);
    expect(resolved.autonomousDecision).toBe('abstain');
    expect(resolved.abstentionReasons.join(' ')).toMatch(
      /probability-in-range|recorded-evidence/,
    );
  });

  it('returns deduplicated-official when an official prediction already exists for the canonical identity', async () => {
    const officialMock = {
      ...predictionRecords[0]!,
      id: 'ORC-2026-0001',
      demo: false,
    };
    const resolved = await resolveCanonicalQuestion(
      'Will global battery storage exceed 1,200 GW in 2028 according to the IEA?',
      {
        now: fixedNow,
        existingOfficialRecord: officialMock,
      },
    );
    expect(resolved.autonomousDecision).toBe('deduplicated-official');
    expect(resolved.existingOfficialRecord?.id).toBe('ORC-2026-0001');
    expect(resolved.existingOfficialRecord?.demo).toBe(false);
  });
});
