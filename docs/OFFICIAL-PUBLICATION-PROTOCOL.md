# THE ORACLE — Official Publication Protocol v1.1

This document specifies **Official Publication Protocol v1.1**: the domain rules that
separate an exploratory visitor query from a candidate proposition and from an official,
sealed prediction record.

The executable domain reference lives in:

- `src/data/publication-types.ts` — vocabulary, lifecycle table (`LIFECYCLE`), terminal
  stages (`TERMINAL_STAGES`), evaluation requirement identifiers
  (`EVALUATION_REQUIREMENTS`), candidate and request shapes, `PublicationOutcome`
  (8 variants), and the storage-agnostic `PublicationRegistry` interface.
- `src/data/canonical-identity.ts` — structured proposition identity, deterministic alias
  resolution (`AliasTable`), three-valued identity comparison (`compareIdentities`), and
  the scheme-prefixed identity digest (`identityDigest`).
- `src/data/publication.ts` — strict calendar UTC timestamp parsing
  (`parseIsoDateTimeMs`, `isValidIsoDateTime`), attested stage transitions
  (`canTransition`, `advance`, `advanceCandidate`, `qualifyCandidate`,
  `isVerifiedEligibleCandidate`), the eleven-point evaluator (`evaluateCandidate`,
  `verdictIsComplete`), versioned candidate/request digests (`candidateContentDigest`,
  `publicationRequestDigest`), domain-level sealed record construction
  (`buildSealedPredictionRecord`), the seven-step publication gate (`publishCandidate`),
  and the single-process reference store (`InMemoryRegistry`).

---

## 1. Scope and honest status

| Layer | Status in this repository |
| --- | --- |
| Domain types, lifecycle graph, `TERMINAL_STAGES`, and attested transitions | **Implemented and tested** (`src/data/publication-types.ts`, `src/data/publication.ts`) |
| Structured canonical identity and alias resolution | **Implemented and tested** (`src/data/canonical-identity.ts`) |
| Eleven-requirement candidate evaluation with strict calendar/temporal checks | **Implemented and tested** (`src/data/publication.ts`) |
| Candidate-to-request binding, content-bound idempotency, and sealed `PredictionRecord` construction | **Implemented and tested** (`src/data/publication.ts`) |
| Atomic publication & idempotency contract (`commitPublication`) | **Implemented against `PublicationRegistry` (`InMemoryRegistry` in-process)** |
| Persistent database, HTTP API server, and multi-process ACID atomicity | **Not implemented** — specified in `docs/PUBLICATION-API-CONTRACT.md` |
| Automatic extraction from free text into `CandidateProposition` | **Not implemented** — the Explore page remains a local lexical heuristic |

Nothing in this protocol modifies `src/data/records.json`. The ten shipped records remain
illustrative (`demo: true`, `anchored: false`), and no visitor interaction in the browser
can create a persistent official record.

---

## 2. Three distinct objects

A forecasting archive loses its integrity if "someone asked a question" and "the archive
published a prediction" share a data path. The protocol separates them into three distinct
types:

1. **Exploratory query (`exploratory-query`)** — raw text typed by a visitor. It has no
   `PropositionIdentity`, no probability, no resolution criteria, and no direct or
   indirect transition to `officially-published` that bypasses evaluation.
2. **Candidate proposition (`CandidateProposition`)** — a structured reading of a query.
   It carries a `candidateId` (which never becomes a `PredictionId`), the verbatim
   `submittedQuery`, a `proposedQuestion`, a structured `proposedIdentity`, a nullable
   `probability`, `rationale`, `horizon`, `resolutionCriteria`, `evidence`,
   `disclosedLimitations`, and an explicit list of `inferences` recording any component
   supplied by a rule rather than by the author.
3. **Official prediction (`PredictionRecord`)** — a sealed record constructed by
   `buildSealedPredictionRecord` only after a candidate traverses the verified lifecycle to
   `eligible-for-publication`, passes all eleven evaluation requirements, resolves every
   component of its `PropositionIdentity` without ambiguity, matches the
   `PublicationRequest` identity, and wins the atomic `commitPublication` operation for its
   `identityDigest`.

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

