# Stress harness

Real Postgres, Redis, API, worker, and web. Synthetic rows only. No Clerk key, no paid API, no deploy.

```bash
pnpm stress
```

`pnpm stress` runs `node stress/run.mjs`. The first load test installs `autocannon@7.15.0` under `/tmp/stress-tools` with npm. That package is not a dependency of this repo. `npx -p` on npm 11 does not put the package on `NODE_PATH`, so the harness installs the same version into a temp prefix instead.

## Bounds

| Cap | Value |
| --- | --- |
| Hard wall clock | 50 min (`STRESS_HARD_TIMEOUT_MS`) |
| API RSS | 900 MiB, then SIGKILL |
| Worker RSS | 640 MiB, then SIGKILL |
| Web RSS | 800 MiB, then SIGKILL |
| Harness RSS | 450 MiB, then the run exits |
| Soak | 30 min at 2 connections (`STRESS_SOAK_SECONDS=0` skips it) |
| Postgres `statement_timeout` | set by the operator, 30s on the sweep VM |
| Redis | `maxmemory 256mb`, `noeviction` |
| Node heap | `NODE_OPTIONS=--max-old-space-size=768` on the app processes |

Every scenario re-reads `/proc/<pid>/status` after it returns. A dead pid is recorded as null. The previous sample is not reused.

## What it calls

Read threshold, 20 concurrent users, autocannon: `/api/v1/crm/dashboard`, `/api/v1/accounts/key`, `/api/v1/opportunities`, `/api/v1/pipeline-stages`, `/api/v1/tasks`. Writes: `POST /api/v1/tasks`. Pass: read p95 under 300 ms, read p99 under 1 s, write p95 under 500 ms, no 5xx except injected faults.

Hammer, on the live routes:

- **B11.** Eleven `POST /api/v1/migrations/start-csv` as the stub admin, then one as `x-bidstack-e2e-role: admin`. Pass: 10×201, then 429, then 201. The API must be started with `BIDSTACK_ALLOW_STUB_ROLE_HEADER=true`.
- **Same file.** Two concurrent starts of the same rows. Pass: one job row, one 201, one 409.
- **Different files.** Two concurrent starts. Pass: both 201.
- **C2B.** A `BEFORE UPDATE` trigger blocks only `PENDING → RUNNING` on `pg_advisory_lock(481516234)` for 2.5 s. Cancel runs during that lock. Pass: cancel is 202, the job ends `CANCELLED`, exactly one `migration.cancel`, never `COMPLETE`. A miss here is `expected fail until #349`.
- **R1E.** Worker stopped, one real start, a `migration.cancel.requested` row with `attemptId: null`, `progressAt` aged 20 minutes, queued chunks removed, worker started, stale sweep, then `POST /retry`. Pass: sweep `FAILED`, retry finishes `COMPLETE`.
- **D2.** Cancel after the one-row import has committed. Pass: job stays `COMPLETE` and the response says it is too late (`already finished`, `too late`, or `status COMPLETE`).

CSV: 10k start, 100k start, 100k parse, a corrupt xlsx, a 32 MiB-inflating zip, a 1 MiB cell. Pass: worker RSS under 512 MiB, corrupt and zip-bomb responses are 4xx, neither process dies.

Faults: Redis down 30 s, then Postgres down 30 s. Company create is timed at 8 s. `/readyz` must name `db` and `redis`. Recovery is 10 s. Auth on a dead database must not return 200.

Boot: a second API on port 4010 with Postgres on port 1, and `scripts/run-safe-migrate-deploy.mjs` against that URL. Both are killed at 12 s and 15 s.

## Output

`stress/LAST-RUN.json` has the git HEAD and each scenario. `stress/SHA256SUMS` is the harness files. The sweep write-up is `docs/sweeps/sweep-02-stress.md`.
