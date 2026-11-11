# State machines — inventory (origin/main)

Base: `0ba51f57f2889be9c8147508e0e65e17f7251187` (`origin/main`).
Re-verified on that tree. Line numbers from `cursor/polo-integrated-bca5` are not used.
This file is the inventory. It does not change behavior.

Standard: one pure `transition(state, event)`, persisted rows versioned, unknown stored values map to a named safe state and are not rewritten on read. Illegal moves are rejected and logged with ids and states only. HTTP 409 stays the contract where a route already returns 409.

Owner of main/bca5 reconciliation: Tony. bca5 stays a preservation line. Access policy and data-subject request exist on this tree and not on bca5.

Status values: `FIX` (in the cleared order), `LATER`, `NOT A MACHINE`, `pending reconciliation`.

## Inventory

| # | Subject | Persisted | Status | Risk | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Integration token | `integration_tokens.status` | FIX | H | Refresh writes `active` by id. A revoke that landed during refresh can be revived. |
| 2 | Access policy | `access_policy_versions.status` | pending reconciliation | H | On main the route already compare-and-sets. On bca5 the model is absent. Do not port a second legality check. |
| 3 | Migration job | `migration_jobs.status` | FIX | H | CSV start enqueues chunks before the `RUNNING` write. Cancel, undo, and complete write by id. |
| 4 | Tenant export | `tenant_exports.status` | FIX | M | Claim and finish already compare-and-set. Finish the ordering; a wrong export is recoverable. |
| 5 | Data subject request | `data_subject_requests.status` | pending reconciliation | H | On main, `done`/`failed` write by id. On bca5 there is no status column (risk n/a). |
| 6 | Signature request | `signature_requests.status` | FIX | H | Void reads a terminal status, then updates by id. |
| 7 | RFP orchestration | `rfp_orchestration_runs.state` | FIX | M | Approve-drafting can write `running` with no from-state. |
| 8 | Proposal approval | `proposals.status` | FIX | H | Two writers can approve. The approval route already compare-and-sets; the other writer must share that rule. |
| 9 | SERUM approval | `serum` approval fields | FIX | H | Characterization only. No behavior change in that commit. |
| 10 | Opportunity stage | pipeline stage on the opportunity | NOT A MACHINE | n/a | Tony, 11 Nov 2026 17:03 BRT: keep Polo opportunity stages open. No guard. |
| 11 | KAM draft | `kam_drafts.status` | LATER | M | Submit already compare-and-sets `pending` → `approved`. |
| 12 | Onboarding tour | browser storage | LATER | L | Local wizard. No server record. |
| 13 | Public sign steps | React state on `PublicSignPage` | folded | L | Guard on the signature request. Not a second writer of `signature_requests.status`. |

Cleared order after this commit: migration start window, SMS callback, data-subject request, then integration token, signature void, proposal approval, SERUM characterization, then the M rows (RFP extraction, RFP orchestration, tenant export). Opportunity stage is not in that order. SMS is the second cleared fix, so it is not repeated as a later M row.

## 1. Integration token

Purpose: one grant per org and provider. Refresh must not write `active` onto a row that was revoked while the refresh was in flight.

Code: `apps/api/src/services/email-integration.helpers.ts` (failure at 110, success `active` at 120, both `where: { id }`). `apps/worker/src/lib/workspace-token.ts` (revoked at 85 and 104, error at 111, success `updateMany` at 120 where `id` and `deletedAt: null`, sets `active` at 126). Disconnect writes `revoked` and `deletedAt` by id at `apps/api/src/services/workspace-connect.service.ts:221`. Slack disconnect is the same shape at `apps/api/src/routes/integrations/slack.ts:395`.

Persisted: `IntegrationToken.status` (`active | expired | revoked | error`). No version column.

States: `active`, `expired`, `revoked`, `error`.

Events: `connect`, `refresh_ok`, `refresh_fail`, `revoke`, `expire`.

Transitions: `connect → active`. `refresh_ok` from `active` stays `active`. `refresh_fail` from `active` → `error`, or `revoked` when the provider says the grant is dead. `revoke` from `active|error` → `revoked` and sets `deletedAt`. `expire` is in the enum and has no writer on this tree.

