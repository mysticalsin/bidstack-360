# Service case detail waits for the read

## Evidence

`ServiceCaseDetailPage` treated `isLoading` as the only unread state. A paused
first read has `isLoading` false and no case, so the page said "Case not
found" and that the case may have been deleted. An in-flight read showed the
skeleton and did not say the case had not arrived.

## Correction

`serviceCaseRecordPhase` reports unread, failed, missing, or ready. Unread
(in flight or paused, no case) says "Checking this case. The case has not
arrived." and keeps the detail skeleton. A failed read stays on "Failed to
load case". A settled success with no record still says "Case not found" and
that the case may have been deleted. A case that arrived still shows.

## Verification

`ServiceCaseDetailPage.record-read.test.tsx`. The paused and in-flight cases
failed before the phase check.
