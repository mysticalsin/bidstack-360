# Report edit waits for the read

## Evidence

`ReportBuilderPage` treated a missing edit payload as a deleted report. A paused
first read has `isLoading` false and no report, so the page said Report not
found and It may have been deleted. An in-flight read showed only the pulse. A
failed read used the not-found title.

## Correction

`reportEditPhase` reports unread, failed, missing, or ready. Unread says the
report has not arrived. It does not say Report not found, and it does not say
the report was deleted. A failed read says Failed to load this report. A
settled 404 still says Report not found. A loaded report still opens in the
editor.

## Verification

`ReportBuilderPage.edit-read.test.tsx`. The paused, in-flight, and failed cases
failed before the phase check.
