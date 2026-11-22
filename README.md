# THE ORACLE

**SEE WHAT'S COMING.**

A public forecasting intelligence platform: explore the future, interrogate your own
questions, discover emerging signals, and read a public archive of official predictions
designed to be **immutable, timestamped, evidence-backed and independently checkable**.

> **Status: v0.1 prototype.** There is **no forecasting engine**, no server and no
> database. Every prediction, probability, trend value and source in this repository is
> **illustrative demo data** and is labelled as such throughout the interface. Nothing
> here is a claim about the real world.

---

## The principle behind the design

> **One question. One official prediction. The same answer for everyone.**

Most prediction products optimise for how convincing a forecast sounds *today*. THE
ORACLE is organised around how auditable it will be *later*:

1. **Canonicalize** — a question becomes one unambiguous yes/no proposition with a fixed
   threshold, a named deciding authority and a resolution date.
2. **Seal** — the record is published with its probability, evidence bundle and
   resolution rule, then hashed. From that moment the figure is historical, not live.
3. **Observe** — the horizon runs. Evidence accumulates in public but cannot alter the
   sealed record.
4. **Resolve** — on the resolution date the pre-registered rule is applied mechanically,
   and the outcome is attached to the original probability. Misses stay in the archive.

## What is actually implemented

| Area | State |
| --- | --- |
| Site, navigation, five sections | ✅ Built |
| Crystal sphere (brand centrepiece) | ✅ Built — original SVG/CSS construction |
| Archive browsing, search, filters, record detail | ✅ Built |
| Prediction record schema + demo records | ✅ Built |
| SHA-256 digest sealing + in-browser verification | ✅ Built |
| Deterministic question reading (subject, horizon, archive match) | ✅ Built |
| Local drafts (no account, no transmission) | ✅ Built |
| Forecast generation of any kind | ❌ Not built |
| Server, database, shared resolution service | ❌ Not built |
| Public transparency log / external anchoring | ❌ Not built |
| Accounts, sync, personalisation | ❌ Not built |

See **`docs/FEATURES-AND-LIMITATIONS.md`** for the complete list, including the six
limitations the product itself states on its About page.

---

## Getting started

Requirements: **Node.js 20+** (developed on 22) and npm.

```bash
npm install       # install dependencies
npm run dev       # start the dev server at http://localhost:5173
```

Production build and preview:

```bash
npm run build     # type-check + production bundle into dist/
npm run preview   # serve the built bundle at http://localhost:4173
```

Checks:

```bash
npm run typecheck # strict tsc for the app, the tests and the audit harness
npm test          # Vitest: 228 tests across 10 files
npm run seal      # recompute the SHA-256 digest of every record (see below)
```

No API keys, accounts, paid services or environment variables are required. The
application makes **no network requests at runtime** — fonts are bundled locally and
there are no analytics, trackers or third-party scripts.

---

## Project structure

```
the-oracle/
├── index.html                   # shell, meta, skip link, no-JS fallback
├── public/
│   └── favicon.svg              # crystal mark
├── scripts/
│   └── seal-records.mjs         # computes and writes record digests
├── docs/
│   ├── FEATURES-AND-LIMITATIONS.md
│   └── DEPLOYMENT.md         # host config, placeholders, pre-launch checklist
└── src/
    ├── main.tsx                 # fonts + global styles + router mount
    ├── App.tsx                  # shell, route table, focus/scroll management
    ├── components/
    │   ├── oracle/              # the crystal sphere (+ facet geometry)
    │   ├── layout/              # nav, footer, atmosphere, page header
    │   ├── predictions/         # record card, probability bar
    │   ├── trends/              # trend card, sparkline
    │   ├── explore/             # question composer
    │   └── ui/                  # button, badge, callout, field, empty state…
    ├── data/
    │   ├── types.ts             # domain model (the heart of the product)
    │   ├── records.json         # 10 illustrative sealed records
    │   ├── records.ts           # archive queries and aggregates
    │   ├── trends.ts            # 9 illustrative trend signals
    │   └── *.test.ts
    ├── lib/
    │   ├── integrity.ts         # canonical serialization + SHA-256
    │   ├── question.ts          # deterministic question reading
    │   ├── format.ts            # display formatting (UTC everywhere)
    │   ├── storage.ts           # local draft persistence
    │   └── *.test.ts
    ├── pages/
    │   ├── Home.tsx             # 5 homepage sections
    │   ├── Explore.tsx          # question → demonstration reading
    │   ├── Predictions.tsx      # archive with filters
    │   ├── PredictionRecordPage.tsx
    │   ├── Trends.tsx
    │   ├── About.tsx
    │   └── NotFound.tsx
    ├── styles/
    │   ├── tokens.css           # design tokens (colour, type, space, motion)
    │   └── global.css           # reset, primitives, a11y, reduced motion
    └── test/setup.ts            # jsdom matchers + browser API polyfills
```

