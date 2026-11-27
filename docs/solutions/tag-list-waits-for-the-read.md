# Tag list waits for the read

## Problem

The entity tag list treated a missing payload as an empty record. A paused read has `isLoading` false and no tags, so the picker showed only the Tag button. An in-flight read did the same. A failed read did the same, including when a stale tag was still in hand.

## Correction

`tagListPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not show the Tag button. A failed read stays on the error and does not keep a stale tag. A settled empty list still shows the Tag button. A loaded tag still shows.

## Verification

`TagPicker.read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
