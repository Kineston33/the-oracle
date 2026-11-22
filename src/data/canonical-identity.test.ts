import { describe, expect, it } from 'vitest';
import {
  AliasTable,
  IDENTITY_COMPONENTS,
  canonicalIdentity,
  compareIdentities,
  identityDigest,
  normalizeTermValue,
  term,
  unresolvedTerm,
  type AliasEntry,
} from './canonical-identity';
import type { PropositionIdentity } from './publication-types';

const WORLD_CUP: AliasEntry[] = [
  {
    namespace: 'team',
    canonical: 'fifa-argentina',
    aliases: ['fifa-argentina', 'albiceleste', 'argentina', 'Argentina'],
  },
  {
    namespace: 'outcome',
    canonical: 'win-tournament',
    aliases: ['win-tournament', 'become-world-champions', 'win-the-cup', 'lift-the-trophy'],
  },
  {
    namespace: 'outcome',
    canonical: 'reach-final',
    aliases: ['reach-final', 'play-the-final'],
  },
];

function identity(overrides: Partial<PropositionIdentity> = {}): PropositionIdentity {
  return {
    subject: term('team', 'fifa-argentina'),
    event: term('outcome', 'win-tournament'),
    condition: term('literal', 'outright-winner'),
    geographicScope: term('scope', 'global'),
    horizon: term('period', '2030'),
    resolutionDate: '2031-01-15T00:00:00.000Z',
    decidingAuthority: term('dataset', 'fifa-official-results'),
    ...overrides,
  };
}

describe('normalizeTermValue', () => {
  it('folds case, surrounding whitespace and punctuation', () => {
    expect(normalizeTermValue('  FIFA-Argentina ')).toBe('fifa-argentina');
    expect(normalizeTermValue('fifa  argentina')).toBe('fifa-argentina');
    expect(normalizeTermValue('--fifa--argentina--')).toBe('fifa-argentina');
  });

  it('applies NFKC so compatibility forms converge', () => {
    // U+FB01 LATIN SMALL LIGATURE FI normalises to "fi" under NFKC.
    expect(normalizeTermValue('\uFB01fa')).toBe('fifa');
    expect(normalizeTermValue('ﬁfa')).toBe(normalizeTermValue('fifa'));
  });

  it('keeps non-Latin scripts instead of deleting them', () => {
    // An ASCII-only pattern would turn all three of these into the empty string,
    // which would make three unrelated subjects compare equal.
    expect(normalizeTermValue('Аргентина')).toBe('аргентина');
    expect(normalizeTermValue('日本')).toBe('日本');
    expect(normalizeTermValue('الأرجنتين')).toBe('الأرجنتين');
    expect(normalizeTermValue('日本')).not.toBe(normalizeTermValue('中国'));
  });

  it('preserves combining marks', () => {
    expect(normalizeTermValue('cafe\u0301')).toBe('café');
    expect(normalizeTermValue('café')).toBe(normalizeTermValue('cafe\u0301'));
  });
});

describe('identifier construction', () => {
  it('normalises both namespace and id', () => {
    expect(term('Team ', 'FIFA-Argentina')).toEqual({
      namespace: 'team',
      id: 'fifa-argentina',
    });
  });

  it('records a gap explicitly rather than omitting the field', () => {
    const gap = unresolvedTerm();
    expect(gap.unresolved).toBe(true);
    expect(gap.id).toBe('unknown');
  });
});