### Architectural notes

**Zero runtime dependencies beyond React and Router.** `lucide-react` supplies icons;
fonts are self-hosted via `@fontsource`. There is no CSS framework, no state library and
no UI kit — styling is CSS Modules on top of a small token layer, so the visual identity
is fully owned by this repository.

**Route-level code splitting.** The homepage is the entry chunk; every other route loads
lazily with a calm, branded fallback.

**The domain model is the product.** `src/data/types.ts` describes the target
architecture — prediction ID, canonical question, category, publication timestamp,
original probability, horizon, resolution criteria, evidence references, resolution
status and outcome, integrity metadata. The UI is built against those types, so replacing
the static demo archive with a real API should not require redesigning any surface.

**Immutability is real, but bounded.** Each record's payload is serialized with
recursively sorted keys, the `integrity` field is removed, and the UTF-8 bytes are hashed
with SHA-256. The digest is stored in the record and **recomputed in the reader's browser**
when the record is opened. If the two ever disagree, the integrity panel says so. This
detects modification after sealing. It does **not** prevent a coordinated rewrite in which
the payload and the digest are replaced together — that requires external anchoring, which
is future work.

**The question reader does not pretend to be intelligent.** `src/lib/question.ts` is a
transparent, deterministic parser: keyword lexicons for subject classification, regex for
horizon detection, and token overlap for archive matching. It never estimates a
probability and never generates prose about what *will* happen. It surfaces a canonical
draft and a resolution checklist instead, and states its own limitations inline.

---

## Editing the demo archive

Records live in `src/data/records.json`. To change one:

```bash
# 1. edit src/data/records.json
npm run seal     # 2. recompute every record's SHA-256 digest
npm test         # 3. the integrity test fails if any record is unsealed
```

`scripts/seal-records.mjs` uses the identical canonicalization routine as the runtime
(`lib/integrity.ts`), so the digests it writes are the digests the browser verifies.

> Sealing is **not** notarization. It proves the digest embedded in the repository matches
> the record shipped with it. No external party has witnessed or countersigned anything.

---

## Design system

| Token | Value | Use |
| --- | --- | --- |
| Obsidian | `#07070C` | Page base |
| Midnight navy | `#0B0E1B` | Raised surfaces |
| Oracle violet | `#786BFF` | Primary accent, probability |
| Cosmic blue | `#00D4FF` | Signals, trends, secondary accent |
| Warm gold | `#E8C88A` | Integrity, archival meaning — deliberately sparse |
| Instrument Serif | display | Headlines, canonical questions, probabilities |
| Inter | UI | Body and controls |
| JetBrains Mono | data | IDs, hashes, labels, instrument readouts |

The **crystal sphere** is an original construction and the brand's centrepiece: a
round-brilliant facet structure drawn twice (dark facet plate behind the cosmos, bright
refracted veins in front), a miniature faceted singularity inside a tilted accretion disc,
and three orbital rings drawn in two halves so the crystal genuinely occludes the far side
of each orbit. It is pure SVG + CSS — no canvas, WebGL, raster images or external assets.

Accessibility: semantic landmarks, a skip link, visible focus rings, labelled controls,
`aria-live` regions for async results, a two-mode focus trap for the mobile menu, WCAG AA
contrast on text tokens, and full `prefers-reduced-motion` support (the sphere stops
entirely, including ambient drift).

---

## Testing

228 tests across ten files:

- `lib/question.test.ts` — normalisation, category detection, horizon parsing, archive
  matching, canonical draft generation, and the invariant that a reading never contains a
  probability.
- `lib/integrity.test.ts` — canonicalization determinism, digest reproduction for every
  sealed record, tamper detection, archive structural invariants.
- `lib/storage.test.ts` — draft persistence, de-duplication, malformed-data resilience.
- `data/records.test.ts`, `data/trends.test.ts` — filtering, sorting, adjacency, and the
  rule that demo content is always flagged.
- `test/contrast.test.ts` — reads `tokens.css` and asserts every text token clears WCAG AA
  against every surface token, and that the text hierarchy stays monotonic.
- `data/records.test.ts` — the canonical-question rule: every record asks a distinct
  question, a duplicate is reported as a fork, the key survives every script (Spanish,
  Portuguese, French, Cyrillic, Greek, Arabic, Hebrew, CJK, Devanagari), typographic
  variation still folds, and the probability is never mutated by any read helper.