## 4. The eleven evaluation requirements and strict temporal validation

`evaluateCandidate(candidate)` checks every requirement in `EVALUATION_REQUIREMENTS`
independently and returns an `EvaluationVerdict` whose `results` array always contains all
eleven items in canonical order (`verdictIsComplete(verdict) === true`).

Timestamps are validated with `parseIsoDateTimeMs` / `isValidIsoDateTime`, which require
`YYYY-MM-DDTHH:mm:ss(.sss)Z` and verify `getUTCFullYear()`, `getUTCMonth()`, and
`getUTCDate()` against the parsed calendar components so impossible dates (`2026-02-29`,
`2030-02-30`, `2030-04-31`) cannot silently roll over into the next month.

| Requirement ID | What `evaluateCandidate` checks | Why a default is refused |
| --- | --- | --- |
| `unambiguous-question` | `proposedQuestion` is non-empty after trimming and contains no hedging words (`maybe`, `possibly`, `might`, `unclear`, `either`). | A hedged question cannot be resolved Yes or No on a fixed date. |
| `falsifiable-proposition` | `candidate.inferences` contains an entry with `rule === 'falsifiability-review'`. | Falsifiability is an editorial judgment, not a property a regex can prove from prose. |
| `fixed-horizon` | `horizon !== null`, non-empty `label`, both `startsAt` and `endsAt` are valid calendar UTC ISO-8601 timestamps, and `startsAt < endsAt`. | Reversed, zero-length, or impossible calendar horizons cannot bound an outcome. |
| `fixed-resolution-date` | `proposedIdentity.resolutionDate` is a valid calendar UTC ISO-8601 timestamp, `resolutionDate >= horizon.endsAt`, and matches `resolutionCriteria.resolveOn`. | A question cannot resolve before its horizon ends or disagree with its own criteria. |
| `identified-authority` | `proposedIdentity.decidingAuthority` is not marked `unresolved: true` and its `id` is not `'unknown'`. | Someone must decide the outcome without consulting the forecaster. |
| `objective-criteria` | `resolutionCriteria !== null` with non-empty `rule`, non-empty `authority`, and a valid UTC `resolveOn` timestamp. | Criteria must be stated before the outcome is known. |
| `probability-in-range` | `probability !== null`, finite, and strictly `0 < probability < 1`. | `null` is not `0.5`, and `0` or `1` denies uncertainty rather than pricing it. |
| `documented-rationale` | `rationale !== null` and non-empty after trimming. | A bare number without reasoning cannot be audited. |
| `recorded-evidence` | `evidence.length > 0`. | An official forecast must cite the inputs available at publication time. |
| `preserved-evidence-provenance` | Every item in `evidence` has non-empty `publisher`, non-empty `title`, and a valid calendar UTC `publishedAt` timestamp. | Unattributed or undated citations cannot be checked against post-outcome sources. |
| `disclosed-limitations` | `disclosedLimitations.length > 0`. | Every forecast has blind spots; omitting them overstates precision. |

---

## 5. Canonical serialization and versioned request digests

Idempotency keys are bound to the immutable digest of the publication command, computed
using recursive key-sorted canonical JSON (`canonicalize` from `src/data/events.ts`):

- **Candidate content digest (`candidateContentDigest`)**:
  `SHA-256( UTF-8( "oracle.candidate/1\n" + canonicalize(canonicalCandidateContent) ) )`
- **Publication request digest (`publicationRequestDigest`)**:
  `SHA-256( UTF-8( "oracle.publication-request/1\n" + canonicalize({ schema: "oracle.publication-request/1", candidate: canonicalCandidateContent, request: { candidateId, identity, candidateDigest } }) ) )`

Because `publicationRequestDigest` covers all publication-relevant fields of the candidate
(including its alias-resolved `proposedIdentity`, `proposedQuestion`, `probability`,
`rationale`, `horizon`, `resolutionCriteria`, `evidence`, `disclosedLimitations`, and
`inferences`) alongside the request's `candidateId`, alias-resolved `identity`, and
`candidateDigest`, reusing an `idempotencyKey` with any modified field produces a different
`requestDigest` and returns `{ kind: 'idempotency-conflict', ... }`.