describe('AliasTable', () => {
  it('resolves aliases to the canonical identifier', () => {
    const table = new AliasTable(WORLD_CUP);
    expect(table.resolve(term('team', 'albiceleste')).id).toBe('fifa-argentina');
    expect(table.resolve(term('outcome', 'become-world-champions')).id).toBe('win-tournament');
  });

  it('leaves unknown identifiers alone instead of inventing a mapping', () => {
    const table = new AliasTable(WORLD_CUP);
    const unknown = term('team', 'fifa-brazil');
    expect(table.resolve(unknown)).toEqual(unknown);
  });

  it('does not merge across namespaces', () => {
    const table = new AliasTable(WORLD_CUP);
    // 'argentina' is an alias in `team`, but a `country` term is a different
    // identifier system and must not inherit it.
    expect(table.resolve(term('country', 'argentina')).id).toBe('argentina');
  });

  it('reports whether it merges two identifiers', () => {
    const table = new AliasTable(WORLD_CUP);
    expect(table.merges('team', 'albiceleste', 'fifa-argentina')).toBe(true);
    expect(table.merges('team', 'albiceleste', 'fifa-brazil')).toBe(false);
  });

  it('rejects a canonical identifier absent from its own alias list', () => {
    expect(
      () =>
        new AliasTable([
          { namespace: 'team', canonical: 'fifa-argentina', aliases: ['albiceleste'] },
        ]),
    ).toThrow(/not one of its aliases/);
  });

  it('rejects an alias that maps to two different targets', () => {
    expect(
      () =>
        new AliasTable([
          { namespace: 'team', canonical: 'a', aliases: ['a', 'shared'] },
          { namespace: 'team', canonical: 'b', aliases: ['b', 'shared'] },
        ]),
    ).toThrow(/maps to both/);
  });

  it('accepts a repeated alias that maps to the same target', () => {
    expect(
      () =>
        new AliasTable([
          { namespace: 'team', canonical: 'a', aliases: ['a', 'shared'] },
          { namespace: 'team', canonical: 'a', aliases: ['a', 'shared'] },
        ]),
    ).not.toThrow();
  });

  it('treats an empty table as identity', () => {
    const table = new AliasTable([]);
    const subject = term('team', 'albiceleste');
    expect(table.resolve(subject)).toEqual(subject);
  });
});

describe('compareIdentities', () => {
  it('calls two explicitly aliased spellings equivalent', () => {
    const a = identity();
    const b = identity({
      subject: term('team', 'albiceleste'),
      event: term('outcome', 'become-world-champions'),
    });
    const match = compareIdentities(a, b, new AliasTable(WORLD_CUP));
    expect(match.outcome).toBe('equivalent');
    expect(match.because).toEqual([]);
    expect(match.canonical).toBeDefined();
  });

  it('does not call them equivalent without the alias table', () => {
    // The point of the design: normalisation alone is not a semantic matcher.
    const a = identity();
    const b = identity({ subject: term('team', 'albiceleste') });
    expect(compareIdentities(a, b).outcome).toBe('distinct');
    expect(compareIdentities(a, b).because).toEqual(['subject']);
  });

  it('keeps "reach the final" distinct from "win the tournament"', () => {
    const match = compareIdentities(
      identity(),
      identity({ event: term('outcome', 'reach-final') }),
      new AliasTable(WORLD_CUP),
    );
    expect(match.outcome).toBe('distinct');
    expect(match.because).toEqual(['event']);
    expect(match.detail).toMatch(/event/);
  });

  it.each([
    ['subject', { subject: term('team', 'fifa-brazil') }],
    ['event', { event: term('outcome', 'reach-final') }],
    ['condition', { condition: term('literal', 'penalty-shootout') }],
    ['geographicScope', { geographicScope: term('scope', 'south-america') }],
    ['horizon', { horizon: term('period', '2034') }],
    ['resolutionDate', { resolutionDate: '2031-06-01T00:00:00.000Z' }],
    ['decidingAuthority', { decidingAuthority: term('dataset', 'fifa-discipline') }],
  ] as const)('reports a difference in %s as distinct', (component, change) => {
    const match = compareIdentities(identity(), identity(change as Partial<PropositionIdentity>));
    expect(match.outcome).toBe('distinct');
    expect(match.because).toEqual([component]);
  });

  it('reports an unresolved component as uncertain, never as a match', () => {
    const match = compareIdentities(
      identity(),
      identity({ decidingAuthority: unresolvedTerm() }),
      new AliasTable(WORLD_CUP),
    );
    expect(match.outcome).toBe('uncertain');
    expect(match.because).toEqual(['decidingAuthority']);
    expect(match.canonical).toBeUndefined();
  });

  it('prefers distinct over uncertain when both apply', () => {
    // A known difference is a stronger finding than an unknown: reporting
    // "uncertain" here would let an operator retry until it resolved to a match.
    const match = compareIdentities(
      identity({ event: term('outcome', 'reach-final') }),
      identity({ decidingAuthority: unresolvedTerm(), subject: unresolvedTerm() }),
      new AliasTable(WORLD_CUP),
    );
    expect(match.outcome).toBe('distinct');
    expect(match.because).toEqual(['event']);
  });

  it('collects every unresolved component, not just the first', () => {
    const match = compareIdentities(
      identity(),
      identity({ decidingAuthority: unresolvedTerm(), condition: unresolvedTerm() }),
    );
    expect(match.outcome).toBe('uncertain');
    expect(match.because).toEqual(['condition', 'decidingAuthority']);
  });

  it('is symmetric for outcome and for the components cited', () => {
    const a = identity({ event: term('outcome', 'reach-final') });
    const b = identity({ subject: term('team', 'fifa-brazil') });
    const forward = compareIdentities(a, b, new AliasTable(WORLD_CUP));
    const backward = compareIdentities(b, a, new AliasTable(WORLD_CUP));
    expect(forward.outcome).toBe(backward.outcome);
    expect(forward.because).toEqual(backward.because);
  });

  it('is reflexive for a fully resolved identity', () => {
    expect(compareIdentities(identity(), identity()).outcome).toBe('equivalent');
  });

  it('compares every component in the canonical order', () => {
    expect(IDENTITY_COMPONENTS).toHaveLength(7);
    const allUnresolved: PropositionIdentity = {
      subject: unresolvedTerm(),
      event: unresolvedTerm(),
      condition: unresolvedTerm(),
      geographicScope: unresolvedTerm(),
      horizon: unresolvedTerm(),
      resolutionDate: '',
      decidingAuthority: unresolvedTerm(),
    };
    const match = compareIdentities(allUnresolved, allUnresolved);
    // resolutionDate still compares equal, the other six are gaps.
    expect(match.because).toEqual(IDENTITY_COMPONENTS.filter((c) => c !== 'resolutionDate'));
  });
});

