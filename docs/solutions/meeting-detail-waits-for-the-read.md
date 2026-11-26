# Meeting detail waits for the read

## Problem

The meeting detail page treated a missing payload as a failed load. A paused read has `isLoading` false and no record, so the page said Couldn't load this meeting. An in-flight read showed only the skeleton.

## Correction

`meetingDetailReadPhase` reports unread, failed, missing, or ready. Unread says the record has not arrived. It does not say the meeting is not found, and it does not say the load failed. A failed read stays on the error. A 404 still says the meeting is not found. A settled meeting with no notes still says that. A loaded meeting still shows.

## Verification

`MeetingDetailPage.read.test.tsx`. The paused and in-flight cases failed before the phase check.
