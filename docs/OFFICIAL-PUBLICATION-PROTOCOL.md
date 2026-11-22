# THE ORACLE — Official Publication Protocol v1

This document specifies **Official Publication Protocol v1**: the domain rules that
separate an exploratory visitor query from a candidate proposition and from an official,
sealed prediction record.

The executable domain reference lives in:

- `src/data/publication-types.ts` — vocabulary, lifecycle table (`LIFECYCLE`), evaluation
  requirement identifiers (`EVALUATION_REQUIREMENTS`), candidate and request shapes, and
  the storage-agnostic `PublicationRegistry` interface.
- `src/data/canonical-identity.ts` — structured proposition identity, deterministic alias
  resolution (`AliasTable`), three-valued identity comparison (`compareIdentities`), and
  the scheme-prefixed identity digest (`identityDigest`).
- `src/data/publication.ts` — stage transitions (`canTransition`, `advance`,
  `isPublishable`), the eleven-point evaluator (`evaluateCandidate`,
  `verdictIsComplete`), the six-step publication gate (`publishCandidate`), and the
  single-process reference store (`InMemoryRegistry`).

---

## 1. Scope and honest status

| Layer | Status in this repository |
| --- | --- |
| Domain types, lifecycle graph, and transition rules | **Implemented and tested** (`src/data/publication-types.ts`, `src/data/publication.ts`) |
| Structured canonical identity and alias resolution | **Implemented and tested** (`src/data/canonical-identity.ts`) |
| Eleven-requirement candidate evaluation | **Implemented and tested** (`src/data/publication.ts`) |
| Publication gate order, idempotency replay, and race contract | **Implemented against `PublicationRegistry`** (`src/data/publication.ts`) |
| Persistent database, HTTP API server, and multi-process atomicity | **Not implemented** — specified in `docs/PUBLICATION-API-CONTRACT.md` |
| Automatic extraction from free text into `CandidateProposition` | **Not implemented** — the Explore page remains a local lexical heuristic |

Nothing in this protocol modifies `src/data/records.json`. The ten shipped records remain
illustrative (`demo: true`, `anchored: false`), and no visitor interaction in the browser
can create an official record.

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
3. **Official prediction (`PredictionRecord`)** — a record sealed only after a candidate
   reaches `eligible-for-publication`, passes all eleven evaluation requirements, resolves
   every component of its `PropositionIdentity` without ambiguity, and wins the atomic
   `claimIdentity` operation for its `identityDigest`.

---

## 3. Lifecycle state machine

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

### Invariants enforced by `LIFECYCLE`, `canTransition`, and `advance`

- **Single entry to publication**: `eligible-for-publication` is the only stage whose
  outgoing edges include `officially-published` (`PUBLISHABLE_STAGE`).
- **Mandatory gates on every simple path**: every path from `exploratory-query` to
  `officially-published` passes through `identity-matching`, then `evaluation`, then
  `eligible-for-publication` in that order.
- **Terminal stages have no outgoing edges**: `rejected-candidate`, `resolved`, and
  `annulled` map to `[]`. A rejected candidate cannot be rehabilitated in place; a new
  candidate must be drafted and evaluated from the beginning.
- **No arbitrary stage setter**: `advance(from, to)` throws `TransitionError` if
  `LIFECYCLE[from]` does not contain `to`.

---

## 4. The eleven evaluation requirements

`evaluateCandidate(candidate)` checks every requirement in `EVALUATION_REQUIREMENTS`
independently and returns an `EvaluationVerdict` whose `results` array always contains all
eleven items in canonical order (`verdictIsComplete(verdict) === true`).

Missing data is always recorded as a failure, never filled in with a silent default:

