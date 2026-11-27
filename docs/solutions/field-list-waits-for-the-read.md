# Field list waits for the read

## Problem

The custom object field list treated a missing payload as an empty list. A paused read has `isLoading` false and no rows, so the section said no custom fields yet. An in-flight read said only that fields were loading.

## Correction

`fieldsListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say there are no custom fields yet. A failed read stays on the error. A settled empty list still says no custom fields yet. A loaded field still shows.

## Verification

`FieldsSection.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
