# Cross-sell log waits for the read

## Problem

The org cross-sell log treated a missing payload as an empty book. A paused read has `isLoading` false and no rows, so the page said No cross-sell actions and counted 0. An in-flight read showed zero counts and only the loading skeleton. A failed read still counted 0 and said there was no dated action.

## Correction

`crossSellReadPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say there are no actions, and it does not count 0. A failed read stays on the error. A settled empty log still says there are no actions and still counts 0. A loaded action still shows.

## Verification

`CrossSellPage.read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
