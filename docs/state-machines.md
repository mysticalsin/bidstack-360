# State machines — inventory (origin/main)

Base: `0ba51f57f2889be9c8147508e0e65e17f7251187` (`origin/main`).
Re-verified on that tree. Line numbers from `cursor/polo-integrated-bca5` are not used.
This file is the inventory. It does not change behavior.

Last reviewed: 2026-11-11, on `cursor/sm-main-inventory-a111`. The addendum items that touch the four machines are in: a failed import is retryable, the API data-subject view maps unknown to failed, dropped SMS callbacks keep their facts, and an `expired` grant is refused. Stale imports are failed by the worker after a chunk is claimed. Retry clears that claim clock, writes the retry audit in the status transaction, and declares an empty body. A chunk claim writes only `progressAt`. The RFP gate stays `proposals:write`.

Standard: one pure `transition(state, event)`, persisted rows versioned, unknown stored values map to a named safe state and are not rewritten on read. Illegal moves are rejected and logged with ids and states only. HTTP 409 stays the contract where a route already returns 409.

Owner of main/bca5 reconciliation: Tony. bca5 stays a preservation line. Access policy and data-subject request exist on this tree and not on bca5.

Status values: `FIX` (in the cleared order), `LATER`, `NOT A MACHINE`, `pending reconciliation`.

## Inventory

| # | Subject | Persisted | Status | Risk | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Integration token | `integration_tokens.status` | fixed | H | Refresh is allowed from `active` or `error`. Status `expired` is refused before the provider is called. A past `expiresAt` with status `active` still refreshes. Connect writers are LATER. |
| 2 | Access policy | `access_policy_versions.status` | pending reconciliation | H | On main the route already compare-and-sets. On bca5 the model is absent. Do not port a second legality check. |
| 3 | Migration job | `migration_jobs.status` | fixed | H | Start claims `RUNNING` before enqueue. Enqueue failure returns the job `FAILED`. Retry is `FAILED → RUNNING` only when no row was imported. It drops the previous claim clock and records both attempt ids in the same transaction. A worker claim writes only that clock. A claim with no progress for 15 minutes is failed by the worker. A job still queued is not. GET does not write. |
| 4 | Tenant export | `tenant_exports.status` | FIX | M | Claim and finish already compare-and-set. Finish the ordering; a wrong export is recoverable. |
| 5 | Data subject request | `data_subject_requests.status` | fixed on main; pending reconciliation | H | On main, later writes carry the claim's `startedAt` and `orgId`. The API view and the worker both map an unknown stored value to `failed` and do not rewrite it. On bca5 there is no status column (risk n/a). |
| 6 | Signature request | `signature_requests.status` | fixed | H | Void compare-and-sets from `DRAFT`, `SENT`, or `VIEWED`. A signature that lands during the void is left signed. |
| 7 | RFP orchestration | `rfp_orchestration_runs.state` | FIX | M | Approve-drafting can write `running` with no from-state. |
| 8 | Proposal approval | `proposals.status` | fixed | H | Both writers approve only from `draft` or `review`, from one from-list. The RFP gate permission is `proposals:write`. |
| 9 | SERUM approval | `serum` approval fields | FIX | H | Characterization only. No behavior change in that commit. |
| 10 | Opportunity stage | pipeline stage on the opportunity | NOT A MACHINE | n/a | Tony, 11 Nov 2026 17:03 BRT: keep Polo opportunity stages open. No guard. |
| 11 | KAM draft | `kam_drafts.status` | LATER | M | Submit already compare-and-sets `pending` → `approved`. |
| 12 | Onboarding tour | browser storage | LATER | L | Local wizard. No server record. |
| 13 | Public sign steps | React state on `PublicSignPage` | folded | L | Guard on the signature request. Not a second writer of `signature_requests.status`. |
| 14 | SMS delivery | `sms_messages.status` | fixed | H | A callback moves forward only, and only for the org the route resolved. A callback that cannot move the row keeps error, price, and segments. |
| 15 | RFP extraction | document version `extractionStatus` and `ocrStatus` | FIX | H | Several workers write with no from-status. Not started. |

