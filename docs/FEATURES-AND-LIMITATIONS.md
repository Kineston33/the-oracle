# THE ORACLE — Implemented features and known limitations

This document is the honest ledger for **v0.1**. It exists because a platform built on
accountable forecasting should not begin with an inflated account of itself.

---

## 1. Implemented

### Brand and shell

- Original **crystal sphere** centrepiece: round-brilliant facet geometry (`facets.ts`),
  a miniature faceted singularity, tilted accretion disc, particle field, caustic ground
  pool, and three orbital rings drawn in two halves so the crystal occludes the far side of
  each orbit. Pure SVG + CSS; no canvas, WebGL, images or external libraries.
- Three interaction states on the sphere (`idle`, `reading`, `thinking`) with independently
  accelerated orbits and core pulse.
- Animation pauses when the tab is hidden, when the sphere leaves the viewport
  (`IntersectionObserver`), and entirely under `prefers-reduced-motion`.
- Fixed atmospheric backdrop: star fields, two slow nebula drifts, horizon glow, film grain.
- Sticky condensing navigation with active-section indication.
- Mobile navigation with scroll lock, `Escape` to close, a two-mode focus trap, focus
  restoration, and auto-close on viewport resize or navigation.
- Footer with navigation, principle statement, and data-honesty disclaimers.
- Route transitions move focus to the new page heading; scroll resets except when a hash
  target is present.

### Homepage

- Hero with display headline, supporting copy, functional question composer, suggested
  explorations, archive counters, and the sphere.
- Immutable-record principle section with four labelled statuses (*Designed* / *Partial*).
- Emerging-signals section with a lead panel plus three other signals (no duplicates).
- Archive preview rendered as a dense ledger, with an integrity aside and a clearly
  caveated illustrative hit rate.
- Four-step methodology section and a closing call to action.
- Restructured responsive grid: the headline is always the first thing above the fold; the
  sphere sits between the headline and the composer on narrow viewports.

### Explore

- Primary question input: multiline, auto-growing, `⌘/Ctrl+Enter`-free single-Enter submit,
  character counter, inline validation, live local detection chips (subject, horizon).
- Deterministic reading panel: subject classification from keyword lexicons, horizon
  detection (explicit years plus relative expressions), lexical archive matching, a
  mechanical canonical-question draft, and a tailored resolution checklist.
- Three separate disclosures that no forecast is produced and no probability is estimated.
- Local notebook: save, remove, clear-all, re-open; `localStorage`-backed, with graceful
  degradation and an explicit notice when storage is unavailable.
- Suggested starter questions (all labelled illustrative).
- Deliberate 620 ms "reading" pause with a live-region status message, so the result never
  appears instant or magical.

### Predictions archive

- Ten illustrative sealed records covering open, resolved-yes, resolved-no and annulled
  states.
- Full-text search across title, canonical question, record ID, category, horizon and
  deciding authority.
- Category chips and status select, both URL-synced (`?category=`, `?status=`, `?q=`) and
  shareable.
- Result counts announced through an `aria-live` region.
- Empty state with a reset action.
- Deliberately caveated archive-level statistics; hit rate returns `—` rather than `NaN`
  when no decisive resolutions exist.

### Prediction record

- Breadcrumb, status/category/demo badges, revision number, and publication date.
- Canonical question block explaining that equivalent phrasings resolve here.
- Large published-probability display with a centered probability meter (midpoint marked
  at 50%).
- Fact grid: horizon, resolution date with countdown, status, deciding authority.
- Resolution block (YES/NO/INDETERMINATE) with basis, note, and an explicit statement that
  both the original probability and the outcome stay on the record permanently.
- Annulment block explaining why a record was withdrawn rather than deleted.
- Resolution criteria: rule, authority, and pre-registered edge cases.
- Evidence list with kind, publisher, date, forecaster's note, and an honest
  "no external link — this illustrative source does not exist" fallback.
