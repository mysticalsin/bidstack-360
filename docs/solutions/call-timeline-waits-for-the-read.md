# Call timeline waits for the read

## Problem

The expanded call timeline treated a missing payload as a failed load. A paused read has `isLoading` false and no call, so the card said "Failed to load call details." An in-flight read was only a skeleton. A later failure replaced a summary that had already arrived.

## Correction

`callTimelinePhase` reports unread, failed, or ready. Unread says the detail has not arrived. A failed read with no payload stays on the error. A detail that arrived stays, including when a later read fails. A settled call with no summary still offers re-extract. A settled empty timeline still says no calls were recorded.

## Verification

`CallTimeline.read.test.tsx`. The paused read, the in-flight read, the unannounced failure, and the later failure failed before the phase check.
