# THE ORACLE — Official Publication Protocol v1.3

This document specifies **Official Publication Protocol v1.3**: the domain rules that
separate an exploratory visitor query from a candidate proposition and from an official,
sealed prediction record, together with the clock, horizon, evidence-chronology,
candidate-digest, and record-validation guarantees enforced at publication time.

The executable domain reference lives in:

- `src/data/publication-types.ts` — vocabulary, lifecycle table (`LIFECYCLE`), terminal
  stages (`TERMINAL_STAGES`), evaluation requirement identifiers
  (`EVALUATION_REQUIREMENTS`), candidate and request shapes, `PublicationOutcome`
  (10 variants), and the storage-agnostic `PublicationRegistry` interface.
- `src/data/canonical-identity.ts` — structured proposition identity, deterministic alias
  resolution (`AliasTable`), three-valued identity comparison (`compareIdentities`), and
  the scheme-prefixed identity digest (`identityDigest`).
- `src/data/publication.ts` — strict calendar UTC timestamp parsing
  (`parseIsoDateTimeMs`, `isValidIsoDateTime`), `InvalidClockError`, attested stage
  transitions (`canTransition`, `advance`, `advanceCandidate`, `qualifyCandidate`,
  `isVerifiedEligibleCandidate`), the eleven-point evaluator bound to `publishedAt`
  (`evaluateCandidate`, `verdictIsComplete`), versioned candidate/request digests
  (`candidateContentDigest`, `publicationRequestDigest`), domain-level sealed official
  record construction (`buildSealedPredictionRecord` with `demo: false`), official record
  validation (`validateOfficialRecord`, `validateOfficialArchive`), the nine-step
  publication gate (`publishCandidate`), and the single-process reference store
  (`InMemoryRegistry`).

---

## 1. Scope and honest status

| Layer | Status in this repository |
| --- | --- |
| Domain types, lifecycle graph, `TERMINAL_STAGES`, and attested transitions | **Implemented and tested** (`src/data/publication-types.ts`, `src/data/publication.ts`) |
| Structured canonical identity and alias resolution | **Implemented and tested** (`src/data/canonical-identity.ts`) |
| Eleven-requirement candidate evaluation bound to `publishedAt` (horizon + evidence chronology) | **Implemented and tested** (`src/data/publication.ts`) |
| Candidate-to-request binding, `candidateDigest` verification, honest clock contract (`recordedAt > publishedAt`), and sealed official `PredictionRecord` construction (`demo: false`) | **Implemented and tested** (`src/data/publication.ts`) |
| Official record & archive validation (`validateOfficialRecord`, `validateOfficialArchive`) distinct from historical demo archive validation (`validateArchive`) | **Implemented and tested** (`src/data/publication.ts`) |
| Atomic publication & idempotency contract (`commitPublication`) | **Implemented against `PublicationRegistry` (`InMemoryRegistry` in-process)** |
| Persistent database, HTTP API server, and multi-process ACID atomicity | **Not implemented** — specified in `docs/PUBLICATION-API-CONTRACT.md` |
| External cryptographic timestamp anchoring | **Not implemented** — all records carry `integrity.anchored: false` |
| Automatic extraction from free text into `CandidateProposition` | **Not implemented** — the Explore page remains a local lexical heuristic |

Nothing in this protocol modifies `src/data/records.json`, `src/data/events.ts`, or
`src/data/validate.ts`. The ten shipped records remain illustrative (`demo: true`,
`anchored: false`), and no visitor interaction in the browser can create a persistent
official record.

---

## 2. Three distinct objects and the demo vs. official record boundary

A forecasting archive loses its integrity if "someone asked a question", "someone drafted a
candidate", "the repository ships illustrative demo fixtures", and "the archive published an
official prediction" share a status flag or bypass validation.

1. **Exploratory query (`exploratory-query`)** — raw text typed by a visitor. It has no
   `PropositionIdentity`, no probability, no resolution criteria, and no direct or
   indirect transition to `officially-published` that bypasses evaluation.
