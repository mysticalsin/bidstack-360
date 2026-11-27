# A follow-up record can move its due day

## Evidence

Demo follow-up "Submit revised pricing & SoW v2" is due 15 May 2026. Edit on the record changes the title and the status. The due day is not a field, so Save cannot move the day that makes the follow-up late. A rename must not also send the date.

## Correction

Edit shows the due day. Save sends that day only when it changed. An empty date clears it. A value that is not a calendar day is left out. Title and status stay on the same patch, and an unchanged draft still sends nothing.

## Verification

`apps/web/src/components/task/task-detail-patch.test.ts` pins the May demo day, a cleared day, a rename, and a non-date. `apps/web/src/pages/TaskDetailPage.reschedule.test.tsx` opens Edit on that follow-up, moves the day, clears it, and renames without rescheduling.
