# Sidebar Collapse INP Headroom

## Problem

Dense CRM shells can pass the public INP launch budget while still feeling
slightly heavy. In this app, the dashboard synthetic interaction measured the
first visible button on `/dashboard`, which is the sidebar collapse control.
The first evidence run measured 144ms: under the 200ms hard budget, but above
the 100ms premium headroom target.

## Pattern

- Treat shell controls as urgent UI, not background transitions. Do not wrap
  visible sidebar collapse state in `startTransition`.
- Keep persistence off the input path. Write localStorage from an idle callback
  or timeout, but update the visual state immediately.
- Do not make the full app shell subscribe to sidebar collapse state just to
  resize the grid. A document data flag can drive the CSS grid width while the
  sidebar component handles its own collapsed internals.
- Avoid animating layout properties during dense-shell clicks. Padding, gap,
  max-width, width, grid tracks, and max-height create avoidable layout work.
  Prefer opacity, color, transform, or an instant layout snap with a small
  cosmetic fade.
- Persist Core Web Vitals measurements to an ignored report artifact so a green
  run has numbers for review:
  `apps/web/playwright-report/core-web-vitals-latest.json`.

## Verification

- `pnpm --filter @bidstack/web exec eslint src/stores/ui.ts src/stores/ui.test.ts src/components/layout/AppShell.tsx e2e/performance/core-web-vitals.spec.ts`
- `pnpm --filter @bidstack/web test -- src/stores/ui.test.ts src/lib/queryCache.test.ts`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web exec cross-env E2E_WORKERS=1 playwright test e2e/performance/core-web-vitals.spec.ts --project=chromium-desktop --reporter=list`
- `pnpm --filter @bidstack/web exec cross-env E2E_BASE_URL=http://127.0.0.1:1 playwright test e2e/performance/bundle-size-budget.spec.ts --project=chromium-desktop --reporter=list`

## Evidence

Fresh production-preview run after the fix:

- Dashboard INP: 96ms, down from 144ms.
- Dashboard LCP: 912ms.
- Dashboard CLS: 0.0008.
- Dashboard to Leads SPA navigation: 142ms.

Keep the hard INP gate at 200ms unless product standards change, but keep
100ms as the premium headroom target for shell interactions.
