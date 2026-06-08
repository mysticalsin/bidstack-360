# Account Cockpit Tab-Discard Fallback

## Problem

Account cockpit pages are long-lived work surfaces. React Query can keep stale
data visible during a background refresh failure, but that does not help if the
browser discards or reloads the tab after a long idle. In that case, the
in-memory query cache is gone and a single transient `500` can render the fatal
cockpit error even though the user had already loaded a valid account.

## Solution

- Store only the last schema-validated account dashboard snapshot in
  `sessionStorage`, keyed by account id.
- On account pages, use that tab-local snapshot only when the live dashboard
  request fails with a transient network/5xx error.
- Do not use the fallback for 4xx failures such as missing accounts or
  authorization problems.
- Clear account cockpit session snapshots from the existing auth cache cleanup
  path so a same-tab logout/user switch cannot briefly show stale account data.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx src/lib/queryCache.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- Browser smoke on the affected account page with no fatal cockpit error and no
  console errors.
