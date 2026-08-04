# ADR 0004 — Bid evidence: the CRM's arithmetic verbatim, a new vocabulary, and a fact ledger that is never updated

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Tony Walteur (CTO), Backend lead, Bid management (weights review)
- **Related:** `D:\CRM\apps\agent\agent\lib\evidence.ts` (source of the arithmetic),
  `apps/worker/src/queues/rfp-compliance-fill.ts` (the debt this retires),
  `packages/db/prisma/schema.prisma` (`BidFact`, `BidFactCitation`, `BidFactDecision`),
  ADR 0003 (propose-only governance)

## Context

### The debt: the model currently scores itself

Today's compliance worker asks the LLM for a confidence number and then stores
that number as if it meant something:

```ts
// apps/worker/src/queues/rfp-compliance-fill.ts:95-105 (prompt, abridged)
'Return ONLY a JSON object with: status (YES|NO|PARTIAL|NOT_APPLICABLE), ' +
'justification (concise string, max 1000 chars), confidence (0-10000).'
```

```ts
// apps/worker/src/queues/rfp-compliance-fill.ts:138-146
data: {
  responseStatus: result.verdict.status,
  answerDraft: result.verdict.justification,
  confidenceBps: result.verdict.confidence ?? null,   // the model's own number
  assessmentStatus: 'ASSESSED',
}
```

The prompt also sends nothing but `requirementText` (:104) — no chunk, no page
range, no source. So the stored `confidenceBps` is a language model's opinion
of its own opinion, computed with no access to the document it is claiming to
be confident about. It is worse than no number, because the UI can render it.

### The arithmetic we are porting

`D:\CRM\apps\agent\agent\lib\evidence.ts` prices *observations*, not opinions.
Verified verbatim:

```ts
const CEILING = 0.99;                                              // :93
const CONTRADICTED = 0.45;                                         // :95
export const BAND_FLOOR = { VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 };  // :97

const contradicted = evidence.some((item) => item.kind === "contradiction");  // :109
const hasPrimary   = evidence.some((item) => WEIGHTS[item.kind].primary);     // :110
const combined = evidence.reduce(
  (remaining, item) => remaining * (1 - WEIGHTS[item.kind].weight), 1);       // :112-115
let score = Math.min(CEILING, 1 - combined);                                 // :117
if (contradicted) score = Math.min(score, CONTRADICTED);                     // :118

export function bandFor(score: number, hasPrimary: boolean): FactBand | null {  // :128-133
  if (score >= BAND_FLOOR.VERIFIED && hasPrimary) return FactBand.VERIFIED;
  if (score >= BAND_FLOOR.PROBABLE) return FactBand.PROBABLE;
  if (score >= BAND_FLOOR.POSSIBLE) return FactBand.POSSIBLE;
  return null;
}
```

Empty evidence short-circuits to `score 0, band null, "No evidence."`
(:100-107). The evidence item itself is `{ kind, detail, sourceUrl? }` (:80-84)
— a kind the ledger prices, and a human-readable detail. There is no field on
it for a score.

The CRM's own vocabulary is contact-identity shaped: `profile.email-match`,
`linkedin.employer-and-name`, `crm.thread-reply`, `github.account-identity`,
`employer-only`, … (:3-14, weights :22-78). None of it means anything on a bid.

## Decision 1 — The arithmetic ports verbatim. The constants are not ours to tune.

`apps/worker/src/agent/evidence.ts` reproduces noisy-OR combination, the 0.99
ceiling, the 0.45 contradiction clamp, and the three band floors exactly. Unit
tests pin each constant by value so a future edit has to argue with a failing
test rather than a diff nobody reads.

Two properties are load-bearing and must be understood before touching them:

- **Contradiction holds; it never averages.** 0.45 sits below PROBABLE's 0.55
  floor. A single `contradiction` alongside a 0.95 primary source produces
  `score 0.45 → POSSIBLE`, not a comfortable middle. Disagreement between an
  RFP base document and its amendment must surface as "held", not as a blended
  answer that is wrong in both directions.
- **The ceiling exists so nothing is ever certain.** `min(0.99, …)` means no
  stack of evidence reaches 1.0. That is deliberate epistemics, not a rounding
  guard.

## Decision 2 — A new vocabulary for bids. The weights are guesses.

