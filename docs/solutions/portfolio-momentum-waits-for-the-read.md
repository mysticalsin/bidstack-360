# Portfolio momentum waits for the read

## Problem

The portfolio momentum card treated a missing payload as a failed load. A paused read has `isLoading` false and no payload, so the card said the momentum could not be loaded. An in-flight read showed only the skeleton. A failed read, including one that still held a stale account, belongs on the error.

## Correction

`portfolioMomentumPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say the load failed, and it does not say no accounts are here. A failed read stays on the error and does not keep a stale account. A settled empty list stays empty. A loaded account still shows.

## Verification

`PortfolioMomentum.read.test.tsx`. The paused and in-flight cases failed before the phase check.
