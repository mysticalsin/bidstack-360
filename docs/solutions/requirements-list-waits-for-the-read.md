# Extracted requirements wait for the read

## Problem

The extracted requirements list treated a missing payload as an empty extract. A paused read has `isLoading` false and no rows, so the list said "No requirements yet". A read that had not started did the same. An in-flight read was only a skeleton.

## Correction

`requirementsListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say "No requirements yet", and it does not count 0. A failed read stays on the error. A settled empty list still says "No requirements yet". A loaded requirement still shows.

## Verification

`RequirementsList.list-read.test.tsx`. The paused, not-started, and in-flight cases failed before the phase check.
