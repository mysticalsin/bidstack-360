# State machines

Inventory of the lifecycles that used to live as status strings, flag
combinations, or ordered side effects. Three of them now have one transition
table and tests that refuse every move not in the table. The others are
recorded here with their states and the race or encoding each one still has.
They were not rewritten in this change: each is already a Prisma enum or an
existing pure function, and folding every writer into a new reducer in one
pass would mix unrelated behavior.

## Migration job — explicit

States: `PENDING`, `RUNNING`, `COMPLETE`, `FAILED`, `CANCELLED`.
Table: `packages/shared/src/migration-status.ts`. Writers: start-csv,
start-hubspot, cancel, undo, and the migration worker.

| event | from | to |
|---|---|---|
| (born, CSV) | — | PENDING |
| (born, HubSpot) | — | RUNNING |
| start | PENDING | RUNNING |
| cancel | PENDING, RUNNING | CANCELLED |
| complete | RUNNING | COMPLETE |
| fail | PENDING, RUNNING | FAILED |
| undo | COMPLETE | FAILED |

Illegal: anything else, including `COMPLETE -fail-> FAILED` and
`CANCELLED -fail-> FAILED`. A late chunk used to write FAILED with no status
check, so it could overwrite a finished job. The worker now updates with
`status in (PENDING, RUNNING)` and ignores a row that moved. The same filter
covers a chunk that uses up its retries while the row is still PENDING
(start-csv queues the chunk before it marks the row RUNNING). Previously that
left the row PENDING, and `finishStart` could then mark it RUNNING over a
chunk that had already died.

Still an encoding, not a state: undo stores FAILED and sets `meta.undone`.
There is no UNDONE status. A reader that treats every FAILED job as an error
is wrong about an undone import. Left as-is so stored rows and the undo
response do not change.

## Access policy version — explicit

States: `draft`, `pending`, `approved`, `rejected`, `published`, `superseded`.
Table: `packages/shared/src/access-policy-status.ts`. The route still applies
each move with a compare-and-swap on status and `updatedAt`, so two concurrent
reviews cannot both win.

| event | from | to |
|---|---|---|
| (born) | — | draft |
| submit | draft, rejected | pending |
| withdraw | pending | draft |
| approve | pending | approved |
| reject | pending | rejected |
| publish | approved | published |
| supersede | published | superseded |

A rollback does not move the superseded row. It creates a new row already
`pending`, which then needs the same second-admin approve before publish.
Publishing a draft, approving a published row, and publishing a superseded
row are refused.

## HubSpot sync run — explicit rollup

Per-entity jobs use the migration table. The Sync now control shows one state
for all of them: `queued`, `running`, `completed`, `failed`
(`hubspotAggregateState` in `apps/api/src/services/sync-now/runs.ts`).

- `FAILED` or `CANCELLED` fails the run only once nothing is still PENDING or
  RUNNING. One slow entity does not get hidden behind another's failure.
- `CANCELLED` is reported as `failed`. The control has no cancelled state.
- A `RUNNING` row with no `startedAt` is reported `queued`. The status and the
  timestamp can disagree, and the timestamp wins. Left as-is; the test pins it.

Dust jobs map BullMQ `completed` / `failed` / `active` / anything else onto
`completed` / `failed` / `running` / `queued`.

## Upload start — protocol, already guarded

One start is `(org, user, source, uploadId)` plus a SHA-256 of the request.

1. Take the advisory lock for that key.
2. No row: create it. A unique-index conflict is 409.
3. Row with the same digest: resume (re-queue missing chunks, finish the
   start writes).
4. Row with a different digest: 409, including the same user with different
   rows.
5. A second user in the org is a different key, so it cannot resume the first
   user's job.

The lock is held on a second connection for the request. A wait over 30s
surfaces as a 500 (P2028). Two parallel requests with one key produce one
import.

## Opportunity stage — already explicit

`packages/shared/src/stage-transitions`. Legal moves are stay, one step
forward or back among active stages, close to won/lost, or reopen.
Skipping a stage is illegal. Unknown stages fail open.

## Redis client

ioredis statuses. Commands run only in `ready` or `connect`. `wait`, `close`,
and `end` can be reconnected. `reconnecting` is not asked to connect again;
the client warns at most once per 30s while it is in that state. Callers that
do not go through `ensureRedisReady` (the rate-limit store) fail the request
instead of queueing it.

## Other Prisma enums

These are typed states. Their transitions are still decided at each writer.
Recorded so the next pass does not start from a search.

`LeadStatus`, `ContactFactStatus`, `CustomerCommitmentStatus`, `TaskStatus`,
`SyncEventStatus`, `WebhookMessageStatus`, `WebhookOutboxStatus`,
`TenantExportStatus`, `ProposalStatus`, `RfpDocumentStatus`, `RfpJobStatus`,
`RequirementStatus`, `ComplianceRowStatus`, `AssessmentStatus`,
`BidFactStatus`, `ReviewIssueStatus`, `CompetitorInsightStatus`,
`ApprovalGateStatus`, `SubmissionPackageStatus`, `ActivityStatus`,
`RfpAgentAssignmentStatus`, `CaseStatus`, `IntegrationTokenStatus`,
`SyncState`, `BookingStatus`, `SmsStatus`, `SubscriptionStatus`,
`RenewalOpportunityStatus`, `ExpansionStatus`, `RfpOrchestrationState`,
`SignatureStatus`, `GovernanceStatus`, `ProjectReferenceStatus`,
`ContractStatus`, `KamAccountStatus`, `KamDraftStatus`, `KamHandoffStatus`,
`WatchdogEventStatus`, `MeetingIngestStatus`.

UI loading, error, and empty for the import wizard come from the React Query
result (`isLoading`, `isError`, and no job yet), not from a hand-rolled trio
of booleans.
