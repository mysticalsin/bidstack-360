# Owner drilldown waits for the read

## Problem

The workload desk drilldown treated a missing payload as an empty desk. A paused read has `isLoading` false and no rows, so the row said "No live bids on this desk right now." A read that had not started did the same. An in-flight read was only a shimmer.

## Correction

`ownerDrilldownPhase` reports unread, failed, or ready. Unread says the live bids have not arrived. It does not say the desk has no live bids. A failed read stays on the error. A settled empty desk still says there are no live bids. A loaded bid still shows.

## Verification

`OwnerDrilldown.drill-read.test.tsx`. The paused, not-started, and in-flight cases failed before the phase check.