Landed on this branch: migration (enqueue failure returns `FAILED`, retry, worker-owned stale, attempt ids, retry audit), SMS callback (forward-only, org-scoped, facts kept on a dropped callback), data-subject request (claim token, and the API view maps unknown to `failed`), integration token (refresh from `active` or `error`, `expired` refused, one `GrantRevokedError`), signature void, and proposal approval. Next is SERUM characterization, then the M rows (RFP extraction, RFP orchestration, tenant export). Opportunity stage is not in that order.

## 1. Integration token

Purpose: one grant per org and provider. Refresh may continue an `active` or `error` grant. It must not write onto a row that was revoked or deleted while the refresh was in flight.

Code: one table, `tokenFrom` in `packages/shared/src/state-machines/integration-token.ts`. `GrantRevokedError` is that module's class. The API helper and the worker both throw it (the worker re-exports it). `refresh_ok`, `refresh_fail`, and `revoke` match `active` or `error`, and `deletedAt` null. `expired` is not in any from-list and has no writer. Worker success is `workspace-token.ts` at 150. The failure helper `markToken` accepts only `revoked` or `error` (at 91). A lost compare-and-set logs `tokenId`, `from`, and `to` (`warnIllegalToken` at 75). A row whose status is `expired` throws at 114 before any fetch or write. The API does the same at `email-integration.helpers.ts:189`. A past `expiresAt` with status `active`, or with the column omitted, still refreshes. Disconnect still writes `revoked` and `deletedAt` by id at `apps/api/src/services/workspace-connect.service.ts:221`. Slack disconnect is the same shape at `apps/api/src/routes/integrations/slack.ts:395`.

Connect writers, LATER. Each sets `active` by the `(org, user, provider)` key and is not the refresh race:

- `apps/api/src/routes/integrations/gmail.ts:209`
- `apps/api/src/routes/integrations/microsoft-mail.ts:182`
- `apps/api/src/routes/integrations/slack.ts:198`

Persisted: `IntegrationToken.status` (`active | expired | revoked | error`). No version column.

States: `active`, `expired`, `revoked`, `error`.

Events: `connect`, `refresh_ok`, `refresh_fail`, `revoke`, `expire`.

Transitions: `connect → active` (the three writers above, LATER). `refresh_ok` from `active` or `error` → `active`. `refresh_fail` from `active` or `error` → `error`. `revoke` from `active` or `error` → `revoked` when the provider rejects the grant. `expire` is in the enum and has no writer on this tree. `revoked` and a tombstone are not rewritten by refresh.

Legacy / unknown: a value outside the Prisma enum is rejected by the database. `expired` is never written. A stored `expired` refuses refresh and is not rewritten. A row with `deletedAt` set is not refreshed.

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

Code: one table, `migrationFrom` in `packages/shared/src/state-machines/migration.ts`. Every compare-and-set uses it.