2. **Candidate proposition (`CandidateProposition`)** — a structured reading of a query.
   It carries a `candidateId` (which never becomes a `PredictionId`), the verbatim
   `submittedQuery`, a `proposedQuestion`, a structured `proposedIdentity`, a nullable
   `probability`, `rationale`, `horizon`, `resolutionCriteria`, `evidence`,
   `disclosedLimitations`, and an explicit list of `inferences` recording any component
   supplied by a rule rather than by the author.
3. **Official prediction (`PredictionRecord` with `demo: false`)** — a sealed record
   constructed by `buildSealedPredictionRecord(candidate, predictionId, publishedAt, recordedAt)`
   only after a candidate traverses the verified lifecycle to `eligible-for-publication`,
   passes all eleven evaluation requirements at `publishedAt`, resolves every component of
   its `PropositionIdentity` without ambiguity, matches the `PublicationRequest` identity
   and `candidateDigest`, satisfies the injected clock contract (`recordedAt > publishedAt`),
   passes `validateOfficialRecord`, and wins the atomic `commitPublication` operation for
   its `identityDigest`.

### Historical DEMO archive validation vs. Official publication validation

- **Historical DEMO archive (`src/data/records.json`, validated by `validateArchive` in `src/data/validate.ts`)**:
  The ten records shipped in `src/data/records.json` are illustrative demonstrations created
  before the publication protocol existed. Protected `src/data/validate.ts` is the build-time
  gate for `src/data/records.json` (`npm run validate`), and it intentionally enforces
  `record.demo === true` so no shipped static fixture can masquerade as a live official
  forecast.
- **Newly sealed official records (`demo: false`, validated by `validateOfficialRecord` / `validateOfficialArchive` in `src/data/publication.ts`)**:
  `buildSealedPredictionRecord` always sets `demo: false`, `payloadScope: 'sealed-payload'`,
  `sealClaim: 'published-before-outcome'`, and `anchored: false`. Because `validateArchive`
  rejects `demo: false` by design, `src/data/publication.ts` provides `validateOfficialRecord`
  and `validateOfficialArchive`, which enforce:
  - `record.demo === false` (rejecting any demo record in the official validator),
  - `record.integrity.payloadScope === 'sealed-payload'`,
  - `record.integrity.sealClaim === 'published-before-outcome'`,
  - `record.integrity.anchored === false`,
  - strict calendar UTC timestamps on `record.publishedAt`, `e0.occurredAt`, and
    `e0.recordedAt` with `e0.origin === 'observed'`, `e0.occurredAt === record.publishedAt`,
    and `e0.recordedAt > e0.occurredAt`,
  - `record.publishedAt < record.horizon.endsAt`, and every `evidence[i].publishedAt <= record.publishedAt`,
  - zero problems from `eventChainProblems(record)`, `publishedLinkProblems(record)`, and
    `digestProblems(record)`, plus canonical-question uniqueness across the official archive.

---

## 3. Lifecycle state machine and anti-forgery attestation

Every proposition stage is a member of `PropositionStage`, and the allowed edges are
defined as data in `LIFECYCLE` (`src/data/publication-types.ts`):

```text
exploratory-query
  └─► candidate-proposition
        ├─► rejected-candidate (terminal)
        └─► identity-matching
              ├─► rejected-candidate (terminal)
              └─► evaluation
                    ├─► rejected-candidate (terminal)
                    └─► eligible-for-publication
                          ├─► rejected-candidate (terminal)
                          └─► officially-published
                                ├─► resolved (terminal)
                                └─► annulled (terminal)
```

### Invariants enforced by `LIFECYCLE`, `TERMINAL_STAGES`, `advanceCandidate`, and `qualifyCandidate`

- **Single entry to publication**: `eligible-for-publication` (`PUBLISHABLE_STAGE`) is the
  only stage whose outgoing edges include `officially-published`.
- **Mandatory gates on every simple path**: every path from `exploratory-query` to
  `officially-published` passes through `identity-matching`, then `evaluation`, then
  `eligible-for-publication` in that order.
