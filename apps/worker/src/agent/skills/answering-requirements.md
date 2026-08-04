---
description: How to answer an RFP requirement from sources we actually hold, when a similar answer is a different answer, and when to declare a GAP.
---

# Answering requirements

You are given a requirement extracted from a tender document. You need an answer
that a bid manager can accept without re-reading the source. Getting this wrong
puts a claim we cannot substantiate inside a submitted response, so the
procedure is built to fail closed.

## Why the obvious approach does not work

The requirement says *"The supplier shall process all personal data within the
EU/EEA."* Our library contains a reference project with the sentence *"all data
is hosted in our UK data centre."* A keyword search scores that as an excellent
match. It is not an answer — it is a **different obligation about a different
territory**, and post-Brexit it is arguably the opposite answer.

Asking a model whether we comply produces "Yes — we operate EU-region hosting",
which happens to be true for three of our accounts and would have been just as
confident had it been true for none. You cannot tell the difference afterwards.
That is why guessing the answer is banned outright.

What works is decomposition: the requirement decomposes into a **subject**
(personal data we process for this client) and an **obligation** (stays inside
EU/EEA). Retrieve on both, then read what comes back and decide whether it
states that obligation about that subject.

That is the shape of every answer: **guess where to look, never what you will
find.**

## The procedure

0. **Read the requirement's own chunk first.** `retrieveRequirementContext`
   returns the source chunk and its neighbours. The clause above and the clause
   below routinely define the scope, the exception, or the deadline that changes
   the answer. If the requirement has no source chunk, stop: the fact is
   `UNAVAILABLE`, which is a neutral state, not a zero score, and not a reason
   to answer from general knowledge.
1. **Decompose into subject and obligation.** Write them down before you
   retrieve. If you cannot state the obligation in one sentence, the requirement
   is compound — answer the part you can evidence and flag the rest.
2. **Retrieve against both.** Reference library, prior submissions, certificates
   on file, client correspondence. Same opportunity only.
3. **Read each candidate against both tests.**
   - Does it concern the same **subject**?
   - Does it state the same **obligation**, at the same strength?
   "Available 24/7" does not satisfy "99.95% availability measured monthly with
   service credits". A commitment without its measurement is a different
   commitment.
4. **Both, or it is a different requirement.** One of the two is not a weaker
   match. It is a different claim that happens to share vocabulary, and
   `similar-requirement-only` exists precisely so you can report it honestly and
   still score below the storage floor.
5. **Quote what you cite.** `citeSource` re-finds your quote in the chunk text in
   code before a citation may exist. A quote that cannot be re-found is
   **rejected, not scored lower** — there is no weight for "probably said this".
   Paraphrase in the answer draft if you like; the citation quote is verbatim.

## Strength, not just topic

Requirements carry a modal verb and it is load-bearing. `shall` and `must` are
mandatory; `should` and `may` are not. A mandatory requirement we cannot
evidence is a bid risk that someone must decide about. An optional one we cannot
evidence is usually a scoring opportunity, not a problem. Read it before you
choose a verdict.

## Reporting the answer

| What you have | Verdict | Evidence to record |
| --- | --- | --- |
| A source states the obligation about the subject | `YES` | The primary kind you actually read |
| A source states part of it, or a weaker form | `PARTIAL` | The primary kind, plus the honest supporting kinds |
| Sources disagree | keep the verdict, add `contradiction` | Held at POSSIBLE. Nobody is shown a guess. |
| The requirement does not apply to this engagement | `NOT_APPLICABLE` | Whatever establishes the scope — usually `rfp.stated-in-document` |
| Nothing we hold satisfies a **mandatory** requirement | `GAP` | Everything you did find, including `similar-requirement-only` |

## When to declare a GAP

`GAP` is not a failure to answer. It is an answer: *we searched, and nothing on
file satisfies this.* Declare it when the requirement is mandatory and no source
states the obligation about the subject.

`flagComplianceGap` opens a `ReviewIssue` at high severity, and high-severity
issues block the approval gate. That is the point. An unanswered mandatory row
that a human can fill in ten minutes beats a plausible answer nobody knows to
check — the first costs an afternoon, the second loses the bid at clarification
stage or, worse, wins it and becomes a contractual commitment we cannot meet.

Do not soften a GAP into a `PARTIAL` because a partial looks better on the
matrix. The matrix is read by the person who has to decide whether we bid.

## Things that look like evidence and are not

- **A keyword hit.** Retrieval says where to look. A query for "data residency"
  returns the clause that requires it, the annex that exempts it, and a
  marketing page — all ranked closely, all about "data residency".
- **A reference on the same technology.** We have run Kubernetes for eleven
  clients. That does not mean we ran it under this SLA, in this region, with
  this accreditation.
- **Plausible boilerplate.** "We maintain a comprehensive information security
  management system" is a sentence, not a certificate. If it is not attested
  somewhere, it is not `compliance.certificate-on-file`.
- **A prior draft.** A proposal we wrote and never submitted was never checked
  by anyone. `proposal.prior-submission` means submitted.
- **An expired certificate.** It attested something once. It does not attest it
  now, and a buyer will check the date before we do.
- **Our own previous agent proposal.** A `PROPOSED` fact nobody accepted is your
  earlier guess. Citing it launders it into evidence.

## When the requirement genuinely cannot be answered here

Some requirements need a price, a named individual, a signature, or a commercial
decision. Say so plainly and move on. A row marked GAP with a clear detail line
is a row a bid manager resolves in a meeting. A row filled with something
confident and unfounded is one that reaches the buyer.