Legacy / unknown: a value outside the Prisma enum is rejected by the database. `expired` is never written. An unknown value is not remapped in application code. Safe read: treat a missing row (`deletedAt` set) as revoked and do not refresh it.

Platform: the worker success path already refuses a soft-deleted row. The API helper does not. That is the gap.

## 2. Access policy

Purpose: draft through publish of one policy version. Owner of reconciliation: Tony.

Code: `apps/api/src/routes/access-policies.ts`. `transition` at 153 compare-and-sets on `status` and `updatedAt`. A lost race returns 409.

Persisted: `AccessPolicyStatus` on `access_policy_versions` (`draft | pending | approved | rejected | published | superseded`).

States: those six.

Events: `submit`, `approve`, `reject`, `publish`, `rollback`. Rollback creates a new `pending` row. It does not move a published row backwards.

Transitions: `draft → pending → approved|rejected`. `approved → published`. Publishing the next version sets the previous `published` row to `superseded`. `ACCESS_POLICIES_ENFORCE` is a process flag, not a column.

Legacy / unknown: the column is a Prisma enum. An unknown value cannot be stored. No application remap.

On bca5 this table does not exist. Do not add the preservation line's three-check helper.

## 3. Migration job

Purpose: one import. Chunks must not run while the row is still `PENDING`, and a later write must not undo cancel, undo, or complete.

Code, re-verified on this tree:

- Create `PENDING` at `apps/api/src/routes/migrations.ts:153`.
- Chunk loop `queue.add` at 194–212, while the row is still `PENDING`.
- `RUNNING` written by id at 214–217, after the enqueue.
- Cancel reads at 324–328 and writes by id at 331.
- Undo requires `COMPLETE` at 364 and writes `FAILED` plus `meta.undone` by id at 438.
- Worker `maybeComplete` reads at `apps/worker/src/queues/migration.ts:642`, returns unless `RUNNING` at 644, writes `COMPLETE` by id at 648.
- A chunk is skipped only when the row is `CANCELLED` or `FAILED` (703). `PENDING` is not skipped.
- An unsupported entity writes `FAILED` by id at 711.
- Exhausted retries compare-and-set `FAILED` only from `RUNNING` at 923–927. A chunk that dies while the row is still `PENDING` is not failed. The later by-id `RUNNING` write can then stick the job.

States: `PENDING`, `RUNNING`, `COMPLETE`, `FAILED`, `CANCELLED`.

Events: `start`, `cancel`, `complete`, `fail`, `undo`.

Transitions: `start` is `PENDING → RUNNING` and must win before any chunk is enqueued. `cancel` from `PENDING|RUNNING → CANCELLED`. `complete` from `RUNNING → COMPLETE`. `fail` from `RUNNING → FAILED`. `undo` from `COMPLETE → FAILED` with `meta.undone` (there is no `UNDONE` status). `COMPLETE`, `FAILED`, and `CANCELLED` do not move again.

Legacy / unknown: the column is a Prisma enum, so an unknown value is rejected by the database and is not remapped. `undo` is stored as `FAILED` plus `meta.undone`, not as its own status.

Platform: cancel and undo return HTTP 409 when the from-state does not match. The worker does not throw on a lost complete; it leaves the row.

## 4. Tenant export

Purpose: build one archive. Download requires `ready`.

Code: claim `pending|running → running` at `apps/worker/src/queues/tenant-export.ts:228`. Finish compare-and-sets from `running` at 261. A sweeper can fail a `running` row (comment at 237). No writer sets `expired`.

States: `pending`, `running`, `ready`, `failed`, `expired`.

Events: `claim`, `finish`, `fail`, `expire`.

Transitions: `claim` from `pending|running → running`. `finish` from `running → ready`. `fail` from `running → failed`. `expire` has no writer.

Legacy / unknown: Prisma enum. No application remap. `expired` is unread.

Risk is M: a wrong export can be re-requested. It does not approve a bid.

## 5. Data subject request

Purpose: one export or erasure. Owner of reconciliation: Tony. The main-side bug is in the cleared order. Whether bca5 grows this table is a separate decision.

Code: `packages/db/src/compliance/request-runner.ts`. Claim compare-and-sets `queued`, or `running` older than 15 minutes, to `running` at 64. `done` is written by id at 107 and 185. `failed` is written by id at 191. Unknown stored text is not mapped (a claim miss that is not `running` returns `skipped` at 83).

