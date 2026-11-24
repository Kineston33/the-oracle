import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AliasTable,
  canonicalIdentity,
  compareIdentities,
  identityDigest,
  normalizeTermValue,
  term,
  unresolvedTerm,
  type AliasEntry,
} from './canonical-identity';
import {
  CANDIDATE_CONTENT_SCHEMA,
  InMemoryRegistry,
  InvalidClockError,
  TransitionError,
  advance,
  advanceCandidate,
  buildSealedPredictionRecord,
  canTransition,
  candidateContentDigest,
  evaluateCandidate,
  isPublishable,
  isValidIsoDateTime,
  isVerifiedEligibleCandidate,
  parseIsoDateTimeMs,
  publicationRequestDigest,
  publishCandidate,
  qualifyCandidate,
  validateOfficialArchive,
  validateOfficialRecord,
  verdictIsComplete,
  type PublicationDeps,
} from './publication';
import {
  EVALUATION_REQUIREMENTS,
  LIFECYCLE,
  PUBLISHABLE_STAGE,
  TERMINAL_STAGES,
  type CandidateProposition,
  type PropositionIdentity,
  type PublicationRequest,
} from './publication-types';
import { predictionRecords } from './records';
import { appendEvent, canonicalize, payloadBytes, sealedPayload } from './events';
import { sha256Hex } from './hash';
import { validateArchive } from './validate';
import type { PredictionRecord, RecordEvent } from './types';

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

/**
 * Argentina winning the 2030 World Cup, expressed as identifiers rather than
 * prose. Both phrasings below map to this identity only because an alias table
 * says `albiceleste` and `fifa-argentina` are the same team.
 */
function argentinaWins2030(): PropositionIdentity {
  return {
    subject: term('team', 'fifa-argentina'),
    event: term('outcome', 'win-tournament'),
    condition: term('literal', 'outright-winner'),
    geographicScope: term('scope', 'global'),
    horizon: term('period', '2030'),
    resolutionDate: '2031-01-15T00:00:00.000Z',
    decidingAuthority: term('dataset', 'fifa-official-results'),
  };
}

function argentinaReachesFinal(): PropositionIdentity {
  return { ...argentinaWins2030(), event: term('outcome', 'reach-final') };
}

const ALIASES: AliasEntry[] = [
  {
    namespace: 'team',
    canonical: 'fifa-argentina',
    aliases: ['fifa-argentina', 'albiceleste', 'argentina'],
  },
  {
    namespace: 'outcome',
    canonical: 'win-tournament',
    aliases: ['win-tournament', 'become-world-champions', 'win-the-cup'],
  },
];

function aliasTable(): AliasTable {
  return new AliasTable(ALIASES);
}

/**
 * Construct an unattested candidate object literal.
 *
 * Used to test raw drafts or manually forged stages (`stage: 'eligible-for-publication'`)
 * that have NOT passed through `advanceCandidate` / `qualifyCandidate`.
 */
