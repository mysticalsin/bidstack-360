# Solution: structural no-hallucination + coupling approval gates to orchestration state

Two reusable patterns extracted while hardening the RFP pipeline (relay-baton, 2026-06-04).

## 1. Cite-or-omit: make "no hallucination" a code invariant, not a prompt

**Problem:** asking an LLM to "only use real sources" is unreliable. Models invent
URLs and pricing.

**Pattern — enforce grounding in three layers, none of which is the prompt:**

1. **Fetch first, then constrain.** Retrieve the documents yourself
   (`fetchGroundedDocuments`, SSRF-guarded). The set of fetched URLs is the *only*
   allow-list the model may cite from.
2. **Drop anything uncited.** `enforceCitations(findings, fetchedUrls)` splits model
   findings into `kept` (sourceUrl ∈ fetched set, compared via `normalizeUrl`) and
   `dropped` (invented). Parsing fails *closed* — a non-JSON or schema-violating
   answer yields zero findings, never a surfaced guess.
3. **Make the DB refuse uncited rows.** `CompetitorInsight.sourceUrl` is `NOT NULL`.
   An uncited insight cannot be persisted even if layers 1–2 had a bug.

Structured connectors (e.g. USASpending award amounts) bypass the LLM entirely —
they are cited by construction from API rows, and return `[]` (never a fabricated
number) on API error.

Code: `packages/shared/src/competitor-intel/index.ts`. Tests assert that an invented
URL is dropped and that bad JSON surfaces nothing.

## 2. A human gate must move the orchestration, not just stamp the artifact

**Problem:** the proposal approval route set `proposal.approvedAt` but never touched
the linked `RfpOrchestration`. Result: the orchestration stayed in
`awaiting_approval` forever, and the downstream autofill step — which *requires*
`state='approved'` — was unreachable. A bid could also be approved with open
high/critical review issues.

**Pattern — the gate owns the state transition, atomically:**

- Look up the linked orchestration; require it at the *correct* gate
  (`state='awaiting_approval'` AND `qa_review ∈ completedPhases` distinguishes the
  final proposal gate from the earlier drafting gate, since both reuse the state).
- Block on unresolved blockers (high/critical `ReviewIssue`, status not
  resolved/waived) — a waiver is an explicit, audited human decision.
- In one `$transaction`: guard the approve with `updateMany({ where:{ approvedAt:null }})`
  (atomic double-approval guard via `count===1`), then a conditional
  `UPDATE ... WHERE state='awaiting_approval'` asserting exactly one row moved, or
  roll the whole thing back.

Code: `apps/api/src/routes/rfp-pipeline.ts` route 4.

## Cross-links

- The blocker check (pattern 2) is *fed* by first-class `ReviewIssue` rows that the
  review crew now writes (`rfp-legal-scan.ts`) instead of opaque markdown — see
  RFP-REVIEW-001 in `handoff/relay-baton/issues/ISSUE_REGISTER.md`.
- Design: `docs/competitor-intel.md`.
