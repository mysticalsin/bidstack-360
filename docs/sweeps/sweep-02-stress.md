# Sweep 02 — stress, concurrency, failure injection

App tree: `40b13242` (`main`). Harness tree at measurement: `08586c16`. Synthetic rows only. No Clerk key, no paid API, no deploy. Docker is not installed on this VM, so container commands were run as processes. `polo-preview` was not touched.

Stack: Postgres 16.15 with `vector`, Redis 7.0.15 (`maxmemory 256mb`, `noeviction`), API on `127.0.0.1:4000`, worker on `4002`, web on `38081`. Stub auth. `API_RATE_LIMIT_MAX=100000` so the global bucket does not hide the route limit of 10. `BIDSTACK_ALLOW_STUB_ROLE_HEADER=true` for the second admin. Node heap cap `768` MiB. Harness watchdog: 50 min, API 900 MiB, worker 640 MiB, web 800 MiB.

`/readyz` on a healthy stack: `{"ok":true,"db":true,"redis":true,"storage":true}`.

## Findings

1. **High. Company create hangs when Redis is down. Covered by #376.** `POST /api/v1/companies` was aborted by the client at 8001 ms with no status and no body. `/readyz` in the same window was 503 in 4 ms with `db: true` and `redis: false`. After Redis came back, `/readyz` was 200 in 1240 ms. The richer `dependencies.*.status` strings are the #376 change. This sweep did not edit that path.

2. **High. An unreadable spreadsheet is a 200 or a 500. Fixed in draft #400 (`e0a50f02`).** `POST /api/v1/migrations/parse-spreadsheet`:
   - `bad.xlsx` whose bytes are `this is not a workbook`: **200** in 8 ms, `{headers:[], rows:[]}`.
   - A zip whose local header declares a 32 MiB entry and compresses to 32,764 bytes: **500** `Something went wrong` in 100 ms. API RSS stayed at its existing ~728 MiB. The worker stayed up.
   - The same inputs are 400 after #400. A CSV of 100,001 data rows is **200** in 95 ms with exactly 10,000 rows and, before #400, no signal that the rest was dropped. #400 adds `truncated: true`.

3. **Medium. A cancelled import leaves its Redis rows key. Not fixed here.** `DELETE /api/v1/migrations/:id/cancel` returned 200, the job was `CANCELLED`, and `migration:<id>:companies:rows` was still present (`EXISTS` 1 before and after). The key TTL is 3600 s, so the leak is bounded. #350 deletes the key on a lost start claim and says the cancel path is out of scope. #349 rewrites that handler. This sweep did not edit `migrations.ts` for cancel.

4. **C2B is an expected fail until #349, and the job did not complete.** The claim trigger held `PENDING → RUNNING` for 2.5 s. Cancel during that lock returned **200**, not 202. The start then returned **409** `Migration job is no longer pending`. Final status `CANCELLED`, `migration.cancel` count **1**, companies named for that file **0**. The pass line (202, and never `COMPLETE`) fails on the status code. The import did not finish.

5. **D2 passed.** After a one-row import reached `COMPLETE 1 0 1`, cancel returned **409** `Cannot cancel a job with status COMPLETE`. The row stayed `COMPLETE`.

6. **R1E passed on the rerun.** A leftover `migration.cancel.requested` with `attemptId: null`, a stale sweep, then `POST /retry`: sweep set `FAILED`, retry was **200**, final status `COMPLETE`. The old mark did not cancel the retry. The in-run attempt did not reach the sweep because `updated_at` was written with microseconds and the sweep's equality missed. The worker's own progress write truncates `updated_at` to milliseconds (`date_trunc('milliseconds', NOW())` in `noteChunkClaimed`). The rerun used an ISO millisecond timestamp.

7. **B11 passed.** User A: ten **201**s and then **429**. User B, same org, `x-bidstack-e2e-role: admin`: **201**.

8. **Same file, one active job. Different files do not block.** Two concurrent starts of the same rows: **201** and **409** `This import is already running.`, one `migration_jobs` row. Two different names: **201** and **201**.

9. **Two users moving one opportunity.** `POST /api/v1/opportunities/:id/stage` from `s1_lead` to `s1_ongoing`: **200** and **409** `Opportunity stage changed concurrently; reload and retry.` Final stage `s1_ongoing`.

10. **Double create writes two rows.** Two parallel `POST /api/v1/opportunities` with the same body and `territoryId: null`: **201** and **201**, two ids, `count = 2`. The route has no idempotency key. The in-run pair was **400** `body/territoryId Required` because the harness omitted the field. That pair is not the measurement.

11. **Postgres connections do not fall back to the pre-soak count.** See soak. This is the pool staying open, not a connection per request.

## Load (autocannon 7.15.0)

20 connections, 8 s, 0 5xx. Read pass is p95 under 300 ms and p99 under 1 s. Write pass is p95 under 500 ms.

