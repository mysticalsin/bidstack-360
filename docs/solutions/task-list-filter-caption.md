# The tasks header counts the chip, not the loaded page

## Evidence

Demo follow-ups are dated May 2026. On 25 Nov 2026 the Today chip matches none of them, so the list is empty. The header still said "1 active follow-ups" from the loaded page. Overdue has the same split: a December follow-up stays off that chip, and the header kept counting it.

## Correction

Today and Overdue use the number of rows that chip is showing. An empty Today view says "Nothing due today." An empty Overdue view says "Nothing overdue in this list." One row uses the singular sentence. All and the status chips still use the loaded length.

## Verification

`apps/web/src/components/task/task-list-caption.test.ts` pins the empty Today book, the overdue count, and the All boundary. `apps/web/src/pages/TasksPage.filter-caption.test.tsx` renders Today for "Submit revised pricing & SoW v2" and Overdue with that row beside a December follow-up.
