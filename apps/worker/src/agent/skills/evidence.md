---
description: Use when proposing an answer to a requirement — picking the right evidence kind for what you actually saw, and understanding why a claim was proposed, held or refused.
---

# Evidence

You never set a confidence. You report what you observed, and the ledger prices
it. Getting the `kind` right is therefore the whole job — it is the difference
between a proposal a bid manager accepts with one click and a wrong answer that
ships inside a submitted response.

There is no field on an observation for a number. That is not an oversight and
it is not a formality you can work around by hedging in the `detail` line. The
arithmetic in `evidence.ts` reads the `kind` and nothing else.

## The kinds, and what each one means

**Primary — these can carry a claim on their own.** All of them are a source
that states *this obligation about this subject*, not merely a source that is
consistent with it.

| Kind | Use it when |
| --- | --- |
| `rfp.stated-in-document` | The RFP, its annexes or an amendment states the obligation or the fact, at a page you can cite. Decisive: the buyer's own words. |
| `library.delivered-project` | A delivered project in our reference library satisfies the requirement — the same scope, for a comparable buyer. Not "we do that kind of work". |
| `crm.client-correspondence` | Correspondence with *this* client on file states it. Their own words, or ours to them, on the record. |
| `proposal.prior-submission` | We answered this requirement in a proposal we actually submitted. A draft nobody sent is not a prior submission. |
| `compliance.certificate-on-file` | A certificate or attestation on file covers it — ISO, SOC 2, an insurance schedule, a signed DPA. Check it has not expired before you record it. |

**Supporting — true, but not enough alone.**

| Kind | Use it when |
| --- | --- |
| `web.cited-claim` | A public page states it and you have the URL. |
| `competitor.insight` | Competitor or market intelligence implies it. Implies. |
| `similar-requirement-only` | A *similar* requirement was answered, but the subject or the obligation differs. Nearly worthless on its own, and deliberately so — this is how a UK data-residency answer gets filed against an EU clause. |

**`contradiction` — when two sources disagree.**

Record it. It does not lower the score a little; it holds the claim entirely,
which is correct. The base document requiring EU-only processing and amendment 2
permitting US support is not 70% true. It is unresolved, and it needs a human
who can ring the buyer, not a blended number that is wrong under both documents.

## What good evidence looks like

**One entry per *independent* source.** Two sentences on the same page are one
observation, not two: a DPA whose subject and obligation both match is one
`compliance.certificate-on-file`, not a subject match plus an obligation match.
Splitting it double-counts a single page into false certainty, which is exactly
the arithmetic this system exists to avoid. (`proposeAnswer` deduplicates by
source before scoring, so splitting does not even work — it just makes your
observation list a worse record of what you read.)

`detail` is read by a bid manager in a tooltip, next to a decision they are
about to make. Write it for them:

- Good: `DPA §3 names AWS eu-west-1 as the sole processing region`
- Good: `Ref. library: Ministère de la Culture 2024, same 24/7 L2 scope`
- Bad: `match confirmed`
- Bad: `requirement appears to be satisfied`

If you cannot write a specific detail line, you did not observe anything —
you inferred. Do not record an inference as an observation.

## What happens next, so you can stop guessing about it

- Score ≥ 0.85 **and** at least one primary source → **VERIFIED**.
- Score ≥ 0.55 → **PROBABLE**. Score ≥ 0.3 → **POSSIBLE**.
- Below 0.3 → no band, and the proposal is **refused, not stored**.
- Any `contradiction` → clamped to 0.45 → **held at POSSIBLE**, whatever else
  you found.

Every one of those outcomes lands as `PROPOSED`. Nothing you produce writes
itself into a response document; a human accepts it. That is why we can ship
weights that are honest guesses.

A POSSIBLE proposal is a good outcome. It is often the *correct* outcome: the
bid manager knows in three seconds whether our Rotterdam project counts, and the
old rule — discard anything short of certain — meant we paid for that retrieval
every run and learned nothing from it.

**Never add evidence to push a claim over a line.** The bands are a readout, not
a target. A second `web.cited-claim` you went looking for after seeing the score
is not evidence, it is a thumb on the scale, and it is how a wrong answer gets
dressed up as a right one.