---

## 6. Seven-step publication gate (`publishCandidate`)

`publishCandidate(candidate, request, deps)` executes seven checks in strict order:

1. **Candidate-to-request binding (`candidate-mismatch`)** — before any registry lookup or
   mutation, verifies `request.candidateId === candidate.candidateId`
   (`reason: 'candidate-id'`) and verifies that `request.identity` matches
   `candidate.proposedIdentity` under `deps.aliases` (`reason: 'proposed-identity'`). A
   candidate about one proposition can never publish another proposition's identity.
2. **Stage value check (`wrong-stage`, `reason: 'invalid-stage'`)** — if
   `!isPublishable(candidate.stage)`, returns immediately without touching the registry.
3. **Content-bound idempotency lookup** — computes `requestDigest` and `identityDigest` and
   calls `registry.findByIdempotencyKey(request.idempotencyKey, requestDigest)`:
   - If the key is bound to the exact same `requestDigest`, returns
     `{ kind: 'replayed', original }` verbatim.
   - If the key is bound to a different `requestDigest`, returns
     `{ kind: 'idempotency-conflict', idempotencyKey, existingRequestDigest, incomingRequestDigest, detail }`.
4. **Identity self-check (`identity-conflict`)** — runs
   `compareIdentities(request.identity, request.identity, deps.aliases)`. If any component
   is unresolved (`outcome !== 'equivalent'`), atomically records the non-publishing
   outcome for `idempotencyKey` and returns `{ kind: 'identity-conflict', match }`.
5. **Evaluation gate (`rejected`)** — runs `evaluateCandidate(candidate)`. If
   `!verdict.eligible`, atomically records the non-publishing outcome for `idempotencyKey`
   and returns `{ kind: 'rejected', verdict }`.
6. **Lifecycle attestation check (`wrong-stage`, `reason: 'forged-stage'`)** — verifies
   `isVerifiedEligibleCandidate(candidate)`. A manually constructed or post-qualification
   mutated candidate is rejected without touching the identity registry.
7. **Domain record sealing and atomic commit (`commitPublication`)** — constructs the
   complete sealed `PredictionRecord` and initial `e0` (`published`) event via
   `buildSealedPredictionRecord(candidate, predictionId, deps.now())` and calls
   `registry.commitPublication({ idempotencyKey, requestDigest, identityDigest, predictionId, record })`:
   - If the idempotency key was concurrently bound to the same `requestDigest`, returns
     `{ kind: 'replayed', original }`; if bound to a different `requestDigest`, returns
     `{ kind: 'idempotency-conflict', ... }` without claiming the identity.
   - If `identityDigest` was unclaimed, commits the identity claim, the sealed
     `PredictionRecord`, and the idempotency binding together and returns
     `{ kind: 'created', predictionId, identityDigest, requestDigest, record }`.
   - If `identityDigest` was already claimed by an earlier or concurrent winner, commits
     the idempotency binding for the existing winner and returns
     `{ kind: 'existing', predictionId: winnerId, identityDigest, requestDigest, record }`.

---

## 7. Official record creation boundary and post-publication immutability

- **Domain record construction vs persistent storage**: `buildSealedPredictionRecord`
  constructs a complete `PredictionRecord` (`payloadScope: 'sealed-payload'`,
  `sealClaim: 'published-before-outcome'`, `anchored: false`, `demo: true`) and its
  schema-2 `e0` (`published`) event that passes `validateArchive([record])` with zero
  problems. In this repository, `InMemoryRegistry` holds sealed records only in process
  memory for domain testing and never writes to `src/data/records.json`. Persistent
  storage and cross-process atomicity require the relational ACID transaction specified in
  `docs/PUBLICATION-API-CONTRACT.md`.
- **Immutability after publication**: `sealedPayload(record)` includes `probability`,
  `canonicalQuestion`, `title`, `category`, `publishedAt`, `horizon`, `resolutionCriteria`,
  `evidence`, `demo`, and `sealClaim`, and excludes `events`, `status`, and `resolution`.
  Appending a `resolved` or `annulled` event via `appendEvent` leaves `payloadBytes(record)`
  and `record.probability` byte-for-byte identical.