- `components/layout/RouteMetadata.test.tsx` — each route carries its own title,
  description, canonical URL and Open Graph title.
- `App.test.tsx` — navigation, mobile/desktop routes, question submission and validation,
  archive filtering and empty states, record detail rendering, digest verification in the
  DOM, and the honesty requirements (a record never loses its original probability; the
  integrity panel always states that anchoring is absent).

`src/audit.audit.tsx` is a development-only structural audit that renders every route and
dumps markup for inspection. It is excluded from the normal suite by filename:

```bash
npx vitest run --config vitest.audit.config.ts
```

---

## Assumptions made

1. **No backend.** With a zero budget and no existing infrastructure, the archive is a
   typed static dataset and drafts use `localStorage`. All logic that will eventually be
   server-side (canonicalization, sealing, resolution) is isolated in `lib/` so it can move.
2. **The question input must be honest rather than impressive.** A convincing fake answer
   would undermine the product's entire premise. Submitting therefore opens a *labelled*
   demonstration reading instead of inventing a forecast.
3. **Demo content is marked, not merely mentioned.** Every record carries a visible Demo
   badge, the archive opens with an integrity-toned notice, trends carry an "illustrative
   index" badge, and the About page separates *real*, *illustrative* and *not built*.
4. **UTC everywhere.** Dates are formatted in UTC so a timestamp on a sealed record reads
   identically in every timezone.
5. **Ten records is enough.** The archive is sized to demonstrate every state — open,
   resolved-yes, resolved-no, and annulled — rather than to look large.

## Roadmap

`Now` → interface and record model (this build). `Next` → server-side persistence,
editorial review, signed records. `Later` → the forecasting engine, reference-class base
rates and calibration tracking. `Eventually` → an append-only public transparency log with
third-party witnesses and independent re-resolution.

---

## Licence

No explicit licence is granted at this stage. The repository is public for review,
all rights reserved, until a licensing decision is made.

## The archive gate

`src/data/validate.ts` holds the rules that must hold before the archive ships: unique
record ids, a demo flag, evidence, an in-range probability, a well-formed digest, a
coherent horizon, and — the one the product rests on — **one canonical question per
official prediction**.

The module imports no JSON and no DOM, which is what lets `scripts/validate-archive.mjs`
import it directly under Node and run it against the real `records.json`:

```bash
npm run validate    # standalone
npm run build       # runs validate first, refuses to build on failure
npm run seal        # runs validate first, refuses to re-seal on failure
```

A duplicate canonical question stops the build with a non-zero exit and names the
offending record ids. This is exercised by tests and was verified against a deliberately
corrupted copy of the archive.

`canonicalKey` is Unicode-aware (`\p{L}`, `\p{N}`, `\p{M}`), so accented Latin, Cyrillic,
Greek, Arabic, Hebrew and CJK are all preserved rather than deleted. It compares wording,
not meaning; paraphrase detection is a stated limitation.

## Integrity model: sealed payload and append-only events

A published record has two parts that are deliberately kept apart.

**The sealed payload** — exactly the content fixed at publication: question, category,
`publishedAt`, probability, horizon, resolution criteria, evidence, and the demo flag. Its
SHA-256 digest never moves once the record is published.

**The event chain** — everything that happens afterwards, appended and never edited:

```
e0 published  →  e1 resolved | annulled  →  …
```

Each event hashes its own envelope plus the previous event's digest, so the chain is both
ordered and tamper-evident. Resolving or annulling a record appends a link; it cannot touch
the payload, the probability, the publication date, or the payload digest.

### The chain is bound to the payload by the publication event

The `published` event carries the payload digest, and its own digest covers that value. So
the payload and the event that published it cannot be edited independently: changing one
leaves the other naming a state that never existed.

`npm run validate` enforces this cryptographically, not structurally:

- the `published` event must exist, be unique, and open the chain;
- the digest it names must equal both `integrity.digest` *and* the digest recomputed from
  the shipped bytes;
- no other event may name a payload digest.

Editing a probability and recomputing `integrity.digest` therefore fails, because the
publication event still names the original. This is tested destructively in
`src/data/publication-link.test.ts` — including the strongest form of the attack, where the
whole chain is rebuilt, which passes validation and is reported as what it is: an internal
rewrite that no external anchor can contradict yet.

### Every event declares its own scheme

An event digest is never interpreted by convention. Each event states:

