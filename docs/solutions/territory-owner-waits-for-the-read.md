# Territory owners wait for the read

## Problem

The new-territory owner picker treated a missing payload as an empty list. A paused read has `isLoading` false and no owners, so the control said Select an owner. An in-flight read did the same. A failed read did the same, including when a stale owner was still in hand.

## Correction

`territoryOwnerPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not show the empty placeholder. A failed read stays on the error and does not keep a stale owner. A settled empty list still says Select an owner. A loaded owner still shows.

## Verification

`TerritoryDialog.read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