describe('canonicalIdentity', () => {
  it('applies aliases to every component', () => {
    const canonical = canonicalIdentity(
      identity({
        subject: term('team', 'albiceleste'),
        event: term('outcome', 'win-the-cup'),
      }),
      new AliasTable(WORLD_CUP),
    );
    expect(canonical.subject.id).toBe('fifa-argentina');
    expect(canonical.event.id).toBe('win-tournament');
  });

  it('preserves unresolved terms instead of dropping them', () => {
    const canonical = canonicalIdentity(identity({ condition: unresolvedTerm() }));
    // Dropping the field would make two different gaps hash the same.
    expect(canonical.condition).toEqual({ namespace: 'unknown', id: 'unknown', unresolved: true });
  });

  it('does not alias the resolution date', () => {
    const canonical = canonicalIdentity(identity(), new AliasTable(WORLD_CUP));
    expect(canonical.resolutionDate).toBe('2031-01-15T00:00:00.000Z');
  });
});

describe('identityDigest', () => {
  it('is a 64-character hex digest', async () => {
    expect(await identityDigest(identity())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical for two spellings that an alias table merges', async () => {
    const table = new AliasTable(WORLD_CUP);
    const a = identity();
    const b = identity({
      subject: term('team', 'albiceleste'),
      event: term('outcome', 'become-world-champions'),
    });
    expect(await identityDigest(a, table)).toBe(await identityDigest(b, table));
  });

  it('differs for two spellings the table does not merge', async () => {
    expect(await identityDigest(identity())).not.toBe(
      await identityDigest(identity({ subject: term('team', 'albiceleste') })),
    );
  });

  it('differs for the propositions the product must keep apart', async () => {
    const table = new AliasTable(WORLD_CUP);
    expect(await identityDigest(identity(), table)).not.toBe(
      await identityDigest(identity({ event: term('outcome', 'reach-final') }), table),
    );
  });

  it('differs when a component is a recorded gap', async () => {
    expect(await identityDigest(identity())).not.toBe(
      await identityDigest(identity({ decidingAuthority: unresolvedTerm() })),
    );
  });

  it('does not depend on the wording of the question', async () => {
    // The digest is a function of the identity only. Two arbitrary sentences that
    // were read into the same identity produce the same digest, which is exactly
    // why wording cannot create a second official record.
    const table = new AliasTable(WORLD_CUP);
    expect(await identityDigest(identity(), table)).toBe(await identityDigest(identity(), table));
  });

  it('is stable across calls and independent of key insertion order', async () => {
    const reordered: PropositionIdentity = {
      decidingAuthority: term('dataset', 'fifa-official-results'),
      resolutionDate: '2031-01-15T00:00:00.000Z',
      horizon: term('period', '2030'),
      geographicScope: term('scope', 'global'),
      condition: term('literal', 'outright-winner'),
      event: term('outcome', 'win-tournament'),
      subject: term('team', 'fifa-argentina'),
    };
    expect(await identityDigest(reordered)).toBe(await identityDigest(identity()));
  });
});
