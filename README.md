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
npm test          # Vitest: 191 tests across 9 files
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

191 tests across nine files:

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