- **Integrity panel**: algorithm, revision, channel, anchoring status, copyable digest,
  and live in-browser SHA-256 verification with four states (checking / match / mismatch /
  unavailable).
- Publication record with a plain-language explanation of what immutability does and does
  not guarantee here.
- Newer/older record pagination.

### Trends

- Nine illustrative signals across six domains, each with a summary, a falsifier, an
  eight-quarter series, a sparkline, signal strength, 90-day velocity, confidence, source
  count, region and horizon.
- Highlight panel for the fastest-moving signal with a larger chart.
- Domain chips and three sort orders (signal, velocity, confidence).
- Search across names, descriptions, falsifiers and regions.
- Empty state, and a prominent "these numbers are not measurements" callout.
- Method note describing how a real signal would enter the index.

### About

- Sticky in-page navigation with `IntersectionObserver`-driven active state.
- Philosophy, five-step methodology, and a pull quote.
- Explicit **real / illustrative / not built** transparency grid.
- Detailed, precise explanation of how the digest works and where it falls short.
- Six stated limitations.
- Four-phase roadmap with shipped/planned/vision states.

### Cross-cutting

- Domain model in `src/data/types.ts` covering every field an official record will need.
- Canonical serialization (recursively sorted keys, `undefined` dropped) and SHA-256
  sealing shared between the browser and the `scripts/seal-records.mjs` build step.
- Full keyboard operation, visible focus rings, skip link, semantic landmarks, labelled
  form controls, and `aria-live` for asynchronous results.
- 404 route with the same design language.
- No-JS fallback message in `index.html`.
- Strict TypeScript and automated test suite across UI, integrity, canonical identity, and
  publication protocol rules; successful production build.

### Official Publication Protocol v1.2 (domain layer)

- **Three-tier separation and attested lifecycle (`src/data/publication-types.ts`, `src/data/publication.ts`)**:
  explicit domain types separating `exploratory-query`, `CandidateProposition`, and official
  `PredictionRecord` instances (`demo: false`), with `LIFECYCLE`, `TERMINAL_STAGES`
  (`['rejected-candidate', 'resolved', 'annulled']`), and `PUBLISHABLE_STAGE`
  (`'eligible-for-publication'`) exported as data, plus module-private `WeakMap` stage
  attestations (`advanceCandidate`, `qualifyCandidate`, `isVerifiedEligibleCandidate`) so
  manually forged `eligible-for-publication` candidates cannot publish.
- **Structured proposition identity (`src/data/canonical-identity.ts`)**: seven-component
  `PropositionIdentity` (`subject`, `event`, `condition`, `geographicScope`, `horizon`,
  `resolutionDate`, `decidingAuthority`), Unicode-safe `normalizeTermValue`, explicit
  `AliasTable` with self-inclusion and conflict checks, three-valued `compareIdentities`
  (`distinct` → `uncertain` → `equivalent`, with no numeric similarity threshold), and
  scheme-prefixed `identityDigest` (`oracle.identity/1\n`).
- **Eleven-requirement candidate evaluation bound to `publishedAt` (`src/data/publication.ts`)**:
  `evaluateCandidate(candidate, { publishedAt })` and `verdictIsComplete` checking all eleven
  `EVALUATION_REQUIREMENTS` without silent defaults, including strict UTC calendar date
  validation (`parseIsoDateTimeMs`, `isValidIsoDateTime`) that rejects impossible calendar
  dates (`2026-02-29`, `2030-02-30`, `2030-04-31`), reversed horizons (`startsAt >= endsAt`),
  expired horizons (`publishedAt >= horizon.endsAt`), resolution dates preceding
  `horizon.endsAt` or disagreeing with `resolutionCriteria.resolveOn`, and post-publication
  evidence (`evidence[i].publishedAt > publishedAt`).
