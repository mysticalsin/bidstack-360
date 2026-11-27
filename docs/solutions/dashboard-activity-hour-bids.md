# Dashboard activity hour opens the bid

## Problem

The workspace dashboard activity-by-hour chart counted the latest activities and named the busiest hour. Demo calls, emails, meetings, and notes are filed on bids. The chart stopped at the count, so "Exec sponsor catch-up" at 14:00 could not be opened. A read that was still loading, or had failed, used the empty-log sentence.

## Pattern

- Bucket the same viewer-zone hour the chart uses. Order rows by time of day, then by calendar day.
- An opportunity activity links to `/opportunities/:id`. A blank subject reads "Open the bid". A record that is not a bid stays text, with no invented opportunity route.
- The busiest hour's work is shown. Other hours that have activity are chips.
- Loading and error copy name that state. A failed read has Retry. The empty sentence is only for a settled read with nothing logged.

## Verification

- `apps/web` `activity-hour-bids.test.ts` and `ActivityByHourCard.test.tsx`
