# Plan debate — POLO-IMPORT-WIZARD-QA-FIXES

## Proposal

H-1. Below the `md` breakpoint, render each column as a stacked row: header, sample, and a full-width Maps-to select. Keep the three-column table at `md` and up, and let that table scroll (`overflow-x-auto`) instead of clipping (`overflow-hidden`). Add three exact auto-map aliases: `Account Name` → `company.name`, `Employees` → `company.employeeCount`, `Country` → `company.countryCode`. No fuzzy matching.

M-1. Cancel sets `lock_timeout` to 2s, then updates the job row. If Postgres cancels that statement (`55P03`), Cancel writes an audit row `migration.cancel.requested` and returns 200 with the job still RUNNING. The chunk, under its existing `FOR UPDATE`, reads that audit row before it inserts and again before it commits bookkeeping. If the mark is there it rolls the inserts back and compare-and-sets the job to CANCELLED. A cancel that gets the lock still sets CANCELLED immediately, which the chunk already treats as "stop".

M-2. A ref makes Retry single-flight, the same way Confirm already is. The 409 sentence `Migration job is no longer failed` is not an error on screen: the winning request moved the job, and the poll shows the new status. Other 409 sentences the wizard still shows go through `t()` with an English fallback. The raw server string is not rendered.

Out of scope: deploying, the polo-preview Worker, wrangler, and merging. Devin gates the exact head.

## Challenger: Devin

## Challenger: Sentinel

Verbatim record: `plan-debate-polo-pr349-3a1975bd-20261119.md` (sha256 abe3d4a519cd14fbdca3fc997ac0db3756ae1aae63f2c4ceeba10a1dcdfa2cef).

Sentinel's verdict on `3a1975bd` stays above. It is not deleted. The answers below are against head `502830b1756f172e2d4be52e6f5b5e10eb472c62`. They are not merge approval. Sentinel did not run a security Q&A; the stub-auth note is in `decision.md` and is not one of these eleven items.

## Writer answers

1. **A stale mark cancels a later retry.** Resolved. The mark is stored with `diff.attemptId` and matches only that attempt, and only when `mark.at` is at or after the job's `started_at`. It does not expire while that attempt is still `PENDING` or `RUNNING` (L-1). A retry writes a new attempt and a new `startedAt`, so the old mark does not apply. If the worker dies after Cancel, the sweep cancels that attempt instead of failing it and offering Retry (N-2). Evidence: red `99dc769b0211bfc3f8499edbf02a99af4c3ae0ac`, fix `178f1b3c14360259e07c26bcd34a34a49c8d768c`. Tests: `an accepted cancel still cancels the next chunk after the database clock passes 150s`; `cancel, then fail, then retry, and the retry imports`; `a dead worker with a pending cancel is cancelled, not failed`; `a stale new attempt is not cancelled by the previous attempt mark`. Restoring the 150s cutoff wrote a company row.

2. **Any lock holder produces a mark that a later chunk consumes.** The failure mode is resolved. The original "return 409 and write no mark" rule was superseded by Devin's L-2: a busy lock on a job that is still `PENDING` or `RUNNING` persists the mark for the current attempt and returns 202. That attempt consumes it. A later attempt does not (item 1). `isLockTimeout` matches SQLSTATE `55P03` only, including the driver text `PostgresError { code: "55P03" }`. A running job is never answered `Cannot cancel a job with status RUNNING`. Evidence: red `8bc544752ff0bf31fab3f2f143cea227e1ef9fdc`, fix `43ded66e59f9836eac5360f801871101db7766c3`; progressAt at start red `3673c4a0d11b6ee503dd263ae0439762630a25d9`, fix `3d0fa243bca06c0b9e45ef12a112f0a0e52c6d40`; 55P03-only fix `37affbf07188b2d96b3e9e59e4eed38586c5c0eb`. Tests: `a chunk lock older than 120s still accepts cancel and the next chunk cancels` (50 runs, 0 failures); `a busy row lock without progressAt still records cancel for this attempt`; `starting an import sets progressAt from the database clock`. Returning 409 on a busy lock failed the 202 assertion. Dropping `progressAt` left it null.

