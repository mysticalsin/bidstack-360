# UX/UI Premium Audit - 2026-06-13

## Scope

Surfaces audited: `apps/web` dashboard, pipeline, and opportunities flows in local stub auth.
Viewports checked: desktop default browser viewport and mobile `390x844`.
Benchmark lens: premium CRM/RFP command-center patterns from Salesforce Sales Cloud, HubSpot Sales, Pipedrive, Attio, Responsive, and Loopio.

## Success Criteria

- Direct local visits render the authenticated app shell in stub auth mode.
- Key routes have no app console errors; expected third-party reduced-motion warnings are acceptable in reduced-motion browser environments.
- Mobile routes have no page-level horizontal overflow.
- Pipeline columns keep the product-spec minimum useful width instead of cramping cards.
- Shared primitives feel restrained and enterprise-grade, without continuous ambient glow/shimmer.
- Verification gates pass: lint, typecheck, focused UI tests, production web build.

## Fixed Issues

1. Dev startup was blocked by Vite dependency optimization errors from modern route-only dependencies.
   - Fix: `apps/web/vite.config.ts` now sets `optimizeDeps.esbuildOptions.target = 'esnext'`.

2. Stub auth could show the public/login shell on direct local visits when no prior session key existed.
   - Fix: `apps/web/src/lib/auth.tsx` now defaults to the stub user unless the user explicitly signed out.
   - Test coverage updated in `apps/web/src/lib/auth.test.tsx`.

3. Shared buttons and cards had dark-mode glow/shimmer that read less premium in dense enterprise UI.
   - Fix: `apps/web/src/components/ui/Button.tsx` and `apps/web/src/components/ui/Card.tsx` now use restrained token shadows.

4. The topbar sign-out control used a visible text glyph.
   - Fix: `apps/web/src/components/ui/Icon.tsx` adds a real `logOut` icon and `apps/web/src/components/layout/Topbar.tsx` uses it.

5. Pipeline desktop columns were too cramped for stage labels and deal cards.
   - Fix: `apps/web/src/pages/PipelinePage.tsx` now uses a horizontal rail with `280px` minimum columns when unfiltered.

6. Cockpit customization exposed a phantom `Contractual agreements` toggle for a block not rendered on the cockpit page.
   - Fix: removed that unused catalog entry from `apps/web/src/stores/cockpitLayout.ts`.

7. Long-lived pages could require a logout/login after sitting open because stale Clerk tokens returned 401/403 and React Query was configured not to recover on tab focus.
   - Fix: `apps/web/src/lib/api.ts` retries one 401/403 with a forced token refresh.
   - Fix: `apps/web/src/lib/auth.tsx` maps forced refresh to Clerk `getToken({ skipCache: true })`.
   - Fix: `apps/web/src/main.tsx` restores stale-query refetch on window focus and reconnect.
   - Test coverage updated in `apps/web/src/lib/api.test.ts` and `apps/web/src/lib/auth.test.tsx`.

8. Full Vitest runs printed non-fatal happy-dom fetch teardown noise after passing.
   - Fix: `apps/web/src/hooks/useFormatMoney.ts` and `apps/web/src/hooks/useDisplayMoney.ts` skip only their automatic exchange-rate fetch in test mode.
   - Explicit currency/store tests still call and verify `fetchRates()` directly.

## Verification

- `pnpm --filter @bidstack/web lint` - pass
- `pnpm --filter @bidstack/web typecheck` - pass
- `pnpm --filter @bidstack/web test` - pass, 43 files / 282 tests, no teardown AbortError
- `pnpm --filter @bidstack/web exec vitest run src/lib/api.test.ts src/lib/auth.test.tsx src/pages/OpportunitiesPage.test.tsx` - pass, 3 files / 13 tests
- `pnpm --filter @bidstack/web build` - pass
- `pnpm --filter @bidstack/web exec playwright test e2e/performance/bundle-size-budget.spec.ts --reporter=line` - pass, 4 tests
- Browser routes checked with no app console errors. The only browser warning observed was Framer Motion reporting that reduced motion was enabled in the test browser:
  - `http://localhost:5173/dashboard`
  - `http://localhost:5173/pipeline`
  - `http://localhost:5173/opportunities`
- Mobile `390x844` overflow check:
  - dashboard: `0px` page-level horizontal overflow
  - pipeline: `0px` page-level horizontal overflow; intended internal board rail remains scrollable
  - opportunities: `0px` page-level horizontal overflow
- Pipeline rail metrics:
  - desktop client width `1004px`, scroll width `1740px`, first five columns `280px`
  - mobile client width `362px`, scroll width `1740px`, first three columns `280px`

## Evidence

Screenshots saved in `D:\BIDCRM\artifacts\ux-audit-2026-06-13\`:

- `01-dashboard-desktop.png`
- `03-opportunities-desktop.png`
- `04-dashboard-mobile.png`
- `06-pipeline-desktop-after.png`
- `07-pipeline-mobile-after.png`

## Remaining Issues

1. Production chunks remain heavy and deserve a dedicated performance pass:
   - `vendor`: `687.28 kB` raw / `207.00 kB` gzip
   - `editor`: `392.45 kB` raw / `124.43 kB` gzip
   - `motion`: `260.52 kB` raw / `85.22 kB` gzip
   - `index`: `256.55 kB` raw / `71.67 kB` gzip

2. The in-app browser screenshot call timed out during the first audit pass, so visual evidence was captured with the local Playwright project instead.

## Verdict

The audited front-end surfaces now meet the premium UX bar for local demo use: app shell loads correctly, long-lived auth recovers without forcing a relogin, key flows are visually stable, pipeline density is fixed, shared primitives are calmer, and quality gates are green. Remaining work is a dedicated performance pass rather than a blocking visual defect on the checked routes.
