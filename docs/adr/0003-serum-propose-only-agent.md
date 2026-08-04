# ADR 0003 — The bid agent registers with SERUM as a propose-only agent; nothing it produces reaches a record without a human

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Tony Walteur (CTO), Architect, Backend lead
- **Related:** `packages/db/src/serum-runtime-policy.ts`, `apps/api/src/routes/serum.ts`,
  `apps/api/src/routes/rfp-pipeline.ts`, `apps/worker/src/queues/crew-run.ts`,
  `docs/ROUND2-ULTRAPLAN.md` (Verdict, "Governance path"), ADR 0004 (evidence vocabulary)
- **Blocks:** Round-2 Track B. No Track B code lands before this ADR has a written review sign-off.

## Context

### BidStack already has an AI governance plane. It is not small.

SERUM is per-org, per-environment, versioned, approval-gated AI policy:
4,303 lines across `packages/db/src/serum-runtime-policy.ts` (1,577),
`apps/api/src/routes/serum.ts` (2,260), and `packages/shared/src/schemas/serum.ts`
(466) — plus the control-plane UI, three migrations, and a policy test file.
It already fronts crews (`apps/worker/src/queues/crew-run.ts:161`), retrieval
(`apps/worker/src/queues/rfp-embed-requirement.ts:59`,
`rfp-embed-reference.ts:58`, `apps/mcp-server/src/lib/reference-search.ts:73`),
connectors, the Dust/MCP gateway, the prompt library, and eval quality gates.

A Round-2 bid agent that invented its own gate would be a second, weaker
governance plane owned by nobody — and it would be the one an auditor found.

### What SERUM actually denies — read, not assumed

`checkSerumAgentRuntimePolicy` (`packages/db/src/serum-runtime-policy.ts:743-819`)
is an ordered chain of denials. Verbatim, the two clauses this ADR turns on:

```ts
// packages/db/src/serum-runtime-policy.ts:781-787
if (!agent.humanApprovalRequired || !args.approvalConfirmed) {
  return runtimeDecision({
    ...base,
    allowed: false,
    status: 'denied',
    reason: 'Human approval confirmation is required before an agent run can start.',
  });
}
// :789-796
if (/unrestricted|write|autonomous/i.test(agent.autonomy)) {
  return runtimeDecision({
    ...base,
    allowed: false,
    status: 'denied',
    reason: 'Autonomous or write-capable agent modes are blocked by runtime policy.',
  });
}
```

The rest of the chain: no published config → `not_configured` (:765-772);
published but disabled → `disabled` (:773-780); agent not in
`allowedAgentIds` → denied (:797-803); concurrency exhausted → denied
(:805-811); otherwise allowed (:813-818).

**Correction to the ultraplan's phrasing.** The plan (and this repo's own
prose) says SERUM "hard-denies write-capable/autonomous agent modes". What the
code does is narrower and worth stating precisely, because the whole of this
ADR rests on it:

- `autonomy` is a **free-form string**, not an enum —
  `packages/shared/src/schemas/serum.ts:230` is `autonomy: z.string()`, read
  with `stringConfig(config, 'autonomy', 'disabled')`
  (`serum-runtime-policy.ts:351`), edited as a plain text field in the control
  plane (`apps/web/src/components/settings/SerumControlPlaneSection.tsx:1556-1566`).
- The check is therefore a **denylist regex over a name**, not an allowlist of
  vetted modes. It denies modes *whose label contains* `unrestricted`, `write`,
  or `autonomous`. It does not, and cannot, deny a mode called `full-access`.

So the guarantee SERUM gives us today is: *you cannot name yourself
write-capable and run.* That is a real, useful, fail-safe-in-our-direction
guarantee — a run registered as `propose-only` is legal, and any attempt to
relabel it toward autonomy trips the regex. It is not the same as "the platform
prevents writes". Actual write prevention has to come from the agent's own
write path, which is what Decision 2 and Decision 3 below exist to supply.

