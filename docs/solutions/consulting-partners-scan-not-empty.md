# Consulting partner scan is not an empty list

## Problem

`consulting_partners` returned `partners: []` when the scan had never run, was still queued or running, or had failed with no rows. Jarvis read that as no consulting partners.

## Correction

A scan that has not arrived omits `partners` and says the list has not arrived. A failed scan with no rows says the load failed. A settled scan, including one that skipped public fetch, still returns `partners`, and an empty array means none were found. Rows already stored stay, even if a later rescan is running or failed.

## Verification

`consulting-partners-read.test.ts`. The never, in-flight, and failed cases failed before the scan status was checked.
