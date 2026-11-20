# Decision — cancel must return while a chunk holds the job row

## What is wrong

A chunk imports inside one interactive transaction (`apps/worker/src/queues/migration.ts`). The first statement is `SELECT … FROM migration_jobs WHERE id = $1 FOR UPDATE`. The inserts and the progress update run before that transaction commits. The transaction is created with `{ timeout: 120_000 }`.

Cancel is `migrationJob.updateMany` on that same row (`apps/api/src/routes/migrations.ts`). Postgres blocks the `UPDATE` until the chunk commits or rolls back. `lock_timeout` is unset, so the wait is unbounded.

Prisma's 120s timeout is a client timer on the chunk's transaction. It does not cancel a statement that is stuck inside Postgres, and it does not unblock a different session that is waiting on the row lock. A statement that never finishes means Cancel never finishes. Inspector measured about 160s, which is the 120s timer plus the time the blocked `UPDATE` still had to wait.

## Decision

Cancel waits at most 2 seconds for the row lock (`SET LOCAL lock_timeout = '2s'` inside the cancel transaction). Two outcomes:

1. **The lock is free.** The conditional update to `CANCELLED` commits with the existing `migration.cancel` audit row. Behavior for an idle job is unchanged. The chunk's `FOR UPDATE` then sees a status other than RUNNING and writes nothing.
2. **The lock is not free within 2s.** Postgres cancels the waiting statement (`55P03`). Cancel does not keep waiting. If the job is still `PENDING` or `RUNNING`, it inserts one `migration.cancel.requested` for the current attempt and returns **202** with the job still `RUNNING` and `cancelRequested: true`. A missing or old `progressAt` does not turn that into 409. A job that is already terminal is still 409 and writes no mark.

Start sets `progressAt` from Postgres `NOW()` in the same claim that moves the job to `RUNNING`, so the attempt has a clock before the first chunk.

The chunk checks `migration.cancel.requested` for its org, job id, and attempt twice, both inside the locked transaction. The mark does not expire while that attempt is still `PENDING` or `RUNNING`. It is ignored once the attempt reaches a terminal state, or once a retry replaces `startedAt` and `attemptId`. Both checks, and the statement that would set `COMPLETE`, read `started_at` on the job row. They do not use a process clock and they do not use a 150s cutoff.

The two checks are:

- before any entity insert, so a cancel that landed first writes nothing;
- again after the row loop, before bookkeeping, so a cancel that landed while the chunk held the lock rolls the inserts back.

On either hit the chunk compare-and-sets `PENDING`/`RUNNING` → `CANCELLED`. A later chunk sees `CANCELLED` and returns.

`audit_log` is the mark because the job row itself cannot be updated while the chunk holds it, and both the API and the worker already share that table. Redis was rejected: a CSV import can outlive a Redis blip, and the worker's chunk path must see the mark inside the same database transaction that would commit the rows.

The HTTP call returns in about 2s. The job becomes `CANCELLED` when the chunk next reaches a check. A statement that is hung inside one row insert is not killed by this design; Cancel no longer sits behind it, and the chunk applies the mark when that statement ends. Killing the backend with `pg_cancel_backend` was rejected: it needs extra privileges and can abort a transaction that is not this import.

`CANCEL_RESPONSE_BOUND_MS` is 5000. The integration test fails if Cancel is still blocked at that bound while the chunk lock is held.

`set_config('lock_timeout', '2s', true)` is local to the cancel transaction, the same as `SET LOCAL`. The audit insert inside that transaction shares the 2 second limit. `maxWait: 2_000` means a pool that cannot start the transaction returns 500 and does not write a mark. The next checkout of a pooled connection still reports `SHOW lock_timeout` as `0`.

## Who may write the cancel actions

No route accepts an action string from the client. The writers are:

- `DELETE /api/v1/migrations/:id/cancel`, and only after `settings:write`. A free lock writes `migration.cancel`. A live chunk writes `migration.cancel.requested` with `targetType: 'MigrationJob'` and `diff.attemptId`.
- The import worker, after it reads that mark, writes `migration.cancel` when the compare-and-set lands and `migration.cancel.lost` when it does not. The actor is the mark's `userId`, the person who cancelled.

A job id from another org is 404 on cancel and on retry. A caller without `settings:write` is 403 on both.

## Retry single-flight

The wizard ref stops a second click in one tab. Two browsers are settled by the database: retry's compare-and-set only matches `FAILED`, and `migration_jobs_one_active_per_file` refuses a second active import of the same file. The loser is `409` with `code: RETRY_LOST`. The wizard matches that code. If the winner then fails to enqueue, the job is `FAILED` and the wizard shows that failure.

## Lost cancel on the bookkeeping update

A `BEFORE UPDATE` on `processed_rows` can insert `migration.cancel.requested` during `recordChunkOutcome`, after the last read inside the chunk transaction. The company rows commit. `maybeComplete` then used to set `COMPLETE`, and `applyMarkedCancel` never ran. A chunk that does not finish the file (`processed + errors < total`) stayed `RUNNING`, because the stale sweep only claims `processedRows = 0`.