3. **The mark can land after the last in-transaction check.** The part that completed the job is resolved. The completion `UPDATE` requires the mark to be absent, and a chunk that does not finish the file cancels instead of staying `RUNNING`. Evidence is on `01ee86fc1283e6c206d692b4ad9fc630c6d59ecc` (the lost-cancel fix before this gate). Tests: `a mark inserted on the bookkeeping update cancels instead of completing`; `a mark on a chunk that does not finish the file does not leave the job running`. What remains is the residual Sentinel already accepted: the rows of that same transaction are already committed, and a mark that arrives after the completion statement is a smaller race. Owner: Devin. `decision.md`, residual 1.

4. **200 plus RUNNING looks like a normal read.** Resolved. The pending response is 202 with `cancelRequested: true`. The wizard stays on the translated Cancelling sentence until the poll reaches a final status. Evidence: `5c3d2c41` for the flag and the copy, `43ded66e59f9836eac5360f801871101db7766c3` for 202. Tests: `shows Cancelling while a locked cancel is only requested`; `returns within CANCEL_RESPONSE_BOUND_MS while a chunk holds the job row lock` (expects 202 and `cancelRequested: true`).

5. **The worker CAS loses silently and names the importer.** Resolved, including the follow-up. A win writes `migration.cancel` with the mark's `userId`. A loss to `COMPLETE` or `FAILED` writes `migration.cancel.lost` and logs the job id and status. A second chunk that finds the same attempt already `CANCELLED` writes nothing (N-5). Evidence: actor and lost-audit fixes on `5c3d2c41` / the `applyMarkedCancel` change after `6f549aa2`; N-5 red `108381d5b68b8f2bf98ec36365c492b405e1d32a`, fix `e4e17f42b9a874447f05f96145a86dd6bf28616f`; both chunks held at the apply in `502830b1756f172e2d4be52e6f5b5e10eb472c62`. Tests: `a marked cancel audits the canceller, not the importer`; `a lost cancel keeps COMPLETE and audits the canceller`; `a lost cancel keeps FAILED`; `a two-chunk locked cancel writes one migration.cancel and no cancel.lost`. Restoring the lost-audit write produced one `migration.cancel.lost`.

6. **targetType and who may cancel.** Resolved. The finder requires `targetType: 'MigrationJob'` and the writer's org. No route accepts an action string from the client. Writers are named in `decision.md`. Evidence: red `ed85334d`, fix `ab2c7d22`. Tests: `a cancel mark for a different target type does not stop the chunk`; the authz file asserts 403 without `settings:write` and 404 for another org's job id.

7. **Forgery and replay.** Residual, as Sentinel required for agreement. Duplicate clicks for one attempt do not insert a second mark (`a second cancel while the chunk holds the row does not insert another mark`, fix `b2bcea0a`). The lookup index is `audit_log_target_action_idx` with `down.sql`. A signature is not in this change. Audit write access is the trust boundary. Owner: Devin. `decision.md`, residual 2.

8. **lock_timeout leaks onto the pool.** Resolved. `set_config(..., true)` is transaction-local. Evidence: the `SET LOCAL` test commit `58f8a358`. Test: `lock_timeout does not leak onto the next pooled checkout`. Setting the third argument to false made `SHOW lock_timeout` return `2s`. `decision.md` records that the audit insert shares the 2s limit and that `maxWait: 2_000` is a 500 with no mark.

9. **The losing retry is a red banner, and single-flight is only a ref.** Resolved, including the early status check (N-3). The database claim is the single-flight. The ref only covers one tab. The 409 carries `code: RETRY_LOST`, including when the early read already sees `RUNNING` or `COMPLETE`. The wizard matches the code and shows no alert while the job is running or after Import complete. If the winner then fails to enqueue, the job's own failure sentence stays. Evidence: red `b02848c6`, fix `1e8e96df`; N-3 red `25f805f9c73cc2c631c68e8621b70e73e5ee4131`, fix `dfedb3dac7088d67fdb7a8228ba8e697d9037aa2`. Tests: `two parallel retries queue one attempt and return RETRY_LOST`; `a retry that finds the job already running is RETRY_LOST`; `two Retry clicks send one request and show no error when the job is no longer failed`; `a losing retry that finds the job running leaves no alert after import complete`; `shows the job failure when the other retry lost and the winner did not enqueue`. Dropping the code left the API body without `RETRY_LOST`, and the wizard showed "That did not work. Try again."

