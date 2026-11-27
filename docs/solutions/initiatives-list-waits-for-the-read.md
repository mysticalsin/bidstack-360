# Initiatives list waits for the read

## Problem

The account initiatives board treated a missing payload as a failed load. A paused read has `isLoading` false and no payload, so the board said the initiatives could not be loaded. An in-flight read showed only the skeleton. A failed read, including one that still held a stale initiative, belongs on the error.

## Correction

`initiativesListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say the load failed, and it does not say no initiatives were spotted. A failed read stays on the error and does not keep a stale initiative. A settled empty list stays empty. A loaded initiative still shows.

## Verification

`InitiativesBoard.read.test.tsx`. The paused and in-flight cases failed before the phase check.