- **Honest clock contract, `candidateDigest` verification, official record validation, and nine-step publication gate (`publishCandidate`)**:
  enforces candidate-to-request identity/ID binding (`candidate-mismatch`), cryptographic
  `request.candidateDigest` verification against `candidateContentDigest(candidate, aliases)`
  (`candidate-digest-mismatch`), stage check, injected clock validation (`invalid-clock` /
  `InvalidClockError` requiring valid UTC `publishedAt` and `recordedAt` with
  `recordedAt > publishedAt` and no `+1ms` fabrication), content-bound idempotency
  (`publicationRequestDigest`, `replayed`, `idempotency-conflict`), identity self-check
  (`identity-conflict`), evaluation gate at `publishedAt` (`rejected`), anti-forgery
  lifecycle attestation (`wrong-stage` with `reason: 'forged-stage'`), and atomic
  `commitPublication` producing a `demo: false` official `PredictionRecord` verified by
  `validateOfficialRecord` / `validateOfficialArchive` while leaving `src/data/records.json`
  and `src/data/validate.ts` untouched.

---

## 2. Known limitations

### Product-level, stated in the interface

1. **No forecasting engine.** There is no model that turns a question into a probability.
   Explore is a transparent parser, not a predictor, and says so.
2. **No server, database or shared resolution service.** The archive is a static typed
   dataset. Official records cannot yet be published, revised or resolved by anyone.
3. **No public anchoring.** Digests are verifiable locally but no external witness or
   transparency log has attested them.
4. **No accounts, sync or personalisation** — by design, but it also means drafts are
   tied to a single browser and are lost if storage is cleared.
5. **No calibration history.** With ten demo records, any hit rate is meaningless; the UI
   labels it as structure rather than evidence.
6. **Immutability is architectural, not enforced.** Someone with repository write access
   could rewrite a record and re-seal it. Records are append-only by convention and
   verifiable by digest, which is weaker than the eventual guarantee.

### Technical

7. **The digest verifies consistency, not authorship.** A SHA-256 hash is not a signature.
   Public keys and signed records are not implemented.
8. **Client-side only, with per-route metadata.** Each route now sets its own title,
   description, canonical URL and Open Graph title, so tabs and shared links are accurate.
   There is still no SSR or prerendering: social crawlers that do not execute JavaScript read
   the static defaults in `index.html`, and a record-specific preview is not possible yet.
   The site ships `noindex` until real records exist.
9. **`localStorage` capacity.** Drafts are capped at 24 entries (roughly 20 KB of text) and
   are pruned oldest-last; there is no quota handling beyond silent failure.
10. **The question parser is shallow, and the archive key is wording-level.** Keyword
    lexicons and token overlap misclassify unusual phrasing and cannot detect semantic
    equivalence. The canonical-question key is now Unicode-aware — it keeps letters, digits
    and combining marks from every script — but it is still a *string* comparison, not a
    semantic one. Specifically: `baterías` and `baterias` do **not** merge, `1.200` and
    `1200` do **not** merge, and two paraphrases of the same question are not detected.
    Every one of those gaps is a missed merge, never a false one. False merges are the
    failure mode that would let two official answers to one question coexist, so the bias
    is intentional.
11. **Category and status filters do not persist across page loads** beyond the URL. Deep
    links work; returning later resets to defaults.
12. **No dark/light theme switch.** The product is dark-only by design; `color-scheme: dark`
    is declared so native controls match.
13. **The hit-rate aggregate is simplistic** — it thresholds at 50% and excludes
    indeterminate outcomes. Real calibration needs Brier scores and reference classes.
14. **No virtualisation.** All ten demo records and nine trends render at once. Real
    archive sizes will need windowing.
15. **Accessibility is tested, not certified.** Automated coverage plus manual attention to
    semantics and focus, but no third-party WCAG audit. The sphere is deliberately
    `aria-hidden` as decorative.
16. **Browser support target** is evergreen Chromium, Firefox and Safari. `field-sizing`
    (auto-growing textarea) degrades gracefully where unsupported.
17. **No internationalisation.** Copy is English, dates are en-GB formatted in UTC.
18. **The error boundary is a safety net, not a monitoring system.** A render error shows a
    branded recovery surface with the error message, but nothing is reported anywhere —
    there is no error service, by design.