- CSV start claims `PENDING → RUNNING` before `queue.add` and stores a new `attemptId` and the column mapping on `meta`. Chunks are built by `enqueueCsvChunks` (`migrations.ts` at 69). If enqueue throws, `markMigrationEnqueueFailed` compare-and-sets `RUNNING → FAILED` (at 106) and the route returns 201 with that failed job (at 341). The wizard can cancel a `PENDING` or `RUNNING` job and can retry a `FAILED` job that imported nothing (`migrationRetryAllowed`). A failed cancel or retry shows a translated error, not the server's English. Enqueue failure and expired rows are stored as `enqueue_failed` and `rows_expired`. The error file turns those codes into sentences. `70c14d06` moved start and retry onto `enqueueCsvChunks`. The test that both copies of chunk 0 are consumed was added in that same commit. There is no recorded red run of it.
- Retry is `POST /migrations/:id/retry`. The body schema is an empty object (`RetryBody` at 51). It matches `FAILED` only when `processedRows` and `errorRows` are both 0 (`migrationRetryAllowed`), mints a new `attemptId`, and drops `progressAt`. The status change and the `audit_logs` row (`migration.retry`, actor, org, migration, previous attempt, new attempt) commit in one transaction (`migrations.ts` at 386). A lost compare-and-set is logged with the status the job was in. A failed audit insert leaves the job `FAILED`. CSV retry calls the same `enqueueCsvChunks` with the mapping stored on that job. A job saved before the snapshot falls back to the shared `MigrationMapping` row. The new job ids do not collide with a chunk still queued. HubSpot uses `enqueueHubspotChunk`, and a HubSpot retry that cannot enqueue stores the same `enqueue_failed` or `rows_expired` code.
- HubSpot start creates the job `RUNNING` with an `attemptId`, then enqueues. If that enqueue throws, `hubspot-import.ts` at 191 compare-and-sets `RUNNING → FAILED` and returns the reloaded row. It does not throw.
- Stale means no progress since a worker claimed a chunk, not time spent queued. `noteChunkClaimed` (`apps/worker/src/queues/migration.ts` at 822) sets only `meta.progressAt` while the status is `RUNNING`, and stores `updated_at` truncated to milliseconds so Prisma's read matches the compare-and-set. It does not rewrite the rest of `meta`, so a retry's attempt id is left in place. A running job with that clock at least 15 minutes old (`MIGRATION_STALE_MS`), and no rows imported, is failed by `migration-stale-scan`. `claimStaleMigration` (at 1114) compare-and-sets `RUNNING → FAILED` on that status and the `updatedAt` it observed, with reason `stale`. A chunk that just committed progress moves `updatedAt`, so the claim misses. A job with no `progressAt` is still queued and is not failed. A retry clears the previous attempt's clock, so the new attempt is not stale until its own chunk is claimed. A job that has processed or errored a row is not failed this way. `GET /migrations` and `GET /migrations/:id` do not write. Both return the same derived `stalled` flag from `stalledFlag` (`migrations.ts` at 50, list at 187, detail at 210). The stall and failure sentences are in every locale.
- The worker's next-page enqueue (`migration.ts` at 1051) leaves the job `RUNNING` and rethrows when the next page cannot be queued. BullMQ runs the chunk again, the page is fetched again, and the next cursor is queued. Failing the job there would make that retry return at the running-status guard. The next page spreads the payload, so the attempt id travels with it.
- Cancel matches `PENDING` or `RUNNING`. Undo matches `COMPLETE` and `undoableUntil` still in the future, and stores `FAILED` plus `meta.undone`. It reads every `migration.chunk.imported` audit for the job, ordered by id, and deletes only after that read finishes. A short page ends the read. It does not report success from a capped page.
- Worker complete, unsupported entity, and exhausted retries match `RUNNING` only.
- A chunk runs only while the status is `RUNNING` and `migrationChunkMatchesAttempt` accepts it (`migration.ts` at 861). The running status in the raw SQL is `migrationActiveStatus()`, the from-status of `fail`. A job with an attempt id refuses a chunk from another attempt or a chunk with none, before any row is read and before complete. The same check is inside `commitChunkProgress` and `maybeComplete`: an older attempt does not move the counters and does not mark the job `COMPLETE`. The entity inserts share that check's transaction (`processMigrationChunk`). The job row is locked first, and its `org_id` must be the payload's org, before the claim clock or any row is written, so a foreign payload does not move the owner's stale clock and an older attempt adds no contacts, companies, opportunities, leads, or financials either. An exhausted BullMQ retry fails the job only when its attempt is still the one stored. The attempt id is in that update and in the error summary (`failExhaustedMigrationChunk` at 1166). Both copies of a retried chunk 0 are consumed; only the current attempt imports. A legacy job with no attempt id still accepts a chunk with none. `PENDING`, `COMPLETE`, `FAILED`, and `CANCELLED` are skipped.
- F-G3. Chunks of one job wait on that job's row lock. The wait is intentional. It keeps the attempt check and the inserts in one transaction. The inserts stay in file order. Reordering them would move the resume cursor and would not pick one lock order for a company, which has unique indexes on name and on domain.
- F-G4. The import transaction waits up to 10 seconds to start and 120 seconds to finish (`maxWait` 10_000, `timeout` 120_000 at `migration.ts` 1015). A deadlock or serialization failure is not stored as a row error. That is Postgres `40P01` and `40001`, Prisma `P2034`, and a company insert whose driver error has no `code` and whose message is `PostgresError { code: "40P01" }`. The chunk throws a short public sentence, the transaction rolls back, and BullMQ retries the chunk. The sentence has no process id, transaction id, source path, or SQL. When the retries are finished, the job stores `import_conflict`. The error file maps that code, and the older sentence that promised another try, to a line that does not. A lost compare-and-set is logged with the status the job was in.