Persisted: `status` is `VarChar(16)`, default `queued`. Comment says `queued | running | done | failed`. Any other 16-character string can be stored.

States: `queued`, `running`, `done`, `failed`.

Events: `claim`, `complete`, `fail`.

Transitions: `claim` from `queued` or stale `running` → `running`. `complete` and `fail` only from `running`. `done` and `failed` do not move.

Legacy / unknown: map any stored value outside those four to `failed` for the caller, and do not rewrite the row on read. `failed` is the safe state because treating unknown as `queued` would run another erasure, and treating it as `done` would hide one.

On bca5 the erasure route has no status column. Risk there is n/a. It is not a machine.

## 6. Signature request

Purpose: one request reaches signed, declined, voided, or expired. The public page is a guard, not a writer of this column.

Code: `voidSignatureRequest` reads terminal statuses at `apps/api/src/services/documents/signature.service.ts:427` and updates by id to `VOIDED` at 454. A request that becomes `SIGNED` after the read can still be voided. DocuSign webhook claim and internal sign already exclude terminal statuses.

Public page: `apps/web/src/pages/PublicSignPage.tsx` steps `welcome | sign | submit | confirm`. `goTo` at 51 sets the step. That state stays in the component. The page must not write `signature_requests.status`.

States: `DRAFT`, `SENT`, `VIEWED`, `SIGNED`, `DECLINED`, `VOIDED`, `EXPIRED` (the Prisma enum).

Events: `send`, `view`, `sign`, `decline`, `void`, `expire`.

Transitions: void is legal from a non-terminal status only, and the write must compare-and-set from that set. `SIGNED`, `DECLINED`, `VOIDED`, and `EXPIRED` do not move.

Legacy / unknown: Prisma enum. No application remap.

Page guard: `welcome → sign → submit → confirm`. `confirm` is terminal in the component. Jumping backward is a UI concern and does not void or sign.

## 7. RFP orchestration

Purpose: one pipeline run. Risk M: the side effects stay in the caller, and a wrong phase can be re-run.

Code: approve sets `approved` where `state = awaiting_approval` (`apps/api/src/routes/rfp-pipeline.ts` around 458). A later write sets `running` with no state predicate (around 575).

States: `queued`, `running`, `paused`, `approved`, `rejected`, `awaiting_approval`, `completed`, `failed`.

Events: `start`, `pause`, `approve`, `reject`, `complete`, `fail`.

Transitions: `queued → running`. `running → awaiting_approval | failed`. `awaiting_approval → approved`. `approved → running` only for the drafting continuation, from `approved`. `running → completed`.

Legacy / unknown: Prisma enum. `paused` and `rejected` have no writer on this tree. They stay in the enum and are not remapped.

## 8. Proposal approval

Purpose: a proposal becomes approved from draft or review, once.

Code: `apps/api/src/routes/proposals.approval.ts:59` compare-and-sets `draft|review → approved`. A second writer also sets proposal `approved`. Both must use the same from-state.

States: the `ProposalStatus` enum. The approval edge is `draft|review → approved`.

Events: `submit`, `approve`, `lock`.

Transitions: approve only from `draft` or `review`. A locked proposal is revised into a new draft (the route already says so).

Legacy / unknown: Prisma enum. No application remap.

## 9. SERUM approval

Purpose: characterization only in this pass. Record who can move `requested → approved`. Do not change the writes.

Code: `apps/api/src/routes/serum.ts` sets `requested` near 1931 and `approved` near 2027, under an advisory lock, by id.

States: the approval field's current values (`requested`, `approved`, and the other values the column already allows).

Events: `request`, `approve`.

Transitions: to be recorded by the characterization test. No new transition is introduced in that commit.

Legacy / unknown: to be recorded from the column type in that commit. No rewrite.

## 10. Opportunity stage

NOT A MACHINE, by decision. Tony, 11 Nov 2026 17:03 BRT: "Keep Polo opportunity stages open." No guard is added. The function stays fail-open, and the route gate stays `off` unless an operator turns it on.

