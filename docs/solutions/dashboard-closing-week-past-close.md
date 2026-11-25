# Closing this week does not call a past-close book clear

## Problem

The workspace dashboard bid clock lists open bids due in the next 7 days. On the demo book every open bid is already past its close date, so that window is empty. The card then said "No bids closing this week," which reads as a clear week for an open pipeline that is entirely late.

## Solution

When the 7-day read settles empty, the card waits for the overdue read. Open bids from that read are named, oldest due date first, with a currency-free amount, and "View past close" opens `/opportunities?due=overdue`. Decided bids stay off the list. A loading or failed overdue read does not use the clear-week sentence. A bid that is actually due this week stays on the week clock.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/components/dashboard/widgets/ClosingThisWeekCard.test.tsx`
