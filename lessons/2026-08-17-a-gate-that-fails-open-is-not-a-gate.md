---
title: A stage gate that fails open on missing data is not a gate — every skip path is a bypass
date: 2026-08-17
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, security, governance, state-machine]
---

## Lesson — enumerate every path that SKIPS an enforcement check, and treat each as an exploit

**Rule (ALWAYS):** When you ship an enforcement rule, write down every branch that causes the
check to be skipped, and ask of each: "can a caller reach this branch on purpose?" A skip that
a caller controls is a bypass, not a graceful degradation. Fail-open is a legitimate choice
only for branches the caller cannot steer into.

**What happened:** The Amaris stage gate (`STAGE_GATE_MODE=enforce`) was supposed to stop an
opportunity carrying a recorded No-Go from advancing. An adversarial read of
`apps/api/src/routes/opportunities.transitions.ts` and
`packages/shared/src/stage-transitions/index.ts` found **five** ways past it, all reachable
from an ordinary API call:

1. **No pipeline row → no gate.** The whole block was guarded on `toStage` being non-null, but
   a body of `{ stage: 's4_negotiation' }` with no matching `PipelineStage` row was still
   accepted and written. On an org with no default pipeline — which is every org that never
   configured one, including the local seed — the gate never ran at all.
2. **Close then reopen.** `isLegalStageTransition` returns true when the destination is
   terminal, and `isForwardMove` returned false when the *source* was terminal. So "close to
   lost" was legal-and-not-forward, and "reopen straight to negotiation" was
   legal-and-not-forward. Two allowed requests moved a killed bid to the end of the funnel.
3. **Any BidScore cleared a No-Go.** `resolveStandingDecision` mapped "recommendation is not
   `no_bid`" to *positive*, so a row with any unrecognized recommendation string became the
   newest positive signal.
4. **A mismatched gate/outcome pair erased the decision.** The API accepted any
   gate × outcome combination, but only `go/no_go/bid/no_bid` map to a signal. Recording
   `{ gate: 'go_no_go', outcome: 'approved' }` produced *no* signal — and because the gate
   query reads only the **latest** `go_no_go | bid_no_bid` row, that unreadable row **hid** the
   earlier No-Go instead of being ignored.
5. **The tenant guard turned the gate into a 500.** The stage-node `findMany` had no `orgId`,
   and `findMany` is a guarded action, so `BIDSTACK_TENANT_SCOPE_GUARD=enforce` (required in
   production) would throw before the query ran — every gated move 500s in prod, and the
   obvious "fix" is to disable the gate.

**Root cause:** each skip was individually defensible — "don't wedge the pipeline on missing
config", "reopening isn't advancement", "be permissive about recommendation strings". None was
evaluated as *an input a caller chooses*. Fail-open was applied uniformly instead of only where
the caller has no influence over the missing data.

**How to apply:**
- List the skip branches explicitly in the code comment above the check, with why each is safe.
- Supply a **fallback graph** rather than skipping: `canonicalStageNodes()` now backs the gate
  when the pipeline can't answer, so "unconfigured" degrades to the product's own stage order
  rather than to no enforcement.
- Validate the **cross-product** of any two independently-enumerated fields that a resolver
  reads. An unreadable-but-stored value is worse than a rejected one, because a "latest row
  wins" query lets it shadow a real decision.
- Write the regression as an integration test that performs the *sequence* — the close-then-
  reopen bypass is invisible to any test that checks one transition at a time. See
  `apps/api/src/routes/bid-governance.integration.test.ts`.
- Never write a tenant-scoped Prisma query without `orgId`, even when an org-scoped `findFirst`
  ran two lines above: the guard is what catches the next edit, not this one.
