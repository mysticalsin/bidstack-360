# Workload page waits for the read

## Problem

The team workload page treated a missing payload as an empty team. A paused read has `isLoading` false and no owners, so the tiles said 0 and the page said "No live bids on any desk." A read that had not started did the same. An in-flight read showed those zeros above a shimmer. A failed read kept the zeros next to the error. A refresh that failed after a desk arrived replaced that desk with the load error.

## Correction

`workloadPagePhase` reports unread, failed, or ready. Unread says the desks have not arrived. It does not say the team has no live bids, and it does not show 0. A failed read with no payload stays on the error and does not show 0. A payload already in hand stays, including when a later refresh fails. A settled empty team still says there are no live bids. A loaded desk still shows.

## Verification

`WorkloadPage.desk-read.test.tsx`. The paused, not-started, in-flight, failed, and failed-refresh cases failed before the phase check.
