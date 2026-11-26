# Relation list waits for the read

## Problem

The custom object relation list treated a missing payload as a missing list. A paused read has `isLoading` false and no rows, so the section rendered nothing. An in-flight read rendered nothing. A failed read rendered nothing.

## Correction

`relationsListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not go blank. A failed read stays on the error. A settled empty list still says no relations are defined yet. A loaded relation still shows.

## Verification

`RelationsSection.list-read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
