# Dashboard bid drill says when an open bid is late

## Context

The Open pipeline sheet labels a column Due and printed a calendar date. Demo bids due in summer 2026 still read as scheduled closes on a later day. Won and lost bids in the same sheet kept a live-looking date.

## Correction

An open bid uses the shared due chip (overdue, due today, or days left) on the UTC day. A won or lost bid keeps the calendar date and stops the clock. A bid with no due date stays an em dash.

## Verification

`apps/web/src/components/drill/OppDrill.test.tsx` renders the sheet on 2026-11-25 and requires the July open bid to say it is overdue, the same-day bid to say due today, a future bid to count days left, and the won and lost bids to stay off that clock.
