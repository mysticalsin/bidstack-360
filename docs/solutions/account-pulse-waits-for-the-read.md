# Account pulse waits for the read

## Problem

The account pulse card treated a missing payload as a failed load. A paused read has `isLoading` false and no payload, so the card said the pulse could not be loaded. An in-flight read showed only the skeleton. A failed read, including one that still held a stale pulse, belongs on the error.

## Correction

`accountPulsePhase` reports unread, failed, or ready. Unread says the record has not arrived. It does not say the load failed, and it does not show a score. A failed read stays on the error and does not keep a stale pulse. A settled pulse with no drivers stays on that pulse. A loaded pulse still shows.

## Verification

`PulseHero.read.test.tsx`. The paused and in-flight cases failed before the phase check.