| Kind | Weight | Primary | What it means (the detail line's subject) |
|---|---|---|---|
| `rfp.stated-in-document` | 0.95 | yes | The RFP itself states the obligation or the fact, at a citable page |
| `library.delivered-project` | 0.85 | yes | A delivered project in our reference library satisfies the requirement |
| `crm.client-correspondence` | 0.85 | yes | Correspondence with this client on file states it |
| `proposal.prior-submission` | 0.80 | yes | We answered this requirement in a prior submitted proposal |
| `compliance.certificate-on-file` | 0.80 | yes | A certificate or attestation on file covers it |
| `web.cited-claim` | 0.40 | no | A cited public source states it |
| `competitor.insight` | 0.35 | no | Competitor/market intelligence implies it |
| `similar-requirement-only` | 0.20 | no | A *similar* requirement was answered — subject or obligation differs |
| `contradiction` | 0.00 | no | Another source disagrees (clamp trigger) |

**These weights are explicit guesses.** Nobody has measured them. They were set
by analogy to the CRM's identity weights and by argument, not by data. They are
in this ADR precisely so that the first person who wants to change one has to
say what data changed their mind.

The only instrument that can re-price them is `BidFactDecision`, which snapshots
`evidenceKinds`, `scoreBps`, and `band` at the moment a human accepted or
dismissed (schema doc comment: *"the evidence weights are explicit guesses
(ADR-0004) and this is the only record that can ever re-price them"*).
Re-calibration is a Round-3 activity with its own ADR; until then no weight
moves.

`similar-requirement-only` is deliberately near-worthless alone — it is the
bid analogue of the CRM's `employer-only` (weight 0.2, `evidence.ts:68-72`,
label *"the employer matches, the name does not"*). It exists so that "we have
answered something that looks like this" can be *reported honestly* and still
score below the storage floor.

### What these weights actually produce (computed, not asserted)

| Evidence | Score | Primary | Band |
|---|---|---|---|
| `rfp.stated-in-document` | 0.9500 | yes | VERIFIED |
| `library.delivered-project` | 0.8500 | yes | VERIFIED (exactly at the floor) |
| `proposal.prior-submission` | 0.8000 | yes | PROBABLE |
| `proposal.prior-submission` + `compliance.certificate-on-file` | 0.9600 | yes | VERIFIED |
| `rfp.stated-in-document` + `library.delivered-project` + `crm.client-correspondence` | 0.9900 | yes | VERIFIED (ceiling) |
| `web.cited-claim` ×3 | 0.7840 | no | PROBABLE |
| `web.cited-claim` + `competitor.insight` | 0.6100 | no | PROBABLE |
| `similar-requirement-only` ×2 | 0.3600 | no | POSSIBLE |
| `similar-requirement-only` | 0.2000 | no | `null` — **not stored** |
| `rfp.stated-in-document` + `contradiction` | 0.4500 | yes | POSSIBLE (clamped) |

Row 2 is the sharpest calibration risk on the table: one reference project
reaches VERIFIED on its own. Under ADR 0003 that still only produces a
`PROPOSED` fact a human must accept, which is the reason we can ship guessed
weights at all.

## Decision 3 — Dismissal dedupe: normalize, then SHA-256

`BidFact.valueHash` (VarChar(64)) is the SHA-256 hex digest of the normalized
claim. Normalization, in this exact order:

1. Unicode NFKC normalize.
2. Lowercase (`toLocaleLowerCase('en')` — locale-fixed, so the same claim
   hashes identically regardless of the server's locale).
3. Strip punctuation and symbols: remove every character in the Unicode
   punctuation and symbol categories (`\p{P}` and `\p{S}`), replacing each with
   a single space rather than deleting it, so `EU/EEA` and `EU EEA` agree and
   `co-operate` does not become `cooperate`.
4. Collapse all whitespace runs (including newlines and non-breaking spaces) to
   a single U+0020, then trim.
5. `sha256(utf8Bytes(normalized))`, lowercase hex.

The hash is computed in code and stored, never computed in SQL. Two facts with
the same `valueHash` for the same `(orgId, subjectType, subjectId)` are the
same claim for dedupe purposes.

The law it enforces, ported from `D:\CRM\apps\agent\agent\lib\facts.ts:96-109`:
**a value a human has already dismissed is never offered again.** The CRM
compares with `sameValue`; we hash because compliance answers are paragraphs,
not job titles, and a paragraph comparison in a `WHERE` clause is an index
nobody will maintain.

## Decision 4 — The `BidFact` lifecycle: `PROPOSED → APPLIED | DISMISSED | SUPERSEDED`, immutable

```
                 human accept
   PROPOSED ─────────────────────► APPLIED ──────────────► SUPERSEDED
      │                                   (a newer accepted fact
      │ human dismiss                      for the same subject)
      └──────────────────────────► DISMISSED   (terminal, permanent)
```

Rules, each of which is a test:

- **A row is never updated to change its claim.** A revised claim is a NEW row;
  the old one is marked `SUPERSEDED` with `supersededById` pointing forward.
  Hence the model carries no `updatedAt` and no `deletedAt` — as the schema
  comment puts it, *"an audit ledger you can soft-delete is not an audit
  ledger"*.
- **The only mutations a row ever sees** are `status`, `supersededById`,
  `decidedByUserId`, `decidedAt`. Claim, verdict, confidence, band, citations
  and `valueHash` are write-once.
- **`DISMISSED` is terminal and permanent.** Nothing transitions out of it, and
  its `valueHash` blocks re-proposal forever.
- **`SUPERSEDED` is reachable only from `APPLIED`**, and only inside the accept
  transaction that creates its replacement (the `decideFact` pattern,
  `D:\CRM\apps\api\src\contacts\contacts.service.ts:458-468`).
- **Refusals never become rows.** Ported verbatim from `facts.ts`: empty claim →
  refuse; `band === null` → refuse, below the floor for keeping; `valueHash`
  matches a `DISMISSED` fact → refuse (:96-109); identical value already
  `APPLIED` → no-op (:111-122); the row was filled by a human and no applied
  agent fact underlies it → refuse, *"a person already filled in … That
  outranks anything found on the web"* (:126-135).
- **A citation exists only if its quote was re-found in the chunk text by
  code.** A quote that cannot be re-verified is a **rejection, not a lower
  score** — there is no weight for "probably said this". `BidFactCitation.sourceChunkId`
  is NOT NULL with a real FK, unlike the nullable `Requirement.sourceChunkId`:
  a requirement with no chunk is `UNAVAILABLE` evidence; a citation with no
  chunk is an invented citation.
- **A requirement with no `sourceChunkId` caps the fact at
  `assessmentStatus: UNAVAILABLE`.** It never renders as a zero score. This is
  the Round-1 unknown-is-not-bad law reused verbatim (`AssessmentStatus`
  enum: `ASSESSED | UNAVAILABLE | PENDING`).

## Decision 5 — The law no tool may break: a tool reports what it OBSERVED

> A tool returns evidence kinds and a human-readable detail. It never returns,
> computes, argues for, or implies a confidence. The ledger prices evidence;
> the tool witnesses it.

Concretely, and enforced in three places:

1. **Type level.** The evidence item is `{ kind, detail, sourceUrl? }` — there
   is no numeric field for a tool to fill (`evidence.ts:80-84`). Adding one
   requires superseding this ADR.
2. **Prompt level.** The `confidence (0-10000)` demand at
   `rfp-compliance-fill.ts:100` is deleted in Phase 1. The model is asked which
   evidence kinds it observed and to quote the text it observed them in.
3. **Write level.** `proposeAnswer` computes `confidenceBps` as
   `round(scoreEvidence(evidence).score * 10000)`. Any caller-supplied
   confidence is ignored, not merged.

Corollaries the skill files state in prose and the tests state in code:

- **One entry per *independent* source.** A single page whose subject and
  obligation both match is ONE observation, not one per sentence.
- **Never add evidence to push a claim over a line.** The bands are not a
  target; they are a readout.
- **The detail line is written for the bid manager's tooltip.** *"DPA §3 names
  AWS eu-west-1"*, not *"match confirmed"*.

## Alternatives considered

1. **Keep the model's own `confidence` and calibrate it.** Rejected — it is not
   a measurement of anything. It varies with prompt phrasing and model version,
   and it is exactly the number a prompt-injected RFP would like to control.
2. **Average contradictions instead of clamping.** Rejected — averaging turns
   "the base document and amendment 2 disagree on the SLA" into a confident
   middle number that is wrong under both documents. The clamp is the whole
   reason the port is worth doing.
3. **Design bid-specific weights from data before shipping.** Rejected — there
   is no data. `bid_fact_decisions` is empty until proposals exist. Guessing
   openly, recording the guess, and instrumenting the correction beats waiting
   for a calibration set that only the shipped feature can produce.
4. **Port the CRM's evidence kinds unchanged.** Rejected — `linkedin.employer-and-name`
   on a compliance requirement is meaningless, and a vocabulary nobody believes
   gets ignored rather than corrected.
5. **Exact-string comparison for dismissal dedupe.** Rejected — compliance
   answers are paragraphs; a trailing space or a smart quote would resurrect a
   dismissed claim. (The trade-off this creates is in Consequences.)
6. **Mutable `BidFact` rows with an `updatedAt`.** Rejected — the ledger is the
   Art. 50 evidence trail. A row whose claim can change is not evidence of what
   was proposed.
7. **A `confidence` field on the evidence item "for tools that really know".**
   Rejected — every tool believes it really knows. That field is the failure
   mode this entire ADR exists to remove.

## Consequences

### Positive

- Confidence becomes a function of observations with a readable derivation,
  auditable after the fact from the `evidenceKinds` snapshot.
- Contradictions are visible as held answers instead of disappearing into an
  average.
- Fabricated citations cannot exist: the quote is re-found in chunk text by
  code before the row is written.
- Weight changes become a data question with an instrument attached, instead of
  a taste argument.

### Negative / accepted costs

- **The weights are wrong.** Not "might be" — a first guess at nine weights is
  wrong somewhere. Round-2 mitigation is entirely structural: everything lands
  `PROPOSED` (ADR 0003), so an early error costs a click. If Round 3 auto-applies
  before calibrating, this ADR's protection is gone.
- **`library.delivered-project` alone reaches VERIFIED at exactly 0.85.** A
  single reference project is currently treated as strongly as an explicit
  statement in the RFP. This is the first weight to interrogate against real
  decision data.
- **Same-kind evidence stacks.** The scorer reduces over the array without
  deduplicating, so three `web.cited-claim` entries reach 0.784 (PROBABLE).
  The "one entry per independent source" law is prose in the skill file, not
  arithmetic. Mitigation, and a deliberate addition to the CRM's behaviour:
  `proposeAnswer` deduplicates the evidence array by `(kind, sourceChunkId)`
  — and by `(kind, sourceUrl)` where no chunk exists — **before** calling
  `scoreEvidence`. The scorer itself stays byte-for-byte the CRM's; the
  deduplication is an input contract, and it is tested separately so the
  distinction survives.
- **Normalized hashing does not catch rewording.** A dismissed answer, reworded
  by the model, produces a different hash and will be offered again. This is a
  known hole in the dedupe, accepted for Round 2: the alternative (embedding
  similarity on dismissals) is a retrieval problem, not a hashing problem, and
  it belongs in Round 3 alongside calibration.
- **Punctuation stripping can merge genuinely different claims.** Replacing
  `\p{P}`/`\p{S}` with spaces means `≥ 99.5%` and `99.5%` normalize alike. For
  dismissal dedupe that is the safer direction (over-suppress rather than
  re-offer a dismissed claim), but it means a numerically different answer can
  be blocked by an earlier dismissal. Reviewers should treat an unexpectedly
  missing proposal as a possible hash collision before treating it as a
  retrieval failure.
- **`assessmentStatus: UNAVAILABLE` will be common at first.** `Requirement.sourceChunkId`
  is nullable, and every requirement extracted before the chunk link existed
  has none. The UI must render UNAVAILABLE as neutral — grey dot, em-dash —
  never as a low score or a red state.

### Test coverage this ADR requires

- Every constant pinned by value: `CEILING` 0.99, contradiction clamp 0.45,
  band floors 0.85 / 0.55 / 0.3.
- `hasPrimary` gate: score ≥ 0.85 with no primary kind must NOT be VERIFIED.
- Contradiction clamp: 0.95 primary + contradiction → 0.45 → POSSIBLE.
- Below-floor evidence returns `band: null` and is refused, not stored.
- Empty evidence returns score 0 / band null / `"No evidence."`.
- Every row of the computed table above, as a table-driven test.
- Hash normalization: casing, NFKC forms, smart quotes, newline runs, and
  non-breaking spaces all collapse to one digest; `EU/EEA` ≡ `EU EEA`.
- Dedupe: a `DISMISSED` hash is never re-offered; a reworded claim IS re-offered
  (pinning the known hole so it is a decision, not a surprise).
- Lifecycle: no path out of `DISMISSED`; `SUPERSEDED` only from `APPLIED`;
  claim/verdict/band/`valueHash` never change on an existing row.
- Citation: an unverifiable quote is rejected and no `BidFactCitation` row
  exists — the fact is not merely scored lower.

## Follow-ups (Round 3)

- Re-price the nine weights from `bid_fact_decisions`, per tenant where the
  sample supports it. Own ADR; this one is superseded on the weights table only.
- Semantic dismissal dedupe to close the rewording hole.
- Revisit `library.delivered-project` at 0.85 first.