| Requirement ID | What `evaluateCandidate` checks | Why a default is refused |
| --- | --- | --- |
| `unambiguous-question` | `proposedQuestion` is non-empty after trimming and contains no hedging words (`maybe`, `possibly`, `might`, `unclear`, `either`). | A hedged question cannot be resolved Yes or No on a fixed date. |
| `falsifiable-proposition` | `candidate.inferences` contains an entry with `rule === 'falsifiability-review'`. | Falsifiability is an editorial judgment, not a property a regex can prove from prose. |
| `fixed-horizon` | `horizon !== null` with non-empty `startsAt` and `endsAt`. | "Eventually" is not a forecast horizon. |
| `fixed-resolution-date` | `proposedIdentity.resolutionDate` matches `^\d{4}-\d{2}-\d{2}T`. | Without a decision date, a forecast can wait indefinitely to be right. |
| `identified-authority` | `proposedIdentity.decidingAuthority` is not marked `unresolved: true` and its `id` is not `'unknown'`. | Someone must decide the outcome without consulting the forecaster. |
| `objective-criteria` | `resolutionCriteria !== null` with non-empty `rule` and `authority`. | Criteria must be stated before the outcome is known. |
| `probability-in-range` | `probability !== null`, finite, and strictly `0 < probability < 1`. | `null` is not `0.5`, and `0` or `1` denies uncertainty rather than pricing it. |
| `documented-rationale` | `rationale !== null` and non-empty after trimming. | A bare number without reasoning cannot be audited. |
| `recorded-evidence` | `evidence.length > 0`. | An official forecast must cite the inputs available at publication time. |
| `preserved-evidence-provenance` | Every item in `evidence` has non-empty `publisher`, `title`, and `publishedAt`. | Unattributed citations cannot be checked against post-outcome sources. |
| `disclosed-limitations` | `disclosedLimitations.length > 0`. | Every forecast has blind spots; omitting them overstates precision. |

`verdict.eligible` is `true` only when all eleven checks pass. Failed checks that could be
satisfied by supplying missing information are listed in `verdict.clarificationsRequired`
so an operator can distinguish "needs clarification" from "already published".

---

## 5. Publication gate order (`publishCandidate`)

`publishCandidate(candidate, request, deps)` executes six checks in strict order:

1. **Stage check** — if `!isPublishable(candidate.stage)`, returns
   `{ kind: 'wrong-stage', stage: candidate.stage, required: 'eligible-for-publication' }`
   without touching the registry.
2. **Idempotency replay** — looks up `request.idempotencyKey` via
   `registry.findByIdempotencyKey`. If present, returns
   `{ kind: 'replayed', original }` verbatim. A replayed rejection stays a rejection; it
   is never reshaped into a publication.
3. **Existing identity lookup** — computes `digest = await identityDigest(request.identity, deps.aliases)`
   and calls `registry.findByIdentity(digest)`. If found, records the idempotency outcome
   and returns `{ kind: 'existing', predictionId, identityDigest: digest }`.
4. **Identity self-check** — runs `compareIdentities(request.identity, request.identity, deps.aliases)`.
   If any component of the identity is unresolved (`outcome !== 'equivalent'`), records
   the idempotency outcome and returns `{ kind: 'identity-conflict', match }`. Uncertainty
   blocks publication rather than minting a duplicate record.
5. **Evaluation gate** — runs `evaluateCandidate(candidate)`. If `!verdict.eligible`,
   records the idempotency outcome and returns `{ kind: 'rejected', verdict }`.
6. **Atomic identity claim** — generates a candidate `predictionId` and calls
   `registry.claimIdentity(digest, predictionId)`.
   - If the registry returns `{ status: 'claimed' }`, records and returns
     `{ kind: 'created', predictionId, identityDigest: digest }`.
   - If a concurrent caller won the race between steps 3 and 6, the registry returns
     `{ status: 'already-claimed', predictionId: winnerId }`, and `publishCandidate`
     records and returns `{ kind: 'existing', predictionId: winnerId, identityDigest: digest }`.

Steps 1–5 are local and side-effect-free (except for recording idempotency keys on
deterministic rejections). Step 6 is the single point that requires storage-level
atomicity.

---

## 6. Immutability after publication

Once a candidate becomes an official `PredictionRecord` under `payloadScope: 'sealed-payload'`
(`src/data/events.ts`):

- **Probability is sealed at publication**: `sealedPayload(record)` includes `probability`,
  `canonicalQuestion`, `title`, `category`, `publishedAt`, `horizon`, `resolutionCriteria`,
  `evidence`, `demo`, and `sealClaim`. Any post-publication edit to `probability` changes
  `payloadBytes(record)` and invalidates `integrity.digest` and the `e0` publication event.
- **Resolution does not touch the sealed payload**: `sealedPayload(record)` excludes
  `events`, `status`, and `resolution`. Appending a `resolved` or `annulled` event via
  `appendEvent(record, event)` adds an `e1` link to `record.events` while leaving
  `payloadBytes(record)` and `record.probability` byte-for-byte identical.
- **Rejected candidates leave no official trace**: when `publishCandidate` returns
  `wrong-stage`, `identity-conflict`, or `rejected`, `claimIdentity` is never called and
  no entry is created in the identity table.
