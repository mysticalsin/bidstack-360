# Strategic and top accounts name a past close

## Evidence

Strategic Accounts and Top accounts summed open deals and pipeline without a close-date clock. The demo key account CI Financial still has an open bid due 2026-07-22. On a later day that row read as a current open deal. The All-accounts cards are a different list and were not this surface.

## Correction

`overdueDeals` counts open deals whose `due_date` is before today (UTC). Today and a missing date are not late. Won and lost deals stay out. The key-account aggregate and the auto top-account query both use that day. Each row and the page open-deals tile say the count, and the cockpit link names it.

## Verification

`accounts.overdue.test.ts`, `AccountsKeySegment.overdue.test.tsx`, `AccountsTopSegment.overdue.test.tsx`, and the existing key-account page-scope test.
