/**
 * Canonical proposition identity.
 *
 * The problem this module solves: two sentences can mean the same proposition,
 * and two similar sentences can mean different ones. Text normalisation does not
 * solve it, and pretending it does would create duplicate official records.
 *
 * The design therefore refuses to derive identity from wording. It compares
 * structured components instead, and where a component cannot be compared it
 * returns `uncertain` rather than guessing. Everything downstream treats
 * `uncertain` as a blocker, not as a soft match.
 *
 * What this buys:
 *   · aliases map to one identity when the mapping is stated explicitly;
 *   · genuinely different propositions stay apart, provably, by the component
 *     that differs;
 *   · ambiguity is a first-class outcome with a name, not an edge case.
 *
 * What it does not do: infer that two free-text sentences mean the same thing.
 * That requires a resolution step with a human or a reviewed model in it, and
 * the protocol makes that dependency explicit instead of hiding it.
 *
 * This module is JSON-free and DOM-free so the same rules run in the app, in
 * tests, and in a future backend.
 */

import { sha256Hex } from './hash.ts';
import { canonicalize } from './events.ts';
import type {
  IdentityComponent,
  IdentityMatch,
  IdentityTerm,
  PropositionIdentity,
} from './publication-types.ts';

/** The components compared, in a fixed order so verdicts are deterministic. */
export const IDENTITY_COMPONENTS: readonly IdentityComponent[] = [
  'subject',
  'event',
  'condition',
  'geographicScope',
  'horizon',
  'resolutionDate',
  'decidingAuthority',
];

/**
 * Normalise an identifier.
 *
 * Applied to namespaces and ids alike. Unicode-aware for the same reason
 * `canonicalKey` is: an ASCII-only pattern silently deletes every non-Latin
 * script, which would make two different subjects compare equal.
 *
 * This is *not* semantic matching. It folds case, whitespace and punctuation so
 * that `FIFA-Argentina` and `fifa argentina` are the same identifier. It does not
 * know that `albiceleste` is Argentina — that belongs in an explicit alias table.
 */