Code, unchanged: `packages/shared/src/stage-transitions/index.ts:29`. A null `from` returns true at 34. An unknown node returns true at 42 (`if (fi === -1 || ti === -1) return true`). The route `apps/api/src/routes/opportunities.transitions.ts` compare-and-sets the previous stage and also calls this function. Gate mode is `off | warn | enforce`, and `off` is the default.

What the code allows today: stay, one step among active stages, close to won or lost, reopen, and any move whose node is not in the pipeline. That openness is the product behavior, not a defect to close.

## 11. KAM draft

Purpose: a draft the operator approves. Already compare-and-set. Not in this pass.

Code: `apps/api/src/routes/kam-drafts.ts` updates `pending → approved` with the status in the `where` clause (near 204).

States: `draft`, `pending`, `approved`, `rejected` (the enum on this tree).

Events: `submit`, `approve`, `reject`.

Transitions: `draft → pending → approved|rejected`. Approve only from `pending`.

Legacy / unknown: Prisma enum. No application remap.

## 12. Onboarding tour

Purpose: first-run tour in the browser. LATER. Do not port the preservation-line reducer.

Code: `apps/web/src/stores/onboarding.ts`. `startTour` at 98 sets `tourActive` and step 0. `advance` moves one step and sets `tourSeen` at the end. `skipToStep` jumps. Persistence is `localStorage`.

States: inactive, active at a step index, seen, dismissed.

Events: `start`, `advance`, `back`, `skip`, `dismiss`.

Transitions: `start` from inactive → step 0. `advance` increments until the last step, then inactive + `tourSeen`. `dismiss` sets dismissed and seen. `back` decrements and does not go below 0.

Legacy / unknown: a missing or unreadable storage blob starts inactive. It is not rewritten into a new shape in this pass.

Not a server record. Risk L.

## 13. Public sign (folded)

See row 6. The component steps are a guard on the way to submit. They are not a persisted machine and they must not write `signature_requests.status`.

## SMS delivery

Purpose: a Twilio callback only moves a message forward.

Code: `handleStatusCallback` in `apps/api/src/services/twilio-sms.service.ts`. The map is at 316. The write at 332 is `updateMany` where `twilioSid` only. An older `sent` callback overwrites `DELIVERED`. Unknown `MessageStatus` is ignored at 325 and is not stored. The log at 343 is not the write.