### Two more verified facts that shape the decision

1. **`approvalConfirmed` is caller-supplied, not derived from config.** Every
   existing call site takes it from the request or the job payload:
   `apps/api/src/routes/crews.ts:133,137` (`z.boolean().default(false)`) →
   `crews.ts:559,579,691` → `apps/worker/src/queues/crew-run.ts:32`
   (`z.boolean().default(false)`) → `:154,:166`. Nothing in the codebase
   derives `approvalConfirmed` from a published SERUM config version. The
   ultraplan's preferred mechanism ("the org's versioned published config
   constitutes the standing run-approval") **does not exist today** and would
   be new derivation logic inside the policy layer.
2. **`humanApprovalRequired` defaults to `true`** when unset in the config JSON
   (`serum-runtime-policy.ts:355`, `boolConfig(config, 'humanApprovalRequired', true)`).
   The safe default is already the strict one.

### The write path the agent would otherwise take

Today's compliance-fill worker writes AI output straight onto a
production-visible row:

```ts
// apps/worker/src/queues/rfp-compliance-fill.ts:138-146
await prisma.complianceMatrixRow.update({
  where: { id: matrixItemId },
  data: {
    responseStatus: result.verdict.status,
    answerDraft: result.verdict.justification,
    confidenceBps: result.verdict.confidence ?? null,
    assessmentStatus: 'ASSESSED',
  },
});
```

It is gated — the autofill route refuses unless the orchestration is
`approved` (`apps/api/src/routes/rfp-pipeline.ts:295-302`) — but that gate is
per-pipeline, not per-claim. Once the pipeline is approved, every subsequent
answer the model produces lands on the record unread.

## Decision 1 — Register with SERUM; do not fork it

The Round-2 bid agent registers as a SERUM agent with:

| Field | Value | Why |
|---|---|---|
| `agentId` / `producedByAgentKey` | `rfp-compliance-proposer` | Must appear in the org's `allowedAgentIds` or `:797-803` denies the run |
| `autonomy` | `propose-only` | Contains none of `unrestricted` / `write` / `autonomous`, so `:789` passes; the string is also honest, which is the point |
| `humanApprovalRequired` | `true` | The default (`:355`); we never publish a config that turns it off |
| `maxConcurrentRuns` | org-configured, `> 0` | `:805-811` |

Every proposing run calls `checkSerumAgentRuntimePolicy` **before** it reads
anything, and a denial is a clean return with the decision `reason` logged —
the same shape `crew-run.ts:156-171` already uses. `not_configured` is a
denial, not a bypass: an org that has never published a SERUM Agents policy
gets no bid agent.

The registered `autonomy` string is `propose-only` exactly. Reviewers should
reject any config version that decorates it ("propose-only, drafts answers")
— not because the regex would fail open, but because it would fail *closed*
on the word "drafts"' neighbours and produce a confusing denial.

## Decision 2 — `approvalConfirmed` comes from a human action, this round

Because `approvalConfirmed` has no derivation from published config
(Context fact 1), Round 2 takes the ultraplan's **named fallback as the
primary path**, not as a fallback:

- The proposing run is triggered by the existing human-gated entry points. The
  autofill route already requires `orchestration.state === 'approved'`
  (`rfp-pipeline.ts:295-302`) — a human clicked approve, and
  `rfp-pipeline.ts:429-490` recorded who and when. That approval is the human
  action; the enqueuing route passes `approvalConfirmed: true` into the job
  payload the same way `crews.ts:691` does.
- A run with no such human trigger passes `approvalConfirmed: false` and is
  denied at `:781`. This is not a degraded mode — it is the correct answer for
  an unattended run this round.

Deriving standing approval from a published config version is **not built in
Round 2**. It is a change to `checkSerumAgentRuntimePolicy` itself, which
fronts crews, connectors, and the gateway; that blast radius does not ride
inside a feature round. Round 3 may propose it in its own ADR.

