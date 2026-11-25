# A due alert opens the follow-up record

## Evidence

Demo follow-up "Submit revised pricing & SoW v2" is due 15 May 2026. On 25 Nov 2026 the hourly scan marks it overdue and stores that marker in `Notification.url`. The bell navigates to that URL. The marker was `/tasks?taskId=<id>&due=<day>`. The tasks list reads `filter`, `sort`, and `view`. It does not read `taskId`, so Open dropped the assignee on the unfiltered list. The record is `/tasks/:id`.

## Correction

The marker the scan writes is `/tasks/<id>?due=<day>`. The day stays on the query, so a follow-up that is still late tomorrow does not match today's row. A row already stored with the list query still counts as sent today, so the first scan after this change does not nudge twice.

## Verification

`apps/worker/src/queues/task-kam-alerts.helpers.test.ts` pins the May demo id on 25 Nov 2026 to the record URL, a different URL the next day, and the old list query. `apps/worker/src/queues/task-kam-alerts.test.ts` writes that URL for the demo follow-up and skips the write when the old list query is already stored.
