# Toolkit library waits for the read

## Problem

The stored toolkit library treated a missing payload as an empty catalog. A paused read has `isLoading` false and no rows, so the library said "No stored toolkits yet". An in-flight read was only a skeleton.

## Correction

`toolkitStorePhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say "No stored toolkits yet". A failed read stays on the error. A settled empty library still says "No stored toolkits yet". A loaded toolkit still shows.

## Verification

`ToolkitStoreSection.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
