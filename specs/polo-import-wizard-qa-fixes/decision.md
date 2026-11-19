# Decision — cancel must return while a chunk holds the job row

## What is wrong

A chunk imports inside one interactive transaction (`apps/worker/src/queues/migration.ts`). The first statement is `SELECT … FROM migration_jobs WHERE id = $1 FOR UPDATE`. The inserts and the progress update run before that transaction commits. The transaction is created with `{ timeout: 120_000 }`.

Cancel is `migrationJob.updateMany` on that same row (`apps/api/src/routes/migrations.ts`). Postgres blocks the `UPDATE` until the chunk commits or rolls back. `lock_timeout` is unset, so the wait is unbounded.

Prisma's 120s timeout is a client timer on the chunk's transaction. It does not cancel a statement that is stuck inside Postgres, and it does not unblock a different session that is waiting on the row lock. A statement that never finishes means Cancel never finishes. Inspector measured about 160s, which is the 120s timer plus the time the blocked `UPDATE` still had to wait.

## Decision

Cancel waits at most 2 seconds for the row lock (`SET LOCAL lock_timeout = '2s'` inside the cancel transaction). Two outcomes:

1. **The lock is free.** The conditional update to `CANCELLED` commits with the existing `migration.cancel` audit row. Behavior for an idle job is unchanged. The chunk's `FOR UPDATE` then sees a status other than RUNNING and writes nothing.
2. **The lock is not free within 2s.** Postgres cancels the waiting statement (`55P03`). Cancel does not keep waiting. It inserts `migration.cancel.requested` on `audit_log` (that insert does not lock `migration_jobs`) and returns 200 with the job still `RUNNING`.

The chunk checks `migration.cancel.requested` for its org and job id twice, both inside the locked transaction:

- before any entity insert, so a cancel that landed first writes nothing;
- again after the row loop, before bookkeeping, so a cancel that landed while the chunk held the lock rolls the inserts back.

On either hit the chunk compare-and-sets `PENDING`/`RUNNING` → `CANCELLED`. A later chunk sees `CANCELLED` and returns.

`audit_log` is the mark because the job row itself cannot be updated while the chunk holds it, and both the API and the worker already share that table. Redis was rejected: a CSV import can outlive a Redis blip, and the worker's chunk path must see the mark inside the same database transaction that would commit the rows.

The HTTP call returns in about 2s. The job becomes `CANCELLED` when the chunk next reaches a check. A statement that is hung inside one row insert is not killed by this design; Cancel no longer sits behind it, and the chunk applies the mark when that statement ends. Killing the backend with `pg_cancel_backend` was rejected: it needs extra privileges and can abort a transaction that is not this import.

`CANCEL_RESPONSE_BOUND_MS` is 5000. The integration test fails if Cancel is still blocked at that bound while the chunk lock is held.

## Who may write the cancel actions

No route accepts an action string from the client. The writers are:

- `DELETE /api/v1/migrations/:id/cancel`, and only after `settings:write`. A free lock writes `migration.cancel`. A live chunk writes `migration.cancel.requested` with `targetType: 'MigrationJob'` and `diff.attemptId`.
- The import worker, after it reads that mark, writes `migration.cancel` when the compare-and-set lands and `migration.cancel.lost` when it does not. The actor is the mark's `userId`, the person who cancelled.

A job id from another org is 404 on cancel and on retry. A caller without `settings:write` is 403 on both.

## What did not change

A cancel of a job that is already `COMPLETE`, `FAILED`, or `CANCELLED` is still 409. A cancel that gets the lock is still a single `CANCELLED` write. The chunk still refuses to import when the locked status is not RUNNING.
