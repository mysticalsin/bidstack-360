# Production Gate Noise

## Problem

Warnings in release gates are easy to normalize, but they hide real regressions when the build is already noisy. Two recurring sources in this repo are development logger transports and Vite raw chunk-size warnings.

## Pattern

- Share one development `pino-pretty` transport per process. Creating a new transport for every module logger adds process `exit` listeners and eventually emits `MaxListenersExceededWarning`.
- Keep production logging on plain Pino JSON; the pretty transport is local-development only.
- Treat Vite's raw chunk warning as a coarse signal. Use gzip budget tests for the hard gate, and set `chunkSizeWarningLimit` just above known split-vendor reality so true raw-size regressions still surface.
- Emit `dist/.vite/manifest.json` so performance tests can verify manual chunk boundaries instead of guessing from filenames.
- Keep Core Web Vitals specs serial and run the default E2E gate with one Playwright worker. LCP/CLS measurements are lab-sensitive; parallel probes against the same preview/API server measure machine contention, not product performance. Use `E2E_WORKERS=2+` only for fast non-gate runs.
- Run the root test gate serially across workspace packages when multiple Vitest pools spawn child processes. Package-local tests can stay fast; the release gate should prefer deterministic shutdown over parallel flakiness.
- For the worker package, use Vitest `pool: 'vmThreads'` with `fileParallelism: false` and `isolate: false`. Child-process forks can pass every assertion and still fail during Tinypool IPC shutdown on Windows; a serial VM thread run keeps the document-extraction sandbox coverage without the fragile fork channel.
- Keep the worker package outside pnpm recursive/filter streaming in the root `test` script and run it before the heavy API/web suites. Launching it through `pnpm -r --stream`, `pnpm --filter @bidstack/worker test`, or after the API suite in the same shell chain can surface Tinypool channel shutdown noise. The worker `test` script and root gate intentionally call `scripts/run-worker-tests.mjs`, which spawns Vitest in `apps/worker` with npm/pnpm lifecycle env vars stripped.
- Run the worker package `typecheck` non-incrementally. The shared base config enables TypeScript incremental state, but release validation must not replay stale `.tsbuildinfo` diagnostics after queue-file edits.

## Verification

- `pnpm --filter @bidstack/api lint`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web exec playwright test --grep "@bundle"`
- `pnpm e2e -- smoke.spec.ts`

## Notes

Do not split the chart or editor vendor chunks casually. `apps/web/vite.config.ts` documents previous circular chunk crashes around charts, so further raw-size reduction needs browser coverage for analytics widgets and RFP/editor routes.