10. **Audit and log leakage.** Residual, verified clean, as Sentinel required. The locked branch does not log the error object. Test: the bound cancel response has no `55P03`, `PostgresError`, `lock_timeout`, or `FOR UPDATE`. The 409 for a terminal job still names that status enum. It is not driver text, and it is not used for a job that is still `RUNNING`. Owner: Devin. `decision.md`, residual 3.

11. **Each guard needs a test, and none may skip for a missing database.** Resolved. The guards in items 1, 2, 4, 5, 6, 8 and 9 have the tests named above. The pre-commit check is `a cancel mark written after the row loop rolls the inserts back`. The pre-insert check is `a mark already present means the chunk issues no insert`. The worker database suites are listed in `FAIL_LOUD_WITHOUT_DB` and excluded from the no-database unit job (`7af8cacc`, plus `migration.cancel-gap.test.ts`). Devin's gate on `502830b1` reported the worker database suite 1075 passed, 0 failed, 0 skipped, and all 12 fail-loud files ran.

## Backlog, not open objections

Devin took these out of this round. They are named in `decision.md` under Backlog, owner Devin. They are not claims that the eleven objections above are still open.

- N-7
- L-series lows other than L-1 and L-2, which are fixed above
- T-1
- I-6

CONSENSUS: AGREED

## Addendum — stub default is the oldest admin

The agreement line above does not cover this. Line 19 excluded the stub-auth note from the eleven items. The change landed afterwards, in `3ae96a4e004671f3c7fa7d0a80b10d41c7e4d634`, and it changes who a header-less stub request is.

**Change.** `resolveStubAuth` used to load the oldest user in the org (`createdAt` ascending) and take that row's role. It now loads the oldest user whose `role` is `admin` (`apps/api/src/plugins/auth.ts` lines 347–351). If the org has no admin, it still falls back to the oldest user (lines 352–355).

**Why.** Red `c1859148d132d3ee038af9ef72f3ea285839f46f`. A read-only override user created earlier keeps that `createdAt` when `x-bidstack-e2e-role` moves them into the current org. The next request with no header then resolved to that user. `settings:write` returned 403, including an unknown-subject call that should have been 404, and the T-1 undo returned 403. Fix `3ae96a4e004671f3c7fa7d0a80b10d41c7e4d634`. Restoring the oldest-row lookup made the red test 403 again.

**Risk.** This is a privilege change on the stub. A header-less request is an admin even when an older non-admin exists. The previous rule could have resolved to a lesser role. The fallback still does, when the org has no admin.

**Containment.** The stub does not boot outside local development and test.

- `apps/api/src/lib/polo-mode.ts` lines 49–50: `allowStub` is true only when `NODE_ENV` is `development` or `test`.
- `apps/api/src/lib/polo-mode.ts` lines 64–70: real data mode refuses to boot without Clerk or Cloudflare Access, and any other boot without Clerk, Cloudflare Access, or demo mode throws `CLERK_SECRET_KEY required in production`.
- `apps/api/src/plugins/auth.ts` lines 559–560: with Clerk configured, a request that has no bearer throws 401 `Missing Authorization header`. `apps/api/src/plugins/auth.test.ts` lines 246–263 set `NODE_ENV` to `production` and expect that 401 on plain HTTP.
- `apps/api/src/plugins/auth.ts` lines 733–740: the request hook calls `resolveStubAuth` only in the last branch, after Clerk, Cloudflare Access, and `resolveDemoAuth`.
- `docker-compose.prod.yml` line 81 sets `NODE_ENV: production` on the api service, and line 87 requires `CLERK_SECRET_KEY`.
- The public preview sets `DEMO_MODE` (`deploy/vercel-demo/README.md` lines 19 and 25) and the hook uses `resolveDemoAuth` (`auth.ts` line 738), not the stub.

**Alternatives considered.** An explicit stub user id from the environment (a named fixture, not "whoever is the oldest admin"). Bumping `createdAt` when the role header moves a user, so the override cannot become the oldest row and the lookup can stay "oldest user". Excluding the `e2e-*` override emails from the default lookup. None of those is what shipped. The oldest-admin lookup is the change under challenge.

CHALLENGE: pending independent challenger (Devin gate)
