# Compliance matrix waits for the read

## Problem

The compliance matrix treated a missing payload as an empty fill. A paused read has `isLoading` false and no rows, so the matrix said "No compliance data yet". An in-flight read was only a skeleton.

## Correction

`compliancePhase` reports unread, failed, or ready. Unread says the matrix has not arrived. It does not say "No compliance data yet", and it does not count 0. A failed read stays on the error. A settled empty matrix still says "No compliance data yet". A loaded row still shows.

## Verification

`ComplianceMatrix.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