States: `PENDING`, `RUNNING`, `COMPLETE`, `FAILED`, `CANCELLED`.

Events: `start`, `cancel`, `complete`, `fail`, `undo`, `retry`, `stale`.

Transitions: `start` is `PENDING → RUNNING` and must win before any chunk is enqueued. `cancel` from `PENDING|RUNNING → CANCELLED`. `complete` from `RUNNING → COMPLETE`. `fail` from `RUNNING → FAILED`. `undo` from `COMPLETE → FAILED` with `meta.undone` (there is no `UNDONE` status). `retry` from `FAILED → RUNNING` only when nothing was imported. `stale` from `RUNNING → FAILED` only after a worker claim with no progress for 15 minutes, and only from the worker. `COMPLETE` and `CANCELLED` do not move again. A `FAILED` job that already imported rows does not retry.

Legacy / unknown: the column is a Prisma enum, so an unknown value is rejected by the database. `undo` is stored as `FAILED` plus `meta.undone`, not as its own status.

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

Code: one table, `dsrClaimWhere` and `dsrOwnedWhere` in `packages/shared/src/state-machines/data-subject.ts`. The runner uses them. The claim matches `queued`, or `running` older than 15 minutes, and writes `startedAt` as the claim token (`request-runner.ts` at 78). Finish, the residue report, and pending storage keys (at 123, 162, and 194) match that `startedAt`, the org, and the expected status. A stale reclaim writes a new `startedAt`, so the old run's update matches nothing and does not overwrite the new run. The runner views an unknown stored status as `failed` at 85 and does not write it. The API view does the same through `dsrStateFromStored` at `data-subject-requests.ts:53`. The worker calls the runner and does not map the runner's `skipped` or `busy` outcome through that function.

Persisted: `status` is `VarChar(16)`, default `queued`. Comment says `queued | running | done | failed`. Any other 16-character string can be stored.

States: `queued`, `running`, `done`, `failed`.

Events: `claim`, `complete`, `fail`.

Transitions: `claim` from `queued` or stale `running` → `running`. `complete` and `fail` only from `running`. `done` and `failed` do not move.

Legacy / unknown: `dsrStateFromStored` views any stored value outside those four as `failed` and does not rewrite the row. `failed` is the safe state because treating unknown as `queued` would run another erasure, and treating it as `done` would hide one.

On bca5 the erasure route has no status column. Risk there is n/a. It is not a machine.

## 6. Signature request

Purpose: one request reaches signed, declined, voided, or expired. The public page is a guard, not a writer of this column.

Code: one table, `signatureFrom('void')` in `packages/shared/src/state-machines/signature.ts`. `voidSignatureRequest` refuses anything that table rejects (at 436) and compare-and-sets `status in signatureFrom('void')` (at 452). An illegal void and a lost compare-and-set are logged with the status the request was in. A request that becomes `SIGNED` after the read matches nothing, and no void event is stored. The local compare-and-set claims `VOIDED` before the DocuSign call. A lost claim does not call the provider. If the provider then fails, the row is put back to the status it had and no void event is stored. DocuSign webhook claim and internal sign already exclude terminal statuses.

Public page: `apps/web/src/pages/PublicSignPage.tsx` steps `welcome | sign | submit | confirm`. `goTo` at 51 sets the step. That state stays in the component. The page must not write `signature_requests.status`.

States: `DRAFT`, `SENT`, `VIEWED`, `SIGNED`, `DECLINED`, `VOIDED`, `EXPIRED` (the Prisma enum).

Events: `send`, `view`, `sign`, `decline`, `void`, `expire`.

Transitions: void is legal from `DRAFT`, `SENT`, or `VIEWED`. `SIGNED`, `DECLINED`, `VOIDED`, and `EXPIRED` do not move.

Legacy / unknown: Prisma enum. An unknown value cannot be stored.

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

Code: one table, `proposalFrom` in `packages/shared/src/state-machines/proposal.ts`. `proposals.approval.ts` and the RFP gate in `rfp-pipeline.ts` both match `draft` or `review`. The RFP gate also requires `approvedAt` null. A submitted proposal is not approved.