export function normalizeTermValue(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build an identity term, normalising its parts. */
export function term(namespace: string, id: string): IdentityTerm {
  return { namespace: normalizeTermValue(namespace), id: normalizeTermValue(id) };
}

/** A term that records a gap rather than hiding one. */
export function unresolvedTerm(namespace = 'unknown'): IdentityTerm {
  return { namespace: normalizeTermValue(namespace), id: 'unknown', unresolved: true };
}

/**
 * An explicit alias mapping.
 *
 * The protocol only merges two identifiers when a human recorded that they are
 * the same. The table is data, so it can be reviewed, versioned and tested — the
 * opposite of an opaque similarity score.
 */
export interface AliasEntry {
  namespace: string;
  /** Alternative identifiers that all denote the same entity. */
  aliases: string[];
  /** The identifier they collapse to. Must be one of `aliases`. */
  canonical: string;
}

export class AliasTable {
  private readonly map = new Map<string, string>();

  constructor(entries: readonly AliasEntry[]) {
    for (const entry of entries) {
      const ns = normalizeTermValue(entry.namespace);
      const target = normalizeTermValue(entry.canonical);
      if (!entry.aliases.some((alias) => normalizeTermValue(alias) === target)) {
        // An alias table that maps to something not in its own list is a typo or
        // an attempt to smuggle in a merge. Refuse at construction, not at use.
        throw new Error(
          `Alias table entry for '${ns}' maps to '${target}', which is not one of its aliases`,
        );
      }
      for (const alias of entry.aliases) {
        const from = normalizeTermValue(alias);
        const key = `${ns}:${from}`;
        const existing = this.map.get(key);
        if (existing && existing !== target) {
          throw new Error(
            `Alias '${from}' in namespace '${ns}' maps to both '${existing}' and '${target}'`,
          );
        }
        this.map.set(key, target);
      }
    }
  }

  /** Resolve a term through the table. Unknown ids resolve to themselves. */
  resolve(value: IdentityTerm): IdentityTerm {
    const key = `${value.namespace}:${value.id}`;
    const canonical = this.map.get(key);
    if (canonical === undefined) return value;
    return { namespace: value.namespace, id: canonical, unresolved: value.unresolved };
  }

  /** True when the table explicitly merges these two identifiers. */
  merges(namespace: string, a: string, b: string): boolean {
    const ns = normalizeTermValue(namespace);
    return (
      this.map.get(`${ns}:${normalizeTermValue(a)}`) ===
      this.map.get(`${ns}:${normalizeTermValue(b)}`)
    );
  }
}

function termsEqual(a: IdentityTerm, b: IdentityTerm): boolean {
  return a.namespace === b.namespace && a.id === b.id;
}

function isResolved(value: IdentityTerm): boolean {
  return value.unresolved !== true && value.id !== 'unknown';
}

/**
 * Compare two propositions component by component.
 *
 * The precedence is deliberate and asymmetric:
 *
 *   1. A component that differs in a way the alias table does *not* merge is a
 *      positive finding of difference → `distinct`. This is checked first, so
 *      "Argentina win" vs "Argentina reach the final" can never be rescued by
 *      the other fields agreeing.
 *   2. A component that cannot be compared (unresolved on either side) makes the
 *      whole comparison → `uncertain`. Missing information never counts as a
 *      match.
 *   3. Only when every component is resolved and equal → `equivalent`.
 *
 * There is no similarity threshold anywhere, on purpose. A threshold produces a
 * number that has to be argued about at 0.87; a component either resolved to the
 * same thing or it did not.
 */
export function compareIdentities(
  left: PropositionIdentity,
  right: PropositionIdentity,
  aliases: AliasTable = new AliasTable([]),
): IdentityMatch {
  const differing: IdentityComponent[] = [];
  const unresolved: IdentityComponent[] = [];

  for (const component of IDENTITY_COMPONENTS) {
    if (component === 'resolutionDate') {
      // A date is its own identifier system; exact equality, no aliasing.
      if (left.resolutionDate !== right.resolutionDate) differing.push(component);
      continue;
    }

    const a = aliases.resolve(left[component]);
    const b = aliases.resolve(right[component]);

    if (!isResolved(a) || !isResolved(b)) {
      unresolved.push(component);
      continue;
    }
    if (!termsEqual(a, b)) differing.push(component);
  }

  if (differing.length > 0) {
    return {
      outcome: 'distinct',
      because: differing,
      detail: `Differs in: ${differing.join(', ')}.`,
    };
  }

  if (unresolved.length > 0) {
    return {
      outcome: 'uncertain',
      because: unresolved,
      detail:
        `Cannot compare ${unresolved.join(', ')}: ` +
        'at least one side does not resolve to a concrete identifier.',
    };
  }

  return {
    outcome: 'equivalent',
    because: [],
    detail: 'Every component resolves to the same identifier on both sides.',
    canonical: canonicalIdentity(left, aliases),
  };
}

/**
 * Collapse an identity to the form that will be hashed.
 *
 * Aliases are applied first, so two spellings of the same subject produce the
 * same digest. Unresolved terms are preserved as `unknown` rather than dropped:
 * dropping them would make two different gaps compare equal.
 */
export function canonicalIdentity(
  identity: PropositionIdentity,
  aliases: AliasTable = new AliasTable([]),
): PropositionIdentity {
  const pick = (component: Exclude<IdentityComponent, 'resolutionDate'>): IdentityTerm =>
    aliases.resolve(identity[component]);

  return {
    subject: pick('subject'),
    event: pick('event'),
    condition: pick('condition'),
    geographicScope: pick('geographicScope'),
    horizon: pick('horizon'),
    resolutionDate: identity.resolutionDate,
    decidingAuthority: pick('decidingAuthority'),
  };
}

/**
 * The stable digest of a canonical identity.
 *
 * This is the value a database must make unique. It is computed from the
 * canonical form, never from the wording, so a rephrasing that maps to the same
 * identity produces the same digest and therefore cannot create a second record.
 *
 * It is prefixed with a scheme marker so a future identity model can coexist with
 * this one instead of silently colliding with it.
 */
export async function identityDigest(
  identity: PropositionIdentity,
  aliases: AliasTable = new AliasTable([]),
): Promise<string> {
  const canonical = canonicalIdentity(identity, aliases);
  return sha256Hex(`oracle.identity/1\n${canonicalize(canonical)}`);
}
