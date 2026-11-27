# Territory map waits for the read

## Problem

The territories map treated a missing analytics payload as an empty book. A paused read has `isLoading` false and no countries, so the panel said No geographic data. An idle unread read did the same. An in-flight read still uses the skeleton. A failed read already stays on the error.

## Correction

After the loading and error branches, a missing `analytics.data` says the map has not arrived. It does not say No geographic data. A payload that arrived empty still says No geographic data. A loaded country still draws the map.

## Verification

`TerritoriesPage.map-honesty.test.tsx`. The idle and paused cases failed before the missing-payload branch.
