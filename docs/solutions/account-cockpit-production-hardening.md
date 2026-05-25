# Account Cockpit Production Hardening

## Problem

Account detail pages can lose user trust when they render the wrong account,
let paid enrichment run without an admin gate, or create horizontal overflow on
mobile and desktop. The cockpit also mixed account-scoped sections with
portfolio-wide benchmarks without clearly labeling the scope.

## Solution

- Keep `/accounts/:id` backed by `/api/crm/dashboard?account=:id`, but return
  404 when the requested account id or normalized account name is not present.
- Gate paid company enrichment behind `requireRole('admin')` and a tighter
  per-user route rate limit.
- Label non-account-scoped panels as portfolio views instead of pretending they
  are account-specific.
- Add semantic account status chips for health, confidence, refresh age, and
  opportunity linkage.
- Defend the shell against overflow: collapse secondary topbar labels on small
  screens, contain wide sales tables in their scroll wrappers, let the health
  card stack before it pushes the right rail, and set grid children to
  `min-width: 0`.

## Verification

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web test`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/api lint`
- `pnpm --filter @bidstack/api test -- crm/dashboard.test.ts crm/companies.test.ts`
- `pnpm --filter @bidstack/web e2e -- account-detail.spec.ts accounts.spec.ts --project=chromium-desktop --reporter=list --trace=off`

## Notes

- For viewport validation, assert `scrollWidth <= clientWidth + 1` on both
  desktop and mobile. Then inspect element-level overflow only if the page-level
  guard fails.
- When a link name is a substring of other navigation items, use exact role
  matching in Playwright, for example `{ name: 'Accounts', exact: true }`.