## Decision 3 — Every agent output lands `PROPOSED`, including VERIFIED-band facts

The agent's only write path is `proposeAnswer`, which inserts
`BidFact { status: PROPOSED }` plus its citations. It never writes
`ComplianceMatrixRow.answerDraft`, `responseStatus`, `confidenceBps`, or
`assessmentStatus`.

This is a **deliberate divergence from the source law we are porting**. The
CRM applies a VERIFIED fact directly:

```ts
// D:\CRM\apps\agent\agent\lib\facts.ts:137
const applies = scored.band === FactBand.VERIFIED;
// :159 — status: applies ? FactStatus.APPLIED : FactStatus.PROPOSED
```

We do not. Reasons, in order of weight:

1. **The weights are guesses.** ADR 0004 records the bid evidence weights as
   explicit, uncalibrated starting values. Auto-applying on a band computed
   from guessed weights is auto-applying on a guess. A single
   `library.delivered-project` at weight 0.85 scores exactly 0.85 and is
   primary — one reference project would silently become a compliance answer.
2. **The blast radius is not a CRM field.** The CRM auto-applies a job title
   onto a contact. We would be auto-applying a compliance answer into a
   document that goes to a public buyer under a signature. Wrong job title
   costs an email; wrong compliance answer costs a bid, and in a regulated
   procurement can cost more than the bid.
3. **It keeps the SERUM registration honest.** An agent registered
   `propose-only` that writes records when confident is registered
   dishonestly, regex or no regex.
4. **It is the only way to get calibration data.** Every accept and dismiss
   writes a `BidFactDecision` row with its `evidenceKinds` snapshot. Auto-apply
   removes exactly the decisions we need to re-price the weights with.

**Auto-apply of VERIFIED facts is a Round 3 decision**, taken only after
`bid_fact_decisions` holds real per-tenant accept/dismiss data, and only in its
own ADR. It is explicitly out of scope for Round 2 and must not be introduced
by a flag, a config field, or an "obviously safe" special case.

## Decision 4 — Promotion happens through exactly two doors, both human

1. **Per-row:** `PATCH /api/bid-facts/:id/decide` with a Clerk user. Contract
   cloned from the CRM's `decideFact`
   (`D:\CRM\apps\api\src\contacts\contacts.service.ts:432-495`): 404 when
   absent (:447-449); **409 "already settled" unless status is `PROPOSED`**
   (:451-453); inside one transaction — supersede the prior APPLIED fact for
   the same subject (:458-468), set `APPLIED`/`DISMISSED` with
   `decidedByUserId` + `decidedAt` (:470-477), and only then write the target
   columns (:479-484).
2. **Pipeline-level:** the existing TOCTOU-safe approval transaction,
   `apps/api/src/routes/rfp-pipeline.ts:429-490`, unchanged. Verified in full:
   - atomic guard — `tx.proposal.updateMany({ where: { id, orgId, approvedAt: null } })`
     and `if (approved.count !== 1) throw conflict('Proposal has already been approved')`
     (:433-443), so a concurrent double-approval loses the race without a row lock;
   - conditional raw state advance asserting exactly one row moved, else roll
     the whole approval back (:449-460);
   - **in-transaction blocker recount** — `tx.reviewIssue.count({ where: blockerWhere })`
     at :465, throwing at :466-471, catching a worker that inserts a
     high/critical finding between the fast-fail (:419) and the commit;
   - `tx.auditLog.create` inside the transaction (:473-489).

**Correction to the ultraplan.** The plan says the decide endpoint should
"fire `logAiInvocation` inside the same transaction". The code it cites does
the opposite, on purpose:

```ts
// apps/api/src/routes/rfp-pipeline.ts:492-505
// EU AI Act Art. 50 — log human-in-the-loop decision.
// WHY fire-and-forget: audit failure must never block the approval;
// the auditLog row above is the primary paper trail.
void logAiInvocation({ ... });
```