- **Terminal stages (`TERMINAL_STAGES`)**: `['rejected-candidate', 'resolved', 'annulled']`
  matches the exact set of stages in `LIFECYCLE` with empty outgoing transition lists.
- **Unforgeable stage attestation**: `advanceCandidate(candidate, to, aliases)` and
  `qualifyCandidate(candidate, aliases)` enforce identity resolution on
  `identity-matching → evaluation` and full evaluation on
  `evaluation → eligible-for-publication`, freeze the resulting `CandidateProposition`, and
  record its canonical content snapshot in a module-private `WeakMap`. A caller that
  manually constructs `{ ...candidate, stage: 'eligible-for-publication' }` — or clones and
  modifies a qualified candidate — fails `isVerifiedEligibleCandidate(candidate)` and is
  rejected by `publishCandidate` with
  `{ kind: 'wrong-stage', reason: 'forged-stage', ... }`.

---

## 4. Honest clock contract, forecast horizon, and evidence chronology

### 4.1 Injected clock and recording timestamps (`publishedAt` and `recordedAt`)

Domain functions never call `new Date()` or `Date.now()` directly and never fabricate
`recordedAt` by adding `+1ms` to `publishedAt`:

- `buildSealedPredictionRecord(candidate, predictionId, publishedAt, recordedAt)` requires
  explicit `publishedAt` and `recordedAt` arguments. Both must pass `parseIsoDateTimeMs`
  (strict `YYYY-MM-DDTHH:mm:ss(.sss)Z` format with calendar-valid year, month, day, hour,
  minute, and second), and `recordedAt` must be strictly greater than `publishedAt`
  (`recordedAtMs > publishedAtMs`). If either timestamp is malformed or
  `recordedAt <= publishedAt`, `buildSealedPredictionRecord` throws `InvalidClockError`.
- In `publishCandidate(candidate, request, deps)`, the publication clock is read via
  injected dependencies (`publishedAt = deps.now()`, and
  `recordedAt = deps.recordedAt ? deps.recordedAt() : deps.now()`). If either value is not a
  valid calendar UTC timestamp or `recordedAt <= publishedAt`, `publishCandidate` returns
  `{ kind: 'invalid-clock', publishedAt, recordedAt, detail }` before any registry lookup or
  mutation.
- The sealed record's `record.publishedAt` and its initial publication event's
  `e0.occurredAt` both equal `publishedAt`, and `e0.recordedAt` equals `recordedAt`.

### 4.2 The eleven evaluation requirements (`evaluateCandidate(candidate, { publishedAt })`)

`evaluateCandidate(candidate, options)` checks every requirement in
`EVALUATION_REQUIREMENTS` independently against `referencePublishedAt = options?.publishedAt ?? candidate.createdAt`
(and `publishCandidate` always passes `{ publishedAt }` from the injected publication clock).
The returned `EvaluationVerdict` always contains all eleven items in canonical order
(`verdictIsComplete(verdict) === true`).

