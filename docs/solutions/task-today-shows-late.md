# Today says when the follow-ups are already late

## Evidence

Demo follow-ups are dated May 2026. On 25 Nov 2026 the Today chip matches none of them. The empty title was "No tasks match this filter", so the late work looked like an empty book. Today is not a server filter: those rows are still on the loaded page. The quick-add under that empty view files an open follow-up, which Today still does not show, so the save reads as a miss.

## Correction

An empty Today view that still has open follow-ups before today says how many are already late in this list and offers Show overdue. That button uses the same Overdue chip. A finished follow-up is not counted. The quick-add stays hidden on an empty Today, Overdue, or status view. All, Open, and a filter that already lists rows keep it.

## Verification

`apps/web/src/components/task/task-list-empty.test.ts` counts the two May demo follow-ups and leaves a finished one and a December one out. `apps/web/src/pages/TasksPage.today-empty.test.tsx` renders the empty Today view for "Submit revised pricing & SoW v2", withholds the quick-add, and opens that row from Show overdue.