States: `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `UNDELIVERED`.

Events: Twilio `queued`, `sent`, `delivered`, `failed`, `undelivered`.

Transitions: `QUEUED → SENT → DELIVERED`. `FAILED` and `UNDELIVERED` are forward moves from `QUEUED` or `SENT`. Nothing moves out of `DELIVERED`, `FAILED`, or `UNDELIVERED`. A same-rank callback does not replace a terminal status.

Legacy / unknown: an unrecognized Twilio status is ignored and the row is not rewritten. The column is a Prisma enum.

Risk M. Cleared as the second fix.

## RFP extraction

Purpose: `ocrStatus` and `extractionStatus` on a document version (`RfpJobStatus`). Several workers write them.

Code: queue sets both to `queued` at `apps/api/src/routes/rfp-pipeline.ts:173`. The extract worker compare-and-sets the extraction row to `running` at `apps/worker/src/queues/document-extract.ts:217`, then writes the version's `extractionStatus` and `ocrStatus` to `running` at 225 with no from-status. Failure writes `failed` at 463. Requirement extract writes `running` at `apps/worker/src/queues/rfp-requirement-extract.helpers.ts:139` and success or failure later in that file, with no from-status. `document-extract-db.ts` writes `succeeded` by id near 138.

States: `pending`, `queued`, `running`, `retrying`, `succeeded`, `failed`, `cancelled`.

Events: `queue`, `start`, `succeed`, `fail`, `cancel`.

Transitions: forward only, from the status the writer observed. A `succeeded` version is not set back to `running` or `failed` by a late worker.

Legacy / unknown: Prisma enum. No application remap.

Risk H if a late worker can clobber a succeeded extraction that a bid already uses. Confirm the writers before the M-row commit. If the clean fix is one writer shared with MSA text extract, stop and say so.

`RfpDocumentStatus` (`intake | pending_extraction | extracting | ready | failed | superseded | archived`) is the bid document column, not `ocrStatus`. It is a related writer, not a second inventory row.

## Not a machine

Two states, or a label with no ordering, or a derived fact. Each has a reason.

| Enum or field | Reason |
| --- | --- |
| LeadStatus | Label on a lead (`new`, `contacted`, `qualified`, `nurture`, `disqualified`, `converted`). No shared reducer. A conversion is a separate command. |
| LeadPriority | Priority label. No lifecycle. |
| ContactFactStatus | Review label on one fact. |
| CustomerCommitmentStatus | `open`, `met`, `missed`, `needs_review`. No second writer with an order. |
| TaskStatus | Checklist label (`open`, `in_progress`, `done`, `blocked`). |
| SyncEventStatus | Inbound event log (`received`, `processed`, `error`). One consumer. |
| WebhookMessageStatus | Delivery log (`pending`, `succeeded`, `failed`). |
| WebhookOutboxStatus | One relay claims the row in `packages/db/src/webhook-outbox.ts`. Not a second lifecycle in this pass. |
| ApprovalGateStatus | Gate label. Proposal approval is row 8. |
| SubmissionPackageStatus | Package label. Not the proposal approval write. |
| ActivityStatus | Activity label (`planned`, `completed`, `cancelled`). |
| BookingStatus | `CONFIRMED`, `CANCELLED`, `NO_SHOW`. One booking command. |
| SubscriptionStatus | Billing label. No reducer in this tree's CRM routes. |
| RenewalOpportunityStatus | Label on a renewal. The stage rule is row 10. |
| ExpansionStatus | Label. |
| GovernanceStatus | Label. |
| ProjectReferenceStatus | Label. |
| ContractStatus | Contract label (`active`, `pending`, `expired`, `terminated`, `draft`, `in_negotiation`). Not the signature request. |
| InitiativeStage | Label. |
| KamAccountStatus | Account label. The draft machine is row 11. |
| KamHandoffStatus | `draft`, `exported`, `confirmed`. One handoff command. |
| WatchdogEventStatus | Event label. |
| MeetingIngestStatus | Ingest log. |
| RfpAgentAssignmentStatus | `active` or `paused`. Two states, no order. |
| CaseStatus | Support label. |
| RequirementStatus, ComplianceRowStatus, AssessmentStatus, BidFactStatus, ReviewIssueStatus, CompetitorInsightStatus | Review labels on bid rows. No shared lifecycle. |
| HubSpot run rollup | `hubspotRunFromJobs` in `apps/api/src/services/sync-now/runs.ts:88` folds migration jobs into a display string. `CANCELLED` is reported as failed (101). `RUNNING` with `startedAt` null is reported as queued (106). It writes nothing. |
| Intake stepper | `IntakePage.tsx:165` disables steps past `unlocked`. Local UI. Not persisted. |
| OAuth refresh lock | `apps/api/src/lib/oauth-refresh-lock.ts` is a mutex. The token row is row 1. |
| ApiKey | No status column. `apps/api/src/plugins/auth.ts:644` loads a key with `revokedAt` and `deletedAt` null, and rejects `expiresAt` in the past at 655. Revoked and expired are derived. |
| User.role | `User.role` is a string, default `member` (`schema.prisma` near 306). `UserRole` is a separate join. Auth reads `user.role` (`apps/api/src/plugins/auth.ts:307`). Two sources. Not one status machine. |

Not status machines, so they are not rows: `AccountTier`, `Sentiment`, `DocumentKind`, `ActivityType`, `WebhookBackoffStrategy`, `RfpDocumentType`, `CompetitorInsightCategory`, `CasePriority`, `SmsConsentSource`, `SmsEntityType`, `ExpansionKind`, `ContractKind`, `ContractRateSchedule`, `GovernanceMeetingType`, `WatchdogEventKind`, `TemplateKind`, `SignatureProvider`, `IntegrationProvider`, `MigrationSource`.

## Mapping notes

- `IntegrationTokenStatus.expired` has no writer.
- `TenantExportStatus.expired` has no writer.
- RFP orchestration `paused` and `rejected` have no writer.
- Migration `undo` is stored as `FAILED` plus `meta.undone`.
- Data subject request will map unknown stored text to `failed` without rewriting it.
- SMS ignores an unknown Twilio status and does not store it.
