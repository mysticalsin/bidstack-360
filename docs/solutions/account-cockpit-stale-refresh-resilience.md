# Account Cockpit Stale Refresh Resilience

## Problem

Account cockpits are long-lived work surfaces. A user may leave a page open for
hours while browser focus, auth refresh, API availability, or Vite proxy state
changes. A later background refresh can fail even though the page already has a
valid account snapshot.

If the UI treats every query error as fatal, it turns a transient refresh failure
into a perceived CRM crash.

## Solution

- Separate initial-load failure from background-refresh failure.
- Render a fatal empty/error state only when no trusted snapshot exists.
- When stale data exists, keep the cockpit visible and show an inline refresh
  warning with a Retry action.
- Keep the warning specific: "live refresh failed" is materially different from
  "this account cannot load."
- Add regression tests for both paths:
  - no snapshot + error => fatal page state
  - snapshot + refetch error => cockpit remains visible

## Implementation Notes

- React Query exposes both cached `data` and error state. Use both.
- Do not hide stale data behind a full-page loader or error shell.
- When an enrichment panel has missing vendor data, queue bounded refresh work
  rather than blocking the cockpit render.
- Deduplicate per-page refresh attempts so the browser cannot spam the queue
  during rerenders.

## Verification

- `pnpm --filter @bidstack/web exec vitest run src/pages/DashboardPage.test.tsx`
- Browser smoke on the affected account page.
- Direct API/proxy request to the affected dashboard endpoint.
