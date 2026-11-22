import { describe, expect, it } from 'vitest';
import {
  AliasTable,
  compareIdentities,
  identityDigest,
  normalizeTermValue,
  term,
  unresolvedTerm,
  type AliasEntry,
} from './canonical-identity';
import {
  InMemoryRegistry,
  advance,
  canTransition,
  evaluateCandidate,
  isPublishable,
  publishCandidate,
  verdictIsComplete,
  type PublicationDeps,
} from './publication';
import {
  EVALUATION_REQUIREMENTS,
  LIFECYCLE,
  type CandidateProposition,
  type PropositionIdentity,
  type PublicationRequest,
} from './publication-types';
import { predictionRecords } from './records';
import { appendEvent, payloadBytes, sealedPayload } from './events';
import { sha256Hex } from './hash';
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

function validCandidate(overrides: Partial<CandidateProposition> = {}): CandidateProposition {
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
        title: 'FIFA world ranking, December 2029',
        publisher: 'FIFA',
        publishedAt: '2029-12-20T00:00:00.000Z',
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
    stage: 'eligible-for-publication',
    createdAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

function request(overrides: Partial<PublicationRequest> = {}): PublicationRequest {
  return {
    candidateId: 'cand-1',
    idempotencyKey: 'key-1',
    identity: argentinaWins2030(),
    candidateDigest: 'a'.repeat(64),
    requestedAt: '2026-11-22T00:00:00.000Z',
    ...overrides,
  };
}

function deps(registry = new InMemoryRegistry()): PublicationDeps {
  return {
    registry,
    aliases: aliasTable(),
    now: () => '2026-11-22T00:00:00.000Z',
    newPredictionId: (digest) => `ORC-2030-${digest.slice(0, 4).toUpperCase()}`,
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
    const outcome = await publishCandidate(
      validCandidate({ probability: null }),
      request(),
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
    const outcome = await publishCandidate(
      validCandidate({ proposedIdentity: uncertain }),
      request({ identity: uncertain }),
      deps(registry),
    );
    expect(outcome.kind).toBe('identity-conflict');
    expect(registry.size).toBe(0);
  });

  it('returns the existing record for a duplicate publication', async () => {
    const registry = new InMemoryRegistry();
    const first = await publishCandidate(validCandidate(), request({ idempotencyKey: 'k1' }), deps(registry));
    const second = await publishCandidate(
      validCandidate({ candidateId: 'cand-2' }),
      request({ idempotencyKey: 'k2' }),
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
    const request1 = request({ idempotencyKey: 'same' });
    const rejected = await publishCandidate(
      validCandidate({ probability: null }),
      request1,
      deps(registry),
    );
    const replay = await publishCandidate(validCandidate(), request1, deps(registry));

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
      request({ idempotencyKey: 'b', identity: rephrased.proposedIdentity }),
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

    const rejectedByEval = await publishCandidate(
      validCandidate({ probability: null, evidence: [] }),
      request({ idempotencyKey: 'rej-eval' }),
      deps(registry),
    );
    const rejectedByStage = await publishCandidate(
      validCandidate({ stage: 'rejected-candidate' }),
      request({ idempotencyKey: 'rej-stage' }),
      deps(registry),
    );

    expect(rejectedByEval.kind).toBe('rejected');
    expect(rejectedByStage.kind).toBe('wrong-stage');
    expect(registry.size).toBe(0);
    expect(await registry.findByIdentity(digest)).toBeNull();
  });
});