The decide endpoint follows the code, not the plan: the `AuditLog` row and the
`BidFactDecision` calibration row go **inside** the transaction; the Art. 50
`logAiInvocation` call is fired **after commit, fire-and-forget**, mirroring
:495-505. An audit sink outage must never be able to block a human decision.

## Decision 5 — Org-scoping is a law, not a convention

Every agent read and every agent write carries `orgId` in its where-clause.
Three layers, all already present:

1. `BidFact`, `BidFactCitation`, and `BidFactDecision` all pin `orgId` NOT NULL
   with a real FK to `Org` and `onDelete: Cascade` (`packages/db/prisma/schema.prisma`,
   `model BidFact` / `BidFactCitation` / `BidFactDecision`).
2. The tenant-scope guard is mandatory in production —
   `apps/worker/src/lib/production-env.ts:88-95` fails boot unless
   `BIDSTACK_TENANT_SCOPE_GUARD` is `warn` or `enforce`, with the comment
   naming the exposure: *"a missing/'off' value here leaves worker queries just
   as exposed to an all-tenants leak as the API"*. An undefined `orgId` counts
   as unscoped.
3. The worker keeps the loaded-row org-verify plus `doNotRetry`, verbatim from
   `apps/worker/src/queues/rfp-compliance-fill.ts:81-87` — an org mismatch is a
   permanent failure, never a retry.

Round-2 retrieval is **same-opportunity only**. Any future cross-opportunity
retrieval must additionally apply the caller's country access scope
(`apps/api/src/lib/access-scope.ts` — `getAccessScope`,
`applyOpportunityScope`, `countryVariantsForScope`) keyed on the human who
started the run. That is a Round-3 obligation, recorded here so it is not
rediscovered as a bug.

NDA Tier-D documents never reach the proposer: `isDocumentAiSafe`
(`apps/worker/src/queues/rfp-requirement-extract.helpers.ts:256`, already used
at `rfp-requirement-extract.processor.ts:60` and `rfp-legal-scan.ts:285`) gates
everything upstream of it.

## Decision 6 — What this satisfies under the EU AI Act

Article 50's transparency and human-oversight obligations are met structurally,
not by policy document:

- A named human takes every consequential decision (Decision 4) and is recorded
  on the fact itself (`decidedByUserId`, `decidedAt`) and in `AuditLog`.
- The decision is logged to the Art. 50 trail via `logAiInvocation`, the same
  sink the approval gate uses (`rfp-pipeline.ts:495-505`).
- The reasoning is inspectable *before* the decision, not reconstructed after:
  `BidFact.rationale` plus `BidFactCitation` rows carrying the re-verified
  quote and page range (ADR 0004).
- The agent's authority is bounded by a versioned, per-org, per-environment
  published policy an auditor can read (SERUM), with the run-time denial
  reasons in the logs.

## Alternatives considered

