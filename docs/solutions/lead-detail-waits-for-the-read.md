# Lead detail waits for the read

## Problem

The lead detail page treated a missing payload as a missing lead. A paused read has `isLoading` false and no record, so the page said Lead not found and that the lead may have been deleted. An in-flight read showed only the skeleton. A failed read used the same deleted sentence.

## Correction

`leadDetailReadPhase` reports unread, failed, missing, or ready. Unread says the record has not arrived. It does not say the lead is not found, and it does not say the lead was deleted. A failed read stays on the error and does not say the lead was deleted. A 404 still says the lead is not found. A loaded lead still shows, including one whose notes field is empty.

## Verification

`LeadDetailPage.read.test.tsx`. The paused, in-flight, failed, and 404 cases failed before the phase check.