The statement that sets `COMPLETE` now requires that no matching mark exists. If that update misses because the mark is present, the worker compare-and-sets `CANCELLED` and writes `migration.cancel`. A partial chunk takes the same cancel path after the commit. A third read before the bookkeeping `UPDATE` does not close this: the mark does not exist until that `UPDATE` runs.

The rows of that chunk are already committed, because the mark was written by the same transaction as the inserts. The job does not become `COMPLETE`, and a partial chunk does not stay `RUNNING`.

## Retry, a dead worker, and an old mark

Cancel while the chunk holds the lock writes one `migration.cancel.requested` row for that attempt (`diff.attemptId`, the clicker's `userId`). A repeat Cancel for the same attempt does not insert another row.

If the worker dies before it applies the mark, the stale sweep used to set `FAILED`. Retry was then offered, and the old mark cancelled the new attempt at 0 rows. The original Cancel ended as `FAILED`.

The sweep now treats a mark for the current attempt as cancel: status `CANCELLED`, `migration.cancel` audited as the person on the mark, not the person who started the import. There is no 150s expiry. A mark for a previous attempt, or older than this attempt's `startedAt`, does not cancel the job. A mark for the attempt that is still running still cancels the next chunk after the database clock has moved past 150s. A chunk that has held the row for longer than 120s gets 202 and the mark, and the worker finishes `CANCELLED` when it next reaches a check. A retry stores a new `attemptId`, writes `migration.retry`, and the chunk ignores the old mark. Sequence covered by tests: cancel, fail, retry, the retry imports; and cancel, worker death, sweep, the job is `CANCELLED`.

The wizard shows Cancelling… while the job is still `RUNNING` and `cancelRequested` is true. A losing retry (`409` code `RETRY_LOST`) is not an error. A second tap within 750ms of Retry cannot hit Cancel after the button swaps.

The Maps-to select has a minimum width so the chosen field is not clipped from the `md` breakpoint (768px) through about 900px. The table scrolls instead of squashing the control.

## Who clicked Cancel

`migration.cancel.requested.userId` is the authenticated user on the Cancel request. `applyMarkedCancel` copies that id onto `migration.cancel`. It is not the import's `userId`. The same path is used when the sweep applies a mark the chunk never saw.

## Stub auth with no role header

A request that does not send `x-bidstack-e2e-role` is the seeded Admin only on the local and test stub.

The path is `resolveStubAuth` in `apps/api/src/plugins/auth.ts`. When `readStubRoleOverride` returns null (no header, lines 194–197 and 339–342), the function loads the oldest admin in the org (`role: 'admin'`, `createdAt` ascending, lines 347–351) and returns that row's `role`. If the org has no admin it falls back to the oldest user (lines 352–355). The fixture seed creates Jane Smith first with `role: 'admin'` (`packages/db/src/seed-data.ts` line 16, `packages/db/src/seed.ts` lines 90–102) and grants the system role Admin (`packages/db/src/seed.rbac.ts` lines 488–489 and 638–644).

That function runs only from the auth hook's final branch (`apps/api/src/plugins/auth.ts` lines 733–740): no `CLERK_SECRET_KEY`, Cloudflare Access off, demo mode off. `assertPoloAuthBoot` (`apps/api/src/lib/polo-mode.ts` lines 49–50 and 69–71) refuses to boot that branch unless `NODE_ENV` is `development` or `test`. Production compose sets `NODE_ENV=production` and requires `CLERK_SECRET_KEY` (`docker-compose.prod.yml` lines 81 and 87). The public preview sets `DEMO_MODE` (`deploy/vercel-demo/README.md`, `DEPLOY.md`) and uses `resolveDemoAuth`, not the stub. `resolveStubAuth` also rejects any remote address that is not loopback (lines 317–324).

This is not reachable on preview or production. Choosing the oldest admin is a privilege change on that stub. It is the open addendum in `plan-debate.md`.

## Residuals

Owner of each residual: Devin (Polo interim owner).

1. **Rows of the in-flight chunk.** The bookkeeping-update gap no longer completes the job or leaves a partial chunk `RUNNING`. What remains: those rows commit, because the mark was inserted by the same transaction. A mark that arrives after the completion statement is still a smaller race.

2. **The mark is unsigned.** Anyone who can insert into `audit_log` can write `migration.cancel.requested`. That write access is the trust boundary. Duplicate clicks for one attempt are de-duplicated. The lookup index is `audit_log_target_action_idx` on `(target_id, action)`, with `down.sql` beside the migration. A signature on the mark is not in this change.

3. **Leakage is clean.** The locked branch does not log the error object. A forced `55P03` returns the job JSON. The test asserts that body has no `55P03`, `PostgresError`, `lock_timeout`, or `FOR UPDATE`. The 409 for a job that cannot be cancelled still names the status enum. That enum is not driver text.

N-1 (cancel-requested state, one mark per attempt), the first half of N-3 (losing retry is not an error, second tap is not Cancel), and N-4 (select width at 768 and 900) are in this change. A second chunk of the same attempt does not write `migration.cancel.lost` after the first chunk's `migration.cancel`. A retry that finds the job already `RUNNING` or `COMPLETE` returns `409` with `code: RETRY_LOST`, and the wizard shows no red text. A running job is never answered `Cannot cancel a job with status RUNNING`.

## Start rate limit

`POST /migrations/start-csv` allows 10 starts a minute. The key is `u:<orgId>:<userId>` when the request has a user, and `ip:<req.ip>` when it does not. One person in an org must not spend the bucket of another person in that org. The route requires `settings:write`, so a signed-in start uses the user key. The IP form is only the fallback for a request that has no user id.

`req.ip` is Fastify's client address. `apps/api/src/server.ts` sets `trustProxy` from `parseTrustProxy(TRUSTED_PROXIES)`. Unset, that is `false`: `X-Forwarded-For` is ignored and `req.ip` is the socket peer. Production sets `TRUSTED_PROXIES=2`, which trusts a hop only when the immediate peer is an internal address, and never more than two hops. A client that connects from a public address cannot spoof `X-Forwarded-For`. `TRUSTED_PROXIES=true` would trust every hop. This change does not alter that parser. An authenticated user cannot consume another user's start quota, because the key includes the user id.

The queue suite used to bump a generation counter inside this file so each case got a fresh bucket. That counter, `advanceCsvStartRateLimitForTests`, and the `NODE_ENV === 'test'` branch are gone. Each queue case builds its own server, and the test store is in memory on that server.

## Cancel pending on the polled job

`cancelRequested` is derived on GET list and GET detail when the live attempt has a `migration.cancel.requested` mark. The wizard disables Cancel from that server field or from the click in this tab. The job id is not enough in memory: it is stored per org in session storage, and a mount with no stored id takes the newest non-terminal job from GET /migrations. A stored id that is terminal, missing, or for another org returns to the upload step. Cancel state is never read from session storage.

## Retry clock

Retry sets `startedAt` with `SELECT NOW()` inside the same transaction as the status change. The cancel mark's `at` is the database clock. Using `new Date()` let an API clock that was a few seconds ahead make `mark.at` older than `startedAt`, and the chunk then ignored a cancel that had already returned 202. Dropping the `started_at` bound in the worker would also hide the skew, and it would touch every mark check. The database clock on this one write is the smaller change. The cancel lock path is unchanged.

A cancel that times out while start still holds the row records a mark with no attempt id, because start has not published one yet. Start then writes the attempt. That mark is for the job, not for a missing attempt: the worker applies it to an attempt whose `started_at` is at or after the mark. A mark that names an attempt still requires `mark.at >= started_at`, which is why the retry clock and this rule do not undo each other. A mark is bound to an attempt id, not to a comparison of `started_at` and the mark time. The start route reads `NOW()` and then waits on the row, so that clock is earlier than a cancel mark written after the wait. The claim update itself sees a pre-start mark (no attempt id) and sets `CANCELLED`, writes `migration.cancel` with the attempt id, and does not enqueue. A retry inserts `migration.cancel.resolved` before publishing the next attempt, so a leftover pre-start mark cannot cancel that attempt. A mark that names the new attempt still can. A cancel after every row is already counted leaves the job `COMPLETE` and answers 409 `IMPORT_FINISHED`. The retry clock keeps a mark written after the attempt. The pre-start mark covers a cancel written before the start's attempt existed, so that start still cancels. It does not cover a retry. The retry claim inserts `migration.cancel.resolved` before it publishes the new attempt. `app_role` cannot update `audit_log`, so this is an insert, not a change to the mark. A resolution covers marks at or before it. The new attempt runs. A cancel whose mark commits after that claim still names the new attempt and still cancels it. That order is fixed by the row lock: the claim resolves the marks it can see, then publishes the attempt, in one transaction. HubSpot start takes `startedAt` from `SELECT NOW()` in the same transaction as the insert, the same clock as CSV start and retry.

`migration.start` records `diff.attemptId` with the same value the PENDING to RUNNING claim writes on `meta.attemptId`. The diff does not carry row data. A cancel or a later mark can be tied to that attempt from the audit log.

## Backlog

Owner: Devin (Polo interim owner). Not in this round.

| Item | Note |
| --- | --- |
| N-7 | Inspector round 2. Deferred. |
| L-series Lows | Deferred. L-1 and L-2 were the gate defects and are fixed here. |
| T-1 | Deferred. |
| I-6 | Deferred. |
| I-8 | The progress bar can read 99% next to "Import complete". That math predates this PR. Not changed. |

## What did not change

A cancel of a job that is already `COMPLETE`, `FAILED`, or `CANCELLED` is still 409. A cancel that gets the lock is still a single `CANCELLED` write. The chunk still refuses to import when the locked status is not RUNNING.