1. **Fork a lightweight gate for the bid agent** ("SERUM is heavy; a feature
   flag is enough"). Rejected. Two governance planes means the one that gets
   audited is not the one that is enforced, and the flag would be the only
   thing between a prompt-injected RFP and a production compliance answer.
2. **Register with `autonomy: 'assisted'` or `'supervised'`.** Rejected — both
   pass the regex just as well and describe *less* than the truth.
   `propose-only` names the actual capability, which is the only property that
   makes the registration reviewable.
3. **Derive `approvalConfirmed` from the published config version now.**
   Rejected for Round 2 (Decision 2). It changes a function that fronts crews,
   connectors, the gateway, retrieval, prompts, and evals — a governance-layer
   edit shipping inside a feature round is exactly the change nobody reviews
   properly.
4. **Auto-apply VERIFIED facts, matching the CRM.** Rejected (Decision 3). It
   also destroys the calibration data that would justify it later, which makes
   it self-sealing.
5. **Let the agent write `answerDraft` directly but mark the row
   `assessmentStatus: PENDING` for review.** Rejected — a value on the record
   is on the record. The RFP export path reads `answerDraft`; a status column
   nobody joins on is not a gate.
6. **Skip the SERUM call in dev/staging for speed.** Rejected — the denied path
   is the path most likely to be wrong, so it is the one that must run in the
   environments where it can be observed. Integration tests cover the denied
   branch explicitly.

## Consequences

### Positive

- The agent inherits an audited, versioned, per-org, per-environment policy
  plane and a control-plane UI for free. Zero new governance surface.
- The failure mode of a wrong proposal is a click, not a corrupted record. That
  is what makes shipping an uncalibrated scorer (ADR 0004) defensible at all.
- Prompt injection through third-party RFP text has no write to reach: the only
  write is a `PROPOSED` ledger row, quotes are re-verified in code before a
  citation may exist, and the model never sets its own confidence.
- Every decision generates calibration data by construction.

### Negative / accepted costs

- **A human must click for every answer.** On a 300-row compliance matrix this
  is real work that the CRM's auto-apply would have avoided. We are paying it
  deliberately for one round, and Round 3 revisits it with data.
- **`propose-only` is enforced by our own code, not by SERUM.** SERUM stops us
  *declaring* write capability; it does not intercept a Prisma call. If a
  future edit to the worker writes `answerDraft`, no policy layer catches it.
  Mitigation: the only write helper is `proposeAnswer`, and the Phase-1
  integration tests assert that a proposing run leaves `answerDraft`,
  `responseStatus`, and `assessmentStatus` untouched. That test is the real
  enforcement and must not be weakened without a superseding ADR.
- **The autonomy denylist can fail open on an unknown mode name.** `full-access`
  passes `:789`. Round-3 obligation: convert `autonomy` from `z.string()` to a
  closed enum (`disabled | propose-only | assisted`) with the runtime check as
  an **allowlist**, and add the policy test that currently does not exist —
  `packages/db/src/serum-runtime-policy.test.ts` contains **zero** occurrences
  of `autonomy` today.
- **Gap-flagging only blocks the approval gate if the ReviewIssue carries the
  right `proposalId`.** The blocker predicate is
  `{ orgId, proposalId, severity: in ['high','critical'], status: in ['open','acknowledged','in_progress'], deletedAt: null }`
  (`rfp-pipeline.ts:410-416`). A high-severity issue written with a null
  `proposalId` is invisible to the gate. `flagComplianceGap` must resolve and
  set `proposalId`, and the Phase-1 integration test must assert that the
  approve route actually 409s afterwards — asserting only that the issue row
  exists would be a test that passes while the gate is open.
- **An org with no published SERUM Agents policy gets no bid agent, silently
  from the user's point of view.** The denial reason is logged, but there is no
  UI for it this round. Operators enabling the feature must publish the policy
  first; onboarding docs need the step.

### Test coverage this ADR requires (Phase 1, Track B)

- Denied path: unconfigured org, disabled policy, `approvalConfirmed: false`,
  agent absent from `allowedAgentIds`, concurrency exhausted — each returns
  cleanly with the policy's own `reason` and writes no `BidFact`.
- Allowed path with `autonomy: 'propose-only'` proceeds.
- A run registered with any autonomy string matching `/unrestricted|write|autonomous/i`
  is denied (pins :789 against a future "helpful" relabel).
- A completed proposing run leaves `ComplianceMatrixRow.answerDraft`,
  `responseStatus`, `confidenceBps`, and `assessmentStatus` byte-identical.
- Decide endpoint: 404, 409-on-settled, supersede-on-accept, permanent dismiss,
  `BidFactDecision` written inside the transaction, `logAiInvocation` after it.
- Org mismatch throws with `doNotRetry` set.

## Follow-ups (Round 3, each needs its own ADR)

- Auto-apply of VERIFIED facts, decided from `bid_fact_decisions` data.
- `autonomy` as a closed enum with an allowlist check, plus the missing policy
  tests.
- Standing run-approval derived from the published config version.
- Country access scope on cross-opportunity retrieval.
