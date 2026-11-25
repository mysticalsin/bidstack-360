# A follow-up due today is not overdue after noon

## Evidence

Task `dueDate` is a calendar day (`YYYY-MM-DD`). The dashboard overdue count uses `due_date < today`. The tasks list, the row label, and the calendar tint used elapsed milliseconds, so after 12:00 UTC a follow-up due today read as 1 day late. Needs you could say nothing is overdue and the list it opens (`/tasks?filter=overdue`) still showed that follow-up.

## Correction

`daysUntil` counts a date-only value in whole UTC days. The due day stays 0 until the next UTC date. A timestamp still uses elapsed-time rounding, so a results clock that carries a time is unchanged.

## Verification

`apps/web/src/lib/format.test.ts` pins today, yesterday, and tomorrow at 18:00 UTC, and pins the timestamp path. `apps/web/src/pages/TasksPage.test.tsx` opens the overdue and today filters at that same instant.
