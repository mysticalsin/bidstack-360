# Proposal analytics waits for the read

## Evidence

`RfpAnalyticsSection` treated `isLoading` as the only unread state. A paused
first read has `isLoading` false and no payload, so the KPI strip printed 0
and the status card said "No RFPs yet". An in-flight read kept the shimmer
and still counted "0 won · 0 closed".

## Correction

A pending read with no payload says "Checking proposals. The analytics have
not arrived." and does not print a zero book. A failed read stays on "Failed
to load RFP analytics. Please retry." A settled payload with no proposals
still says "No RFPs yet". A payload that arrived still shows the rollup.

## Verification

`RfpAnalyticsSection.read.test.tsx`. The paused and in-flight cases failed
before the pending check.