| Requirement ID | What `evaluateCandidate` checks | Why a default is refused |
| --- | --- | --- |
| `unambiguous-question` | `proposedQuestion` is non-empty after trimming and contains no hedging words (`maybe`, `possibly`, `might`, `unclear`, `either`). | A hedged question cannot be resolved Yes or No on a fixed date. |
| `falsifiable-proposition` | `candidate.inferences` contains an entry with `rule === 'falsifiability-review'`. | Falsifiability is an editorial judgment, not a property a regex can prove from prose. |
| `fixed-horizon` | `horizon !== null`, non-empty `label`, `startsAt`, `endsAt`, and `publishedAt` are valid calendar UTC ISO-8601 timestamps, `startsAt < endsAt`, and **`publishedAt < horizon.endsAt`**. | A forecast cannot be sealed as `published-before-outcome` at or after the moment its forecast window closes (`publishedAt >= horizon.endsAt`). |
| `fixed-resolution-date` | `proposedIdentity.resolutionDate` is a valid calendar UTC ISO-8601 timestamp, `resolutionDate >= horizon.endsAt`, and matches `resolutionCriteria.resolveOn`. | A question cannot resolve before its horizon ends or disagree with its own criteria. |
| `identified-authority` | `proposedIdentity.decidingAuthority` is not marked `unresolved: true` and its `id` is not `'unknown'`. | Someone must decide the outcome without consulting the forecaster. |
| `objective-criteria` | `resolutionCriteria !== null` with non-empty `rule`, non-empty `authority`, and a valid UTC `resolveOn` timestamp. | Criteria must be stated before the outcome is known. |
| `probability-in-range` | `probability !== null`, finite, and strictly `0 < probability < 1`. | `null` is not `0.5`, and `0` or `1` denies uncertainty rather than pricing it. |
| `documented-rationale` | `rationale !== null` and non-empty after trimming. | A bare number without reasoning cannot be audited. |
| `recorded-evidence` | `evidence.length > 0`. | An official forecast must cite the inputs available at publication time. |
| `preserved-evidence-provenance` | Every item in `evidence` has non-empty `publisher`, non-empty `title`, a valid calendar UTC `publishedAt` timestamp, a valid publication timestamp, and **`evidence[i].publishedAt <= publishedAt`**. | Evidence published after `publishedAt` did not exist when the forecast was sealed; citing future sources would permit hindsight contamination. |
| `disclosed-limitations` | `disclosedLimitations.length > 0`. | Every forecast has blind spots; omitting them overstates precision. |

---

## 5. Canonical serialization and versioned digests

All protocol digests use recursive key-sorted canonical JSON (`canonicalize` from
`src/data/events.ts`) prefixed with an explicit versioned domain tag:

1. **Proposition identity digest (`identityDigest` in `src/data/canonical-identity.ts`)**:
   ```text
   SHA-256( UTF-8( "oracle.identity/1\n" + canonicalize(resolvedPropositionIdentity) ) )
   ```
2. **Candidate content digest (`candidateContentDigest` in `src/data/publication.ts`)**:
   ```text
   SHA-256( UTF-8( "oracle.candidate/1\n" + canonicalize(canonicalCandidateContent(candidate, aliases)) ) )
   ```
   Covers `schema: 'oracle.candidate/1'`, `candidateId`, `submittedQuery`, `proposedQuestion`,
   alias-resolved `proposedIdentity`, `probability`, `rationale`, `horizon`,
   `resolutionCriteria`, `evidence`, `disclosedLimitations`, and `inferences`.
3. **Publication request digest (`publicationRequestDigest` in `src/data/publication.ts`)**:
   ```text
   SHA-256( UTF-8( "oracle.publication-request/1\n" + canonicalize({
     schema: "oracle.publication-request/1",
     candidate: canonicalCandidateContent(candidate, aliases),
     request: { candidateId, identity: resolvedRequestIdentity, candidateDigest }
   }) ) )
   ```

`publishCandidate` actively verifies `request.candidateDigest` against
`candidateContentDigest(candidate, deps.aliases)` before any registry lookup or mutation:
- If `request.candidateDigest` is empty or whitespace-only → `{ kind: 'candidate-digest-mismatch', reason: 'missing', ... }`.
- If `request.candidateDigest` is not a 64-character lowercase hex string → `{ kind: 'candidate-digest-mismatch', reason: 'malformed', ... }`.
- If `request.candidateDigest !== candidateContentDigest(candidate, deps.aliases)` → `{ kind: 'candidate-digest-mismatch', reason: 'mismatch', ... }`.

---

## 6. Nine-step publication gate (`publishCandidate`)

`publishCandidate(candidate, request, deps)` executes nine checks in strict order:

1. **Candidate-to-request binding (`candidate-mismatch`)** — before any registry lookup or
   mutation, verifies `request.candidateId === candidate.candidateId`
   (`reason: 'candidate-id'`) and verifies that `request.identity` matches
   `candidate.proposedIdentity` under `deps.aliases` (`reason: 'proposed-identity'`).
