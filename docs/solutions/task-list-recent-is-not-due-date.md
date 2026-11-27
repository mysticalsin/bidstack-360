# Recent on the tasks list is not the due-date page

## Evidence

`GET /api/tasks` orders by due day ascending. The tasks page labeled that order Recent. On the Polo book, Schedule Aritzia kickoff (due 12 May 2026) stayed above Architecture workshop, DNB (filed 10 May) until the person chose Due date, and that choice did not move a row.

## Correction

Recent reorders the loaded page by `createdAt` descending unless the person has dragged a row. Due date orders by the due day, earliest first, and leaves a missing day last. A drag applies only to Recent.

## Verification

`apps/web/src/components/task/task-list-order.test.ts` and `apps/web/src/pages/TasksPage.order.test.tsx`.
