# E2E Type And Performance Budget Gates

## Problem

Release gates can fail for two different reasons that look similar in CI:
real product regressions and test harness drift. Treat both as product work,
but keep the fixes precise so a noisy gate does not hide real launch risk.

## Pattern

- Keep E2E TypeScript compatible with the E2E tsconfig. If the suite compiles as
  CommonJS, avoid `import.meta.url` in specs and fixtures; resolve fixture paths
  from `process.cwd()` instead.
- Let TypeScript narrow nullable Playwright fixture data before destructuring.
  `test.skip()` does not reliably prove non-null state to the compiler unless
  the test returns after the skip branch.
- Use Playwright matchers that exist on the installed version. Prefer
  `toHaveText()` over invented aliases.
- Type Event Timing `PerformanceObserver.observe()` options through
  `PerformanceObserverInit` when browser type definitions lag experimental
  fields.
- Measure first-load JavaScript from the Vite manifest entry/import graph.
  Summing every file in `dist/assets` confuses initial payload with lazy route
  payload.
- Keep a separate per-chunk gzip cap so lazy route growth is still visible.
- Do not animate dense CRM shell layout properties such as grid tracks,
  widths, or padding. Use opacity/transform for cosmetic motion and keep app
  navigation latency predictable.
- Align hard Core Web Vitals budgets with the documented launch standard, then
  annotate stricter headroom targets separately so improvement pressure remains
  visible without making the gate flaky.
- Persist successful Core Web Vitals measurements, not only failures. The
  local web gate writes `playwright-report/core-web-vitals-latest.json` with
  route, metric, value, unit, budget, headroom, status, and timestamps so a
  green run is reviewable evidence.
- Keep E2E auth-mode gates honest. If Playwright exposes `E2E_AUTH_MODE` or
  `VITE_AUTH_MODE`, the managed web build must compile with that exact mode
  rather than reusing a package build script that hardcodes stub auth.

## Verification

- `pnpm --filter @bidstack/web exec tsc -p e2e/tsconfig.json --noEmit`
- `pnpm --filter @bidstack/web exec eslint <touched-e2e-files>`
- `pnpm --filter @bidstack/web exec playwright test e2e/performance/bundle-size-budget.spec.ts --project=chromium-desktop`
- `pnpm --filter @bidstack/web exec playwright test e2e/performance/core-web-vitals.spec.ts --project=chromium-desktop`

## Notes

The hard launch INP budget in this repo is `<200ms`, matching the project
design standard. Keep `<100ms` as a headroom annotation until the lab signal is
consistently below that target across fresh preview runs.

After the 2026-06-17 sidebar collapse fix, a fresh production-preview run
measured dashboard synthetic INP at `96ms`, down from `144ms`. Treat regressions
above `100ms` as premium UX debt even when the hard gate remains green.

After the 2026-06-17 idle-auth gate fix, the demo-auth production-preview E2E
run proved SERUM recovers from one auth `401` without showing the unavailable
state. The first attempted run caught the harness risk: the package `build`
script hardcoded `VITE_AUTH_MODE=stub`, so Playwright now builds directly with
the selected auth environment.