2. **Candidate content digest verification (`candidate-digest-mismatch`)** — before any
   registry lookup or mutation, computes `expectedCandidateDigest = candidateContentDigest(candidate, deps.aliases)`
   and verifies that `request.candidateDigest` is present, well-formed (`^[0-9a-f]{64}$`),
   and equal to `expectedCandidateDigest`.
3. **Stage value check (`wrong-stage`, `reason: 'invalid-stage'`)** — if
   `!isPublishable(candidate.stage)`, returns immediately without touching the registry.
4. **Injected clock validation (`invalid-clock`)** — reads `publishedAt = deps.now()` and
   `recordedAt = deps.recordedAt ? deps.recordedAt() : deps.now()`. Verifies that both are
   valid calendar UTC ISO-8601 timestamps and `recordedAt > publishedAt` before any registry
   lookup or mutation.
5. **Content-bound idempotency lookup (`replayed` / `idempotency-conflict`)** — computes
   `requestDigest` and `identityDigest` and calls
   `registry.findByIdempotencyKey(request.idempotencyKey, requestDigest)`:
   - If the key is bound to the exact same `requestDigest`, returns
     `{ kind: 'replayed', original }` verbatim.
   - If the key is bound to a different `requestDigest`, returns
     `{ kind: 'idempotency-conflict', idempotencyKey, existingRequestDigest, incomingRequestDigest, detail }`.
6. **Identity self-check (`identity-conflict`)** — runs
   `compareIdentities(request.identity, request.identity, deps.aliases)`. If any component
   is unresolved (`outcome === 'uncertain'`), records the non-publishing outcome for
   `idempotencyKey` via `recordIdempotencyKey` and returns `{ kind: 'identity-conflict', match }`
   without touching the identity registry. Because `idempotencyKey` is now bound to the
   rejected `requestDigest`, retrying the identical broken request replays `identity-conflict`,
   and submitting a corrected candidate requires a new `idempotencyKey` (reusing the old key
   with modified candidate content returns `idempotency-conflict`).
7. **Evaluation gate at `publishedAt` (`rejected`)** — runs
   `evaluateCandidate(candidate, { publishedAt })` (which enforces `publishedAt < horizon.endsAt`
   and `evidence[i].publishedAt <= publishedAt` alongside all other requirements). If
   `!verdict.eligible`, records the non-publishing outcome for `idempotencyKey` via
   `recordIdempotencyKey` and returns `{ kind: 'rejected', verdict }` without touching the
   identity registry. As with `identity-conflict`, the rejected attempt consumes
   `idempotencyKey` for that `requestDigest` while never claiming an official identity, so a
   corrected/retried candidate submission must use a new `idempotencyKey`.
8. **Lifecycle attestation check (`wrong-stage`, `reason: 'forged-stage'`)** — verifies
   `isVerifiedEligibleCandidate(candidate, deps.aliases)`. A manually constructed or
   post-qualification mutated candidate is rejected without touching the identity registry.
9. **Domain record sealing, official record validation, and atomic commit (`commitPublication`)** —
   constructs the sealed official `PredictionRecord` (`demo: false`) and its schema-2 `e0`
   (`published`) event via
   `buildSealedPredictionRecord(candidate, predictionId, publishedAt, recordedAt)`, verifies
   `validateOfficialRecord(record)` has zero problems, and calls
   `registry.commitPublication({ idempotencyKey, requestDigest, identityDigest, predictionId, record })`:
   - If the idempotency key was concurrently bound to the same `requestDigest`, returns
     `{ kind: 'replayed', original }`; if bound to a different `requestDigest`, returns
     `{ kind: 'idempotency-conflict', ... }` without claiming the identity.
   - If `identityDigest` was unclaimed, commits the identity claim, the sealed
     `PredictionRecord`, and the idempotency binding together and returns
     `{ kind: 'created', predictionId, identityDigest, requestDigest, record }`.
   - If `identityDigest` was already claimed by an earlier or concurrent winner, commits
     the idempotency binding for the existing winner and returns
     `{ kind: 'existing', predictionId: winnerId, identityDigest, requestDigest, record: winnerRecord }`.
