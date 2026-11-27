# Field catalog waits for the read

## Problem

The report field picker treated a missing payload as the hard-coded schema. A paused read has `isLoading` false and no fields, so the list showed Status. An in-flight read did the same. A failed read did the same, including when a stale Status field was still in hand.

## Correction

`fieldListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not show the hard-coded schema. A failed read stays on the error and does not keep a stale field. A settled empty catalog still says no fields were found. A loaded field still shows.

## Verification

`FieldPicker.read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
