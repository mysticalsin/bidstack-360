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

The path is `resolveStubAuth` in `apps/api/src/plugins/auth.ts`. When `readStubRoleOverride` returns null (no header, lines 194–197 and 339–342), the function loads the oldest user in the seed org (`createdAt` ascending, lines 344–357) and returns that row's `role`. The fixture seed creates Jane Smith first with `role: 'admin'` (`packages/db/src/seed-data.ts` line 16, `packages/db/src/seed.ts` lines 90–102) and grants the system role Admin (`packages/db/src/seed.rbac.ts` lines 488–489 and 638–644).

That function runs only from the auth hook's final branch (`apps/api/src/plugins/auth.ts` lines 725–732): no `CLERK_SECRET_KEY`, Cloudflare Access off, demo mode off. `assertPoloAuthBoot` (`apps/api/src/lib/polo-mode.ts` lines 69–71) refuses to boot that branch unless `NODE_ENV` is `development` or `test`. Production compose sets `NODE_ENV=production` and requires `CLERK_SECRET_KEY` (`docker-compose.prod.yml`). The public preview sets `DEMO_MODE` (`deploy/vercel-demo/README.md`, `DEPLOY.md`) and uses `resolveDemoAuth`, not the stub. `resolveStubAuth` also rejects any remote address that is not loopback (lines 317–324).

This is not reachable on preview or production. It is not a merge-blocking finding. No code change.

## Residuals

Owner of each residual: Devin (Polo interim owner).

1. **Rows of the in-flight chunk.** The bookkeeping-update gap no longer completes the job or leaves a partial chunk `RUNNING`. What remains: those rows commit, because the mark was inserted by the same transaction. A mark that arrives after the completion statement is still a smaller race.

2. **The mark is unsigned.** Anyone who can insert into `audit_log` can write `migration.cancel.requested`. That write access is the trust boundary. Duplicate clicks for one attempt are de-duplicated. The lookup index is `audit_log_target_action_idx` on `(target_id, action)`, with `down.sql` beside the migration. A signature on the mark is not in this change.

3. **Leakage is clean.** The locked branch does not log the error object. A forced `55P03` returns the job JSON. The test asserts that body has no `55P03`, `PostgresError`, `lock_timeout`, or `FOR UPDATE`. The 409 for a job that cannot be cancelled still names the status enum. That enum is not driver text.

No Low from the Inspector pass on `3a1975bd` is deferred. N-1 (cancel-requested state, one mark per attempt), N-3 (losing retry is not an error, second tap is not Cancel), and N-4 (select width at 768 and 900) are in this change. There is no Backlog row.

## What did not change

A cancel of a job that is already `COMPLETE`, `FAILED`, or `CANCELLED` is still 409. A cancel that gets the lock is still a single `CANCELLED` write. The chunk still refuses to import when the locked status is not RUNNING.