| Route | n | p50 ms | p95 ms | p99 ms | error rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /api/v1/crm/dashboard` | 2675 | 56.1 | 76.3 | 127.8 | 0 |
| `GET /api/v1/accounts/key` | 4799 | 32.5 | 42.2 | 59.8 | 0 |
| `GET /api/v1/opportunities?limit=50` | 5172 | 29.5 | 41.5 | 49.1 | 0 |
| `GET /api/v1/pipeline-stages` | 5164 | 29.7 | 42.6 | 49.2 | 0 |
| `GET /api/v1/tasks?limit=50` | 4030 | 37.8 | 53.6 | 64.1 | 0 |
| `POST /api/v1/tasks` | 5116 | 30.1 | 43.7 | 56.6 | 0 |

Dashboard ramp, same host:

| Connections | n | p50 ms | p95 ms | p99 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 654 | 5.9 | 7.0 | 8.8 |
| 10 | 1131 | 32.1 | 50.3 | 74.4 |
| 20 | 2645 | 57.3 | 78.3 | 107.8 |
| 40 | 1362 | 109.2 | 147.3 | 425.0 |

API RSS across the load block: 723.8 MiB before, 722.2 MiB after. No growth.

`POST /api/v1/migrations/start-csv` with 10,000 company rows: **201** in 35 ms. Three seconds later the job was `RUNNING 1000/10000`. It was then cancelled. `start-csv` with 100,000 rows: **400** in 135 ms, `Array must contain at most 10000 element(s)`. Worker RSS around that block peaked at 300.4 MiB, under the 512 MiB cap. The worker never received the 100k body.

## Soak

1800 s, 2 connections, rotating dashboard, accounts, opportunities, and tasks. **0** responses at 5xx. 60 samples, 30 s apart. Warm sample at 120 s.

| Process | Warm RSS | End RSS | Growth after warm |
| --- | ---: | ---: | ---: |
| API | 570.0 MiB | 565.6 MiB | −0.8% |
| Worker | 339.3 MiB | 234.2 MiB | −31.0% |
| Web | 216.8 MiB | 217.0 MiB | +0.08% |

Redis clients: 80 before, 80 at the warm sample, 80 after a 15 s drain.

Postgres `bidstack` sessions: 2 before the soak, 21 at 120 s, 24 at 1924 s, 24 after the 15 s drain. A later `pg_stat_activity` read was 23 idle and 1 active. The count does not return to 2. It also does not climb with time after the pool has opened. The miss is the pool holding its connections, not a leak of one session per request.

## Faults

Redis stopped for 30 s (`SHUTDOWN NOSAVE`), then started again. The listener pid was gone on the remeasure after the stop.

| Check | Result |
| --- | --- |
| `/readyz` while Redis is down | 503 in 4 ms, `db: true`, `redis: false` |
| `GET /api/v1/tasks` while Redis is down | 200 in 11 ms (auth uses Postgres) |
| `POST /api/v1/migrations/start-csv` × 3 | 409, 409, 409 (the handler refuses to queue) |
| Recovery | `/readyz` 200 in 1240 ms, then tasks 200 |

Postgres stopped with `pg_ctlcluster 16 main stop -m fast` for 30 s, then started.

| Check | Result |
| --- | --- |
| `/readyz` | 503 in 2 ms, `db: false`, `redis: true` |
| `GET /api/v1/tasks` | **500** in 7 ms, `Something went wrong`. Not 200. Auth fails closed. |
| Recovery | `/readyz` 200 in 239 ms, then tasks 200 |

The harness did not observe the rate-limit store failing open into a successful write. With Redis down, start-csv returned 409 from the handler. `skipOnError` is `POLO_DATA_MODE !== 'real'` in `apps/api/src/server.ts`, so a demo process allows the request when the limiter's store throws. That branch is not `NODE_ENV`.

`/readyz` remeasured after the API process was still alive, and after the boot process was killed (`rssAfterStop: null`). Stale samples were not reused.

## Boot with the database down

A second API (`PORT_API=4010`, `DATABASE_URL` host port 1) was still running at 12 s. It listened. `GET /readyz` was **503 in 54 ms** with `db: false` and `redis: true`. The log line is `Can't reach database server at 127.0.0.1:1`. The process was then killed.

`node scripts/run-safe-migrate-deploy.mjs` against that URL exited **1** with Prisma `P1001`. It did not sit until the 15 s kill.

## Covered elsewhere, not reopened

| Topic | Where |
| --- | --- |
| Redis-down company create, bounded enqueue, `/readyz` dependency status strings | #376 |
| Tasks badge vs the Tasks page | #375 |
| Amounts shown in their own currency | #374 |
| Task date beside the title | #359 |
| Cancel during the start claim returns 202 and consumes a pre-start mark | #349 (finding 4) |
| Lost-claim Redis key on CSV start 409 | #350. The successful-cancel key in finding 3 is outside that diff. |
| Progress bar at 100 when the import is finished | #351. This sweep did not drive the wizard. |

## Harness

`pnpm stress` runs `node stress/run.mjs`. The first load test installs `autocannon@7.15.0` under `/tmp/stress-tools`. It is not a dependency of this repo. `npx -p` on npm 11 does not put that package on `NODE_PATH`.

Checksums of the harness files are `stress/SHA256SUMS`. The raw scenario objects are `stress/LAST-RUN.json`, including the corrected double-create and R1E notes.
