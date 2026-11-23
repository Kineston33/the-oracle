# THE ORACLE — Canonical Proposition Identity

This document specifies how **Official Publication Protocol v1** represents, normalises,
compares, and hashes the identity of a proposition (`src/data/canonical-identity.ts` and
`src/data/publication-types.ts`).

---

## 1. Why wording is not identity

The build-time archive gate (`src/data/validate.ts`) normalises `canonicalQuestion` strings
via `canonicalKey` to catch accidental duplicate questions in `src/data/records.json`. That
check is useful for a static file, but string normalisation cannot define proposition
identity:

- **Different wording, same proposition**: *"Will Argentina win the 2030 FIFA World Cup?"*
  and *"Will the Albiceleste become world champions in 2030?"* share almost no words, yet
  ask the exact same question.
- **Similar wording, distinct propositions**: *"Will Argentina win the 2030 FIFA World Cup?"*
  and *"Will Argentina reach the 2030 FIFA World Cup final?"* share nearly every token, yet
  resolve differently if Argentina loses the final.

Because neither character overlap nor cosine similarity can separate those two cases
reliably, the protocol does not compute identity from prose. Instead, identity is a
seven-part typed structure (`PropositionIdentity`), and comparison returns a three-valued
verdict (`equivalent`, `distinct`, `uncertain`) with no numeric similarity threshold.

---

## 2. The seven components of `PropositionIdentity`

Every `PropositionIdentity` has seven required fields, inspected in the fixed order
`IDENTITY_COMPONENTS`:

| Component | Type | Role | Example |
| --- | --- | --- | --- |
| `subject` | `IdentityTerm` | Who or what the proposition is about | `term('team', 'fifa-argentina')` |
| `event` | `IdentityTerm` | The outcome whose occurrence decides the question | `term('outcome', 'win-tournament')` |
| `condition` | `IdentityTerm` | Threshold or qualifying rule | `term('literal', 'outright-winner')` |
| `geographicScope` | `IdentityTerm` | Geographic or institutional scope (`global` is explicit, never assumed) | `term('scope', 'global')` |
| `horizon` | `IdentityTerm` | The period the question is *about* | `term('period', '2030')` |
| `resolutionDate` | `IsoDateTime` | The UTC timestamp on which the question is decided | `'2031-01-15T00:00:00.000Z'` |
| `decidingAuthority` | `IdentityTerm` | Dataset, body, or instrument whose record decides the outcome | `term('dataset', 'fifa-official-results')` |

### `IdentityTerm` and Unicode-safe identifier normalisation

Each `IdentityTerm` has `{ namespace: string; id: string; unresolved?: true }`:

- `normalizeTermValue(value)` applies `.normalize('NFKC').toLowerCase().normalize('NFC')`,
  collapses runs of characters outside `[\p{L}\p{N}\p{M}]` to `-`, and strips leading or
  trailing `-`. Using Unicode property escapes preserves non-Latin scripts (`Аргентина`,
  `日本`, `القاهرة`) instead of stripping them to empty strings.
- `term(namespace, id)` normalises both `namespace` and `id` at construction time.
- `unresolvedTerm(namespace = 'unknown')` returns
  `{ namespace: normalizeTermValue(namespace), id: 'unknown', unresolved: true }`. An
  unknown component is represented explicitly rather than omitted.

---

## 3. Explicit alias resolution (`AliasTable`)

Two different identifiers denote the same entity only when an `AliasEntry` says so:

```ts
export interface AliasEntry {
  namespace: string;
  aliases: string[];
  canonical: string;
}
```

`AliasTable` enforces three rules at construction and resolution time:

1. **Self-inclusion**: `entry.canonical` (after `normalizeTermValue`) must appear in
   `entry.aliases`. If an entry claims a canonical target that is not in its own alias
   list, `new AliasTable(...)` throws immediately.
2. **No conflicting merges**: if the same `namespace:alias` is mapped to two different
   canonical targets across entries, `new AliasTable(...)` throws immediately. Repeating
   an alias that maps to the *same* canonical target is idempotent.
3. **Namespace isolation**: keys are stored as `${namespace}:${alias}`. `team:argentina`
   and `country:argentina` live in different namespaces and never merge. Identifiers not
   present in the table resolve to themselves.

---

## 4. Three-valued comparison (`compareIdentities`)

`compareIdentities(left, right, aliases)` inspects all seven components in
`IDENTITY_COMPONENTS` order (resolving each `IdentityTerm` through `aliases.resolve` and
comparing `resolutionDate` by exact string equality) and applies a strict, asymmetric
precedence:

1. **`distinct` wins first** — if one or more resolved components differ (`differing.length > 0`),
   the result is `{ outcome: 'distinct', because: differing, detail }`, even if another
   component is unresolved. A known difference in `event` (*win tournament* vs *reach
   final*) or `horizon` (*2030* vs *2034*) is enough to prove the two propositions are not
   the same.
2. **`uncertain` blocks second** — if no resolved components differ, but at least one
   component on either side has `unresolved === true` or `id === 'unknown'`, the result is
   `{ outcome: 'uncertain', because: unresolved, detail }`. Missing information never
   counts as a match, and `publishCandidate` refuses to publish when identity self-check
   is `uncertain`.
3. **`equivalent` requires all seven** — only when `differing.length === 0` and
   `unresolved.length === 0` does `compareIdentities` return
   `{ outcome: 'equivalent', because: [], detail, canonical: canonicalIdentity(left, aliases) }`.

---

## 5. Canonical form and `identityDigest`

`canonicalIdentity(identity, aliases)` returns a `PropositionIdentity` in which every
`IdentityTerm` component has been passed through `aliases.resolve(...)`.

`identityDigest(identity, aliases)` computes the 64-character lowercase hex SHA-256 digest:

```text
SHA-256( UTF-8( "oracle.identity/1\n" + canonicalize(canonicalIdentity(identity, aliases)) ) )
```

- **Scheme prefix (`oracle.identity/1\n`)**: binds the hash to version 1 of the identity
  model so an `identityDigest` can never collide with a `SealedPayload` digest or a future
  identity schema.
- **Deterministic key order (`canonicalize`)**: reuses the recursive key-sorting
  serialiser from `src/data/events.ts`, so key insertion order never affects the digest.
- **Wording-independent**: `proposedQuestion` and `submittedQuery` are not part of
  `PropositionIdentity`. Two candidates with different prose that resolve to the same
  seven components under `AliasTable` produce the exact same `identityDigest`.

---

## 6. Known boundaries

- **No automatic natural-language extraction**: `src/data/canonical-identity.ts` operates on
  structured `PropositionIdentity` values. Turning a raw user sentence into a
  `PropositionIdentity` requires an editorial or reviewed extraction step outside this
  module.
- **`AliasTable` is curated data**: aliases only merge when listed in an `AliasTable`.
  Two synonyms missing from the table will compare `distinct` until the table is updated.
