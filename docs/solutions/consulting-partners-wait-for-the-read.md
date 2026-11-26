# Consulting partners wait for the read

## Problem

The consulting partner list treated a missing payload as an empty scan. A paused read has `isLoading` false and no rows, so the list said No consulting partners found. An in-flight read showed only the skeleton.

## Correction

`consultingPartnersReadPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say No consulting partners found. A failed read stays on the error. A settled empty list still says No consulting partners found. A loaded partner still shows.

## Verification

`ConsultingPartnersSection.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