---

## 3. Deliberately not built

- Fake "AI is thinking" theatre that resolves to an invented number.
- Paywalls, upsells, newsletter capture, or analytics.
- Any dependency on a paid API, API key, or external service.
- A visual language borrowed from an existing AI assistant.

---

## 4. If this were the next sprint

1. Persist records server-side with append-only writes and a monotonic revision chain.
2. Sign each record and publish the public key; anchor digests to a transparency log.
3. Move canonicalization and resolution into a reviewed workflow with a named editor.
4. Publish the raw archive as a static JSON endpoint so readers can verify offline.
5. Only then start the forecasting work: reference classes, structured elicitation,
   aggregation and Brier-scored calibration.

### Deployment readiness

19. **The canonical origin is a placeholder.** `https://the-oracle.example` appears in
    `index.html` (canonical, `og:url`, `og:image`) and in
    `src/components/layout/RouteMetadata.tsx`. Open Graph images must be absolute URLs, so
    previews will not render until this is replaced with the real origin.
20. **Indexing is switched off on purpose.** `index.html` carries
    `<meta name="robots" content="noindex, nofollow">` because the archive is demonstration
    data. Removing it before real records exist would put illustrative probabilities into
    search results.
21. **SPA fallback is configured, not proven.** `public/_redirects` (Netlify, Cloudflare
    Pages) and `public/vercel.json` (Vercel) are committed and the build serves correctly
    under `vite preview`, but no host has been exercised. Every route must be reloaded
    directly against the deployed origin before launch.
22. **No consent, analytics or privacy policy.** Nothing is tracked and nothing is sent
    anywhere, which makes this easy to disclose honestly — but a public deployment still
    needs that disclosure written somewhere a visitor can find it.

### Canonical-question enforcement

23. **Is the rule enforced outside the tests? Yes, since the pre-launch audit.** The rules
    live in `src/data/validate.ts`, which imports no JSON and no DOM, so
    `scripts/validate-archive.mjs` imports it directly under Node and runs it against the
    records that actually ship. `npm run build` and `npm run seal` both start with
    `npm run validate`, which exits non-zero on a duplicate canonical question — a real
    build was verified to refuse to produce `dist/`. Before this change the function existed
    but was only ever called from tests, so a duplicate could have shipped.
24. **The gate is still not a publication service.** It runs at build time on a static
    dataset. There is no server that can reject a record at publish time, because there is
    no publishing pipeline yet. Anyone who edits `records.json` locally and runs `dev`
    bypasses the gate entirely; the `build` and `seal` scripts are the enforced paths.

### Integrity model (payload/event split)

25. **No shipped record can claim publication-before-outcome.** All ten demo records were
    sealed before the split, when the digest covered status and resolution. Their digests are
    preserved and verified under `payloadScope: 'legacy-record'`, and every one carries
    `sealClaim: 'self-consistent'`. The claim that a probability was fixed *before* the
    outcome existed is only available to records sealed from now on, and only becomes
    *demonstrable* once an external anchor exists (§6 of the architecture proposal).
26. **`status` is derived, not stored.** It is folded from the event chain by
    `deriveLifecycle`. This is a real improvement — a status cannot be edited into place — but
    it means the archive JSON no longer contains a `status` field. Anything reading
    `records.json` directly must fold the events.
27. **Revisions are still records, not chains.** `integrity.revision` exists, but a revision
    is a separate record. The event chain models state transitions within one revision, not
    the relationship between revisions.
28. **The chain is local tamper-evidence.** Recomputing it proves internal consistency. It does
    not prove the chain was not rebuilt from scratch by someone with write access, because
    nothing anchors it externally yet. The publication link makes a *partial* edit detectable
    (payload or event changed in isolation); a full rebuild that regenerates every digest stays
    internally consistent and is caught only by comparing against git history, not by
    `npm run validate`. Until an anchor exists, that is the honest boundary.
