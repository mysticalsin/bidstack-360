# Intake documents wait for the read

## Problem

The intake receive step treated a missing payload as a blank document list. A paused read has `isLoading` false and no rows, so the step rendered no list status. An in-flight read showed only the loading shimmer.

## Correction

`receiveDocumentsPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say there are no documents yet. A failed read stays on the error. A settled empty list still says no documents yet. A loaded document still shows.

## Verification

`ReceiveStep.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
