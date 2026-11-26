# Sector pipeline waits for the read

## Problem

The sector pipeline chart treated a missing payload as an empty book. A paused read has `isLoading` false and no rows, so the card said No open pipeline yet. An in-flight read said only that the pipeline was loading.

## Correction

`sectorPipelinePhase` reports unread, failed, or ready. Unread says the chart has not arrived. It does not say there is no open pipeline yet. A failed read stays on the error. A settled empty chart still says no open pipeline yet. A loaded sector still shows.

## Verification

`SectorPipelineCard.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
