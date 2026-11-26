# A follow-up record waits for the list

## Evidence

`TaskDetailPage` treated `isLoading` as the only unread state. A paused first read has `isLoading` false and no list, so the record said "Task not found" and that the follow-up may have been deleted. An in-flight read showed only the skeleton.

## Correction

`taskRecordPhase` reports unread, failed, missing, or ready. Unread (in flight or paused, no list) says "Checking this follow-up. The follow-up has not arrived." and keeps the skeleton. A failed read stays on "Failed to load task". A settled list that arrived without that id still says "Task not found". A follow-up that arrived still shows.

## Verification

`task-record-read.test.ts` refuses a paused or in-flight read as missing, and still allows a settled miss and an arrived follow-up. `TaskDetailPage.record-read.test.tsx` renders the record without the deleted sentence until the list arrives.
