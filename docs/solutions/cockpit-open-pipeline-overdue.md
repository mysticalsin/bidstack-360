# Cockpit header says when the open book is already late

## Problem

The account header's open-pipeline line counted open deals and stopped. Demo bids still in flight closed in April–September 2026. On a later day the line read as a current book. A date-only due day is UTC midnight, so elapsed-millisecond rounding also calls the due day itself overdue after noon.

## Solution

`openBookDue` counts open deals whose UTC due day is before today, and the oldest lateness in whole days. A won or lost stage, including a configured pipeline stage, is off the clock. The header line names the days when one deal is late, says "all overdue" when every open deal is late, and names the count when only some are.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/components/cockpit/account-open-due.test.ts src/components/cockpit/OpenPipelineDueLine.test.tsx src/components/cockpit/PageHead.openDue.test.tsx`