function rawCandidate(overrides: Partial<CandidateProposition> = {}): CandidateProposition {
  return {
    candidateId: 'cand-1',
    submittedQuery: 'will argentina win the 2030 world cup?',
    proposedQuestion: 'Will Argentina win the 2030 FIFA World Cup?',
    proposedIdentity: argentinaWins2030(),
    category: 'society',
    probability: 0.18,
    rationale:
      'Historical base rates for tournament favourites of this strength, adjusted for squad age.',
    horizon: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2030-12-31T00:00:00.000Z',
      label: 'By the end of 2030',
    },
    resolutionCriteria: {
      resolveOn: '2031-01-15T00:00:00.000Z',
      rule: 'FIFA lists Argentina as the tournament winner.',
      authority: 'FIFA official tournament record',
      edgeCases: ['Awarded title after a disciplinary process counts as a win.'],
    },
    evidence: [
      {
        id: 'ev-1',
        title: 'FIFA world ranking, October 2026',
        publisher: 'FIFA',
        publishedAt: '2026-10-20T00:00:00.000Z',
        kind: 'dataset',
        note: 'Ranking position at the time of publication.',
      },
    ],
    disclosedLimitations: [
      'Squad composition is unknown this far ahead.',
      'The base rate is drawn from a small number of tournaments.',
    ],
    inferences: [
      {
        component: 'falsifiability-review',
        value: 'reviewed',
        rule: 'falsifiability-review',
      },
    ],
    stage: 'candidate-proposition',
    createdAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Construct a candidate that has genuinely stepped through the lifecycle
 * (`candidate-proposition → identity-matching → evaluation → eligible-for-publication`)
 * when valid, or an unattested candidate when overrides deliberately break
 * evaluation/identity/stage to exercise defense-in-depth checks.
 */
function validCandidate(overrides: Partial<CandidateProposition> = {}): CandidateProposition {
  const draft = rawCandidate({ stage: 'candidate-proposition', ...overrides });
  if (overrides.stage !== undefined && overrides.stage !== 'eligible-for-publication') {
    return draft;
  }
  try {
    return qualifyCandidate({ ...draft, stage: 'candidate-proposition' }, aliasTable());
  } catch {
    return { ...draft, stage: overrides.stage ?? 'eligible-for-publication' };
  }
}

/**
 * Synchronously compute the exact same versioned digest as
 * `await candidateContentDigest(candidate, aliasTable())` for test fixtures.
 */
function syncCandidateDigest(candidate: CandidateProposition): string {
  const body = canonicalize({
    candidateId: candidate.candidateId,
    submittedQuery: candidate.submittedQuery,
    proposedQuestion: candidate.proposedQuestion,
    proposedIdentity: canonicalIdentity(candidate.proposedIdentity, aliasTable()),
    category: candidate.category,
    probability: candidate.probability,
    rationale: candidate.rationale,
    horizon: candidate.horizon,
    resolutionCriteria: candidate.resolutionCriteria,
    evidence: candidate.evidence,
    disclosedLimitations: candidate.disclosedLimitations,
    inferences: candidate.inferences,
  });
  return createHash('sha256')
    .update(`${CANDIDATE_CONTENT_SCHEMA}\n${body}`, 'utf8')
    .digest('hex');
}

function request(
  overrides: Partial<PublicationRequest> = {},
  forCandidate: CandidateProposition = rawCandidate(),
): PublicationRequest {
  return {
    candidateId: forCandidate.candidateId,
    idempotencyKey: 'key-1',
    identity: forCandidate.proposedIdentity,
    candidateDigest: syncCandidateDigest(forCandidate),
    requestedAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

function deps(
  registry = new InMemoryRegistry(),
  overrides: Partial<PublicationDeps> = {},
): PublicationDeps {
  let step = 0;
  return {
    registry,
    aliases: aliasTable(),
    now: () => new Date(Date.UTC(2026, 10, 22, 0, 0, step++)).toISOString(),
    newPredictionId: (digest) =>
      `ORC-2030-${(parseInt(digest.slice(0, 4), 16) % 10000).toString().padStart(4, '0')}`,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
   1. Lifecycle
   ------------------------------------------------------------------------- */

describe('lifecycle stages', () => {
  it('lets an exploratory query become a candidate, and nothing else', () => {
    expect(canTransition('exploratory-query', 'candidate-proposition')).toBe(true);
    expect(canTransition('exploratory-query', 'officially-published')).toBe(false);
    expect(canTransition('exploratory-query', 'evaluation')).toBe(false);
  });

  it('reaches publication only through evaluation and eligibility', () => {
    // Enumerate every simple path from the entry stage and assert that none of
    // them skips a gate. "Publication is reachable" is the weak claim; "every
    // route to it passes both gates" is the one that matters.
    const paths: string[][] = [];
    const walk = (stage: string, trail: string[]): void => {
      if (stage === 'officially-published') {
        paths.push([...trail, stage]);
        return;
      }
      for (const next of LIFECYCLE[stage as keyof typeof LIFECYCLE]) {
        if (trail.includes(next)) continue; // no cycles in a simple path
        walk(next, [...trail, next]);
      }
    };
    walk('exploratory-query', ['exploratory-query']);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toContain('evaluation');
      expect(path).toContain('eligible-for-publication');
      // And the gate order is fixed, never reversed.
      expect(path.indexOf('evaluation')).toBeLessThan(
        path.indexOf('eligible-for-publication'),
      );
    }
  });

  it('refuses a transition that skips evaluation', () => {
    expect(() => advance('candidate-proposition', 'officially-published')).toThrow(
      /does not allow/,
    );
    expect(() => advance('exploratory-query', 'evaluation')).toThrow();
  });

  it('treats resolved and annulled as terminal', () => {
    expect(LIFECYCLE.resolved).toEqual([]);
    expect(LIFECYCLE.annulled).toEqual([]);
    expect(LIFECYCLE['rejected-candidate']).toEqual([]);
  });

  it('allows publication from exactly one stage', () => {
    const stages = Object.entries(LIFECYCLE)
      .filter(([, next]) => next.includes('officially-published'))
      .map(([stage]) => stage);
    expect(stages).toEqual(['eligible-for-publication']);
    expect(isPublishable('evaluation')).toBe(false);
  });
});

/* -------------------------------------------------------------------------
   2. Canonical identity
   ------------------------------------------------------------------------- */

describe('canonical identity', () => {
  it('resolves explicit aliases to the same canonical identity', async () => {
    const a: PropositionIdentity = argentinaWins2030();
    // Same proposition, different wording of the subject and the event.
    const b: PropositionIdentity = {
      ...argentinaWins2030(),
      subject: term('team', 'albiceleste'),
      event: term('outcome', 'become-world-champions'),
    };

    expect(compareIdentities(a, b).outcome).toBe('distinct'); // without the table
    expect(compareIdentities(a, b, aliasTable()).outcome).toBe('equivalent');
    expect(await identityDigest(a, aliasTable())).toBe(await identityDigest(b, aliasTable()));
  });

  it('keeps "reach the final" distinct from "win the tournament"', () => {
    const match = compareIdentities(
      argentinaWins2030(),
      argentinaReachesFinal(),
      aliasTable(),
    );
    expect(match.outcome).toBe('distinct');
    expect(match.because).toEqual(['event']);
  });

  it('treats different resolution dates as distinct propositions', () => {
    const moved: PropositionIdentity = {
      ...argentinaWins2030(),
      resolutionDate: '2031-06-01T00:00:00.000Z',
    };
    expect(compareIdentities(argentinaWins2030(), moved, aliasTable()).outcome).toBe('distinct');
  });

  it('treats different geographic scope as distinct', () => {
    const scoped: PropositionIdentity = {
      ...argentinaWins2030(),
      geographicScope: term('scope', 'south-america'),
    };
    expect(compareIdentities(argentinaWins2030(), scoped, aliasTable()).outcome).toBe('distinct');
  });

  it('treats different horizons as distinct', () => {
    const shifted: PropositionIdentity = {
      ...argentinaWins2030(),
      horizon: term('period', '2034'),
    };
    expect(compareIdentities(argentinaWins2030(), shifted, aliasTable()).outcome).toBe('distinct');
  });

  it('returns uncertain when a component does not resolve', () => {
    const vague: PropositionIdentity = {
      ...argentinaWins2030(),
      decidingAuthority: unresolvedTerm(),
    };
    const match = compareIdentities(argentinaWins2030(), vague, aliasTable());
    expect(match.outcome).toBe('uncertain');
    expect(match.because).toEqual(['decidingAuthority']);
  });

  it('refuses an alias table that maps to something outside its own list', () => {
    expect(
      () =>
        new AliasTable([
          { namespace: 'team', canonical: 'fifa-argentina', aliases: ['albiceleste'] },
        ]),
    ).toThrow(/not one of its aliases/);
  });

  it('refuses an alias table that maps one alias to two targets', () => {
    expect(
      () =>
        new AliasTable([
          { namespace: 'team', canonical: 'a', aliases: ['a', 'x'] },
          { namespace: 'team', canonical: 'b', aliases: ['b', 'x'] },
        ]),
    ).toThrow(/maps to both/);
  });

  it('normalises identifiers without destroying non-Latin scripts', () => {
    expect(normalizeTermValue('  FIFA-Argentina ')).toBe('fifa-argentina');
    expect(normalizeTermValue('Аргентина')).toBe('аргентина');
    expect(normalizeTermValue('日本')).toBe('日本');
  });

  it('produces a stable digest under a scheme prefix', async () => {
    const digest = await identityDigest(argentinaWins2030(), aliasTable());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // Same identity, second call: identical.
    expect(await identityDigest(argentinaWins2030(), aliasTable())).toBe(digest);
  });
});

/* -------------------------------------------------------------------------
   3. Evaluation
   ------------------------------------------------------------------------- */

describe('evaluation requirements', () => {
  it('accepts a complete candidate', () => {
    const verdict = evaluateCandidate(validCandidate());
    expect(verdict.eligible).toBe(true);
    expect(verdict.results.every((entry) => entry.passed)).toBe(true);
    expect(verdictIsComplete(verdict)).toBe(true);
  });

  it('reports every requirement exactly once', () => {
    const verdict = evaluateCandidate(validCandidate());
    expect(verdict.results.map((entry) => entry.id)).toEqual([...EVALUATION_REQUIREMENTS]);
  });

  it('rejects a candidate with no probability instead of assuming one', () => {
    const verdict = evaluateCandidate(validCandidate({ probability: null }));
    expect(verdict.eligible).toBe(false);
    const check = verdict.results.find((entry) => entry.id === 'probability-in-range')!;
    expect(check.passed).toBe(false);
    expect(check.reason).toMatch(/No probability/i);
  });

  it.each([0, 1, -0.1, 1.5, Number.NaN])('rejects probability %s', (value) => {
    const verdict = evaluateCandidate(validCandidate({ probability: value }));
    expect(verdict.results.find((entry) => entry.id === 'probability-in-range')!.passed).toBe(
      false,
    );
  });

  it('rejects a candidate with no evidence', () => {
    const verdict = evaluateCandidate(validCandidate({ evidence: [] }));
    expect(verdict.eligible).toBe(false);
    expect(
      verdict.results.find((entry) => entry.id === 'recorded-evidence')!.passed,
    ).toBe(false);
  });

  it('rejects evidence without provenance', () => {
    const verdict = evaluateCandidate(
      validCandidate({
        evidence: [
          {
            id: 'ev-x',
            title: '',
            publisher: '',
            publishedAt: '',
            kind: 'report',
            note: 'no source',
          },
        ],
      }),
    );
    expect(
      verdict.results.find((entry) => entry.id === 'preserved-evidence-provenance')!.passed,
    ).toBe(false);
  });

  it('rejects an unresolved deciding authority', () => {
    const identity: PropositionIdentity = {
      ...argentinaWins2030(),
      decidingAuthority: unresolvedTerm(),
    };
    const verdict = evaluateCandidate(validCandidate({ proposedIdentity: identity }));
    expect(verdict.eligible).toBe(false);
  });

  it('rejects a candidate that disclosed no limitations', () => {
    const verdict = evaluateCandidate(validCandidate({ disclosedLimitations: [] }));
    expect(verdict.eligible).toBe(false);
    expect(
      verdict.results.find((entry) => entry.id === 'disclosed-limitations')!.passed,
    ).toBe(false);
  });

  it('rejects a candidate with no falsifiability review', () => {
    const verdict = evaluateCandidate(validCandidate({ inferences: [] }));
    expect(verdict.eligible).toBe(false);
    expect(
      verdict.results.find((entry) => entry.id === 'falsifiable-proposition')!.passed,
    ).toBe(false);
  });

  it('explains why each failure failed', () => {
    const verdict = evaluateCandidate(
      validCandidate({ probability: null, evidence: [], rationale: null }),
    );
    for (const entry of verdict.results.filter((item) => !item.passed)) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------
   4. Publication
   ------------------------------------------------------------------------- */

describe('publication', () => {
  it('publishes an eligible candidate', async () => {
    const registry = new InMemoryRegistry();
    const outcome = await publishCandidate(validCandidate(), request(), deps(registry));
    expect(outcome.kind).toBe('created');
    expect(registry.size).toBe(1);
  });

  it('refuses to publish an exploratory query', async () => {
    const registry = new InMemoryRegistry();
    const outcome = await publishCandidate(
      validCandidate({ stage: 'exploratory-query' }),
      request(),
      deps(registry),
    );
    expect(outcome.kind).toBe('wrong-stage');
    expect(registry.size).toBe(0);
  });

  it('refuses to publish a rejected candidate', async () => {
    const registry = new InMemoryRegistry();
    const outcome = await publishCandidate(
      validCandidate({ stage: 'rejected-candidate' }),
      request(),
      deps(registry),
    );
    expect(outcome.kind).toBe('wrong-stage');
    expect(registry.size).toBe(0);
  });

  it('refuses to publish an invalid candidate', async () => {
    const registry = new InMemoryRegistry();
    const invalid = validCandidate({ probability: null });
    const outcome = await publishCandidate(
      invalid,
      request({}, invalid),
      deps(registry),
    );
    expect(outcome.kind).toBe('rejected');
    expect(registry.size).toBe(0);
  });

  it('refuses to publish when identity is uncertain', async () => {
    const registry = new InMemoryRegistry();
    const uncertain: PropositionIdentity = {
      ...argentinaWins2030(),
      subject: unresolvedTerm(),
    };
    const candidate = validCandidate({ proposedIdentity: uncertain });
    const outcome = await publishCandidate(
      candidate,
      request({ identity: uncertain }, candidate),
      deps(registry),
    );
    expect(outcome.kind).toBe('identity-conflict');
    expect(registry.size).toBe(0);
  });

  it('returns the existing record for a duplicate publication', async () => {
    const registry = new InMemoryRegistry();
    const first = await publishCandidate(validCandidate(), request({ idempotencyKey: 'k1' }), deps(registry));
    const secondCand = validCandidate({ candidateId: 'cand-2' });
    const second = await publishCandidate(
      secondCand,
      request({ candidateId: 'cand-2', idempotencyKey: 'k2' }, secondCand),
      deps(registry),
    );

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('existing');
    if (first.kind === 'created' && second.kind === 'existing') {
      expect(second.predictionId).toBe(first.predictionId);
    }
    expect(registry.size).toBe(1);
  });

  it('replays the original outcome for a repeated idempotency key', async () => {
    const registry = new InMemoryRegistry();
    const first = await publishCandidate(validCandidate(), request(), deps(registry));
    const replay = await publishCandidate(validCandidate(), request(), deps(registry));

    expect(replay.kind).toBe('replayed');
    if (replay.kind === 'replayed') {
      expect(replay.original).toEqual(first);
    }
    expect(registry.size).toBe(1);
  });

  it('keeps a rejected replay rejected instead of reshaping it', async () => {
    const registry = new InMemoryRegistry();
    const invalid = validCandidate({ probability: null });
    const request1 = request({ idempotencyKey: 'same' }, invalid);
    const rejected = await publishCandidate(invalid, request1, deps(registry));
    const replay = await publishCandidate(invalid, request1, deps(registry));

    expect(rejected.kind).toBe('rejected');
    expect(replay.kind).toBe('replayed');
    if (replay.kind === 'replayed') expect(replay.original.kind).toBe('rejected');
    expect(registry.size).toBe(0);
  });

  it('lets exactly one of two concurrent claims win', async () => {
    // The domain boundary can only prove the *contract*: the registry decides.
    // Two claims with the same digest, issued without awaiting the first, must
    // produce one winner and one loser that observes the winner.
    const registry = new InMemoryRegistry();
    const digest = await identityDigest(argentinaWins2030(), aliasTable());

    const [a, b] = await Promise.all([
      registry.claimIdentity(digest, 'ORC-A'),
      registry.claimIdentity(digest, 'ORC-B'),
    ]);

    const winners = [a, b].filter((entry) => entry.status === 'claimed');
    const losers = [a, b].filter((entry) => entry.status === 'already-claimed');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winnerId = winners[0].status === 'claimed' ? 'ORC-A' : 'ORC-B';
    const loser = losers[0];
    if (loser.status === 'already-claimed') {
      expect([winnerId, 'ORC-A', 'ORC-B']).toContain(loser.predictionId);
    }
    expect(registry.size).toBe(1);
  });

  it('never creates a second record for two concurrent publish calls', async () => {
    const registry = new InMemoryRegistry();
    const outcomes = await Promise.all([
      publishCandidate(validCandidate(), request({ idempotencyKey: 'c1' }), deps(registry)),
      publishCandidate(validCandidate(), request({ idempotencyKey: 'c2' }), deps(registry)),
    ]);

    expect(registry.size).toBe(1);
    expect(outcomes.filter((entry) => entry.kind === 'created')).toHaveLength(1);
  });

  it('marks an aliased phrasing as the same publication', async () => {
    const registry = new InMemoryRegistry();
    const first = await publishCandidate(validCandidate(), request({ idempotencyKey: 'a' }), deps(registry));

    // Same proposition, written with the alias identifiers.
    const rephrased = validCandidate({
      proposedQuestion: 'Will Argentina become world champions in 2030?',
      proposedIdentity: {
        ...argentinaWins2030(),
        subject: term('team', 'albiceleste'),
        event: term('outcome', 'become-world-champions'),
      },
    });
    const second = await publishCandidate(
      rephrased,
      request({ idempotencyKey: 'b', identity: rephrased.proposedIdentity }, rephrased),
      deps(registry),
    );

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('existing');
    expect(registry.size).toBe(1);
  });
});

/* -------------------------------------------------------------------------
   5. Existing integrity guarantees are untouched
   ------------------------------------------------------------------------- */

describe('the published archive is unaffected by this protocol', () => {
  it('still exposes exactly the ten historical records', () => {
    expect(predictionRecords).toHaveLength(10);
  });

  it('keeps every historical record demo and unanchored', () => {
    for (const record of predictionRecords) {
      expect(record.demo, record.id).toBe(true);
      expect(record.integrity.anchored, record.id).toBe(false);
    }
  });

  it('does not publish anything into the archive', async () => {
    // A full publication run against the in-memory registry must leave the real
    // archive untouched: there is no code path from here into records.json.
    const before = predictionRecords.map((record) => record.integrity.digest);
    await publishCandidate(validCandidate(), request(), deps());
    const after = predictionRecords.map((record) => record.integrity.digest);
    expect(after).toEqual(before);
  });
});

/* -------------------------------------------------------------------------
   6. What publication seals, and why resolution cannot rewrite it
   ------------------------------------------------------------------------- */

describe('the sealed payload', () => {
  /**
   * A synthetic `PredictionRecord`-shaped fixture, completely independent of
   * `records.json`, sealed under the `sealed-payload` scope.
   */
  function syntheticPublishedRecord(): PredictionRecord {
    return {
      id: 'ORC-2030-9999',
      canonicalQuestion: 'Will Argentina win the 2030 FIFA World Cup?',
      title: 'Argentina 2030 FIFA World Cup title',
      category: 'society',
      publishedAt: '2026-11-22T00:00:00.000Z',
      probability: 0.18,
      horizon: {
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2030-12-31T00:00:00.000Z',
        label: 'By the end of 2030',
      },
      resolutionCriteria: {
        resolveOn: '2031-01-15T00:00:00.000Z',
        rule: 'FIFA lists Argentina as the tournament winner.',
        authority: 'FIFA official tournament record',
        edgeCases: ['Awarded title after a disciplinary process counts as a win.'],
      },
      evidence: [
        {
          id: 'ev-1',
          title: 'FIFA world ranking, December 2029',
          publisher: 'FIFA',
          publishedAt: '2029-12-20T00:00:00.000Z',
          kind: 'dataset',
          note: 'Ranking position at the time of publication.',
        },
      ],
      demo: true,
      sealClaim: 'published-before-outcome',
      events: [
        {
          seq: 'e0',
          kind: 'published',
          occurredAt: '2026-11-22T00:00:00.000Z',
          recordedAt: '2026-11-22T00:00:01.000Z',
          origin: 'observed',
          algorithm: 'sha256',
          schemaVersion: 2,
          scope: 'event-envelope+published-payload',
          body: {
            payloadDigest: 'b'.repeat(64),
            payloadScope: 'sealed-payload',
            sealClaim: 'published-before-outcome',
            note: 'Synthetic initial publication.',
          },
          digest: 'c'.repeat(64),
          prevDigest: null,
        },
      ],
      integrity: {
        algorithm: 'SHA-256',
        digest: 'b'.repeat(64),
        payloadScope: 'sealed-payload',
        revision: 1,
        channel: 'public-archive',
        anchored: false,
      },
    };
  }

  function resolutionEvent(prevDigest: string): RecordEvent {
    return {
      seq: 'e1',
      kind: 'resolved',
      occurredAt: '2031-01-15T00:00:00.000Z',
      body: {
        outcome: 'yes',
        basis: 'Synthetic basis, used only to exercise the append rules.',
        note: 'Test fixture.',
        evidenceIds: [],
      },
      recordedAt: '2031-01-15T00:01:00.000Z',
      origin: 'observed',
      algorithm: 'sha256',
      schemaVersion: 2,
      scope: 'event-envelope',
      digest: 'a'.repeat(64),
      prevDigest,
    };
  }

  it('seals the probability at publication', () => {
    // If probability were not inside the sealed payload, changing it would be
    // undetectable and "fixed in advance" would be a slogan.
    const synthetic = syntheticPublishedRecord();
    expect(Object.keys(sealedPayload(synthetic))).toContain('probability');
  });

  it('detects any post-publication change to probability via the payload digest', async () => {
    const synthetic = syntheticPublishedRecord();
    const originalDigest = await sha256Hex(payloadBytes(synthetic));
    const tampered: PredictionRecord = { ...synthetic, probability: 0.72 };
    const tamperedDigest = await sha256Hex(payloadBytes(tampered));

    expect(tamperedDigest).not.toBe(originalDigest);
  });

  it('excludes the event chain, so resolution events do not mutate the original payload', async () => {
    const synthetic = syntheticPublishedRecord();
    const beforeBytes = payloadBytes(synthetic);
    const beforeDigest = await sha256Hex(beforeBytes);
    const resolved = appendEvent(synthetic, resolutionEvent(synthetic.events[0].digest));
    const afterBytes = payloadBytes(resolved);
    const afterDigest = await sha256Hex(afterBytes);

    expect(afterBytes).toEqual(beforeBytes);
    expect(afterDigest).toBe(beforeDigest);
    expect(resolved.probability).toBe(synthetic.probability);
    expect(resolved.events).toHaveLength(synthetic.events.length + 1);
  });

  it('excludes status and resolution by construction', () => {
    const keys = Object.keys(sealedPayload(syntheticPublishedRecord()));
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('resolution');
    expect(keys).not.toContain('events');
  });

  it('cannot be resolved twice in either direction', () => {
    const synthetic = syntheticPublishedRecord();
    const resolved = appendEvent(synthetic, resolutionEvent(synthetic.events[0].digest));
    const annulment: RecordEvent = {
      ...resolutionEvent(resolved.events[1].digest),
      seq: 'e2',
      kind: 'annulled',
    };
    expect(() => appendEvent(resolved, annulment)).toThrow(/final/);
  });

  it('ensures rejected candidates never appear as official predictions in the registry', async () => {
    const registry = new InMemoryRegistry();
    const digest = await identityDigest(argentinaWins2030(), aliasTable());

    const invalidCand = validCandidate({ probability: null, evidence: [] });
    const rejectedByEval = await publishCandidate(
      invalidCand,
      request({ idempotencyKey: 'rej-eval' }, invalidCand),
      deps(registry),
    );
    const rejectedStageCand = validCandidate({ stage: 'rejected-candidate' });
    const rejectedByStage = await publishCandidate(
      rejectedStageCand,
      request({ idempotencyKey: 'rej-stage' }, rejectedStageCand),
      deps(registry),
    );

    expect(rejectedByEval.kind).toBe('rejected');
    expect(rejectedByStage.kind).toBe('wrong-stage');
    expect(registry.size).toBe(0);
    expect(await registry.findByIdentity(digest)).toBeNull();
  });
});

/* -------------------------------------------------------------------------
   7. Protocol v1.1 integrity regression suite
   ------------------------------------------------------------------------- */

describe('protocol v1.1 integrity regressions', () => {
  // 1. Candidate ID mismatch
  it('rejects a candidateId mismatch before any registry lookup or mutation', async () => {
    const registry = new InMemoryRegistry();
    const candAlpha = validCandidate({ candidateId: 'cand-alpha' });
    const outcome = await publishCandidate(
      candAlpha,
      request({ candidateId: 'cand-beta', idempotencyKey: 'k-mismatch-id' }, candAlpha),
      deps(registry),
    );

    expect(outcome).toEqual({
      kind: 'candidate-mismatch',
      reason: 'candidate-id',
      detail: expect.stringContaining('cand-beta'),
    });
    expect(registry.size).toBe(0);
    expect(await registry.findByIdempotencyKey('k-mismatch-id', 'any')).toEqual({
      status: 'miss',
    });
  });

  // 2. Candidate identity versus request identity mismatch
  it('rejects a mismatch between candidate.proposedIdentity and request.identity before touching the registry', async () => {
    const registry = new InMemoryRegistry();
    // Candidate is about Argentina winning the tournament; request tries to claim
    // the identity for Argentina reaching the final.
    const outcome = await publishCandidate(
      validCandidate({ proposedIdentity: argentinaWins2030() }),
      request({
        identity: argentinaReachesFinal(),
        idempotencyKey: 'k-mismatch-identity',
      }),
      deps(registry),
    );

    expect(outcome.kind).toBe('candidate-mismatch');
    if (outcome.kind === 'candidate-mismatch') {
      expect(outcome.reason).toBe('proposed-identity');
      expect(outcome.match?.outcome).toBe('distinct');
      expect(outcome.match?.because).toEqual(['event']);
    }
    expect(registry.size).toBe(0);
    expect(await registry.findByIdempotencyKey('k-mismatch-identity', 'any')).toEqual({
      status: 'miss',
    });
  });

  // 3. Same idempotency key and same content
  it('replays the original outcome when the same idempotency key is reused with identical content', async () => {
    const registry = new InMemoryRegistry();
    const candidate = validCandidate();
    const req = request({ idempotencyKey: 'k-identical' }, candidate);

    const first = await publishCandidate(candidate, req, deps(registry));
    const second = await publishCandidate(candidate, req, deps(registry));

    expect(first.kind).toBe('created');
    expect(second).toEqual({ kind: 'replayed', original: first });
    expect(registry.size).toBe(1);
  });

  // 4. Same idempotency key and different content
  it('returns idempotency-conflict when the same key is reused with different candidate or request content', async () => {
    const registry = new InMemoryRegistry();
    const key = 'k-reused-diff';
    const candA = validCandidate({ probability: 0.18 });
    const candB = validCandidate({ probability: 0.42 });
    const first = await publishCandidate(
      candA,
      request({ idempotencyKey: key }, candA),
      deps(registry),
    );
    const second = await publishCandidate(
      candB,
      request({ idempotencyKey: key }, candB),
      deps(registry),
    );

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('idempotency-conflict');
    if (second.kind === 'idempotency-conflict') {
      expect(second.idempotencyKey).toBe(key);
      expect(second.existingRequestDigest).not.toBe(second.incomingRequestDigest);
    }
    expect(registry.size).toBe(1);
  });

  // 5. Concurrent same-key requests with different content
  it('prevents concurrent requests with the same idempotency key and different content from both publishing', async () => {
    const registry = new InMemoryRegistry();
    const sharedKey = 'k-concurrent-conflict';

    const candWin = validCandidate({
      candidateId: 'cand-win',
      proposedQuestion: 'Will Argentina win the 2030 FIFA World Cup?',
      proposedIdentity: argentinaWins2030(),
    });
    const candFinal = validCandidate({
      candidateId: 'cand-final',
      proposedQuestion: 'Will Argentina reach the 2030 FIFA World Cup final?',
      proposedIdentity: argentinaReachesFinal(),
    });

    const [outA, outB] = await Promise.all([
      publishCandidate(
        candWin,
        request(
          {
            candidateId: 'cand-win',
            idempotencyKey: sharedKey,
            identity: argentinaWins2030(),
          },
          candWin,
        ),
        deps(registry),
      ),
      publishCandidate(
        candFinal,
        request(
          {
            candidateId: 'cand-final',
            idempotencyKey: sharedKey,
            identity: argentinaReachesFinal(),
          },
          candFinal,
        ),
        deps(registry),
      ),
    ]);

    const kinds = [outA.kind, outB.kind].sort();
    expect(kinds).toEqual(['created', 'idempotency-conflict']);
    expect(registry.size).toBe(1);
  });

  // 6. Concurrent different-key requests with identical canonical identity
  it('elects one winner and returns existing for the loser when concurrent requests use different keys for the same canonical identity', async () => {
    const registry = new InMemoryRegistry();
    const cand1 = validCandidate({ candidateId: 'cand-1' });
    const cand2 = validCandidate({
      candidateId: 'cand-2',
      proposedQuestion: 'Will the Albiceleste become world champions in 2030?',
      proposedIdentity: {
        ...argentinaWins2030(),
        subject: term('team', 'albiceleste'),
        event: term('outcome', 'become-world-champions'),
      },
    });

    const [out1, out2] = await Promise.all([
      publishCandidate(
        cand1,
        request(
          { candidateId: 'cand-1', idempotencyKey: 'k-race-1', identity: cand1.proposedIdentity },
          cand1,
        ),
        deps(registry),
      ),
      publishCandidate(
        cand2,
        request(
          { candidateId: 'cand-2', idempotencyKey: 'k-race-2', identity: cand2.proposedIdentity },
          cand2,
        ),
        deps(registry),
      ),
    ]);

    const created = [out1, out2].filter((o) => o.kind === 'created');
    const existing = [out1, out2].filter((o) => o.kind === 'existing');
    expect(created).toHaveLength(1);
    expect(existing).toHaveLength(1);
    if (created[0].kind === 'created' && existing[0].kind === 'existing') {
      expect(existing[0].predictionId).toBe(created[0].predictionId);
      expect(existing[0].identityDigest).toBe(created[0].identityDigest);
    }
    expect(registry.size).toBe(1);
  });

  // 7. Forged 'eligible-for-publication' stage
  it('refuses to publish a manually forged eligible-for-publication stage that bypassed lifecycle transitions', async () => {
    const registry = new InMemoryRegistry();
    const forged = rawCandidate({ stage: PUBLISHABLE_STAGE });

    expect(isVerifiedEligibleCandidate(forged)).toBe(false);

    const outcome = await publishCandidate(
      forged,
      request({ idempotencyKey: 'k-forged' }, forged),
      deps(registry),
    );

    expect(outcome).toEqual({
      kind: 'wrong-stage',
      stage: 'eligible-for-publication',
      required: 'eligible-for-publication',
      reason: 'forged-stage',
      detail: expect.stringContaining('forged'),
    });
    expect(registry.size).toBe(0);
  });

  it('refuses to advance a manually forged intermediate stage or a cloned-and-modified qualified candidate', async () => {
    const forgedEvaluation = rawCandidate({ stage: 'evaluation' });
    expect(() =>
      advanceCandidate(forgedEvaluation, 'eligible-for-publication', aliasTable()),
    ).toThrow(TransitionError);

    expect(() =>
      qualifyCandidate(rawCandidate({ probability: null }), aliasTable()),
    ).toThrow(TransitionError);

    expect(() =>
      qualifyCandidate(
        rawCandidate({
          proposedIdentity: { ...argentinaWins2030(), subject: unresolvedTerm() },
        }),
        aliasTable(),
      ),
    ).toThrow(TransitionError);

    const legitimatelyQualified = validCandidate();
    expect(isVerifiedEligibleCandidate(legitimatelyQualified)).toBe(true);

    // Cloning a qualified candidate to alter its probability strips the WeakMap
    // attestation so it cannot publish.
    const clonedAndModified: CandidateProposition = {
      ...legitimatelyQualified,
      probability: 0.77,
    };
    expect(isVerifiedEligibleCandidate(clonedAndModified)).toBe(false);

    const registry = new InMemoryRegistry();
    const outcome = await publishCandidate(
      clonedAndModified,
      request({ idempotencyKey: 'k-cloned' }, clonedAndModified),
      deps(registry),
    );
    expect(outcome.kind).toBe('wrong-stage');
    if (outcome.kind === 'wrong-stage') {
      expect(outcome.reason).toBe('forged-stage');
    }
    expect(registry.size).toBe(0);
  });

  // 8. Invalid calendar dates
  it.each([
    '2026-02-29T00:00:00.000Z', // 2026 is not a leap year
    '2030-02-30T00:00:00.000Z', // Feb 30 never exists
    '2030-04-31T00:00:00.000Z', // April has 30 days
    '2030-13-01T00:00:00.000Z', // month 13
    '2030-00-15T00:00:00.000Z', // month 0
    '2030-01-32T00:00:00.000Z', // day 32
    '2030-01-15T24:00:00.000Z', // hour 24
    '2030-01-15T12:60:00.000Z', // minute 60
    '2030-01-15',               // date-only without UTC time
    'not-a-timestamp',
  ])('rejects impossible or malformed ISO date %s', (badDate) => {
    expect(isValidIsoDateTime(badDate)).toBe(false);
    expect(parseIsoDateTimeMs(badDate)).toBeNull();

    const badResolution = evaluateCandidate(
      rawCandidate({
        proposedIdentity: { ...argentinaWins2030(), resolutionDate: badDate },
        resolutionCriteria: {
          resolveOn: badDate,
          rule: 'FIFA lists Argentina as the tournament winner.',
          authority: 'FIFA official tournament record',
          edgeCases: [],
        },
      }),
    );
    expect(badResolution.eligible).toBe(false);
    expect(
      badResolution.results.find((r) => r.id === 'fixed-resolution-date')!.passed,
    ).toBe(false);

    const badHorizon = evaluateCandidate(
      rawCandidate({
        horizon: {
          startsAt: badDate,
          endsAt: '2030-12-31T00:00:00.000Z',
          label: 'By the end of 2030',
        },
      }),
    );
    expect(badHorizon.eligible).toBe(false);
    expect(badHorizon.results.find((r) => r.id === 'fixed-horizon')!.passed).toBe(false);
  });

  // 9. Reversed time horizons
  it('rejects reversed or zero-length time horizons', () => {
    const reversed = evaluateCandidate(
      rawCandidate({
        horizon: {
          startsAt: '2030-12-31T00:00:00.000Z',
          endsAt: '2026-01-01T00:00:00.000Z',
          label: 'Reversed window',
        },
      }),
    );
    expect(reversed.eligible).toBe(false);
    const horizonResult = reversed.results.find((r) => r.id === 'fixed-horizon')!;
    expect(horizonResult.passed).toBe(false);
    expect(horizonResult.reason).toMatch(/precede/i);

    const zeroLength = evaluateCandidate(
      rawCandidate({
        horizon: {
          startsAt: '2030-01-01T00:00:00.000Z',
          endsAt: '2030-01-01T00:00:00.000Z',
          label: 'Zero-length window',
        },
      }),
    );
    expect(zeroLength.results.find((r) => r.id === 'fixed-horizon')!.passed).toBe(false);
  });

  // 10. Resolution date inconsistent with the declared horizon or criteria
  it('rejects a resolution date that precedes the horizon end or disagrees with resolutionCriteria.resolveOn', () => {
    const beforeHorizonEnd = evaluateCandidate(
      rawCandidate({
        proposedIdentity: {
          ...argentinaWins2030(),
          resolutionDate: '2029-06-01T00:00:00.000Z',
        },
        resolutionCriteria: {
          resolveOn: '2029-06-01T00:00:00.000Z',
          rule: 'FIFA lists Argentina as the tournament winner.',
          authority: 'FIFA official tournament record',
          edgeCases: [],
        },
      }),
    );
    expect(beforeHorizonEnd.eligible).toBe(false);
    const check1 = beforeHorizonEnd.results.find((r) => r.id === 'fixed-resolution-date')!;
    expect(check1.passed).toBe(false);
    expect(check1.reason).toMatch(/cannot precede/i);

    const mismatchedCriteriaDate = evaluateCandidate(
      rawCandidate({
        proposedIdentity: {
          ...argentinaWins2030(),
          resolutionDate: '2031-01-15T00:00:00.000Z',
        },
        resolutionCriteria: {
          resolveOn: '2031-03-01T00:00:00.000Z',
          rule: 'FIFA lists Argentina as the tournament winner.',
          authority: 'FIFA official tournament record',
          edgeCases: [],
        },
      }),
    );
    expect(mismatchedCriteriaDate.eligible).toBe(false);
    const check2 = mismatchedCriteriaDate.results.find(
      (r) => r.id === 'fixed-resolution-date',
    )!;
    expect(check2.passed).toBe(false);
    expect(check2.reason).toMatch(/does not match/i);
  });

  // 11. TERMINAL_STAGES consistency with LIFECYCLE
  it('keeps TERMINAL_STAGES in exact agreement with LIFECYCLE', () => {
    const terminalFromLifecycle = Object.entries(LIFECYCLE)
      .filter(([, next]) => next.length === 0)
      .map(([stage]) => stage)
      .sort();
    expect([...TERMINAL_STAGES].sort()).toEqual(terminalFromLifecycle);
    expect(TERMINAL_STAGES).toEqual(['rejected-candidate', 'resolved', 'annulled']);
  });

  // 12. No rejected or conflicting candidate creates an official identity claim,
  // and a valid publication builds a complete validateOfficialRecord-clean PredictionRecord
  it('never claims an identity for any rejected, mismatched, forged, or conflicting request, and seals a valid official record when eligible', async () => {
    const registry = new InMemoryRegistry();
    const digest = await identityDigest(argentinaWins2030(), aliasTable());

    // Candidate ID mismatch
    await publishCandidate(
      validCandidate({ candidateId: 'cand-1' }),
      request({ candidateId: 'cand-other', idempotencyKey: 'k-1' }),
      deps(registry),
    );
    // Identity mismatch
    await publishCandidate(
      validCandidate(),
      request({ identity: argentinaReachesFinal(), idempotencyKey: 'k-2' }),
      deps(registry),
    );
    // Forged stage
    const forged = rawCandidate({ stage: 'eligible-for-publication' });
    await publishCandidate(
      forged,
      request({ idempotencyKey: 'k-3' }, forged),
      deps(registry),
    );
    // Uncertain identity
    const uncertain = { ...argentinaWins2030(), subject: unresolvedTerm() };
    const uncertainCand = validCandidate({ proposedIdentity: uncertain });
    await publishCandidate(
      uncertainCand,
      request({ identity: uncertain, idempotencyKey: 'k-4' }, uncertainCand),
      deps(registry),
    );
    // Evaluation failure
    const invalidCand = validCandidate({ probability: null });
    await publishCandidate(
      invalidCand,
      request({ idempotencyKey: 'k-5' }, invalidCand),
      deps(registry),
    );

    expect(registry.size).toBe(0);
    expect(await registry.findByIdentity(digest)).toBeNull();

    // Now publish a genuinely qualified candidate and verify the sealed official
    // record has demo: false and passes validateOfficialRecord with zero problems.
    const created = await publishCandidate(
      validCandidate(),
      request({ idempotencyKey: 'k-valid' }),
      deps(registry),
    );
    expect(created.kind).toBe('created');
    if (created.kind === 'created') {
      expect(created.record.demo).toBe(false);
      expect(await validateOfficialRecord(created.record)).toEqual([]);
      expect(created.record.integrity.payloadScope).toBe('sealed-payload');
      expect(created.record.sealClaim).toBe('published-before-outcome');
      expect(created.record.integrity.anchored).toBe(false);
    }

    // Also verify candidateContentDigest and publicationRequestDigest sensitivity
    const d1 = await candidateContentDigest(validCandidate({ probability: 0.18 }), aliasTable());
    const d2 = await candidateContentDigest(validCandidate({ probability: 0.19 }), aliasTable());
    expect(d1).not.toBe(d2);

    const r1 = await publicationRequestDigest(validCandidate(), request(), aliasTable());
    const r2 = await publicationRequestDigest(
      validCandidate(),
      request({ candidateDigest: 'b'.repeat(64) }),
      aliasTable(),
    );
    expect(r1).not.toBe(r2);

    const standaloneRecord = await buildSealedPredictionRecord(
      validCandidate(),
      'ORC-2030-0042',
      '2026-11-22T00:00:00.000Z',
      '2026-11-22T00:00:01.000Z',
    );
    expect(standaloneRecord.demo).toBe(false);
    expect(await validateOfficialRecord(standaloneRecord)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
   8. Protocol v1.2 publication semantics and transaction hardening
   ------------------------------------------------------------------------- */

describe('protocol v1.2 publication semantics and hardening', () => {
  // Requirement 2: Demo vs official record semantics
  describe('demo versus official record semantics', () => {
    it('constructs newly published official records with demo: false, never demo: true', async () => {
      const registry = new InMemoryRegistry();
      const outcome = await publishCandidate(
        validCandidate(),
        request({ idempotencyKey: 'k-nondemo' }),
        deps(registry),
      );
      expect(outcome.kind).toBe('created');
      if (outcome.kind === 'created') {
        expect(outcome.record.demo).toBe(false);
        expect(await validateOfficialRecord(outcome.record)).toEqual([]);
        expect(await validateOfficialArchive([outcome.record])).toEqual([]);
      }
    });

    it('distinguishes historical demo archive validation (demo: true) from official record validation (demo: false)', async () => {
      const officialRecord = await buildSealedPredictionRecord(
        validCandidate(),
        'ORC-2030-0101',
        '2026-11-22T00:00:00.000Z',
        '2026-11-22T00:00:01.000Z',
      );

      // The official validator accepts the non-demo record and rejects demo: true.
      expect(await validateOfficialRecord(officialRecord)).toEqual([]);
      const mislabelledAsDemo: PredictionRecord = { ...officialRecord, demo: true };
      const officialProblems = await validateOfficialRecord(mislabelledAsDemo);
      expect(officialProblems.some((p) => p.includes('demo: false'))).toBe(true);

      // Conversely, the protected historical demo-archive gate (`validateArchive`
      // in `src/data/validate.ts`) requires `demo: true` and therefore rejects
      // `officialRecord` while continuing to accept all 10 historical records.
      const demoGateOnOfficial = await validateArchive([officialRecord]);
      expect(demoGateOnOfficial).toContain(
        `Record ${officialRecord.id} is missing the demo flag`,
      );
      expect(await validateArchive(predictionRecords)).toEqual([]);
    });
  });

  // Requirement 3: Fix publication and recording timestamps (honest clock contract)
  describe('publication and recording clock contract', () => {
    it('uses the exact injected publishedAt and recordedAt timestamps without synthesizing +1ms', async () => {
      const registry = new InMemoryRegistry();
      const outcome = await publishCandidate(
        validCandidate(),
        request({ idempotencyKey: 'k-clock-exact' }),
        deps(registry, {
          now: () => '2026-11-22T09:15:00.000Z',
          recordedAt: () => '2026-11-22T09:15:07.500Z',
        }),
      );

      expect(outcome.kind).toBe('created');
      if (outcome.kind === 'created') {
        expect(outcome.record.publishedAt).toBe('2026-11-22T09:15:00.000Z');
        expect(outcome.record.events[0].occurredAt).toBe('2026-11-22T09:15:00.000Z');
        expect(outcome.record.events[0].recordedAt).toBe('2026-11-22T09:15:07.500Z');
      }
    });

    it.each([
      ['invalid publishedAt', () => 'not-a-timestamp', () => '2026-11-22T00:00:05.000Z'],
      ['impossible calendar publishedAt', () => '2026-02-29T00:00:00.000Z', () => '2026-11-22T00:00:05.000Z'],
      ['invalid recordedAt', () => '2026-11-22T00:00:00.000Z', () => 'bad-recorded-at'],
      ['non-increasing (equal) timestamps', () => '2026-11-22T00:00:00.000Z', () => '2026-11-22T00:00:00.000Z'],
      ['decreasing timestamps (recordedAt < publishedAt)', () => '2026-11-22T00:00:05.000Z', () => '2026-11-22T00:00:01.000Z'],
    ])('fails without committing when the injected clock provides %s', async (_label, nowFn, recFn) => {
      const registry = new InMemoryRegistry();
      const outcome = await publishCandidate(
        validCandidate(),
        request({ idempotencyKey: 'k-bad-clock' }),
        deps(registry, { now: nowFn, recordedAt: recFn }),
      );

      expect(outcome.kind).toBe('invalid-clock');
      expect(registry.size).toBe(0);
    });

    it('rejects a static single-function clock that returns the same timestamp on both reads', async () => {
      const registry = new InMemoryRegistry();
      const outcome = await publishCandidate(
        validCandidate(),
        request({ idempotencyKey: 'k-static-clock' }),
        deps(registry, { now: () => '2026-11-22T00:00:00.000Z' }),
      );

      expect(outcome.kind).toBe('invalid-clock');
      expect(registry.size).toBe(0);
    });

    it('throws InvalidClockError from buildSealedPredictionRecord on invalid or non-increasing timestamps', async () => {
      await expect(
        buildSealedPredictionRecord(
          validCandidate(),
          'ORC-2030-0001',
          '2026-11-22T00:00:00.000Z',
          '2026-11-22T00:00:00.000Z',
        ),
      ).rejects.toThrow(InvalidClockError);

      await expect(
        buildSealedPredictionRecord(
          validCandidate(),
          'ORC-2030-0001',
          'invalid',
          '2026-11-22T00:00:01.000Z',
        ),
      ).rejects.toThrow(InvalidClockError);
    });
  });

  // Requirement 4: Prevent publication after the forecast horizon
  describe('forecast horizon enforcement at publication time', () => {
    it('allows publication strictly before horizon.endsAt', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate(); // horizon.endsAt is 2030-12-31T00:00:00.000Z
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-before-horizon' }, candidate),
        deps(registry, {
          now: () => '2030-12-30T23:59:59.000Z',
          recordedAt: () => '2030-12-30T23:59:59.500Z',
        }),
      );

      expect(outcome.kind).toBe('created');
      if (outcome.kind === 'created') {
        expect(outcome.record.publishedAt).toBe('2030-12-30T23:59:59.000Z');
        expect(outcome.record.events[0].occurredAt).toBe(outcome.record.publishedAt);
      }
      expect(registry.size).toBe(1);
    });

    it('refuses publication when publishedAt is exactly at horizon.endsAt', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate(); // horizon.endsAt is 2030-12-31T00:00:00.000Z
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-at-horizon' }, candidate),
        deps(registry, {
          now: () => '2030-12-31T00:00:00.000Z',
          recordedAt: () => '2030-12-31T00:00:01.000Z',
        }),
      );

      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') {
        const horizonCheck = outcome.verdict.results.find((r) => r.id === 'fixed-horizon')!;
        expect(horizonCheck.passed).toBe(false);
        expect(horizonCheck.reason).toMatch(/forecast window has already closed/i);
      }
      expect(registry.size).toBe(0);
    });

    it('refuses publication when publishedAt is after horizon.endsAt', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate(); // horizon.endsAt is 2030-12-31T00:00:00.000Z
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-after-horizon' }, candidate),
        deps(registry, {
          now: () => '2031-01-01T00:00:00.000Z',
          recordedAt: () => '2031-01-01T00:00:01.000Z',
        }),
      );

      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') {
        const horizonCheck = outcome.verdict.results.find((r) => r.id === 'fixed-horizon')!;
        expect(horizonCheck.passed).toBe(false);
        expect(horizonCheck.reason).toMatch(/forecast window has already closed/i);
      }
      expect(registry.size).toBe(0);
    });
  });

  // Requirement 5: Require evidence to predate publication
  describe('evidence chronology relative to publication time', () => {
    it('accepts evidence published strictly before publishedAt', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate({
        evidence: [
          {
            id: 'ev-before',
            title: 'Prior ranking dataset',
            publisher: 'FIFA',
            publishedAt: '2026-11-21T23:59:59.000Z',
            kind: 'dataset',
            note: 'Published the day before the forecast.',
          },
        ],
      });
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-ev-before' }, candidate),
        deps(registry, {
          now: () => '2026-11-22T00:00:00.000Z',
          recordedAt: () => '2026-11-22T00:00:01.000Z',
        }),
      );

      expect(outcome.kind).toBe('created');
      expect(registry.size).toBe(1);
    });

    it('accepts evidence published at the exact same timestamp as publishedAt', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate({
        evidence: [
          {
            id: 'ev-exact',
            title: 'Contemporaneous release',
            publisher: 'FIFA',
            publishedAt: '2026-11-22T00:00:00.000Z',
            kind: 'dataset',
            note: 'Published at the exact publication timestamp.',
          },
        ],
      });
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-ev-exact' }, candidate),
        deps(registry, {
          now: () => '2026-11-22T00:00:00.000Z',
          recordedAt: () => '2026-11-22T00:00:01.000Z',
        }),
      );

      expect(outcome.kind).toBe('created');
      expect(registry.size).toBe(1);
    });

    it('blocks publication when any evidence item is dated after publishedAt', async () => {
      const registry = new InMemoryRegistry();
      const futureEvidenceCandidate = validCandidate({
        createdAt: '2026-11-25T00:00:00.000Z',
        evidence: [
          {
            id: 'ev-future',
            title: 'Post-publication report',
            publisher: 'FIFA',
            publishedAt: '2026-11-23T00:00:00.000Z',
            kind: 'report',
            note: 'Dated after the attempted publication clock.',
          },
        ],
      });

      const outcome = await publishCandidate(
        futureEvidenceCandidate,
        request({ idempotencyKey: 'k-ev-after' }, futureEvidenceCandidate),
        deps(registry, {
          now: () => '2026-11-22T00:00:00.000Z',
          recordedAt: () => '2026-11-22T00:00:01.000Z',
        }),
      );

      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') {
        const prov = outcome.verdict.results.find(
          (r) => r.id === 'preserved-evidence-provenance',
        )!;
        expect(prov.passed).toBe(false);
        expect(prov.reason).toMatch(/later than the publication timestamp/i);
      }
      expect(registry.size).toBe(0);
    });
  });

  // Requirement 6: Verify candidateDigest
  describe('candidateDigest verification', () => {
    it('accepts a request whose candidateDigest matches candidateContentDigest(candidate, aliases)', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate();
      const expected = await candidateContentDigest(candidate, aliasTable());
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-digest-ok', candidateDigest: expected }, candidate),
        deps(registry),
      );

      expect(outcome.kind).toBe('created');
      expect(registry.size).toBe(1);
    });

    it('rejects an altered candidateDigest before any registry lookup or mutation', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate({ probability: 0.18 });
      const digestForDifferentProb = await candidateContentDigest(
        validCandidate({ probability: 0.55 }),
        aliasTable(),
      );

      const outcome = await publishCandidate(
        candidate,
        request(
          { idempotencyKey: 'k-digest-altered', candidateDigest: digestForDifferentProb },
          candidate,
        ),
        deps(registry),
      );

      expect(outcome.kind).toBe('candidate-digest-mismatch');
      if (outcome.kind === 'candidate-digest-mismatch') {
        expect(outcome.reason).toBe('mismatch');
        expect(outcome.receivedDigest).toBe(digestForDifferentProb);
        expect(outcome.expectedDigest).toBe(
          await candidateContentDigest(candidate, aliasTable()),
        );
      }
      expect(registry.size).toBe(0);
      expect(
        await registry.findByIdempotencyKey('k-digest-altered', 'any'),
      ).toEqual({ status: 'miss' });
    });

    it('rejects a missing candidateDigest before any registry lookup or mutation', async () => {
      const registry = new InMemoryRegistry();
      const candidate = validCandidate();
      const outcome = await publishCandidate(
        candidate,
        request({ idempotencyKey: 'k-digest-missing', candidateDigest: '   ' }, candidate),
        deps(registry),
      );

      expect(outcome.kind).toBe('candidate-digest-mismatch');
      if (outcome.kind === 'candidate-digest-mismatch') {
        expect(outcome.reason).toBe('missing');
      }
      expect(registry.size).toBe(0);
    });

    it.each(['not-hex', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
      'rejects malformed candidateDigest %s before any registry lookup or mutation',
      async (badDigest) => {
        const registry = new InMemoryRegistry();
        const candidate = validCandidate();
        const outcome = await publishCandidate(
          candidate,
          request({ idempotencyKey: 'k-digest-malformed', candidateDigest: badDigest }, candidate),
          deps(registry),
        );

        expect(outcome.kind).toBe('candidate-digest-mismatch');
        if (outcome.kind === 'candidate-digest-mismatch') {
          expect(outcome.reason).toBe('malformed');
        }
        expect(registry.size).toBe(0);
      },
    );
  });

  // Requirement 7: All nine rejection paths leave zero identity claims
  it('guarantees none of the nine rejection paths ever reserve an official identity', async () => {
    const registry = new InMemoryRegistry();
    const digest = await identityDigest(argentinaWins2030(), aliasTable());
    const valid = validCandidate();

    // 1. Candidate ID mismatch
    const r1 = await publishCandidate(
      valid,
      request({ candidateId: 'wrong-id', idempotencyKey: 'r-1' }, valid),
      deps(registry),
    );
    expect(r1.kind).toBe('candidate-mismatch');

    // 2. Proposed identity mismatch
    const r2 = await publishCandidate(
      valid,
      request({ identity: argentinaReachesFinal(), idempotencyKey: 'r-2' }, valid),
      deps(registry),
    );
    expect(r2.kind).toBe('candidate-mismatch');

    // 3. Forged lifecycle stage
    const forged = rawCandidate({ stage: 'eligible-for-publication' });
    const r3 = await publishCandidate(
      forged,
      request({ idempotencyKey: 'r-3' }, forged),
      deps(registry),
    );
    expect(r3.kind).toBe('wrong-stage');

    // 4. Candidate digest mismatch
    const r4 = await publishCandidate(
      valid,
      request({ idempotencyKey: 'r-4', candidateDigest: 'f'.repeat(64) }, valid),
      deps(registry),
    );
    expect(r4.kind).toBe('candidate-digest-mismatch');

    // 5. Unresolved identity
    const uncertainId = { ...argentinaWins2030(), subject: unresolvedTerm() };
    const uncertainCand = validCandidate({ proposedIdentity: uncertainId });
    const r5 = await publishCandidate(
      uncertainCand,
      request({ idempotencyKey: 'r-5', identity: uncertainId }, uncertainCand),
      deps(registry),
    );
    expect(r5.kind).toBe('identity-conflict');

    // 6. Failed evaluation
    const invalidProb = validCandidate({ probability: null });
    const r6 = await publishCandidate(
      invalidProb,
      request({ idempotencyKey: 'r-6' }, invalidProb),
      deps(registry),
    );
    expect(r6.kind).toBe('rejected');

    // 7. Expired horizon
    const r7 = await publishCandidate(
      valid,
      request({ idempotencyKey: 'r-7' }, valid),
      deps(registry, {
        now: () => '2030-12-31T00:00:00.000Z',
        recordedAt: () => '2030-12-31T00:00:01.000Z',
      }),
    );
    expect(r7.kind).toBe('rejected');

    // 8. Invalid clock timestamps
    const r8 = await publishCandidate(
      valid,
      request({ idempotencyKey: 'r-8' }, valid),
      deps(registry, {
        now: () => '2026-11-22T00:00:00.000Z',
        recordedAt: () => '2026-11-22T00:00:00.000Z',
      }),
    );
    expect(r8.kind).toBe('invalid-clock');

    // 9. Evidence dated after publication
    const futureEvCand = validCandidate({
      createdAt: '2026-12-01T00:00:00.000Z',
      evidence: [
        {
          id: 'ev-late',
          title: 'Late report',
          publisher: 'FIFA',
          publishedAt: '2026-11-25T00:00:00.000Z',
          kind: 'report',
          note: 'Dated after the attempted publication time.',
        },
      ],
    });
    const r9 = await publishCandidate(
      futureEvCand,
      request({ idempotencyKey: 'r-9' }, futureEvCand),
      deps(registry, {
        now: () => '2026-11-22T00:00:00.000Z',
        recordedAt: () => '2026-11-22T00:00:01.000Z',
      }),
    );
    expect(r9.kind).toBe('rejected');

    expect(registry.size).toBe(0);
    expect(await registry.findByIdentity(digest)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Protocol v1.3 — PostgreSQL transaction contract & retry semantics
// ---------------------------------------------------------------------------

describe('protocol v1.3 PostgreSQL transaction contract and retry semantics', () => {
  it('consumes idempotencyKey on identity-conflict and rejected without claiming identity, requiring a new key for a corrected retry', async () => {
    const registry = new InMemoryRegistry();
    const digest = await identityDigest(argentinaWins2030(), aliasTable());

    // 1. Ambiguous identity attempt consumes key-conflict
    const uncertainId = { ...argentinaWins2030(), subject: unresolvedTerm() };
    const uncertainCand = validCandidate({ proposedIdentity: uncertainId });
    const firstConflict = await publishCandidate(
      uncertainCand,
      request({ idempotencyKey: 'key-conflict', identity: uncertainId }, uncertainCand),
      deps(registry),
    );
    expect(firstConflict.kind).toBe('identity-conflict');
    expect(registry.size).toBe(0);
    expect(await registry.findByIdentity(digest)).toBeNull();

    // Retrying identical ambiguous request replays identity-conflict
    const replayedConflict = await publishCandidate(
      uncertainCand,
      request({ idempotencyKey: 'key-conflict', identity: uncertainId }, uncertainCand),
      deps(registry),
    );
    expect(replayedConflict.kind).toBe('replayed');
    if (replayedConflict.kind === 'replayed') {
      expect(replayedConflict.original.kind).toBe('identity-conflict');
    }

    // Reusing key-conflict with a corrected candidate returns idempotency-conflict
    const fixedCand = validCandidate();
    const reusedKeyConflict = await publishCandidate(
      fixedCand,
      request({ idempotencyKey: 'key-conflict' }, fixedCand),
      deps(registry),
    );
    expect(reusedKeyConflict.kind).toBe('idempotency-conflict');
    expect(registry.size).toBe(0);

    // 2. Failed evaluation attempt consumes key-rejected
    const invalidCand = validCandidate({ probability: null });
    const firstRejected = await publishCandidate(
      invalidCand,
      request({ idempotencyKey: 'key-rejected' }, invalidCand),
      deps(registry),
    );
    expect(firstRejected.kind).toBe('rejected');
    expect(registry.size).toBe(0);

    // Reusing key-rejected with the corrected candidate returns idempotency-conflict
    const reusedKeyRejected = await publishCandidate(
      fixedCand,
      request({ idempotencyKey: 'key-rejected' }, fixedCand),
      deps(registry),
    );
    expect(reusedKeyRejected.kind).toBe('idempotency-conflict');
    expect(registry.size).toBe(0);

    // 3. Submitting the corrected candidate with a fresh idempotencyKey succeeds
    const created = await publishCandidate(
      fixedCand,
      request({ idempotencyKey: 'key-fresh-fixed' }, fixedCand),
      deps(registry),
    );
    expect(created.kind).toBe('created');
    expect(registry.size).toBe(1);
    expect(await registry.findByIdentity(digest)).not.toBeNull();
  });

  it('verifies PUBLICATION-API-CONTRACT.md contains valid PostgreSQL DDL and eliminates invalid CHECK DEFERRABLE syntax', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const limitationsDoc = readFileSync(
      resolve(process.cwd(), 'docs/FEATURES-AND-LIMITATIONS.md'),
      'utf8',
    );

    // Extract SQL code blocks from docs/PUBLICATION-API-CONTRACT.md
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');
    expect(sqlBlocks.length).toBeGreaterThan(0);

    // 1. PostgreSQL never allows DEFERRABLE on a CHECK constraint
    expect(sqlBlocks).not.toMatch(/CHECK\s*\([^)]*\)\s*DEFERRABLE/i);
    expect(limitationsDoc).not.toMatch(/deferred\s+`?CHECK/i);

    // 2. Uses immediate CHECK with transaction-local '__pending__' sentinel
    expect(sqlBlocks).toContain('CONSTRAINT publication_idempotency_outcome_valid_shape CHECK');
    expect(sqlBlocks).toContain("'__pending__'");
    expect(sqlBlocks).toContain('\'{"kind":"__pending__"}\'::jsonb');

    // 3. Uses valid PostgreSQL CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED
    expect(sqlBlocks).toContain(
      'CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete()',
    );
    expect(sqlBlocks).toContain(
      'SELECT outcome\n    INTO current_outcome\n    FROM oracle_ledger.publication_idempotency_keys\n   WHERE idempotency_key = NEW.idempotency_key;',
    );
    // A disappearing reservation before COMMIT must raise an exception, never RETURN NULL
    expect(sqlBlocks).not.toMatch(/IF\s+NOT\s+FOUND\s+THEN\s+RETURN\s+NULL/i);
    expect(sqlBlocks).toContain(
      "IF NOT FOUND THEN\n    RAISE EXCEPTION\n      'publication_idempotency_keys row % disappeared before commit'",
    );
    expect(sqlBlocks).toContain(
      'CREATE CONSTRAINT TRIGGER publication_idempotency_outcome_complete_trg\n  AFTER INSERT OR UPDATE ON oracle_ledger.publication_idempotency_keys\n  DEFERRABLE INITIALLY DEFERRED\n  FOR EACH ROW\n  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_outcome_complete();',
    );

    // 4. Enforces BEFORE INSERT OR UPDATE OR DELETE immutability trigger on publication_idempotency_keys
    // and append-only triggers on official_predictions and prediction_events
    expect(sqlBlocks).toContain(
      'CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_immutability()',
    );
    expect(sqlBlocks).toContain(
      "IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION\n      'DELETE on publication_idempotency_keys is forbidden (idempotency_key = %)'",
    );
    expect(sqlBlocks).toContain(
      "OR (NEW.outcome ->> 'kind') NOT IN ('__pending__', 'identity-conflict', 'rejected')\n    THEN\n      RAISE EXCEPTION\n        'publication_idempotency_keys row % cannot be inserted directly with outcome kind %; only __pending__, identity-conflict, or rejected may be inserted'",
    );
    expect(sqlBlocks).toContain(
      "IF (OLD.outcome ->> 'kind') IS DISTINCT FROM '__pending__' THEN\n      RAISE EXCEPTION\n        'publication_idempotency_keys row % is already finalized (%) and cannot be updated'",
    );
    expect(sqlBlocks).toContain(
      'IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key\n       OR NEW.request_digest IS DISTINCT FROM OLD.request_digest\n       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at',
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER publication_idempotency_immutability_trg\n  BEFORE INSERT OR UPDATE OR DELETE ON oracle_ledger.publication_idempotency_keys\n  FOR EACH ROW\n  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_immutability();',
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER official_predictions_append_only_trg\n  BEFORE UPDATE OR DELETE ON oracle_ledger.official_predictions\n  FOR EACH ROW\n  EXECUTE FUNCTION oracle_ledger.enforce_append_only_ledger_row();',
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER prediction_events_append_only_trg\n  BEFORE UPDATE OR DELETE ON oracle_ledger.prediction_events\n  FOR EACH ROW\n  EXECUTE FUNCTION oracle_ledger.enforce_append_only_ledger_row();',
    );

    // 5. Enforces BEFORE TRUNCATE statement-level trigger on publication_idempotency_keys, official_predictions, and prediction_events
    expect(sqlBlocks).toContain(
      'CREATE OR REPLACE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate()',
    );
    expect(sqlBlocks).toContain(
      "RAISE EXCEPTION\n    'TRUNCATE on % is forbidden',\n    TG_TABLE_NAME\n    USING ERRCODE = '23514';",
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER publication_idempotency_no_truncate_trg\n  BEFORE TRUNCATE ON oracle_ledger.publication_idempotency_keys\n  FOR EACH STATEMENT\n  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();',
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER official_predictions_no_truncate_trg\n  BEFORE TRUNCATE ON oracle_ledger.official_predictions\n  FOR EACH STATEMENT\n  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();',
    );
    expect(sqlBlocks).toContain(
      'CREATE TRIGGER prediction_events_no_truncate_trg\n  BEFORE TRUNCATE ON oracle_ledger.prediction_events\n  FOR EACH STATEMENT\n  EXECUTE FUNCTION oracle_ledger.enforce_publication_idempotency_no_truncate();',
    );
    expect(contractDoc).toContain('TRUNCATE ... CASCADE');

    // 6. Enforces SECURITY DEFINER controlled write boundary and zero direct table DML for oracle_app
    expect(sqlBlocks).toContain(
      'CREATE ROLE oracle_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;',
    );
    expect(sqlBlocks).toContain(
      'CREATE ROLE oracle_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN;',
    );
    expect(sqlBlocks).toContain('REVOKE oracle_migrator FROM oracle_app;');
    expect(sqlBlocks).not.toContain('REVOKE oracle_migrator FROM oracle_app, PUBLIC;');
    expect(sqlBlocks).toContain(
      'ALTER TABLE oracle_ledger.publication_idempotency_keys OWNER TO oracle_migrator;',
    );
    expect(sqlBlocks).toContain(
      'REVOKE ALL ON TABLE\n  oracle_ledger.official_predictions,\n  oracle_ledger.prediction_events,\n  oracle_ledger.publication_idempotency_keys\nFROM PUBLIC, oracle_app;',
    );
    expect(sqlBlocks).toContain(
      'GRANT SELECT\n  ON TABLE\n    oracle_ledger.official_predictions,\n    oracle_ledger.prediction_events,\n    oracle_ledger.publication_idempotency_keys\n  TO oracle_app;',
    );
    // Ensure no GRANT statement ever grants INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, or ALL on tables to oracle_app
    const grantStatements = Array.from(
      sqlBlocks.matchAll(/^GRANT\s+[^;]*?TO\s+oracle_app\s*;/gm),
      (m) => m[0],
    );
    expect(grantStatements.length).toBe(3); // USAGE ON SCHEMA, SELECT ON TABLE, EXECUTE ON FUNCTION
    for (const grantSql of grantStatements) {
      expect(grantSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES|CREATE|ALL)\b/i);
    }
    expect(contractDoc).toMatch(/cannot protect\s+against a PostgreSQL superuser or the table owner/i);

    // 7. Retains READ COMMITTED and ON CONFLICT unique-index arbitration
    expect(sqlBlocks).toContain('BEGIN ISOLATION LEVEL READ COMMITTED;');
    expect(sqlBlocks).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sqlBlocks).toContain('ON CONFLICT (identity_digest) DO NOTHING');
  });

  it('simulates (in-memory TypeScript simulation, not real PostgreSQL execution) the SQL trigger state-machine rules for pending reservation, immutability, column protection, DELETE/TRUNCATE prohibition, and commit rollback', () => {
    interface IdempotencyRow {
      idempotency_key: string;
      request_digest: string;
      outcome: { kind?: string; [k: string]: unknown } | null;
      recorded_at: string;
    }

    const FINAL_KINDS = new Set(['created', 'existing', 'identity-conflict', 'rejected']);
    const VALID_SHAPE_KINDS = new Set(['__pending__', ...FINAL_KINDS]);

    // In-memory TypeScript simulation (not a live PostgreSQL instance) modeling:
    // - immediate CHECK constraint (publication_idempotency_outcome_valid_shape)
    // - BEFORE UPDATE OR DELETE row trigger (publication_idempotency_immutability_trg)
    // - BEFORE TRUNCATE statement trigger (publication_idempotency_no_truncate_trg)
    // - DEFERRABLE INITIALLY DEFERRED AFTER INSERT OR UPDATE constraint trigger
    //   (publication_idempotency_outcome_complete_trg)
    class SimulatedPgIdempotencyTable {
      private committed = new Map<string, IdempotencyRow>();
      private working = new Map<string, IdempotencyRow>();
      private queuedTriggerKeys: string[] = [];

      begin(): void {
        this.working = new Map(
          Array.from(this.committed.entries(), ([k, v]) => [k, structuredClone(v)]),
        );
        this.queuedTriggerKeys = [];
      }

      private checkValidShape(row: IdempotencyRow): void {
        if (
          row.outcome === null ||
          typeof row.outcome !== 'object' ||
          Array.isArray(row.outcome) ||
          typeof row.outcome.kind !== 'string' ||
          !VALID_SHAPE_KINDS.has(row.outcome.kind)
        ) {
          throw new Error('23514: publication_idempotency_outcome_valid_shape');
        }
      }

      insert(row: IdempotencyRow): boolean {
        this.checkValidShape(row);
        // BEFORE INSERT trigger: enforce_publication_idempotency_immutability()
        // Direct insertion of 'created' or 'existing' is forbidden; only '__pending__',
        // 'identity-conflict', or 'rejected' may be inserted.
        if (
          row.outcome === null ||
          typeof row.outcome !== 'object' ||
          typeof row.outcome.kind !== 'string' ||
          !['__pending__', 'identity-conflict', 'rejected'].includes(row.outcome.kind)
        ) {
          throw new Error(
            `23514: publication_idempotency_keys row ${row.idempotency_key} cannot be inserted directly with outcome kind ${String(row.outcome?.kind)}; only __pending__, identity-conflict, or rejected may be inserted`,
          );
        }
        if (this.working.has(row.idempotency_key)) {
          // ON CONFLICT (idempotency_key) DO NOTHING
          return false;
        }
        this.working.set(row.idempotency_key, structuredClone(row));
        this.queuedTriggerKeys.push(row.idempotency_key);
        return true;
      }

      update(key: string, patch: Partial<IdempotencyRow>): void {
        const oldRow = this.working.get(key);
        if (!oldRow) return;
        const newRow: IdempotencyRow = {
          ...structuredClone(oldRow),
          ...structuredClone(patch),
        };

        // BEFORE UPDATE trigger: enforce_publication_idempotency_immutability()
        if (oldRow.outcome?.kind !== '__pending__') {
          throw new Error(
            `23514: publication_idempotency_keys row ${oldRow.idempotency_key} is already finalized (${String(oldRow.outcome?.kind)}) and cannot be updated`,
          );
        }
        if (
          newRow.idempotency_key !== oldRow.idempotency_key ||
          newRow.request_digest !== oldRow.request_digest ||
          newRow.recorded_at !== oldRow.recorded_at
        ) {
          throw new Error(
            `23514: publication_idempotency_keys immutable columns (idempotency_key, request_digest, recorded_at) cannot be modified for ${oldRow.idempotency_key}`,
          );
        }
        if (
          newRow.outcome === null ||
          typeof newRow.outcome !== 'object' ||
          Array.isArray(newRow.outcome) ||
          typeof newRow.outcome.kind !== 'string' ||
          !FINAL_KINDS.has(newRow.outcome.kind)
        ) {
          throw new Error(
            `23514: publication_idempotency_keys row ${oldRow.idempotency_key} must transition from __pending__ to a valid final outcome`,
          );
        }

        this.checkValidShape(newRow);
        this.working.set(newRow.idempotency_key, newRow);
        this.queuedTriggerKeys.push(newRow.idempotency_key);
      }

      delete(key: string): void {
        const oldRow = this.working.get(key);
        if (!oldRow) return;
        // BEFORE DELETE trigger: enforce_publication_idempotency_immutability()
        throw new Error(
          `23514: DELETE on publication_idempotency_keys is forbidden (idempotency_key = ${oldRow.idempotency_key})`,
        );
      }

      truncate(): void {
        // BEFORE TRUNCATE FOR EACH STATEMENT trigger:
        // enforce_publication_idempotency_no_truncate()
        throw new Error('23514: TRUNCATE on publication_idempotency_keys is forbidden');
      }

      truncateCascade(): void {
        // Indirect TRUNCATE ... CASCADE is also blocked by BEFORE TRUNCATE FOR EACH STATEMENT
        this.truncate();
      }

      // Simulates a hypothetical bypass that removes a pending row before COMMIT
      // to verify that the deferred trigger's IF NOT FOUND branch aborts COMMIT.
      forceRemoveWorkingRowForTest(key: string): void {
        this.working.delete(key);
      }

      commit(): void {
        try {
          // DEFERRABLE INITIALLY DEFERRED constraint trigger:
          // enforce_publication_idempotency_outcome_complete()
          for (const key of this.queuedTriggerKeys) {
            const current = this.working.get(key);
            if (!current) {
              throw new Error(
                `23514: publication_idempotency_keys row ${key} disappeared before commit`,
              );
            }
            const kind = current.outcome?.kind;
            if (
              current.outcome === null ||
              typeof current.outcome !== 'object' ||
              typeof kind !== 'string' ||
              kind === '__pending__' ||
              !FINAL_KINDS.has(kind)
            ) {
              throw new Error(
                `23514: publication_idempotency_keys row ${key} cannot commit with incomplete or sentinel outcome`,
              );
            }
          }
          this.committed = new Map(
            Array.from(this.working.entries(), ([k, v]) => [k, structuredClone(v)]),
          );
        } catch (err) {
          // Automatic rollback on deferred trigger failure
          this.working = new Map(
            Array.from(this.committed.entries(), ([k, v]) => [k, structuredClone(v)]),
          );
          throw err;
        } finally {
          this.queuedTriggerKeys = [];
        }
      }

      getCommitted(key: string): IdempotencyRow | undefined {
        return this.committed.get(key);
      }

      get committedSize(): number {
        return this.committed.size;
      }
    }

    const table = new SimulatedPgIdempotencyTable();
    const baseDigest = 'a'.repeat(64);
    const recordedAt = '2026-11-22T00:00:01.000Z';

    // Case 1: Pending reservation without finalization UPDATE rolls back at COMMIT
    table.begin();
    table.insert({
      idempotency_key: 'k-unfinalized',
      request_digest: baseDigest,
      outcome: { kind: '__pending__' },
      recorded_at: recordedAt,
    });
    expect(() => table.commit()).toThrow(/cannot commit with incomplete or sentinel outcome/);
    expect(table.getCommitted('k-unfinalized')).toBeUndefined();

    // Case 2: Pending reservation that disappears before COMMIT (NOT FOUND) rolls back at COMMIT
    table.begin();
    table.insert({
      idempotency_key: 'k-disappeared',
      request_digest: baseDigest,
      outcome: { kind: '__pending__' },
      recorded_at: recordedAt,
    });
    table.forceRemoveWorkingRowForTest('k-disappeared');
    expect(() => table.commit()).toThrow(/disappeared before commit/);
    expect(table.getCommitted('k-disappeared')).toBeUndefined();

    // Case 3: DELETE of a pending row is rejected immediately by BEFORE DELETE trigger
    table.begin();
    table.insert({
      idempotency_key: 'k-pending-del',
      request_digest: baseDigest,
      outcome: { kind: '__pending__' },
      recorded_at: recordedAt,
    });
    expect(() => table.delete('k-pending-del')).toThrow(
      /DELETE on publication_idempotency_keys is forbidden/,
    );

    // Case 4: Modifying idempotency_key, request_digest, or recorded_at during finalization is rejected
    table.begin();
    table.insert({
      idempotency_key: 'k-col-protect',
      request_digest: baseDigest,
      outcome: { kind: '__pending__' },
      recorded_at: recordedAt,
    });
    expect(() =>
      table.update('k-col-protect', {
        request_digest: 'b'.repeat(64),
        outcome: { kind: 'created' },
      }),
    ).toThrow(/immutable columns \(idempotency_key, request_digest, recorded_at\) cannot be modified/);
    expect(() =>
      table.update('k-col-protect', {
        recorded_at: '2026-11-22T00:00:09.000Z',
        outcome: { kind: 'created' },
      }),
    ).toThrow(/immutable columns \(idempotency_key, request_digest, recorded_at\) cannot be modified/);
    expect(() =>
      table.update('k-col-protect', {
        idempotency_key: 'k-col-renamed',
        outcome: { kind: 'created' },
      }),
    ).toThrow(/immutable columns \(idempotency_key, request_digest, recorded_at\) cannot be modified/);

    // Case 5: Updating '__pending__' to '__pending__' is rejected
    expect(() =>
      table.update('k-col-protect', {
        outcome: { kind: '__pending__' },
      }),
    ).toThrow(/must transition from __pending__ to a valid final outcome/);

    // Case 6: Valid transition '__pending__' -> 'created' in the same transaction commits cleanly
    table.begin();
    table.insert({
      idempotency_key: 'k-valid',
      request_digest: baseDigest,
      outcome: { kind: '__pending__' },
      recorded_at: recordedAt,
    });
    table.update('k-valid', {
      outcome: { kind: 'created', predictionId: 'pred-0001' },
    });
    expect(() => table.commit()).not.toThrow();
    expect(table.getCommitted('k-valid')?.outcome).toEqual({
      kind: 'created',
      predictionId: 'pred-0001',
    });

    // Case 7: Once finalized, any subsequent UPDATE or DELETE is rejected
    table.begin();
    expect(() =>
      table.update('k-valid', {
        outcome: { kind: 'existing', predictionId: 'pred-9999' },
      }),
    ).toThrow(/already finalized \(created\) and cannot be updated/);
    expect(() => table.delete('k-valid')).toThrow(
      /DELETE on publication_idempotency_keys is forbidden/,
    );
    expect(table.getCommitted('k-valid')?.outcome).toEqual({
      kind: 'created',
      predictionId: 'pred-0001',
    });

    // Case 8: Direct TRUNCATE and TRUNCATE ... CASCADE are rejected with SQLSTATE 23514
    // and leave finalized idempotency keys intact
    table.begin();
    expect(() => table.truncate()).toThrow(
      /23514: TRUNCATE on publication_idempotency_keys is forbidden/,
    );
    expect(() => table.truncateCascade()).toThrow(
      /23514: TRUNCATE on publication_idempotency_keys is forbidden/,
    );
    expect(table.committedSize).toBe(1);
    expect(table.getCommitted('k-valid')).toEqual({
      idempotency_key: 'k-valid',
      request_digest: baseDigest,
      outcome: { kind: 'created', predictionId: 'pred-0001' },
      recorded_at: recordedAt,
    });

    // Case 9: Direct INSERT of a finalized 'created' or 'existing' outcome is rejected
    // by the BEFORE INSERT trigger with SQLSTATE 23514
    table.begin();
    expect(() =>
      table.insert({
        idempotency_key: 'k-forged-created',
        request_digest: baseDigest,
        outcome: { kind: 'created', predictionId: 'pred-forged' },
        recorded_at: recordedAt,
      }),
    ).toThrow(
      /23514: publication_idempotency_keys row k-forged-created cannot be inserted directly with outcome kind created/,
    );
    expect(() =>
      table.insert({
        idempotency_key: 'k-forged-existing',
        request_digest: baseDigest,
        outcome: { kind: 'existing', predictionId: 'pred-forged' },
        recorded_at: recordedAt,
      }),
    ).toThrow(
      /23514: publication_idempotency_keys row k-forged-existing cannot be inserted directly with outcome kind existing/,
    );
  });

  it('enforces the v1.6 controlled SECURITY DEFINER write boundary and least-privilege contract (static SQL inspection + in-memory TypeScript simulation, not real PostgreSQL execution)', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');

    // --- Part A: Static SQL inspection of SECURITY DEFINER functions and privilege grants ---

    // 1. All three controlled write functions are defined in schema oracle_ledger as SECURITY DEFINER
    //    with an explicit fixed search_path = pg_catalog, pg_temp and zero dynamic SQL (EXECUTE)
    const approvedFunctions = [
      'oracle_ledger.commit_official_publication',
      'oracle_ledger.record_rejected_or_conflict_idempotency',
      'oracle_ledger.append_terminal_prediction_event',
    ];
    for (const fnName of approvedFunctions) {
      expect(sqlBlocks).toContain(`CREATE OR REPLACE FUNCTION ${fnName}(`);
    }

    // Extract every CREATE OR REPLACE FUNCTION ... $$ block and verify security properties
    const functionBlocks = Array.from(
      sqlBlocks.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(oracle_ledger\.[a-z0-9_]+)\s*\([\s\S]*?\$\$\s*;/gi,
      ),
      (m) => ({ name: m[1], body: m[0] }),
    );
    expect(functionBlocks.length).toBe(7); // 4 trigger functions + 3 SECURITY DEFINER write functions

    for (const fn of functionBlocks) {
      // Every function in oracle_ledger sets fixed search_path = pg_catalog, pg_temp
      expect(fn.body).toContain('SET search_path = pg_catalog, pg_temp');
      // No function uses dynamic SQL (`EXECUTE '...'` or `EXECUTE format(...)`)
      expect(fn.body).not.toMatch(/\bEXECUTE\s+['"a-z0-9_(]/i);
      // Every function is explicitly assigned to non-superuser owner oracle_migrator
      expect(sqlBlocks).toContain(`ALTER FUNCTION ${fn.name}(`);
      expect(sqlBlocks).toContain(`OWNER TO oracle_migrator;`);
    }

    // 2. Only the 3 approved write functions are SECURITY DEFINER; trigger functions remain SECURITY INVOKER
    for (const fn of functionBlocks) {
      if (approvedFunctions.includes(fn.name)) {
        expect(fn.body).toContain('SECURITY DEFINER');
      } else {
        expect(fn.body).not.toContain('SECURITY DEFINER');
      }
    }

    // 3. oracle_app has NO direct ledger-table write grants (no INSERT, UPDATE, DELETE, TRUNCATE)
    expect(sqlBlocks).not.toMatch(
      /GRANT\s+[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*ON\s+TABLE[^;]*TO\s+oracle_app/i,
    );
    expect(sqlBlocks).toContain(
      'GRANT SELECT\n  ON TABLE\n    oracle_ledger.official_predictions,\n    oracle_ledger.prediction_events,\n    oracle_ledger.publication_idempotency_keys\n  TO oracle_app;',
    );

    // 4. Default PUBLIC execution privileges are revoked, and only the 3 approved functions are granted to oracle_app
    expect(sqlBlocks).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE oracle_migrator IN SCHEMA oracle_ledger\n  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    );
    expect(sqlBlocks).toContain(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA oracle_ledger FROM PUBLIC, oracle_app;',
    );
    const executeGrants = Array.from(
      sqlBlocks.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]*?)TO\s+([a-z0-9_,\s]+);/gi),
      (m) => ({ targets: m[1], grantee: m[2].trim() }),
    );
    expect(executeGrants.length).toBe(1);
    expect(executeGrants[0]?.grantee).toBe('oracle_app');
    for (const fnName of approvedFunctions) {
      expect(executeGrants[0]?.targets).toContain(fnName);
    }
    const unapprovedFunctions = [
      'oracle_ledger.enforce_append_only_ledger_row',
      'oracle_ledger.enforce_publication_idempotency_immutability',
      'oracle_ledger.enforce_publication_idempotency_no_truncate',
      'oracle_ledger.enforce_publication_idempotency_outcome_complete',
    ];
    for (const unapprovedFn of unapprovedFunctions) {
      expect(executeGrants[0]?.targets).not.toContain(unapprovedFn);
    }

    // 5. No role membership grants indirect migration-owner privileges to oracle_app or PUBLIC,
    //    and oracle_migrator is NOLOGIN at steady state
    expect(sqlBlocks).toContain(
      'CREATE ROLE oracle_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN;',
    );
    expect(sqlBlocks).toContain('REVOKE oracle_migrator FROM oracle_app;');
    expect(sqlBlocks).not.toContain('REVOKE oracle_migrator FROM oracle_app, PUBLIC;');
    expect(sqlBlocks).not.toMatch(/GRANT\s+oracle_migrator\s+TO/i);

    // --- Part B: In-memory TypeScript simulation (not real PostgreSQL execution) of the
    //             v1.6 privilege boundary and SECURITY DEFINER write functions ---
    type RoleName = 'oracle_app' | 'oracle_migrator' | 'PUBLIC';
    type TableName =
      | 'oracle_ledger.official_predictions'
      | 'oracle_ledger.prediction_events'
      | 'oracle_ledger.publication_idempotency_keys';
    type DmlOp = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE';

    interface SimulatedPredictionRow {
      prediction_id: string;
      identity_digest: string;
      sealed_payload: Record<string, unknown>;
      payload_digest: string;
      published_at: string;
      recorded_at: string;
    }

    interface SimulatedEventRow {
      prediction_id: string;
      seq: 'e0' | 'e1';
      kind: 'published' | 'resolved' | 'annulled';
      occurred_at: string;
      recorded_at: string;
      envelope: Record<string, unknown>;
      digest: string;
      prev_digest: string | null;
    }

    interface SimulatedIdempotencyRow {
      idempotency_key: string;
      request_digest: string;
      outcome: { kind: string; [k: string]: unknown };
      recorded_at: string;
    }

    // In-memory TypeScript simulation of PostgreSQL role privileges, SECURITY DEFINER
    // execution context switching, and table triggers.
    class SimulatedControlledLedgerDb {
      private predictions = new Map<string, SimulatedPredictionRow>();
      private predictionsByIdentity = new Map<string, string>();
      private events = new Map<string, SimulatedEventRow[]>();
      private idempotency = new Map<string, SimulatedIdempotencyRow>();

      private readonly tableGrants: Record<RoleName, Record<TableName, ReadonlySet<DmlOp>>> = {
        PUBLIC: {
          'oracle_ledger.official_predictions': new Set(),
          'oracle_ledger.prediction_events': new Set(),
          'oracle_ledger.publication_idempotency_keys': new Set(),
        },
        oracle_app: {
          'oracle_ledger.official_predictions': new Set(['SELECT']),
          'oracle_ledger.prediction_events': new Set(['SELECT']),
          'oracle_ledger.publication_idempotency_keys': new Set(['SELECT']),
        },
        oracle_migrator: {
          'oracle_ledger.official_predictions': new Set(['SELECT', 'INSERT']),
          'oracle_ledger.prediction_events': new Set(['SELECT', 'INSERT']),
          'oracle_ledger.publication_idempotency_keys': new Set(['SELECT', 'INSERT', 'UPDATE']),
        },
      };

      private readonly executableFunctions: Record<RoleName, ReadonlySet<string>> = {
        PUBLIC: new Set(),
        oracle_app: new Set(approvedFunctions),
        oracle_migrator: new Set(approvedFunctions),
      };

      private readonly roleMemberships: Record<RoleName, ReadonlySet<RoleName>> = {
        PUBLIC: new Set(),
        oracle_app: new Set(),
        oracle_migrator: new Set(),
      };

      hasRoleMembership(member: RoleName, targetRole: RoleName): boolean {
        return this.roleMemberships[member].has(targetRole);
      }

      private assertTablePrivilege(role: RoleName, table: TableName, op: DmlOp): void {
        if (!this.tableGrants[role][table].has(op)) {
          throw new Error(`42501: permission denied for table ${table} (role=${role}, op=${op})`);
        }
      }

      private assertFunctionExecute(role: RoleName, fnName: string): void {
        if (!this.executableFunctions[role].has(fnName)) {
          throw new Error(`42501: permission denied for function ${fnName} (role=${role})`);
        }
      }

      // Direct table operations attempted by a caller role
      directInsertIdempotency(role: RoleName, row: SimulatedIdempotencyRow): void {
        this.assertTablePrivilege(role, 'oracle_ledger.publication_idempotency_keys', 'INSERT');
        if (!['__pending__', 'identity-conflict', 'rejected'].includes(row.outcome.kind)) {
          throw new Error(
            `23514: publication_idempotency_keys row ${row.idempotency_key} cannot be inserted directly with outcome kind ${row.outcome.kind}`,
          );
        }
        this.idempotency.set(row.idempotency_key, structuredClone(row));
      }

      directInsertPrediction(role: RoleName, row: SimulatedPredictionRow): void {
        this.assertTablePrivilege(role, 'oracle_ledger.official_predictions', 'INSERT');
        this.predictions.set(row.prediction_id, structuredClone(row));
      }

      directInsertEvent(role: RoleName, row: SimulatedEventRow): void {
        this.assertTablePrivilege(role, 'oracle_ledger.prediction_events', 'INSERT');
        const list = this.events.get(row.prediction_id) ?? [];
        list.push(structuredClone(row));
        this.events.set(row.prediction_id, list);
      }

      directUpdatePrediction(role: RoleName, predictionId: string): void {
        this.assertTablePrivilege(role, 'oracle_ledger.official_predictions', 'UPDATE');
        throw new Error(
          `23514: UPDATE on oracle_ledger.official_predictions is forbidden (${predictionId})`,
        );
      }

      directDeleteEvent(role: RoleName, predictionId: string): void {
        this.assertTablePrivilege(role, 'oracle_ledger.prediction_events', 'DELETE');
        throw new Error(
          `23514: DELETE on oracle_ledger.prediction_events is forbidden (${predictionId})`,
        );
      }

      callUnapprovedFunction(role: RoleName, fnName: string): void {
        this.assertFunctionExecute(role, fnName);
      }

      // Controlled SECURITY DEFINER Function 1: commit_official_publication
      commitOfficialPublication(
        caller: RoleName,
        params: {
          idempotencyKey: string;
          requestDigest: string;
          predictionId: string;
          identityDigest: string;
          sealedPayload: Record<string, unknown>;
          payloadDigest: string;
          publishedAt: string;
          recordedAt: string;
          e0Envelope: Record<string, unknown>;
          e0Digest: string;
        },
      ): { status: string; outcome?: Record<string, unknown>; original?: Record<string, unknown> } {
        this.assertFunctionExecute(caller, 'oracle_ledger.commit_official_publication');
        // Runs as definer (oracle_migrator) with triggers active
        const definer: RoleName = 'oracle_migrator';

        if (params.sealedPayload.id !== params.predictionId || params.sealedPayload.demo !== false) {
          throw new Error(
            '23514: p_sealed_payload must be a non-demo official PredictionRecord object matching p_prediction_id',
          );
        }

        // Step 1: Reserve with '__pending__'
        if (this.idempotency.has(params.idempotencyKey)) {
          const existing = this.idempotency.get(params.idempotencyKey)!;
          if (existing.request_digest === params.requestDigest) {
            return { status: 'replayed', original: structuredClone(existing.outcome) };
          }
          return { status: 'idempotency-conflict' };
        }

        this.directInsertIdempotency(definer, {
          idempotency_key: params.idempotencyKey,
          request_digest: params.requestDigest,
          outcome: { kind: '__pending__' },
          recorded_at: params.recordedAt,
        });

        // Step 2: Claim identity or read winner
        let status: 'created' | 'existing';
        let finalOutcome: { kind: string; [k: string]: unknown };
        const existingPredId = this.predictionsByIdentity.get(params.identityDigest);
        if (!existingPredId) {
          this.directInsertPrediction(definer, {
            prediction_id: params.predictionId,
            identity_digest: params.identityDigest,
            sealed_payload: params.sealedPayload,
            payload_digest: params.payloadDigest,
            published_at: params.publishedAt,
            recorded_at: params.recordedAt,
          });
          this.predictionsByIdentity.set(params.identityDigest, params.predictionId);
          this.directInsertEvent(definer, {
            prediction_id: params.predictionId,
            seq: 'e0',
            kind: 'published',
            occurred_at: params.publishedAt,
            recorded_at: params.recordedAt,
            envelope: params.e0Envelope,
            digest: params.e0Digest,
            prev_digest: null,
          });
          status = 'created';
          finalOutcome = {
            kind: 'created',
            predictionId: params.predictionId,
            identityDigest: params.identityDigest,
            requestDigest: params.requestDigest,
            record: params.sealedPayload,
          };
        } else {
          const winner = this.predictions.get(existingPredId)!;
          status = 'existing';
          finalOutcome = {
            kind: 'existing',
            predictionId: winner.prediction_id,
            identityDigest: params.identityDigest,
            requestDigest: params.requestDigest,
            record: winner.sealed_payload,
          };
        }

        // Step 3: Finalize '__pending__' -> ('created' | 'existing'), verifying prediction exists
        this.assertTablePrivilege(definer, 'oracle_ledger.publication_idempotency_keys', 'UPDATE');
        const current = this.idempotency.get(params.idempotencyKey)!;
        if (current.outcome.kind !== '__pending__') {
          throw new Error('23514: row already finalized');
        }
        const refPred = this.predictions.get(String(finalOutcome.predictionId));
        if (!refPred || refPred.identity_digest !== finalOutcome.identityDigest) {
          throw new Error(
            '23514: cannot finalize as created/existing without matching official_predictions row',
          );
        }
        this.idempotency.set(params.idempotencyKey, {
          ...current,
          outcome: structuredClone(finalOutcome),
        });

        return { status, outcome: finalOutcome };
      }

      // Controlled SECURITY DEFINER Function 2: record_rejected_or_conflict_idempotency
      recordRejectedOrConflictIdempotency(
        caller: RoleName,
        params: {
          idempotencyKey: string;
          requestDigest: string;
          outcome: { kind: string; [k: string]: unknown };
          recordedAt: string;
        },
      ): { status: string; outcome?: Record<string, unknown> } {
        this.assertFunctionExecute(
          caller,
          'oracle_ledger.record_rejected_or_conflict_idempotency',
        );
        if (!['identity-conflict', 'rejected'].includes(params.outcome.kind)) {
          throw new Error(
            `23514: record_rejected_or_conflict_idempotency only accepts identity-conflict or rejected outcomes, got: ${params.outcome.kind}`,
          );
        }
        const definer: RoleName = 'oracle_migrator';
        if (this.idempotency.has(params.idempotencyKey)) {
          const existing = this.idempotency.get(params.idempotencyKey)!;
          return existing.request_digest === params.requestDigest
            ? { status: 'replayed', outcome: structuredClone(existing.outcome) }
            : { status: 'idempotency-conflict' };
        }
        this.directInsertIdempotency(definer, {
          idempotency_key: params.idempotencyKey,
          request_digest: params.requestDigest,
          outcome: params.outcome,
          recorded_at: params.recordedAt,
        });
        return { status: 'recorded', outcome: structuredClone(params.outcome) };
      }

      // Controlled SECURITY DEFINER Function 3: append_terminal_prediction_event
      appendTerminalPredictionEvent(
        caller: RoleName,
        params: {
          predictionId: string;
          kind: 'resolved' | 'annulled' | 'published';
          occurredAt: string;
          recordedAt: string;
          envelope: Record<string, unknown>;
          digest: string;
          prevDigest: string;
        },
      ): void {
        this.assertFunctionExecute(caller, 'oracle_ledger.append_terminal_prediction_event');
        if (params.kind !== 'resolved' && params.kind !== 'annulled') {
          throw new Error(
            `23514: append_terminal_prediction_event only permits resolved or annulled events, got: ${params.kind}`,
          );
        }
        if (params.recordedAt <= params.occurredAt) {
          throw new Error('23514: p_recorded_at must be strictly greater than p_occurred_at');
        }
        if (!this.predictions.has(params.predictionId)) {
          throw new Error(`23503: official_predictions row ${params.predictionId} does not exist`);
        }
        const existingEvents = this.events.get(params.predictionId) ?? [];
        const e0 = existingEvents.find((e) => e.seq === 'e0' && e.kind === 'published');
        if (!e0) {
          throw new Error(`23514: initial e0 published event missing for ${params.predictionId}`);
        }
        if (e0.digest !== params.prevDigest) {
          throw new Error('23514: p_prev_digest does not match e0 digest');
        }
        if (params.occurredAt <= e0.occurred_at) {
          throw new Error('23514: terminal event occurred_at must be strictly after e0 occurred_at');
        }
        if (existingEvents.some((e) => e.seq === 'e1' || e.kind !== 'published')) {
          throw new Error(`23505: prediction_id ${params.predictionId} already has a terminal event (e1)`);
        }
        const definer: RoleName = 'oracle_migrator';
        this.directInsertEvent(definer, {
          prediction_id: params.predictionId,
          seq: 'e1',
          kind: params.kind,
          occurred_at: params.occurredAt,
          recorded_at: params.recordedAt,
          envelope: params.envelope,
          digest: params.digest,
          prev_digest: params.prevDigest,
        });
      }
    }

    const db = new SimulatedControlledLedgerDb();
    const digestA = 'a'.repeat(64);
    const digestB = 'b'.repeat(64);
    const digestC = 'c'.repeat(64);
    const digestD = 'd'.repeat(64);

    // 1. oracle_app has no role membership in oracle_migrator
    expect(db.hasRoleMembership('oracle_app', 'oracle_migrator')).toBe(false);
    expect(db.hasRoleMembership('PUBLIC', 'oracle_migrator')).toBe(false);

    // 2. oracle_app cannot insert finalized idempotency rows, predictions, or events directly
    expect(() =>
      db.directInsertIdempotency('oracle_app', {
        idempotency_key: 'k-direct',
        request_digest: digestA,
        outcome: { kind: 'created', predictionId: 'pred-0001' },
        recorded_at: '2026-11-22T00:00:01.000Z',
      }),
    ).toThrow(/42501: permission denied for table oracle_ledger\.publication_idempotency_keys/);

    expect(() =>
      db.directInsertPrediction('oracle_app', {
        prediction_id: 'pred-0001',
        identity_digest: digestB,
        sealed_payload: { id: 'pred-0001', demo: false },
        payload_digest: digestC,
        published_at: '2026-11-22T00:00:00.000Z',
        recorded_at: '2026-11-22T00:00:01.000Z',
      }),
    ).toThrow(/42501: permission denied for table oracle_ledger\.official_predictions/);

    expect(() =>
      db.directInsertEvent('oracle_app', {
        prediction_id: 'pred-0001',
        seq: 'e0',
        kind: 'published',
        occurred_at: '2026-11-22T00:00:00.000Z',
        recorded_at: '2026-11-22T00:00:01.000Z',
        envelope: {},
        digest: digestD,
        prev_digest: null,
      }),
    ).toThrow(/42501: permission denied for table oracle_ledger\.prediction_events/);

    expect(() => db.directUpdatePrediction('oracle_app', 'pred-0001')).toThrow(
      /42501: permission denied for table oracle_ledger\.official_predictions/,
    );
    expect(() => db.directDeleteEvent('oracle_app', 'pred-0001')).toThrow(
      /42501: permission denied for table oracle_ledger\.prediction_events/,
    );

    // 3. PUBLIC cannot execute any function, and oracle_app cannot execute unapproved functions
    for (const fnName of approvedFunctions) {
      expect(() => db.callUnapprovedFunction('PUBLIC', fnName)).toThrow(
        /42501: permission denied for function/,
      );
    }
    for (const fnName of unapprovedFunctions) {
      expect(() => db.callUnapprovedFunction('oracle_app', fnName)).toThrow(
        /42501: permission denied for function/,
      );
      expect(() => db.callUnapprovedFunction('PUBLIC', fnName)).toThrow(
        /42501: permission denied for function/,
      );
    }

    // 4. oracle_app cannot abuse record_rejected_or_conflict_idempotency to insert 'created' or 'existing'
    expect(() =>
      db.recordRejectedOrConflictIdempotency('oracle_app', {
        idempotencyKey: 'k-forged',
        requestDigest: digestA,
        outcome: { kind: 'created', predictionId: 'pred-forged' },
        recordedAt: '2026-11-22T00:00:01.000Z',
      }),
    ).toThrow(
      /23514: record_rejected_or_conflict_idempotency only accepts identity-conflict or rejected outcomes/,
    );

    // 5. oracle_app CAN record a valid 'rejected' outcome via record_rejected_or_conflict_idempotency
    const rejectedRes = db.recordRejectedOrConflictIdempotency('oracle_app', {
      idempotencyKey: 'k-rejected-1',
      requestDigest: digestA,
      outcome: { kind: 'rejected', candidateId: 'cand-1' },
      recordedAt: '2026-11-22T00:00:01.000Z',
    });
    expect(rejectedRes.status).toBe('recorded');

    // 6. oracle_app CAN publish atomically via commit_official_publication
    const pubRes = db.commitOfficialPublication('oracle_app', {
      idempotencyKey: 'k-pub-1',
      requestDigest: digestA,
      predictionId: 'pred-0001',
      identityDigest: digestB,
      sealedPayload: { id: 'pred-0001', demo: false },
      payloadDigest: digestC,
      publishedAt: '2026-11-22T00:00:00.000Z',
      recordedAt: '2026-11-22T00:00:01.000Z',
      e0Envelope: { seq: 'e0', kind: 'published' },
      e0Digest: digestD,
    });
    expect(pubRes.status).toBe('created');

    // 7. oracle_app CAN append a single valid terminal 'resolved' event via append_terminal_prediction_event,
    //    and any second terminal event or wrong prev_digest is rejected
    expect(() =>
      db.appendTerminalPredictionEvent('oracle_app', {
        predictionId: 'pred-0001',
        kind: 'published',
        occurredAt: '2026-11-22T01:00:00.000Z',
        recordedAt: '2026-11-22T01:00:01.000Z',
        envelope: { seq: 'e1', kind: 'published' },
        digest: 'e'.repeat(64),
        prevDigest: digestD,
      }),
    ).toThrow(/23514: append_terminal_prediction_event only permits resolved or annulled events/);

    expect(() =>
      db.appendTerminalPredictionEvent('oracle_app', {
        predictionId: 'pred-0001',
        kind: 'resolved',
        occurredAt: '2026-11-22T01:00:00.000Z',
        recordedAt: '2026-11-22T01:00:01.000Z',
        envelope: { seq: 'e1', kind: 'resolved' },
        digest: 'e'.repeat(64),
        prevDigest: 'f'.repeat(64),
      }),
    ).toThrow(/23514: p_prev_digest does not match e0 digest/);

    expect(() =>
      db.appendTerminalPredictionEvent('oracle_app', {
        predictionId: 'pred-0001',
        kind: 'resolved',
        occurredAt: '2026-11-22T01:00:00.000Z',
        recordedAt: '2026-11-22T01:00:01.000Z',
        envelope: { seq: 'e1', kind: 'resolved' },
        digest: 'e'.repeat(64),
        prevDigest: digestD,
      }),
    ).not.toThrow();

    expect(() =>
      db.appendTerminalPredictionEvent('oracle_app', {
        predictionId: 'pred-0001',
        kind: 'annulled',
        occurredAt: '2026-11-22T02:00:00.000Z',
        recordedAt: '2026-11-22T02:00:01.000Z',
        envelope: { seq: 'e1', kind: 'annulled' },
        digest: '1'.repeat(64),
        prevDigest: digestD,
      }),
    ).toThrow(/23505: prediction_id pred-0001 already has a terminal event \(e1\)/);
  });

  it('enforces v1.7 READ COMMITTED isolation guard, recursive pg_auth_members role-membership audit, and digest format-vs-SHA256 distinction (static SQL inspection + in-memory TypeScript simulation, not real PostgreSQL execution)', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');

    // --- 1. Static SQL checks for active READ COMMITTED isolation enforcement ---
    const commitFnMatch = sqlBlocks.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+oracle_ledger\.commit_official_publication\s*\([\s\S]*?\$\$\s*;/i,
    );
    expect(commitFnMatch).not.toBeNull();
    const commitFnBody = commitFnMatch![0];

    // Must inspect pg_catalog.current_setting('transaction_isolation') and require 'read committed' with ERRCODE = '25001'
    expect(commitFnBody).toContain(
      "v_isolation_level := pg_catalog.current_setting('transaction_isolation');",
    );
    expect(commitFnBody).toContain(
      "IF v_isolation_level IS DISTINCT FROM 'read committed' THEN\n    RAISE EXCEPTION\n      'commit_official_publication requires transaction_isolation = read committed, got: %',\n      v_isolation_level\n      USING ERRCODE = '25001';\n  END IF;",
    );

    // Must occur BEFORE any table access (INSERT, UPDATE, DELETE, or SELECT FROM oracle_ledger.*)
    const isolationCheckIdx = commitFnBody.indexOf(
      "v_isolation_level := pg_catalog.current_setting('transaction_isolation');",
    );
    const firstTableAccessIdx = commitFnBody.search(
      /\b(INSERT\s+INTO|UPDATE\s+oracle_ledger|SELECT\s+[\s\S]*?FROM\s+oracle_ledger)\b/i,
    );
    expect(isolationCheckIdx).toBeGreaterThan(0);
    expect(firstTableAccessIdx).toBeGreaterThan(isolationCheckIdx);

    // Must NOT attempt to change transaction isolation from inside the function
    expect(commitFnBody).not.toMatch(/SET\s+(TRANSACTION|SESSION\s+CHARACTERISTICS)/i);
    expect(sqlBlocks).not.toMatch(/SET\s+TRANSACTION\s+ISOLATION\s+LEVEL/i);

    // record_rejected_or_conflict_idempotency also enforces read committed with ERRCODE = '25001'
    expect(sqlBlocks).toContain(
      "IF v_isolation_level IS DISTINCT FROM 'read committed' THEN\n    RAISE EXCEPTION\n      'record_rejected_or_conflict_idempotency requires transaction_isolation = read committed, got: %',\n      v_isolation_level\n      USING ERRCODE = '25001';\n  END IF;",
    );

    // --- 2. Static SQL checks for recursive pg_catalog.pg_auth_members role-membership audit ---
    expect(sqlBlocks).toContain('WITH RECURSIVE role_membership_graph AS (');
    expect(sqlBlocks).toContain('FROM pg_catalog.pg_auth_members AS m');
    expect(sqlBlocks).toContain('JOIN pg_catalog.pg_roles AS r_member');
    expect(sqlBlocks).toContain("WHERE r_member.rolname = 'oracle_app'");
    expect(sqlBlocks).toContain('m.admin_option');
    expect(sqlBlocks).toContain('m.inherit_option');
    expect(sqlBlocks).toContain('m.set_option');
    expect(sqlBlocks).toContain('r_granted.rolsuper');
    expect(sqlBlocks).toContain('r_granted.rolcreatedb');
    expect(sqlBlocks).toContain('r_granted.rolcreaterole');
    expect(sqlBlocks).toContain('r_granted.rolbypassrls');
    expect(contractDoc).toMatch(
      /Executing `REVOKE oracle_migrator FROM oracle_app;` only removes direct membership[\s\S]*?does \*\*not\*\* by itself remove arbitrary\s+pre-existing role memberships/i,
    );

    // --- 3. Static checks for explicit digest format-validation vs. SHA-256 distinction ---
    expect(contractDoc).toMatch(
      /The PostgreSQL PL\/pgSQL functions validate \*\*digest format\*\* \(`\^\[0-9a-f\]\{64\}\$`[\s\S]*?\*\*not\*\*\s+independent cryptographic SHA-256 recomputation/i,
    );
    expect(sqlBlocks).toContain(
      'Format validation only (64-char lowercase hex); cryptographic SHA-256 computation',
    );
    expect(sqlBlocks).not.toContain('must be 64-character lowercase hex SHA-256 strings');

    // --- 4. In-memory TypeScript simulation (not real PostgreSQL execution) of:
    //        (a) active transaction isolation guard (SQLSTATE 25001 before any mutation), and
    //        (b) recursive pg_auth_members indirect role-membership audit ---
    type IsolationLevel =
      | 'read committed'
      | 'repeatable read'
      | 'serializable'
      | 'read uncommitted';

    class SimulatedIsolationGuardedLedger {
      public idempotencyCount = 0;
      public predictionCount = 0;
      public eventCount = 0;

      commitOfficialPublication(activeIsolation: IsolationLevel): string {
        if (activeIsolation !== 'read committed') {
          throw new Error(
            `25001: commit_official_publication requires transaction_isolation = read committed, got: ${activeIsolation}`,
          );
        }
        this.idempotencyCount += 1;
        this.predictionCount += 1;
        this.eventCount += 1;
        return 'created';
      }

      recordRejectedOrConflictIdempotency(activeIsolation: IsolationLevel): string {
        if (activeIsolation !== 'read committed') {
          throw new Error(
            `25001: record_rejected_or_conflict_idempotency requires transaction_isolation = read committed, got: ${activeIsolation}`,
          );
        }
        this.idempotencyCount += 1;
        return 'recorded';
      }
    }

    const isoLedger = new SimulatedIsolationGuardedLedger();
    for (const badIsolation of [
      'repeatable read',
      'serializable',
      'read uncommitted',
    ] as const) {
      expect(() => isoLedger.commitOfficialPublication(badIsolation)).toThrow(
        new RegExp(
          `25001: commit_official_publication requires transaction_isolation = read committed, got: ${badIsolation}`,
        ),
      );
      expect(() => isoLedger.recordRejectedOrConflictIdempotency(badIsolation)).toThrow(
        new RegExp(
          `25001: record_rejected_or_conflict_idempotency requires transaction_isolation = read committed, got: ${badIsolation}`,
        ),
      );
      // Verify zero mutations occurred on rejected isolation levels
      expect(isoLedger.idempotencyCount).toBe(0);
      expect(isoLedger.predictionCount).toBe(0);
      expect(isoLedger.eventCount).toBe(0);
    }

    expect(isoLedger.commitOfficialPublication('read committed')).toBe('created');
    expect(isoLedger.idempotencyCount).toBe(1);
    expect(isoLedger.predictionCount).toBe(1);
    expect(isoLedger.eventCount).toBe(1);

    // Simulation of recursive pg_catalog.pg_auth_members + pg_catalog.pg_roles audit
    interface PgRole {
      oid: number;
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      rolreplication: boolean;
    }

    interface PgAuthMember {
      member: number;
      roleid: number;
      admin_option: boolean;
      inherit_option: boolean;
      set_option: boolean;
    }

    function runRecursiveRoleAudit(
      roles: PgRole[],
      memberships: PgAuthMember[],
      targetRolname = 'oracle_app',
    ) {
      const roleByOid = new Map(roles.map((r) => [r.oid, r]));
      const baseRole = roles.find((r) => r.rolname === targetRolname);
      if (!baseRole) return [];

      interface GraphNode {
        base_role_oid: number;
        granted_role_oid: number;
        admin_option: boolean;
        inherit_option: boolean;
        set_option: boolean;
        depth: number;
        oid_path: number[];
      }

      const results: GraphNode[] = [];
      const queue: GraphNode[] = memberships
        .filter((m) => m.member === baseRole.oid)
        .map((m) => ({
          base_role_oid: m.member,
          granted_role_oid: m.roleid,
          admin_option: m.admin_option,
          inherit_option: m.inherit_option,
          set_option: m.set_option,
          depth: 1,
          oid_path: [m.member, m.roleid],
        }));

      while (queue.length > 0) {
        const current = queue.shift()!;
        results.push(current);
        for (const edge of memberships) {
          if (
            edge.member === current.granted_role_oid &&
            !current.oid_path.includes(edge.roleid)
          ) {
            queue.push({
              base_role_oid: current.base_role_oid,
              granted_role_oid: edge.roleid,
              admin_option: edge.admin_option,
              inherit_option: edge.inherit_option,
              set_option: edge.set_option,
              depth: current.depth + 1,
              oid_path: [...current.oid_path, edge.roleid],
            });
          }
        }
      }

      return results.map((g) => {
        const granted = roleByOid.get(g.granted_role_oid)!;
        return {
          runtime_role: baseRole.rolname,
          reachable_role: granted.rolname,
          depth: g.depth,
          admin_option: g.admin_option,
          inherit_option: g.inherit_option,
          set_option: g.set_option,
          rolsuper: granted.rolsuper,
        };
      });
    }

    const roles: PgRole[] = [
      {
        oid: 10,
        rolname: 'oracle_app',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
        rolreplication: false,
      },
      {
        oid: 20,
        rolname: 'oracle_migrator',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
        rolreplication: false,
      },
      {
        oid: 30,
        rolname: 'ops_intermediate',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
        rolreplication: false,
      },
    ];

    // Scenario A: Even if direct oracle_app -> oracle_migrator is absent, a transitive
    // membership oracle_app -> ops_intermediate -> oracle_migrator is caught by the audit query
    const transitiveMemberships: PgAuthMember[] = [
      {
        member: 10,
        roleid: 30,
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
      {
        member: 30,
        roleid: 20,
        admin_option: false,
        inherit_option: true,
        set_option: true,
      },
    ];
    const auditFailures = runRecursiveRoleAudit(roles, transitiveMemberships);
    expect(auditFailures).toEqual([
      {
        runtime_role: 'oracle_app',
        reachable_role: 'ops_intermediate',
        depth: 1,
        admin_option: false,
        inherit_option: false,
        set_option: true,
        rolsuper: false,
      },
      {
        runtime_role: 'oracle_app',
        reachable_role: 'oracle_migrator',
        depth: 2,
        admin_option: false,
        inherit_option: true,
        set_option: true,
        rolsuper: false,
      },
    ]);

    // Scenario B: Compliant deployment where oracle_app has zero direct or transitive memberships
    expect(runRecursiveRoleAudit(roles, [])).toEqual([]);
  });

  it('enforces v1.8 PostgreSQL 16 minimum-version guard and effective privilege audit queries (static SQL inspection + in-memory TypeScript simulation, not real PostgreSQL execution)', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');

    // --- 1. Static SQL checks for PostgreSQL 16 minimum-version enforcement ---
    expect(contractDoc).toContain('**Minimum supported PostgreSQL version**: **PostgreSQL 16**');
    expect(sqlBlocks).toContain(
      "v_server_version_num := pg_catalog.current_setting('server_version_num')::integer;",
    );
    expect(sqlBlocks).toContain(
      "IF v_server_version_num < 160000 THEN\n    RAISE EXCEPTION\n      'The Oracle ledger contract v1.9 requires PostgreSQL 16 or newer (server_version_num >= 160000), got: %',\n      v_server_version_num\n      USING ERRCODE = '0A000';\n  END IF;",
    );
    expect(sqlBlocks).toContain(
      "WHERE pg_catalog.current_setting('server_version_num')::integer < 160000",
    );

    // --- 2. Static SQL checks for effective table, schema, function, PUBLIC ACL, and ownership audits ---
    expect(sqlBlocks).toContain(
      'WITH required_ledger_tables(schema_name, rel_name, qualified_name) AS (',
    );
    expect(sqlBlocks).toContain('forbidden_table_privs(priv) AS (');
    expect(sqlBlocks).toContain(
      'expected_ledger_functions(fn_sig, fn_name, is_approved_for_app) AS (',
    );
    expect(sqlBlocks).toContain('effective_privilege_violations AS (');

    // Never pass pseudo-role 'public' as a string to has_table_privilege, has_schema_privilege, or has_function_privilege
    expect(sqlBlocks).not.toMatch(/has_table_privilege\s*\(\s*'public'/i);
    expect(sqlBlocks).not.toMatch(/has_schema_privilege\s*\(\s*'public'/i);
    expect(sqlBlocks).not.toMatch(/has_function_privilege\s*\(\s*'public'/i);
    expect(sqlBlocks).not.toMatch(/has_sequence_privilege\s*\(\s*'public'/i);

    // Effective table privilege checks across all relations in oracle_ledger for oracle_app
    expect(sqlBlocks).toContain(
      "WHERE n.nspname = 'oracle_ledger'\n    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')\n    AND pg_catalog.has_table_privilege('oracle_app', c.oid, ftp.priv)",
    );
    expect(sqlBlocks).toContain(
      "AND pg_catalog.has_table_privilege('oracle_app', c.oid, 'SELECT')",
    );

    // Effective schema privilege checks for oracle_app
    expect(sqlBlocks).toContain(
      "WHERE pg_catalog.has_schema_privilege('oracle_app', s.schema_name, 'CREATE')",
    );
    expect(sqlBlocks).toContain(
      "WHERE NOT pg_catalog.has_schema_privilege('oracle_app', 'oracle_ledger', 'USAGE')",
    );

    // PUBLIC ACL inspection via pg_catalog.aclexplode + pg_catalog.acldefault and acl.grantee = 0::oid
    expect(sqlBlocks).toContain('CROSS JOIN LATERAL pg_catalog.aclexplode(');
    expect(sqlBlocks).toContain(
      "COALESCE(n.nspacl, pg_catalog.acldefault('n'::\"char\", n.nspowner))",
    );
    expect(sqlBlocks).toContain(
      "COALESCE(p.proacl, pg_catalog.acldefault('f'::\"char\", p.proowner))",
    );
    expect(sqlBlocks).toContain('AND acl.grantee = 0::oid');

    // Ownership checks across pg_namespace, pg_class, and pg_proc (both oracle_migrator required ownership and oracle_app zero ownership)
    expect(sqlBlocks).toContain('FROM pg_catalog.pg_namespace AS n');
    expect(sqlBlocks).toContain('FROM pg_catalog.pg_class AS c');
    expect(sqlBlocks).toContain('FROM pg_catalog.pg_proc AS p');
    expect(sqlBlocks).toContain(
      "WHERE p.oid = pg_catalog.to_regprocedure(ef.fn_sig)\n       AND r.rolname = 'oracle_migrator'",
    );

    // Effective function EXECUTE checks for oracle_app by exact signature/OID (via LEFT JOIN + p.oid, never ef.fn_sig)
    expect(sqlBlocks).toContain(
      "LEFT JOIN pg_catalog.pg_proc AS p\n    ON p.oid = pg_catalog.to_regprocedure(ef.fn_sig)\n  WHERE ef.is_approved_for_app\n    AND (\n      p.oid IS NULL\n      OR NOT pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')\n    )",
    );
    expect(sqlBlocks).not.toContain(
      "pg_catalog.has_function_privilege('oracle_app', ef.fn_sig, 'EXECUTE')",
    );
    expect(sqlBlocks).toContain(
      "AND p.oid = pg_catalog.to_regprocedure(ef.fn_sig)\n    )\n    AND pg_catalog.has_function_privilege('oracle_app', p.oid, 'EXECUTE')",
    );

    // Preservation of the recursive pg_auth_members role-membership audit
    expect(sqlBlocks).toContain('WITH RECURSIVE role_membership_graph AS (');
    expect(sqlBlocks).toContain('m.admin_option');
    expect(sqlBlocks).toContain('m.inherit_option');
    expect(sqlBlocks).toContain('m.set_option');

    // --- 3. Deterministic in-memory TypeScript simulation (not real PostgreSQL execution)
    //        of the PostgreSQL 16 preflight guard and effective-privilege evaluator ---
    interface SimulatedCatalogState {
      serverVersionNum: number;
      oracleAppSuperOrInherit: boolean;
      oracleMigratorCanLogin: boolean;
      // Direct grants to oracle_app and PUBLIC (effective privilege for oracle_app = direct OR PUBLIC)
      oracleAppTablePrivs: Record<string, Set<string>>;
      publicTablePrivs: Record<string, Set<string>>;
      oracleAppSchemaPrivs: Record<string, Set<string>>;
      publicSchemaPrivs: Record<string, Set<string>>;
      oracleAppOwnedObjects: string[];
      oracleAppFunctionExec: Set<string>;
      publicFunctionExec: Set<string>;
    }

    const LEDGER_TABLES = [
      'oracle_ledger.official_predictions',
      'oracle_ledger.prediction_events',
      'oracle_ledger.publication_idempotency_keys',
    ];
    const FORBIDDEN_TABLE_PRIVS = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'TRIGGER',
      'REFERENCES',
    ];
    const APPROVED_FUNCTIONS = [
      'commit_official_publication',
      'record_rejected_or_conflict_idempotency',
      'append_terminal_prediction_event',
    ];
    const ALL_ORACLE_LEDGER_FUNCTIONS = [
      ...APPROVED_FUNCTIONS,
      'enforce_append_only_ledger_row',
      'enforce_publication_idempotency_immutability',
      'enforce_publication_idempotency_no_truncate',
      'enforce_publication_idempotency_outcome_complete',
    ];

    function runPreflightVersionGuard(serverVersionNum: number): void {
      if (serverVersionNum < 160000) {
        throw new Error(
          `0A000: The Oracle ledger contract v1.9 requires PostgreSQL 16 or newer (server_version_num >= 160000), got: ${serverVersionNum}`,
        );
      }
    }

    function evaluateEffectivePrivilegeViolations(state: SimulatedCatalogState): string[] {
      const violations: string[] = [];

      // Effective privilege helper: in PostgreSQL, has_*_privilege('oracle_app', ...)
      // is true if granted directly to oracle_app OR granted to PUBLIC.
      const hasEffectiveTablePriv = (role: 'oracle_app' | 'public', tbl: string, priv: string) =>
        role === 'public'
          ? Boolean(state.publicTablePrivs[tbl]?.has(priv))
          : Boolean(state.oracleAppTablePrivs[tbl]?.has(priv) || state.publicTablePrivs[tbl]?.has(priv));

      const hasEffectiveSchemaPriv = (role: 'oracle_app' | 'public', schema: string, priv: string) =>
        role === 'public'
          ? Boolean(state.publicSchemaPrivs[schema]?.has(priv))
          : Boolean(
              state.oracleAppSchemaPrivs[schema]?.has(priv) ||
                state.publicSchemaPrivs[schema]?.has(priv),
            );

      const hasEffectiveFnExec = (role: 'oracle_app' | 'public', fn: string) =>
        role === 'public'
          ? state.publicFunctionExec.has(fn)
          : state.oracleAppFunctionExec.has(fn) || state.publicFunctionExec.has(fn);

      if (state.serverVersionNum < 160000) {
        violations.push('version_guard:server_version_num');
      }
      if (state.oracleAppSuperOrInherit) {
        violations.push('role_attributes:oracle_app');
      }
      if (state.oracleMigratorCanLogin) {
        violations.push('role_attributes:oracle_migrator');
      }

      for (const tbl of LEDGER_TABLES) {
        for (const priv of FORBIDDEN_TABLE_PRIVS) {
          if (hasEffectiveTablePriv('oracle_app', tbl, priv)) {
            violations.push(`oracle_app_forbidden_table_priv:${tbl}:${priv}`);
          }
          if (hasEffectiveTablePriv('public', tbl, priv)) {
            violations.push(`public_forbidden_table_priv:${tbl}:${priv}`);
          }
        }
        if (!hasEffectiveTablePriv('oracle_app', tbl, 'SELECT')) {
          violations.push(`oracle_app_missing_select_priv:${tbl}`);
        }
        if (hasEffectiveTablePriv('public', tbl, 'SELECT')) {
          violations.push(`public_forbidden_table_priv:${tbl}:SELECT`);
        }
      }

      for (const schema of ['oracle_ledger', 'public']) {
        if (hasEffectiveSchemaPriv('oracle_app', schema, 'CREATE')) {
          violations.push(`schema_privilege:${schema}:CREATE`);
        }
        if (hasEffectiveSchemaPriv('public', schema, 'CREATE')) {
          violations.push(`public_schema_privilege:${schema}:CREATE`);
        }
      }
      if (!hasEffectiveSchemaPriv('oracle_app', 'oracle_ledger', 'USAGE')) {
        violations.push('schema_privilege:oracle_ledger:missing_USAGE');
      }
      if (hasEffectiveSchemaPriv('public', 'oracle_ledger', 'USAGE')) {
        violations.push('public_schema_privilege:oracle_ledger:USAGE');
      }

      for (const owned of state.oracleAppOwnedObjects) {
        violations.push(`oracle_app_owns_object:${owned}`);
      }

      for (const fn of APPROVED_FUNCTIONS) {
        if (!hasEffectiveFnExec('oracle_app', fn)) {
          violations.push(`oracle_app_missing_approved_execute:${fn}`);
        }
      }
      for (const fn of ALL_ORACLE_LEDGER_FUNCTIONS) {
        if (!APPROVED_FUNCTIONS.includes(fn) && hasEffectiveFnExec('oracle_app', fn)) {
          violations.push(`oracle_app_unapproved_function_execute:${fn}`);
        }
        if (hasEffectiveFnExec('public', fn)) {
          violations.push(`public_function_execute:${fn}`);
        }
      }

      return violations;
    }

    const buildCompliantState = (): SimulatedCatalogState => ({
      serverVersionNum: 160004,
      oracleAppSuperOrInherit: false,
      oracleMigratorCanLogin: false,
      oracleAppTablePrivs: {
        'oracle_ledger.official_predictions': new Set(['SELECT']),
        'oracle_ledger.prediction_events': new Set(['SELECT']),
        'oracle_ledger.publication_idempotency_keys': new Set(['SELECT']),
      },
      publicTablePrivs: {
        'oracle_ledger.official_predictions': new Set(),
        'oracle_ledger.prediction_events': new Set(),
        'oracle_ledger.publication_idempotency_keys': new Set(),
      },
      oracleAppSchemaPrivs: {
        oracle_ledger: new Set(['USAGE']),
        public: new Set(),
      },
      publicSchemaPrivs: {
        oracle_ledger: new Set(),
        public: new Set(),
      },
      oracleAppOwnedObjects: [],
      oracleAppFunctionExec: new Set(APPROVED_FUNCTIONS),
      publicFunctionExec: new Set(),
    });

    // 1. PostgreSQL < 16 fails preflight version guard with SQLSTATE 0A000
    expect(() => runPreflightVersionGuard(150008)).toThrow(
      /0A000: The Oracle ledger contract v1\.9 requires PostgreSQL 16 or newer \(server_version_num >= 160000\), got: 150008/,
    );
    expect(() => runPreflightVersionGuard(160000)).not.toThrow();

    // 2. Compliant PostgreSQL 16+ state yields zero effective-privilege violations
    expect(evaluateEffectivePrivilegeViolations(buildCompliantState())).toEqual([]);

    // 3. Granting INSERT to PUBLIC on a ledger table makes INSERT effective for both PUBLIC and oracle_app
    const publicWriteLeak = buildCompliantState();
    publicWriteLeak.publicTablePrivs['oracle_ledger.publication_idempotency_keys']!.add('INSERT');
    expect(evaluateEffectivePrivilegeViolations(publicWriteLeak)).toEqual([
      'oracle_app_forbidden_table_priv:oracle_ledger.publication_idempotency_keys:INSERT',
      'public_forbidden_table_priv:oracle_ledger.publication_idempotency_keys:INSERT',
    ]);

    // 4. Leaving default PUBLIC EXECUTE on a trigger function is caught for both PUBLIC and oracle_app
    const publicExecLeak = buildCompliantState();
    publicExecLeak.publicFunctionExec.add('enforce_publication_idempotency_immutability');
    expect(evaluateEffectivePrivilegeViolations(publicExecLeak)).toEqual([
      'oracle_app_unapproved_function_execute:enforce_publication_idempotency_immutability',
      'public_function_execute:enforce_publication_idempotency_immutability',
    ]);

    // 5. Ownership of any object or CREATE on oracle_ledger is flagged
    const ownershipAndCreateLeak = buildCompliantState();
    ownershipAndCreateLeak.oracleAppSchemaPrivs.oracle_ledger!.add('CREATE');
    ownershipAndCreateLeak.oracleAppOwnedObjects.push('oracle_ledger.official_predictions');
    expect(evaluateEffectivePrivilegeViolations(ownershipAndCreateLeak)).toEqual([
      'schema_privilege:oracle_ledger:CREATE',
      'oracle_app_owns_object:oracle_ledger.official_predictions',
    ]);
  });

  it('enforces v1.9 PUBLIC catalog ACL inspection (aclexplode/acldefault), complete role attributes (including oracle_migrator NOINHERIT), exact-signature object ownership, and full oracle_ledger relation scope (static SQL inspection + in-memory TypeScript simulation, not real PostgreSQL execution)', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');

    // --- Part A: Static SQL inspection of v1.9+ catalog audit requirements ---
    expect(contractDoc).toMatch(/# THE ORACLE — Publication API & Storage Contract \(v1\.(9|10)\)/);
    expect(contractDoc).toMatch(
      /the Node\.js backend server is not yet deployed to a live production host, and Neon is not[\s>]+yet connected to a live backend runtime/i,
    );

    // 1. Complete role attribute checks for oracle_app and oracle_migrator (including rolinherit)
    expect(sqlBlocks).toContain(
      "WHERE r.rolname = 'oracle_app'\n    AND (\n      r.rolsuper\n      OR r.rolinherit\n      OR r.rolcreatedb\n      OR r.rolcreaterole\n      OR r.rolbypassrls\n      OR r.rolreplication\n      OR NOT r.rolcanlogin\n    )",
    );
    expect(sqlBlocks).toContain(
      "WHERE r.rolname = 'oracle_migrator'\n    AND (\n      r.rolsuper\n      OR r.rolinherit\n      OR r.rolcreatedb\n      OR r.rolcreaterole\n      OR r.rolcanlogin\n    )",
    );

    // 2. All seven expected functions in oracle_ledger are enumerated with exact canonical signatures
    const expectedFunctionSignatures = [
      'oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
      'oracle_ledger.record_rejected_or_conflict_idempotency(text,character,jsonb,timestamp with time zone)',
      'oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)',
      'oracle_ledger.enforce_append_only_ledger_row()',
      'oracle_ledger.enforce_publication_idempotency_immutability()',
      'oracle_ledger.enforce_publication_idempotency_no_truncate()',
      'oracle_ledger.enforce_publication_idempotency_outcome_complete()',
    ];
    for (const sig of expectedFunctionSignatures) {
      expect(sqlBlocks).toContain(`'${sig}'`);
    }

    // 3. Required ownership checks for schema oracle_ledger, the 3 ledger tables, and all 7 functions
    expect(sqlBlocks).toContain("'required_schema_ownership'");
    expect(sqlBlocks).toContain("'required_table_ownership'");
    expect(sqlBlocks).toContain("'required_function_ownership'");

    // --- Part B: Deterministic in-memory TypeScript simulation (not live PostgreSQL execution)
    //             of aclexplode/acldefault PUBLIC ACLs, role attributes, exact-signature ownership,
    //             and extra relations in oracle_ledger ---
    const PUBLIC_OID = 0; // PostgreSQL pseudo-role PUBLIC in aclitem[]
    const ORACLE_APP_OID = 10;
    const ORACLE_MIGRATOR_OID = 20;
    const OTHER_ROLE_OID = 99;

    interface SimulatedAclEntry {
      grantee: number; // 0 = PUBLIC
      privilege_type: string;
    }

    interface SimulatedRoleRow {
      oid: number;
      rolname: string;
      rolsuper: boolean;
      rolinherit: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      rolreplication: boolean;
      rolcanlogin: boolean;
    }

    interface SimulatedSchemaRow {
      nspname: string;
      nspowner: number;
      nspacl: SimulatedAclEntry[] | null; // null => acldefault('n', nspowner)
    }

    interface SimulatedRelationRow {
      nspname: string;
      relname: string;
      relkind: 'r' | 'p' | 'v' | 'm' | 'f' | 'S';
      relowner: number;
      relacl: SimulatedAclEntry[] | null; // null => acldefault('r' | 'S', relowner)
    }

    interface SimulatedFunctionRow {
      signature: string;
      nspname: string;
      proname: string;
      proowner: number;
      proacl: SimulatedAclEntry[] | null; // null => acldefault('f', proowner) which grants EXECUTE to PUBLIC (0)!
    }

    // Simulates PostgreSQL's pg_catalog.acldefault(type, ownerOid)
    function simulateAclDefault(
      objType: 'r' | 'S' | 'n' | 'f',
      ownerOid: number,
    ): SimulatedAclEntry[] {
      if (objType === 'f') {
        // In PostgreSQL, default function ACL grants EXECUTE to owner AND to PUBLIC (grantee = 0)
        return [
          { grantee: ownerOid, privilege_type: 'EXECUTE' },
          { grantee: PUBLIC_OID, privilege_type: 'EXECUTE' },
        ];
      }
      if (objType === 'n') {
        return [
          { grantee: ownerOid, privilege_type: 'USAGE' },
          { grantee: ownerOid, privilege_type: 'CREATE' },
        ];
      }
      if (objType === 'S') {
        return [
          { grantee: ownerOid, privilege_type: 'USAGE' },
          { grantee: ownerOid, privilege_type: 'SELECT' },
          { grantee: ownerOid, privilege_type: 'UPDATE' },
        ];
      }
      return [
        { grantee: ownerOid, privilege_type: 'SELECT' },
        { grantee: ownerOid, privilege_type: 'INSERT' },
        { grantee: ownerOid, privilege_type: 'UPDATE' },
        { grantee: ownerOid, privilege_type: 'DELETE' },
        { grantee: ownerOid, privilege_type: 'TRUNCATE' },
        { grantee: ownerOid, privilege_type: 'REFERENCES' },
        { grantee: ownerOid, privilege_type: 'TRIGGER' },
      ];
    }

    function explodeEffectiveAcl(
      acl: SimulatedAclEntry[] | null,
      objType: 'r' | 'S' | 'n' | 'f',
      ownerOid: number,
    ): SimulatedAclEntry[] {
      return acl !== null ? acl : simulateAclDefault(objType, ownerOid);
    }

    interface SimulatedV19Catalog {
      roles: SimulatedRoleRow[];
      schemas: SimulatedSchemaRow[];
      relations: SimulatedRelationRow[];
      functions: SimulatedFunctionRow[];
    }

    const REQUIRED_TABLES = [
      'oracle_ledger.official_predictions',
      'oracle_ledger.prediction_events',
      'oracle_ledger.publication_idempotency_keys',
    ];
    const APPROVED_SIGNATURES = new Set(expectedFunctionSignatures.slice(0, 3));
    const FORBIDDEN_REL_PRIVS = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'TRIGGER',
      'REFERENCES',
    ];

    function runV19CatalogAudit(cat: SimulatedV19Catalog): string[] {
      const violations: string[] = [];
      const roleByName = new Map(cat.roles.map((r) => [r.rolname, r]));

      // 2a. Required roles exist
      for (const reqRole of ['oracle_app', 'oracle_migrator']) {
        if (!roleByName.has(reqRole)) {
          violations.push(`missing_required_role:${reqRole}`);
        }
      }

      // 2b. oracle_app role attributes
      const appRole = roleByName.get('oracle_app');
      if (
        appRole &&
        (appRole.rolsuper ||
          appRole.rolinherit ||
          appRole.rolcreatedb ||
          appRole.rolcreaterole ||
          appRole.rolbypassrls ||
          appRole.rolreplication ||
          !appRole.rolcanlogin)
      ) {
        violations.push('role_attributes:oracle_app');
      }

      // 2c. oracle_migrator role attributes (must include rolinherit = false / NOINHERIT)
      const migRole = roleByName.get('oracle_migrator');
      if (
        migRole &&
        (migRole.rolsuper ||
          migRole.rolinherit ||
          migRole.rolcreatedb ||
          migRole.rolcreaterole ||
          migRole.rolcanlogin)
      ) {
        violations.push('role_attributes:oracle_migrator');
      }

      const hasRelPrivForApp = (rel: SimulatedRelationRow, priv: string): boolean => {
        if (rel.relowner === ORACLE_APP_OID) return true;
        const entries = explodeEffectiveAcl(
          rel.relacl,
          rel.relkind === 'S' ? 'S' : 'r',
          rel.relowner,
        );
        return entries.some(
          (e) =>
            (e.grantee === ORACLE_APP_OID || e.grantee === PUBLIC_OID) &&
            e.privilege_type === priv,
        );
      };

      // 3a & 3b. Every relation in oracle_ledger checked for forbidden oracle_app privileges
      for (const rel of cat.relations.filter((r) => r.nspname === 'oracle_ledger')) {
        const qName = `${rel.nspname}.${rel.relname}`;
        if (rel.relkind === 'S') {
          for (const sp of ['USAGE', 'SELECT', 'UPDATE']) {
            if (hasRelPrivForApp(rel, sp)) {
              violations.push(`oracle_app_forbidden_sequence_priv:${qName}:${sp}`);
            }
          }
        } else {
          for (const fp of FORBIDDEN_REL_PRIVS) {
            if (hasRelPrivForApp(rel, fp)) {
              violations.push(`oracle_app_forbidden_table_priv:${qName}:${fp}`);
            }
          }
        }
      }

      // 4. Required ledger tables have SELECT for oracle_app
      for (const reqTable of REQUIRED_TABLES) {
        const [nsp, relname] = reqTable.split('.');
        const found = cat.relations.find(
          (r) => r.nspname === nsp && r.relname === relname && r.relkind === 'r',
        );
        if (!found || !hasRelPrivForApp(found, 'SELECT')) {
          violations.push(`oracle_app_missing_select_priv:${reqTable}`);
        }
      }

      // 5. PUBLIC (grantee = 0) ACL check on all relations in oracle_ledger
      for (const rel of cat.relations.filter((r) => r.nspname === 'oracle_ledger')) {
        const qName = `${rel.nspname}.${rel.relname}`;
        const entries = explodeEffectiveAcl(
          rel.relacl,
          rel.relkind === 'S' ? 'S' : 'r',
          rel.relowner,
        );
        for (const e of entries) {
          if (
            e.grantee === PUBLIC_OID &&
            [
              'SELECT',
              'INSERT',
              'UPDATE',
              'DELETE',
              'TRUNCATE',
              'TRIGGER',
              'REFERENCES',
              'USAGE',
            ].includes(e.privilege_type)
          ) {
            violations.push(`public_forbidden_table_acl:${qName}:${e.privilege_type}`);
          }
        }
      }

      // 6a & 6b. Schema privileges for oracle_app and PUBLIC (grantee = 0)
      for (const sName of ['oracle_ledger', 'public']) {
        const s = cat.schemas.find((sc) => sc.nspname === sName);
        if (!s) continue;
        const entries = explodeEffectiveAcl(s.nspacl, 'n', s.nspowner);
        const appHas = (priv: string) =>
          s.nspowner === ORACLE_APP_OID ||
          entries.some(
            (e) =>
              (e.grantee === ORACLE_APP_OID || e.grantee === PUBLIC_OID) &&
              e.privilege_type === priv,
          );
        if (appHas('CREATE')) {
          violations.push(`schema_privilege:${sName}:CREATE`);
        }
        if (sName === 'oracle_ledger' && !appHas('USAGE')) {
          violations.push('schema_privilege:oracle_ledger:missing_USAGE');
        }
        for (const e of entries) {
          if (
            e.grantee === PUBLIC_OID &&
            ((sName === 'oracle_ledger' && ['CREATE', 'USAGE'].includes(e.privilege_type)) ||
              (sName === 'public' && e.privilege_type === 'CREATE'))
          ) {
            violations.push(`public_schema_acl:${sName}:${e.privilege_type}`);
          }
        }
      }

      // 7a. oracle_migrator owns schema oracle_ledger
      const ledgerSchema = cat.schemas.find((s) => s.nspname === 'oracle_ledger');
      if (!ledgerSchema || ledgerSchema.nspowner !== ORACLE_MIGRATOR_OID) {
        violations.push('required_schema_ownership:oracle_ledger');
      }

      // 7b. oracle_migrator owns all 3 required ledger tables
      for (const reqTable of REQUIRED_TABLES) {
        const [nsp, relname] = reqTable.split('.');
        const found = cat.relations.find(
          (r) => r.nspname === nsp && r.relname === relname && r.relkind === 'r',
        );
        if (!found || found.relowner !== ORACLE_MIGRATOR_OID) {
          violations.push(`required_table_ownership:${reqTable}`);
        }
      }

      // 7c. oracle_migrator owns all 7 expected functions by exact signature
      for (const expectedSig of expectedFunctionSignatures) {
        const fn = cat.functions.find((f) => f.signature === expectedSig);
        if (!fn || fn.proowner !== ORACLE_MIGRATOR_OID) {
          violations.push(`required_function_ownership:${expectedSig}`);
        }
      }

      // 7d. oracle_app owns zero schemas, relations, or functions
      for (const s of cat.schemas.filter((sc) => sc.nspowner === ORACLE_APP_OID)) {
        violations.push(`oracle_app_owns_schema:${s.nspname}`);
      }
      for (const r of cat.relations.filter((rel) => rel.relowner === ORACLE_APP_OID)) {
        violations.push(`oracle_app_owns_relation:${r.nspname}.${r.relname}`);
      }
      for (const f of cat.functions.filter((fn) => fn.proowner === ORACLE_APP_OID)) {
        violations.push(`oracle_app_owns_function:${f.signature}`);
      }

      // 8, 9, 10. Function EXECUTE checks for oracle_app and PUBLIC (via aclexplode + acldefault('f', proowner))
      const hasFnExecForApp = (fn: SimulatedFunctionRow): boolean => {
        if (fn.proowner === ORACLE_APP_OID) return true;
        const entries = explodeEffectiveAcl(fn.proacl, 'f', fn.proowner);
        return entries.some(
          (e) =>
            (e.grantee === ORACLE_APP_OID || e.grantee === PUBLIC_OID) &&
            e.privilege_type === 'EXECUTE',
        );
      };

      for (const approvedSig of APPROVED_SIGNATURES) {
        const fn = cat.functions.find((f) => f.signature === approvedSig);
        if (!fn || !hasFnExecForApp(fn)) {
          violations.push(`oracle_app_missing_approved_execute:${approvedSig}`);
        }
      }

      for (const fn of cat.functions.filter((f) => f.nspname === 'oracle_ledger')) {
        if (!APPROVED_SIGNATURES.has(fn.signature) && hasFnExecForApp(fn)) {
          violations.push(`oracle_app_unapproved_function_execute:${fn.signature}`);
        }
        const entries = explodeEffectiveAcl(fn.proacl, 'f', fn.proowner);
        if (entries.some((e) => e.grantee === PUBLIC_OID && e.privilege_type === 'EXECUTE')) {
          violations.push(`public_function_acl:${fn.signature}`);
        }
      }

      return violations;
    }

    const buildCompliantV19Catalog = (): SimulatedV19Catalog => ({
      roles: [
        {
          oid: ORACLE_APP_OID,
          rolname: 'oracle_app',
          rolsuper: false,
          rolinherit: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
          rolreplication: false,
          rolcanlogin: true,
        },
        {
          oid: ORACLE_MIGRATOR_OID,
          rolname: 'oracle_migrator',
          rolsuper: false,
          rolinherit: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolbypassrls: false,
          rolreplication: false,
          rolcanlogin: false,
        },
      ],
      schemas: [
        {
          nspname: 'oracle_ledger',
          nspowner: ORACLE_MIGRATOR_OID,
          nspacl: [
            { grantee: ORACLE_MIGRATOR_OID, privilege_type: 'CREATE' },
            { grantee: ORACLE_MIGRATOR_OID, privilege_type: 'USAGE' },
            { grantee: ORACLE_APP_OID, privilege_type: 'USAGE' },
          ],
        },
        {
          nspname: 'public',
          nspowner: OTHER_ROLE_OID,
          nspacl: [{ grantee: OTHER_ROLE_OID, privilege_type: 'CREATE' }],
        },
      ],
      relations: REQUIRED_TABLES.map((q) => {
        const [nspname, relname] = q.split('.') as [string, string];
        return {
          nspname,
          relname,
          relkind: 'r',
          relowner: ORACLE_MIGRATOR_OID,
          relacl: [{ grantee: ORACLE_APP_OID, privilege_type: 'SELECT' }],
        };
      }),
      functions: expectedFunctionSignatures.map((sig) => {
        const proname = sig.slice('oracle_ledger.'.length, sig.indexOf('('));
        const isApproved = APPROVED_SIGNATURES.has(sig);
        return {
          signature: sig,
          nspname: 'oracle_ledger',
          proname,
          proowner: ORACLE_MIGRATOR_OID,
          proacl: isApproved
            ? [
                { grantee: ORACLE_MIGRATOR_OID, privilege_type: 'EXECUTE' },
                { grantee: ORACLE_APP_OID, privilege_type: 'EXECUTE' },
              ]
            : [{ grantee: ORACLE_MIGRATOR_OID, privilege_type: 'EXECUTE' }],
        };
      }),
    });

    // Case 1: Compliant catalog state returns zero violations
    expect(runV19CatalogAudit(buildCompliantV19Catalog())).toEqual([]);

    // Case 2: Default NULL function ACL (proacl === null) grants EXECUTE to PUBLIC via acldefault('f', owner)
    // and is detected for both PUBLIC and oracle_app
    const defaultFnAclCat = buildCompliantV19Catalog();
    const triggerFn = defaultFnAclCat.functions.find(
      (f) => f.proname === 'enforce_append_only_ledger_row',
    )!;
    triggerFn.proacl = null; // Unrevoked default PostgreSQL function ACL
    expect(runV19CatalogAudit(defaultFnAclCat)).toEqual([
      'oracle_app_unapproved_function_execute:oracle_ledger.enforce_append_only_ledger_row()',
      'public_function_acl:oracle_ledger.enforce_append_only_ledger_row()',
    ]);

    // Case 3: PUBLIC table and schema ACL grants (grantee = 0) are detected
    const publicAclCat = buildCompliantV19Catalog();
    publicAclCat.relations[0]!.relacl!.push({
      grantee: PUBLIC_OID,
      privilege_type: 'SELECT',
    });
    publicAclCat.schemas[0]!.nspacl!.push({
      grantee: PUBLIC_OID,
      privilege_type: 'USAGE',
    });
    publicAclCat.schemas[1]!.nspacl!.push({
      grantee: PUBLIC_OID,
      privilege_type: 'CREATE',
    });
    expect(runV19CatalogAudit(publicAclCat)).toEqual([
      'public_forbidden_table_acl:oracle_ledger.official_predictions:SELECT',
      'public_schema_acl:oracle_ledger:USAGE',
      'schema_privilege:public:CREATE',
      'public_schema_acl:public:CREATE',
    ]);

    // Case 4: oracle_migrator with INHERIT (rolinherit = true) is rejected, whereas NOINHERIT passes
    const inheritMigratorCat = buildCompliantV19Catalog();
    inheritMigratorCat.roles.find((r) => r.rolname === 'oracle_migrator')!.rolinherit = true;
    expect(runV19CatalogAudit(inheritMigratorCat)).toEqual(['role_attributes:oracle_migrator']);

    // Case 5: Missing or wrong ownership of schema, each required table, and each required function by exact signature
    const wrongOwnerCat = buildCompliantV19Catalog();
    wrongOwnerCat.schemas[0]!.nspowner = OTHER_ROLE_OID;
    wrongOwnerCat.relations[1]!.relowner = OTHER_ROLE_OID;
    wrongOwnerCat.functions[2]!.proowner = OTHER_ROLE_OID;
    expect(runV19CatalogAudit(wrongOwnerCat)).toEqual([
      'required_schema_ownership:oracle_ledger',
      'required_table_ownership:oracle_ledger.prediction_events',
      'required_function_ownership:oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)',
    ]);

    // Also verify that if a function signature is altered (even if proname is unchanged), exact-signature ownership and execute checks catch it
    const alteredSigCat = buildCompliantV19Catalog();
    alteredSigCat.functions[0]!.signature = 'oracle_ledger.commit_official_publication(text)';
    expect(runV19CatalogAudit(alteredSigCat)).toEqual([
      'required_function_ownership:oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
      'oracle_app_missing_approved_execute:oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
      'oracle_app_unapproved_function_execute:oracle_ledger.commit_official_publication(text)',
    ]);

    // Case 6: An additional relation in oracle_ledger with a forbidden privilege is detected
    const extraRelationCat = buildCompliantV19Catalog();
    extraRelationCat.relations.push({
      nspname: 'oracle_ledger',
      relname: 'auxiliary_staging_table',
      relkind: 'r',
      relowner: ORACLE_MIGRATOR_OID,
      relacl: [{ grantee: ORACLE_APP_OID, privilege_type: 'INSERT' }],
    });
    expect(runV19CatalogAudit(extraRelationCat)).toEqual([
      'oracle_app_forbidden_table_priv:oracle_ledger.auxiliary_staging_table:INSERT',
    ]);
  });

  it('enforces v1.10 missing-function audit safety by resolving approved functions once via to_regprocedure + LEFT JOIN and passing p.oid (never ef.fn_sig) to has_function_privilege (static SQL inspection + in-memory TypeScript simulation, not real PostgreSQL execution)', () => {
    const contractDoc = readFileSync(
      resolve(process.cwd(), 'docs/PUBLICATION-API-CONTRACT.md'),
      'utf8',
    );
    const sqlBlocks = Array.from(
      contractDoc.matchAll(/```sql\r?\n([\s\S]*?)```/g),
      (m) => m[1],
    ).join('\n');

    // --- Part A: Static SQL contract inspection for v1.10 missing-function audit safety ---
    expect(contractDoc).toContain('# THE ORACLE — Publication API & Storage Contract (v1.10)');

    // 1. Check 8 resolves each approved function via LEFT JOIN pg_catalog.pg_proc ON p.oid = pg_catalog.to_regprocedure(ef.fn_sig)
    //    and calls has_function_privilege('oracle_app', p.oid, 'EXECUTE') with the resolved OID, never ef.fn_sig
    const check8Pattern =
      /SELECT\s+'oracle_app_missing_approved_execute',\s+ef\.fn_sig,\s+'oracle_app is missing EXECUTE privilege on approved function ' \|\| ef\.fn_sig\s+FROM expected_ledger_functions AS ef\s+LEFT JOIN pg_catalog\.pg_proc AS p\s+ON p\.oid = pg_catalog\.to_regprocedure\(ef\.fn_sig\)\s+WHERE ef\.is_approved_for_app\s+AND \(\s+p\.oid IS NULL\s+OR NOT pg_catalog\.has_function_privilege\('oracle_app', p\.oid, 'EXECUTE'\)\s+\)/;
    expect(sqlBlocks).toMatch(check8Pattern);

    // Ensure the unsafe signature-string call has_function_privilege('oracle_app', ef.fn_sig, ...) is completely absent
    expect(sqlBlocks).not.toMatch(/has_function_privilege\s*\(\s*'oracle_app'\s*,\s*ef\.fn_sig/i);

    // Ensure check 8 invokes to_regprocedure(ef.fn_sig) only once (inside the LEFT JOIN ON clause)
    const check8Section = sqlBlocks.slice(
      sqlBlocks.indexOf("'oracle_app_missing_approved_execute'"),
      sqlBlocks.indexOf("'oracle_app_unapproved_function_execute'"),
    );
    const toRegprocMatchesInCheck8 = check8Section.match(
      /pg_catalog\.to_regprocedure\(ef\.fn_sig\)/g,
    );
    expect(toRegprocMatchesInCheck8).toHaveLength(1);

    // 2. Preserve exact signature matching and the existing required-function-ownership check (7c)
    expect(sqlBlocks).toContain(
      "SELECT\n    'required_function_ownership',\n    ef.fn_sig,\n    'required function ' || ef.fn_sig || ' is missing or not owned by oracle_migrator'\n  FROM expected_ledger_functions AS ef\n  WHERE NOT EXISTS (\n    SELECT 1\n      FROM pg_catalog.pg_proc AS p\n      JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner\n     WHERE p.oid = pg_catalog.to_regprocedure(ef.fn_sig)\n       AND r.rolname = 'oracle_migrator'\n  )",
    );

    // --- Part B: Deterministic in-memory TypeScript simulation (not live PostgreSQL execution)
    //             of LEFT JOIN OID resolution and missing-function safety ---
    const ORACLE_APP_OID = 10;
    const ORACLE_MIGRATOR_OID = 20;

    interface ExpectedFnSpec {
      fn_sig: string;
      fn_name: string;
      is_approved_for_app: boolean;
    }

    interface SimulatedPgProcRow {
      oid: number;
      fn_sig: string;
      proowner: number;
      executableByApp: boolean;
    }

    const EXPECTED_FUNCTIONS: ExpectedFnSpec[] = [
      {
        fn_sig:
          'oracle_ledger.commit_official_publication(text,character,text,character,jsonb,character,timestamp with time zone,timestamp with time zone,jsonb,character)',
        fn_name: 'commit_official_publication',
        is_approved_for_app: true,
      },
      {
        fn_sig:
          'oracle_ledger.record_rejected_or_conflict_idempotency(text,character,jsonb,timestamp with time zone)',
        fn_name: 'record_rejected_or_conflict_idempotency',
        is_approved_for_app: true,
      },
      {
        fn_sig:
          'oracle_ledger.append_terminal_prediction_event(text,text,timestamp with time zone,timestamp with time zone,jsonb,character,character)',
        fn_name: 'append_terminal_prediction_event',
        is_approved_for_app: true,
      },
      {
        fn_sig: 'oracle_ledger.enforce_append_only_ledger_row()',
        fn_name: 'enforce_append_only_ledger_row',
        is_approved_for_app: false,
      },
      {
        fn_sig: 'oracle_ledger.enforce_publication_idempotency_immutability()',
        fn_name: 'enforce_publication_idempotency_immutability',
        is_approved_for_app: false,
      },
      {
        fn_sig: 'oracle_ledger.enforce_publication_idempotency_no_truncate()',
        fn_name: 'enforce_publication_idempotency_no_truncate',
        is_approved_for_app: false,
      },
      {
        fn_sig: 'oracle_ledger.enforce_publication_idempotency_outcome_complete()',
        fn_name: 'enforce_publication_idempotency_outcome_complete',
        is_approved_for_app: false,
      },
    ];

    function simulateV110FunctionAudit(pgProcRows: SimulatedPgProcRow[]): {
      violations: string[];
      check8ToRegprocedureCallCountBySig: Record<string, number>;
    } {
      const procByOid = new Map(pgProcRows.map((row) => [row.oid, row]));
      const procBySig = new Map(pgProcRows.map((row) => [row.fn_sig, row]));
      const check8ToRegprocedureCallCountBySig: Record<string, number> = {};

      // Simulates pg_catalog.to_regprocedure(text): returns OID or null if function is missing (never throws)
      const toRegprocedure = (sig: string, trackCheck8: boolean): number | null => {
        if (trackCheck8) {
          check8ToRegprocedureCallCountBySig[sig] =
            (check8ToRegprocedureCallCountBySig[sig] ?? 0) + 1;
        }
        return procBySig.get(sig)?.oid ?? null;
      };

      // Simulates pg_catalog.has_function_privilege(role, oid, 'EXECUTE'):
      // Strict on NULL::oid; throws if a caller ever passes a string signature or unknown non-null OID
      const hasFunctionPrivilegeByOid = (
        roleOid: number,
        fnOid: number | null,
        priv: 'EXECUTE',
      ): boolean | null => {
        if (typeof fnOid !== 'number') {
          return null; // PostgreSQL STRICT behavior on NULL::oid
        }
        const row = procByOid.get(fnOid);
        if (!row) {
          throw new Error(`42883: function with OID ${fnOid} does not exist`);
        }
        return roleOid === ORACLE_APP_OID && priv === 'EXECUTE' ? row.executableByApp : false;
      };

      const violations: string[] = [];

      // Check 7c: required_function_ownership
      for (const ef of EXPECTED_FUNCTIONS) {
        const resolvedOid = toRegprocedure(ef.fn_sig, false);
        const row = resolvedOid !== null ? procByOid.get(resolvedOid) : undefined;
        if (!row || row.proowner !== ORACLE_MIGRATOR_OID) {
          violations.push(`required_function_ownership:${ef.fn_sig}`);
        }
      }

      // Check 8: LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(ef.fn_sig)
      //          WHERE ef.is_approved_for_app AND (p.oid IS NULL OR NOT has_function_privilege('oracle_app', p.oid, 'EXECUTE'))
      for (const ef of EXPECTED_FUNCTIONS.filter((f) => f.is_approved_for_app)) {
        // Resolve each approved function exactly once through to_regprocedure(ef.fn_sig)
        const resolvedOid = toRegprocedure(ef.fn_sig, true);
        const joinedProc = resolvedOid !== null ? (procByOid.get(resolvedOid) ?? null) : null;
        const pOid: number | null = joinedProc ? joinedProc.oid : null;

        // Even if the SQL planner evaluates both sides of OR, has_function_privilege receives p.oid (number | null), never ef.fn_sig
        const privResult = hasFunctionPrivilegeByOid(ORACLE_APP_OID, pOid, 'EXECUTE');
        if (pOid === null || privResult !== true) {
          violations.push(`oracle_app_missing_approved_execute:${ef.fn_sig}`);
        }
      }

      return { violations, check8ToRegprocedureCallCountBySig };
    }

    const buildCompliantPgProcCatalog = (): SimulatedPgProcRow[] =>
      EXPECTED_FUNCTIONS.map((ef, idx) => ({
        oid: 1000 + idx,
        fn_sig: ef.fn_sig,
        proowner: ORACLE_MIGRATOR_OID,
        executableByApp: ef.is_approved_for_app,
      }));

    // Scenario 1: An approved function missing entirely — emits oracle_app_missing_approved_execute
    //             (plus required_function_ownership) without throwing a signature-resolution error,
    //             and resolves each approved function exactly once in Check 8
    const missingApprovedFnCatalog = buildCompliantPgProcCatalog().filter(
      (row) => row.fn_sig !== EXPECTED_FUNCTIONS[1]!.fn_sig,
    );
    const missingResult = simulateV110FunctionAudit(missingApprovedFnCatalog);
    expect(missingResult.violations).toEqual([
      `required_function_ownership:${EXPECTED_FUNCTIONS[1]!.fn_sig}`,
      `oracle_app_missing_approved_execute:${EXPECTED_FUNCTIONS[1]!.fn_sig}`,
    ]);
    expect(missingResult.check8ToRegprocedureCallCountBySig).toEqual({
      [EXPECTED_FUNCTIONS[0]!.fn_sig]: 1,
      [EXPECTED_FUNCTIONS[1]!.fn_sig]: 1,
      [EXPECTED_FUNCTIONS[2]!.fn_sig]: 1,
    });

    // Scenario 2: An approved function present (and owned by oracle_migrator) but missing EXECUTE for oracle_app
    const missingExecCatalog = buildCompliantPgProcCatalog();
    missingExecCatalog[2]!.executableByApp = false;
    const missingExecResult = simulateV110FunctionAudit(missingExecCatalog);
    expect(missingExecResult.violations).toEqual([
      `oracle_app_missing_approved_execute:${EXPECTED_FUNCTIONS[2]!.fn_sig}`,
    ]);

    // Scenario 3 & 4: All approved functions present with EXECUTE in a compliant catalog produce zero violations
    const compliantResult = simulateV110FunctionAudit(buildCompliantPgProcCatalog());
    expect(compliantResult.violations).toEqual([]);
    expect(compliantResult.check8ToRegprocedureCallCountBySig).toEqual({
      [EXPECTED_FUNCTIONS[0]!.fn_sig]: 1,
      [EXPECTED_FUNCTIONS[1]!.fn_sig]: 1,
      [EXPECTED_FUNCTIONS[2]!.fn_sig]: 1,
    });
  });
});



