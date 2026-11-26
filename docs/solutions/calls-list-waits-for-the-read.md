# Calls list waits for the read

## Evidence

`CallsPage` treated a missing list payload as an empty book. A paused first
read has `isLoading` false and no rows, so the page said No calls found and
counted 0 calls. An in-flight read showed only the skeleton.

## Correction

`callsListPhase` reports unread, failed, or ready. Unread says the list has
not arrived. It does not say No calls found, and it does not count 0. A failed
read still says Failed to load calls. A settled empty list still says No calls
found and still counts 0. A loaded call still shows.

## Verification

`CallsPage.list-read.test.tsx`. The paused and in-flight cases failed before
the phase check.
