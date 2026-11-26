# Setup guide waits for the read

## Problem

The connection command center treated a missing contract as a failed load. A paused read has `isLoading` false and no contract, so the card said the setup guide could not be loaded. An in-flight read showed only the skeleton. A failed read, including one that still held a stale guide, belongs on the error.

## Correction

`connectionGuidePhase` reports unread, failed, or ready. Unread says the contract has not arrived. It does not say the load failed, and it does not say the guide needs setup or that Dust is off. A failed read stays on the error and does not keep a stale guide. A settled guide that still needs setup stays on that guide. A loaded guide still shows.

## Verification

`ConnectionCommandCenter.read.test.tsx`. The paused and in-flight cases failed before the phase check.
