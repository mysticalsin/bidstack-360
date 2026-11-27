# Reports list waits for the read

## Evidence

`ReportsListPage` treated a missing list payload as an empty catalog. A paused
first read has `isLoading` false and no rows, so the page said No reports found,
counted 0 saved reports, and announced 0 reports. An in-flight read showed only
the pulse.

## Correction

`reportsListPhase` reports unread, failed, or ready. Unread says the list has
not arrived. It does not say No reports found, and it does not count 0. A failed
read still says Failed to load reports. A settled empty list still says No
reports found and still counts 0. A loaded report still shows.

## Verification

`ReportsListPage.list-read.test.tsx`. The paused and in-flight cases failed
before the phase check.
