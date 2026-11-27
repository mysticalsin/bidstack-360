# Calendar deadlines wait for the read

## Evidence

The deadlines lane treated a missing payload as an empty week. A paused first read has `isLoading` false and no rows, so the lane said No deadlines. An in-flight read showed only the skeleton. A bid team would plan the week as if nothing is due.

## Correction

`calendarDeadlinesPhase` reports unread, failed, or ready. Unread says the deadlines have not arrived. It does not say No deadlines. A failed read says Could not load deadlines. A settled empty week still says No deadlines. A deadline that arrived still shows.

## Verification

`DeadlinesRow.unread.test.tsx`. The paused read and the in-flight read failed before the phase check.