Permission: Tony, 11 Nov 2026: "No, proposals:write is enough for the RFP gate." `POST /proposals/:id/rfp-approve` stays `proposals:write` (`rfp-pipeline.ts` at 347). An Account Executive, who holds that permission, can approve. A user without it receives 403 and the proposal stays unapproved.

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

Purpose: a Twilio callback only moves a message forward, and only the message that belongs to the org the route resolved.

Code: one table, `smsFrom` in `packages/shared/src/state-machines/sms.ts`. `handleStatusCallback` in `apps/api/src/services/twilio-sms.service.ts` takes `orgId`. The status update (at 362) and the read-backs (at 351 and 373) include `twilioSid` and `orgId`. A recognized callback that cannot move the row still stores `errorCode`, `costMicros`, and `segments` (at 340), matched on the status just read. A `queued` callback has an empty from-list and does not change status. Unknown `MessageStatus` is ignored at 319, including its price and error fields.

States: `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `UNDELIVERED`.

Events: Twilio `queued`, `sent`, `delivered`, `failed`, `undelivered`.

Transitions: `QUEUED → SENT → DELIVERED`. `FAILED` and `UNDELIVERED` are forward moves from `QUEUED` or `SENT`. Nothing moves out of `DELIVERED`, `FAILED`, or `UNDELIVERED`. A same-rank callback does not replace a terminal status.

Legacy / unknown: an unrecognized Twilio status is ignored, and its price and error are not stored. A recognized status that loses the compare-and-set keeps those facts and does not change status. The column is a Prisma enum. An unknown value cannot be stored.

The forward-only guard and the org scope are in. Risk for the callback race is closed.

## RFP extraction

Purpose: `ocrStatus` and `extractionStatus` on a document version (`RfpJobStatus`). Several workers write them. Not changed in this pass.

Code, still the writers below: queue sets both to `queued` at `apps/api/src/routes/rfp-pipeline.ts:173`. The extract worker compare-and-sets the extraction row to `running` at `apps/worker/src/queues/document-extract.ts:217`, then writes the version's `extractionStatus` and `ocrStatus` to `running` at 225 with no from-status. Failure writes `failed` at 463. Requirement extract writes `running` at `apps/worker/src/queues/rfp-requirement-extract.helpers.ts:139` and success or failure later in that file, with no from-status. `document-extract-db.ts` writes `succeeded` by id near 138.

States: `pending`, `queued`, `running`, `retrying`, `succeeded`, `failed`, `cancelled`.

Events: `queue`, `start`, `succeed`, `fail`, `cancel`.

Transitions: forward only, from the status the writer observed. A `succeeded` version is not set back to `running` or `failed` by a late worker.

Legacy / unknown: Prisma enum. No application remap.

Rating: FIX, risk H, not started. A late worker can still clobber a succeeded extraction that a bid already uses. If the clean fix is one writer shared with MSA text extract, stop and say so.

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

## SyncState

Rating: LATER. Not a row in the cleared order.

`SyncState` is `PENDING_PUSH | SYNCED | CONFLICT | DELETED_REMOTE` on `calendar_events`. Calendar sync writes those values by id (`apps/worker/src/queues/calendar-sync.ts` and the Google and Microsoft pull files). The order is real and there is more than one writer, so this is not "not a machine". It has no shared from-list in this pass.

Legacy / unknown: Prisma enum. An unknown value cannot be stored and is not rewritten.

## RfpResponsePhase

Rating: LATER. Same run as row 7, not a second machine.

`RfpResponsePhase` is the `current_phase` label on `rfp_orchestrations` (`requirement_extract` through `completed`). The orchestration `state` is the machine. Some phase writes check the previous phase (`apps/worker/src/queues/rfp-section-planning.ts` sets `section_draft` only from `story_match`). Others assign the phase. Not changed in this pass.

Legacy / unknown: Prisma enum. An unknown value cannot be stored and is not rewritten.

## Every enum

Each Prisma enum in `packages/db/prisma/schema.prisma`, named. Status machines that already have a section are marked there. The rest are not machines: a label, a kind, or a derived fact, with no shared from-list.

| Enum | Rating | Reason |
| --- | --- | --- |
| AccountTier | NOT A MACHINE | `key`, `top`, `standard`. Account label. |
| OpportunityStage | NOT A MACHINE | Row 10. Tony's decision. No guard. |
| LeadStatus | NOT A MACHINE | Lead label. A conversion is a separate command. |
| LeadPriority | NOT A MACHINE | Priority label. |
| Sentiment | NOT A MACHINE | `hot`, `warm`, `neutral`, `cold`. Not a lifecycle. |
| ContactFactKind | NOT A MACHINE | Fact kind (`reports_to`, `buying_role`, `company_link`). |
| ContactFactStatus | NOT A MACHINE | Review label on one fact. |
| CustomerCommitmentStatus | NOT A MACHINE | `open`, `met`, `missed`, `needs_review`. No second ordered writer. |
| TaskStatus | NOT A MACHINE | Checklist label. |
| DocumentKind | NOT A MACHINE | Document kind. |
| SyncEventStatus | NOT A MACHINE | Inbound log. One consumer. |
| WebhookBackoffStrategy | NOT A MACHINE | Retry shape, not a status. |
| WebhookMessageStatus | NOT A MACHINE | Delivery log. |
| AccessPolicyStatus | pending reconciliation | Row 2. |
| WebhookOutboxStatus | NOT A MACHINE | One relay. Not a second lifecycle in this pass. |
| TenantExportStatus | LATER | Row 4. `expired` has no writer. |
| ProposalStatus | fixed | Row 8. Approve matches `draft` or `review`. |
| RfpDocumentType | NOT A MACHINE | Document type. |
| RfpDocumentStatus | LATER | Bid document column. Related to extraction, not `ocrStatus`. |
| RfpJobStatus | FIX | RFP extraction section. Not changed in this pass. |
| RequirementStatus | NOT A MACHINE | Review label on a requirement. |
| ComplianceRowStatus | NOT A MACHINE | Review label on a compliance row. |
| AssessmentStatus | NOT A MACHINE | `ASSESSED`, `UNAVAILABLE`, `PENDING`. |
| BidFactStatus | NOT A MACHINE | Review label on a bid fact. |
| RfpRiskLevel | NOT A MACHINE | `low`, `medium`, `high`, `critical`. |
| ReviewIssueStatus | NOT A MACHINE | Review label. |
| CompetitorInsightCategory | NOT A MACHINE | Category, not a status. |
| CompetitorInsightStatus | NOT A MACHINE | `active`, `archived`, `superseded`. |
| ApprovalGateStatus | NOT A MACHINE | Gate label. Proposal approval is row 8. |
| SubmissionPackageStatus | NOT A MACHINE | Package label. |
| ActivityType | NOT A MACHINE | Activity kind. |
| ActivityStatus | NOT A MACHINE | `planned`, `completed`, `cancelled`. |
| ActivityActorType | NOT A MACHINE | `user`, `system`, `agent`. |
| IntegrationType | NOT A MACHINE | Connector kind. |
| MigrationSource | NOT A MACHINE | Import source. The job status is row 3. |
| MigrationStatus | fixed | Row 3. |
| RfpAgentAssignmentStatus | NOT A MACHINE | `active` or `paused`. Two states, no order. |
| WorkflowTriggerKind | NOT A MACHINE | Trigger kind. |
| WorkflowActionKind | NOT A MACHINE | Action kind. |
| CasePriority | NOT A MACHINE | Priority label. |
| CaseStatus | NOT A MACHINE | Support label. |
| IntegrationProvider | NOT A MACHINE | Provider kind. The grant status is row 1. |
| IntegrationTokenStatus | fixed | Row 1. `expired` has no writer. |
| SyncState | LATER | See SyncState above. |
| BookingStatus | NOT A MACHINE | One booking command. |
| AiAssistantKind | NOT A MACHINE | Assistant kind. |
| EmailProvider | NOT A MACHINE | `GMAIL` or `OUTLOOK`. |
| SmsStatus | fixed | SMS section. |
| SmsConsentSource | NOT A MACHINE | How consent was recorded. |
| SmsEntityType | NOT A MACHINE | `CONTACT` or `LEAD`. |
| SavedViewEntity | NOT A MACHINE | Which list a view belongs to. |
| SubscriptionStatus | NOT A MACHINE | Billing label. |
| RenewalOpportunityStatus | NOT A MACHINE | Renewal label. The stage rule is row 10. |
| HealthTrend | NOT A MACHINE | `IMPROVING`, `STABLE`, `DECLINING`. |
| NpsCategory | NOT A MACHINE | `PROMOTER`, `PASSIVE`, `DETRACTOR`. |
| ChurnSignalKind | NOT A MACHINE | Signal kind. |
| ChurnSignalSeverity | NOT A MACHINE | Severity label. |
| ExpansionKind | NOT A MACHINE | Expansion kind. |
| ExpansionStatus | NOT A MACHINE | Expansion label. |
| RfpOrchestrationState | LATER | Row 7. `paused` and `rejected` have no writer. |
| RfpResponsePhase | LATER | See RfpResponsePhase above. |
| SignatureProvider | NOT A MACHINE | `DOCUSIGN` or `INTERNAL`. |
| SignatureStatus | fixed | Row 6. Void matches `DRAFT`, `SENT`, or `VIEWED`. |
| SignatureEventType | NOT A MACHINE | Event kind on the signature log. |
| TemplateKind | NOT A MACHINE | Template kind. |
| GovernanceStatus | NOT A MACHINE | `open`, `in_progress`, `done`. |
| GovernanceMeetingType | NOT A MACHINE | Meeting kind. |
| ProjectReferenceStatus | NOT A MACHINE | Reference label. |
| ContractKind | NOT A MACHINE | Contract kind. |
| ContractRateSchedule | NOT A MACHINE | Rate schedule. |
| ContractStatus | NOT A MACHINE | Contract label. Not the signature request. |
| WinLossOutcome | NOT A MACHINE | `won` or `lost`. |
| WinLossReasonCode | NOT A MACHINE | Reason code. |
| InitiativeStage | NOT A MACHINE | Initiative label. |
| KamAccountStatus | NOT A MACHINE | Account label. The draft is row 11. |
| KamOwnerModel | NOT A MACHINE | `presales_driven` or `manager_driven`. |
| KamSessionSource | NOT A MACHINE | How a session was captured. |
| KamDraftStatus | LATER | Row 11. |
| KamHandoffStatus | NOT A MACHINE | One handoff command. |
| AccountTeamRole | NOT A MACHINE | Role label. |
| WatchdogEventKind | NOT A MACHINE | Event kind. |
| WatchdogImplication | NOT A MACHINE | `OPPORTUNITY`, `RISK`, `NEUTRAL`. |
| WatchdogEventStatus | NOT A MACHINE | Event label. |
| MeetingIntelSource | NOT A MACHINE | Source label. |
| MeetingIntelVisibility | NOT A MACHINE | `account_team` or `org`. |
| SeniorityLevel | NOT A MACHINE | Seniority label. |
| MeetingIngestStatus | NOT A MACHINE | Ingest log. |

## Free-text status columns

33 string columns in `schema.prisma` that store a status, state, or phase and are not a Prisma enum. An unknown value can be stored. Unless the row names a mapping, readers leave the text in place and do not rewrite it to a guessed status.

| Column | Unknown value |
| --- | --- |
| `DataSubjectRequest.status` | Machine, row 5. Unknown is viewed as `failed` and is not rewritten. |
| `CompanyEnrichment.status` | Optional text. Unknown is left in place. |
| `AiInsight.status` | Default `active`. Unknown is left in place. |
| `DustRun.status` | Default `queued`. Unknown is left in place. |
| `BidOpportunity.status` | Free text. Unknown is left in place. |
| `RiskRegisterItem.status` | Default `open`. Unknown is left in place. |
| `ComplianceCheck.status` | Free text. Unknown is left in place. |
| `ProviderHealth.status` | Free text. Unknown is left in place. |
| `AccountSolution.status` | Comment `active \| archived \| draft`. Unknown is left in place. |
| `AccountProduct.status` | Default `active`. Unknown is left in place. |
| `DocumentExtraction.status` | Comment `pending \| running \| done \| error`. Unknown is left in place. |
| `WorkflowRun.status` | Comment `running \| succeeded \| failed \| cancelled`. Unknown is left in place. |
| `UserPresence.status` | Comment `online \| away \| busy \| offline`. Unknown is left in place. |
| `SerumConfigVersion.status` | Default `draft`. Unknown is left in place. |
| `SerumConfigVersion.approvalStatus` | Default `not_required`. Unknown is left in place. |
| `SerumConnectorConnectionTest.status` | Default `success`. Unknown is left in place. |
| `CallSession.status` | Default `SCHEDULED`. Unknown is left in place. |
| `AiInvocation.status` | Free text. Unknown is left in place. |
| `CrewRun.status` | Default `queued`. Unknown is left in place. |
| `AnalyticsReportRun.status` | Comment `pending \| running \| done \| error`. Unknown is left in place. |
| `MsaIntakeDraft.status` | Default `pending_review`. Unknown is left in place. |
| `AgreementConnection.status` | Default `pending`. Unknown is left in place. |
| `AgreementIngestItem.status` | Default `queued`. Unknown is left in place. |
| `MsaWhitespaceDecision.state` | Free text. Unknown is left in place. |
| `ContractFileVersion.extractionStatus` | Default `pending`. Related to extraction. Unknown is left in place. |
| `MeetingSourceConnection.status` | Default `connected`. Unknown is left in place. |
| `MeetingCrossRegionFlag.status` | Default `open`. Unknown is left in place. |
| `CompanyFirmographics.status` | Default `pending`. Unknown is left in place. |
| `CompanyJobPosting.state` | Optional text. Unknown is left in place. |
| `AccountFinancialProfile.status` | Default `pending`. Unknown is left in place. |
| `IntelSourceRun.status` | Free text. Unknown is left in place. |
| `IntelImportBatch.status` | Default `running`. Unknown is left in place. |
| `ConsultingPartnerRun.status` | Free text. Unknown is left in place. |

## Mapping notes

- `IntegrationTokenStatus.expired` has no writer. Refresh from `expired` is illegal. A past `expiresAt` with status `active` still refreshes. Refresh is legal from `active` or `error`.
- `TenantExportStatus.expired` has no writer.
- RFP orchestration `paused` and `rejected` have no writer.
- Migration `undo` is stored as `FAILED` plus `meta.undone`. Retry is `FAILED → RUNNING` only when no row was imported. It clears the previous claim clock and writes `migration.retry` with both attempt ids in that same transaction. A chunk claim sets only `progressAt`. `stale` is `RUNNING → FAILED` after 15 minutes with no progress since a worker claim. A queued job is not failed. GET list and GET detail derive the same `stalled` flag and do not write it.
- Data subject request maps unknown stored text to `failed` without rewriting it, in the worker and in the API view.
- SMS ignores an unknown Twilio status and does not store its price. A recognized callback that cannot move the row keeps error, price, and segments.
- The three OAuth connect writers (Gmail, Microsoft mail, Slack) still set `active` by the unique key. LATER.
- RFP extraction writers are unchanged. Rating stays FIX, risk H.
- `SyncState` and `RfpResponsePhase` stay LATER.
- Opportunity stage stays NOT A MACHINE.
- Free-text status columns other than the data-subject request leave an unknown value in place.

## LATER (not in this pass)

- A partial import is not marked stale. Retry refuses a job that already imported rows, and failing it here would leave those rows with no retry. F-NEW-4.
- A late `failed` callback that cannot move `DELIVERED` still stores the error code, price, and segments. F-NEW-6.
- Signature void answers 400 for a terminal status (`signature.service.ts` at 436), not 409. The compare-and-set claims `VOIDED` before the DocuSign call. A lost claim does not call the provider, and a provider failure restores the previous status. The from-list is `signatureFrom('void')`. The HTTP answer for a terminal status stays 400. F-NEW-7, F-NEW-8, F-NEW-9.
- The RFP gate says "Proposal has already been approved" when the from-state does not match (`rfp-pipeline.ts` at 456), including a submitted proposal that was never approved. F-NEW-10.
- The three OAuth connect writers, `SyncState`, `RfpResponsePhase`, RFP extraction, and opportunity stage stay as recorded above.
- The Arabic `csvImport` catalog is still only the progress block. The rest of the wizard stays in English. F-F2.