29. **Every shipped event is `migrated`.** Its `occurredAt` is a restated archive date, not an
    observation. No shipped event can claim it was written while the thing happened. That
    capability arrives with the publication pipeline; until then `origin: 'observed'` appears
    only in tests.
30. **`recordedAt` is per record, not per event.** All events of one record share the migration
    timestamp in the current data. The validator checks the ordering inequality, not an exact
    per-event time, because no such precision was ever recorded.
31. **A `legacy-record` record that is still open cannot be resolved, and that is the
    decision.** Its digest covers `status` and `resolution`, so recording an outcome changes
    the bytes it was computed over and the stored digest stops reproducing. Seven shipped
    records are in this state (0001–0006, 0008).

    **Current policy: they are kept as immutable historical demonstrations.** No resolution,
    no annulment, no revision, no change to their digests. `nextEvent()` and `appendEvent()`
    refuse the operation outright, and `npm run validate` would reject a hand-edited archive
    that acquired a terminal event, because the digest stops reproducing.

    Revisions and supersession are **not available features**. They are not implemented in
    the interface, the validator or the data model. A future design could introduce them —
    a new record that supersedes a legacy one, carrying its own modern-scope seal and an
    explicit reference to what it replaces — but until such a system exists and is validated,
    it must not be described as a way to resolve these records.
32. **`npm run validate` cannot detect a full internal rebuild.** Recomputing every payload
    digest, the publication event and the whole chain produces a consistent archive that
    passes. Only the git history contradicts it. Closing this needs an external anchor.

33. **`anchored` is rejected, not trusted.** No anchoring mechanism exists, so a record that
    sets `integrity.anchored: true` fails validation and the panel reports the claim as
    unhonoured. This must stay until a verifiable external proof exists — and when it does,
    the check becomes "the proof verifies", never "the flag says so".
34. **`observed` is a declared provenance, not a demonstrated one.** The digest protects the
    claim from being edited; it cannot show the claim is true. A full rebuild can mint any
    `origin` and `recordedAt`. Only an external witness closes this.
35. **Seven legacy records are permanently unresolvable.** `0001`–`0006` and `0008` are open
    and sealed under `legacy-record`, whose digest covers the outcome. `nextEvent` and
    `appendEvent` refuse terminal events on them. This is the original sealing defect made
    explicit; it is not repaired, because repairing it would mean re-sealing or rewriting
    history.

36. **One UI test needs a longer wait than the default, and only under load.**
    `App.test.tsx > navigation > navigates from the homepage to the archive` clicks a `lazy()`
    route and then waits for the new page.

    *Normal behaviour.* The test passes with Testing Library's default async-utility timeout.
    A single isolated run completes the navigation in roughly 0.3 s.

    *Extreme contention.* With several full-file runs competing for CPU the navigation is not
    broken, it is late: instrumented at 3.6–4.4 s. At that latency the default 1000 ms fails
    the assertion, which is correct behaviour for a timeout — the wait, not the component, is
    the problem.

    *Localised fix applied.* That one `findByRole` passes `timeout: 5000`. No global ceiling is
    configured; every other assertion in the suite keeps the default, so a genuinely stuck
    component still fails quickly everywhere else.

    *Residual limitation.* This is mitigation, not a cure. Measurements taken while
    investigating:

    | Condition | default 1000 ms | 5000 ms |
    |---|---|---|
    | 1 copy, isolated | pass | pass |
    | 3 copies, full suite | pass | pass |
    | 6 copies, that test only | fails 5/6 | fails 3/6 |
    | 6 copies, whole file | — | can fail |

    A 6/6 pass was observed with a 20 s ceiling on that test alone, but that is **not a general
    guarantee**: it shows the navigation eventually completes, not that any ceiling survives
    arbitrary parallelism. Even 10 s failed at six concurrent full-file runs. The honest
    position is that the suite is reliable in a normal run and that unusually heavy parallelism
    can still produce this failure. If it appears in CI, run that file in isolation rather than
    raising the number again.

