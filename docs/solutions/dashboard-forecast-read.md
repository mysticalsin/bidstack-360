# Dashboard revenue chart waits for the forecast read

## Problem

The workspace dashboard revenue tab draws won bids from the bid rows and treats a missing forecast projection as "No target set yet." While that read is loading, or when it fails before any payload arrives, the tab looks like a finished forecast with nothing to compare.

## Solution

Until the projection payload is on screen, the revenue tab says the forecast is loading, or that it could not be loaded, and offers retry. A payload already on screen stays if a later refresh fails. "No target set yet" is only the settled result when the read returned and no commit is set.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/components/dashboard/PerformanceCard.forecastRead.test.tsx src/components/dashboard/PerformanceCard.test.tsx`
