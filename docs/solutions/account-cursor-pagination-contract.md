# Account Cursor Pagination Contract

## Problem

Portfolio/account pages can look correct in seed data while silently dropping
records at scale when the API is cursor-paginated but the UI only consumes the
first page. Client-side filters on that first slice are especially risky:
industry or owner filters can appear empty even when matching accounts exist on
later backend pages.

## Pattern

- Preserve the backend response envelope in hooks: `{ items, nextCursor }`.
- Send `limit` and `cursor` from the page, and use the shared `CursorPager`
  instead of inventing page controls.
- Push user-selected filters that the API already supports, such as `industry`,
  to the server. Do not filter only the current client slice unless the UI label
  explicitly says it is a current-page filter.
- Pass React Query's `signal` into `api()` so rapid filter changes can abort
  stale in-flight reads.
- For visual summary panels, use a separate bounded signal query when a selected
  filter would otherwise collapse the context needed for comparison.

## Verification

- Add a hook regression test that asserts `limit`, `cursor`, and server-side
  filters are present in the request URL.
- Add or extend browser coverage for the interactive filter panel so a click
  proves the page still renders, the filter applies, and reset works.

## References

- `apps/web/src/hooks/useKeyAccounts.ts`
- `apps/web/src/hooks/useKeyAccounts.pagination.test.tsx`
- `apps/web/src/pages/KeyAccountsPage.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