| Field | Meaning |
|---|---|
| `algorithm` | `sha256` — the only value accepted |
| `schemaVersion` | `2` — bumping it changes every event digest |
| `scope` | `event-envelope`, or `event-envelope+published-payload` for `e0` |
| `origin` | `observed` or `migrated` |
| `occurredAt` | the date the event is *declared* to have happened |
| `recordedAt` | when the event was written into this archive |

An unknown algorithm, schema version or scope is a validation failure, not a fallback.

**Everything in that table is inside the hash, including provenance.** Schema 1 left
`recordedAt` and `origin` outside the envelope, on the argument that they describe the
archive's handling of an event rather than the occurrence. That was wrong: `origin:
'observed'` is precisely a claim that the hash existed while the thing happened, so leaving
it editable let a migrated chain be relabelled as a contemporaneous one without changing a
single digest. In schema 2, changing either field — or both — breaks the event's digest and
the chain, and `npm run validate` rejects it.

The version had to move for this to be honest. v1 digests are not silently reinterpreted as
v2: the version is part of the hashed envelope, so a verifier must implement the version an
event declares, and the validator rejects anything it cannot implement rather than skipping
it. Payload digests are unaffected — they never covered events — so all ten remain byte for
byte identical.

### Migrated versus observed

Every event in this repository is `origin: 'migrated'`. The chains were constructed on
`2026-11-22T17:51:26Z` from timestamps the records already carried, so:

- `occurredAt` is a **declared** date, restated faithfully from the archive;
- `recordedAt` is the moment the restatement was written;
- neither is a timestamp proving the hashes existed at `occurredAt`.

The validator enforces the inequality per event: each was recorded strictly later than the
moment it records, and `recordedAt` never goes backwards along a chain. That is provable
from the data without inventing a timestamp. A migrated event is never presented as a
temporal proof, and the record page says so explicitly.

Mixed chains are allowed. A migrated record resolved *later*, for real, must record that
resolution as `observed`; forcing the whole chain to stay `migrated` would mean mislabelling
a contemporaneous event, which is the dishonesty this field exists to prevent. Each event
declares its own provenance and that declaration is covered by its own digest.

### Declared provenance is not demonstrated provenance

`origin: 'observed'` means the event *says* it was written while the thing happened. The
digest protects that claim — it cannot be edited into place — but protecting a claim is not
the same as proving it. Someone who rebuilds the whole chain can produce any `origin` and any
`recordedAt` they like, and every digest will verify.

The two origins therefore make different-strength claims:

| Origin | What it claims | Can this build prove it? |
|---|---|---|
| `migrated` | written later than the dates it records | Yes, by the ordering inequality, independently of the hash |
| `observed` | written contemporaneously with the event | No. Parsimony alone distinguishes it, and that would be circular |

Only an external witness — a transparency log, a timestamped publication — could show when
these bytes existed. Until one is implemented, `observed` is shown in the interface as
"declared observed, not proven", and no record can be marked anchored.

### A legacy-scope record can never be resolved

Seven records (`0001`–`0006`, `0008`) are open and sealed under `legacy-record`. Their digest
covers `status` and `resolution`, so appending a resolution changes the bytes it was computed
over. `nextEvent()` and `appendEvent()` refuse the operation outright rather than letting an
invalid record be assembled and rejected later.

They stay exactly as sealed: immutable historical demonstrations. Resolving them would require
either re-sealing (forbidden) or rewriting history (dishonest).

```bash
npm run validate   # shape, uniqueness, and event-chain continuity
npm run seal       # seals unsealed records; refuses to re-seal a published one
```

### What the shipped records actually claim

Every record in this repository was sealed before the payload/event split existed, when the
digest covered the outcome too. Those digests are **preserved verbatim** and verified against
the shape they were actually computed over (`payloadScope: 'legacy-record'`). They are
declared `sealClaim: 'self-consistent'`, which means exactly one thing:

> the shipped bytes match the sealed digest — not that the payload existed before the outcome.

Recomputing them under the new definition would have produced digests that never existed and
presented them as original seals. That was rejected: it would assert a provenance nobody
witnessed. Any record sealed from now on uses `payloadScope: 'sealed-payload'` and
`sealClaim: 'published-before-outcome'`, which *is* true by construction.

### Anchoring cannot be claimed, only proved

`integrity.anchored` is a boolean in the data. A boolean is not evidence, so the build
rejects any record that sets it — there is no anchoring mechanism to back the claim. The
public panel reports anchoring as *not verified* for every record, and never as a pass.

### Re-sealing is refused

`npm run seal` exits non-zero and writes nothing if any published record no longer matches its
own digest, or if any publication link or event chain is inconsistent. There is no `--force`.
Verified by tampering with a copy: exit 1, file untouched, offending id named.
