# Vitest hookTimeout vs isolated-org seeding — mass "Hook timed out" suite failures

**Date:** 2026-07-01
**Symptom:** Full `apps/api` test runs fail with 30-40 integration test *files* reporting `Error: Hook timed out in 10000ms` — while zero individual tests fail and the failing set changes between runs. The vitest code frame points at the first line of `beforeAll` (`await prisma.$queryRaw\`SELECT 1\``), which looks like a database connectivity problem. It is not.

## Root cause

`createIsolatedOrg()` (apps/api/src/test-support/isolated-org.ts) seeds a **full demo org** in each integration suite's `beforeAll`. Measured cost on a Windows host against dockerized Postgres: **~18 seconds** per file, more under load. Vitest's default `hookTimeout` is **10 seconds**. The hook is killed mid-seed; the code frame renders the hook's *first* line, so the failure masquerades as `SELECT 1` hanging.

Why it looked environmental:

- The failing file set was nondeterministic (seed time fluctuates around the 10s/30s thresholds with machine load).
- Postgres monitoring showed the DB nearly idle (1-2 connections) — a single serial seed connection between samples.
- Suites passed individually on fast runs, failed in full runs (contention pushes seeds over the threshold).
- CI (Linux runners) seeds faster than the threshold, so CI stayed green while local runs failed.

## Fix

`hookTimeout: 120_000` in `apps/api/vitest.config.ts` and `apps/worker/vitest.config.ts` (worker's contract suites had the same failure shape in `afterAll` cleanup). WHY comments inline at both sites.

## Diagnostic ladder that found it (reusable)

1. Suite-level FAIL with zero test failures → hook problem, not test problem.
2. DB-side monitor during the run (`pg_stat_activity` sampled every 15s) → DB idle rules out pool exhaustion/locks.
3. Direct client probe outside vitest (`node --env-file=.env probe.mjs` with the real `@bidstack/db` import) → connects in <500ms, rules out env/client/network.
4. Minimal vitest test doing only `SELECT 1` → passes, rules out vitest/transform.
5. Time each `beforeAll` step in a throwaway copy of the failing suite → `createIsolatedOrg ms: 17963`. Done.

## Traps to remember

- **Vitest's hook-timeout code frame points at the hook's first line, not the slow line.** Never trust it to localize the hang.
- `prisma generate` output here is custom (`packages/db/generated/client`, see `schema.prisma` generator block) — `node_modules/.prisma/client` being absent is NORMAL in this repo; don't chase it.
- Bare `@prisma/client` imported from the workspace root does NOT resolve the generated client; always probe through `@bidstack/db`.
- `pnpm test` chains with `&&`, so a worker-suite flake aborts before api/web/db suites ever run — "the suite failed" may mean "the suite never ran".
