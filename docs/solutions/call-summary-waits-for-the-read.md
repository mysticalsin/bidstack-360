# Call summary waits for the read

## Problem

The call summary panel treated a missing payload as a missing summary. A paused read has `isLoading` false and no call, so the panel rendered nothing. An in-flight read was only a skeleton.

## Correction

`callSummaryPhase` reports unread, failed, or ready. Unread says the summary has not arrived. It does not go blank. A failed read stays on the error. A settled call with no transcript still says the transcript is not available. A loaded summary still shows.

## Verification

`CallSummaryPanel.read.test.tsx`. The paused and in-flight cases failed before the phase check.
