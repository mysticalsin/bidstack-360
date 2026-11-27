# Meetings list waits for the read

## Evidence

`MeetingsPage` treated a missing list payload as an empty book. A paused first
read has `isLoading` false and no rows, so the page said No meetings yet. An
in-flight read showed only the skeleton.

## Correction

`meetingsListPhase` reports unread, failed, or ready. Unread says the list has
not arrived. It does not say No meetings yet. A failed read still says Couldn't
load meetings. A settled empty list still says No meetings yet. A loaded
meeting still shows.

## Verification

`MeetingsPage.list-read.test.tsx`. The paused and in-flight cases failed before
the phase check.