### Official Publication Protocol v1.2 (domain layer)

37. **The publication protocol is a domain specification and reference implementation, not a
    live server.** `src/data/publication-types.ts`, `src/data/canonical-identity.ts`, and
    `src/data/publication.ts` define and test the attested lifecycle, canonical identity,
    evaluation gate, domain-level sealed record construction (`buildSealedPredictionRecord`),
    official record validator (`validateOfficialRecord` / `validateOfficialArchive`), and
    `PublicationRegistry` contract in pure TypeScript. No HTTP API, worker process, or
    persistent database exists in this repository; `docs/PUBLICATION-API-CONTRACT.md`
    specifies the storage and transaction requirements a future backend must implement.
38. **`InMemoryRegistry` is single-process and ephemeral; single-threaded tests do not prove
    distributed atomicity.** `InMemoryRegistry.commitPublication` executes its idempotency
    lookup/conflict check, canonical identity claim, sealed `PredictionRecord` storage, and
    idempotency binding in a single synchronous critical section inside one JavaScript event
    loop. That proves the domain contract and state-machine invariants in unit tests, but it
    provides no crash durability and no multi-process or multi-node concurrency control.
    Production uniqueness and atomic idempotency+publication commit depend on PostgreSQL
    enforcing `PRIMARY KEY (idempotency_key)` (`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`),
    a deferred `CHECK (outcome IS NOT NULL)` constraint, and `UNIQUE (identity_digest)` inside
    a single `READ COMMITTED` ACID transaction (`docs/PUBLICATION-API-CONTRACT.md` §2.3).
39. **Historical DEMO validation (`validateArchive`) and official publication validation
    (`validateOfficialRecord` / `validateOfficialArchive`) are intentionally separate.**
    Protected `src/data/validate.ts` (`validateArchive`) is the build-time gate for the 10
    illustrative records in `src/data/records.json` and requires `record.demo === true`.
    Newly constructed official records have `record.demo === false` and are validated by
    `validateOfficialRecord` / `validateOfficialArchive` (`src/data/publication.ts`), which
    reuse the underlying cryptographic and event-chain checks (`eventChainProblems`,
    `publishedLinkProblems`, `digestProblems`) while enforcing `demo === false`,
    `payloadScope === 'sealed-payload'`, `sealClaim === 'published-before-outcome'`,
    `anchored === false`, `publishedAt < horizon.endsAt`, and `evidence[i].publishedAt <= publishedAt`.
40. **`AliasTable` is curated editorial data, not semantic inference.** `compareIdentities`
    and `identityDigest` merge two different identifiers (`albiceleste` and `fifa-argentina`)
    only when an explicit `AliasEntry` lists both under the same namespace. Nothing in
    `src/data/canonical-identity.ts` parses free-text questions into `PropositionIdentity`
    components or infers synonymy from prose.
41. **Falsifiability is a recorded review assertion, not an automated proof, and stage
    attestation is in-memory (`WeakMap`).** Requirement `falsifiable-proposition` checks
    that `candidate.inferences` contains a recorded `falsifiability-review` entry. Similarly,
    `advanceCandidate` / `qualifyCandidate` track verified stage transitions in a
    module-private `WeakMap`; across HTTP requests in a future backend, candidate stage
    transitions must be persisted and verified by the server rather than trusted from client
    JSON.
42. **Clock honesty is enforced structurally (`recordedAt > publishedAt`), not attested by an
    external time authority.** `buildSealedPredictionRecord` and `publishCandidate` require
    injected `publishedAt` and `recordedAt` UTC timestamps with `recordedAt > publishedAt`
    and verify `publishedAt < horizon.endsAt` and `evidence[i].publishedAt <= publishedAt`,
    refusing invalid or non-increasing clocks (`InvalidClockError` / `invalid-clock`). However,
    without an external RFC 3161 timestamp authority or transparency log (`anchored: false`),
    a party controlling the server clock could still supply a backdated clock at sealing time.
