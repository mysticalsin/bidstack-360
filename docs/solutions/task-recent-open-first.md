# Recent does not lead with a finished follow-up

## Evidence

The tasks route returns due-day order. On the demo book the Stellantis handover is done and dated 23 Nov 2026. The IKEA pricing annex is still open on 28 Nov. Recent is the default and kept that loaded order, so the finished handover led the list.

## Correction

Recent puts unfinished rows first and keeps the loaded order inside that group. Finished rows follow, in the order they were loaded. A blocked row stays with the unfinished rows. A saved drag still wins, including a drag that leaves the handover first. Due date and Status are unchanged.

## Verification

`apps/web/src/components/task/task-recent-order.test.ts` pins the demo order and the loaded-order rule. `apps/web/src/pages/TasksPage.recent-order.test.tsx` renders Recent for that book and the dragged handover.
