# Mine keeps the signed-in person's follow-ups

## Evidence

A new demo org filed every follow-up on Sofia, Marco, or Priya. The signed-in visitor is stored as ME and owned none of them. The fixture book assigns "Submit revised pricing & SoW v2" to Alex Example and the Logistec workshop to Blake Sample. The tasks list showed both, and nothing on the page kept only the signed-in person's rows.

## Correction

The Siemens technical volume is filed on the visitor. IKEA stays with Marco. The tasks list has a Mine chip. It keeps rows whose assignee address matches the signed-in person, ignoring case. An unassigned follow-up is not a match. A missing address says the page could not tell which follow-ups are yours. An empty Mine view that still has other people's rows says so, and hides quick-add, because a new follow-up is unassigned and would not appear there.

## Verification

`apps/web/src/components/task/task-own-filter.test.ts` keeps Alex's pricing follow-up and drops Blake's. `apps/web/src/pages/TasksPage.mine.test.tsx` renders that cut and the empty captions. `packages/db/src/demo-follow-up-owners.test.ts` pins the Siemens follow-up on ME and the IKEA follow-up on MB.
