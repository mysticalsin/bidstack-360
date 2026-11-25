# A follow-up names the bid it is filed on

## Evidence

The demo follow-up "Submit revised pricing & SoW v2" is filed on CI Financial — IT Modernization & MSP. The task title does not say that. The tasks list had no bid link. The record's link said "Opportunity", so opening the follow-up still hid which bid the late work belongs to.

## Correction

`GET /api/tasks` and `GET /api/tasks/:id` include `opportunityName` when that bid belongs to the caller's org. A blank name or another org's bid is null. The list and the record link that name to `/opportunities/:id`. The record still says "Opportunity" when the follow-up has a bid id but no name. Create does not accept the field. The title link and the bid link are each at least 24px, because axe target-size on `/tasks` fails when those two undersized links touch.

## Verification

`packages/shared/src/schemas/task.test.ts` keeps the name optional, accepts null, and rejects a blank string. `apps/api/src/routes/task-opportunity-title.test.ts` pins the org check. `apps/web/src/components/task/task-bid-link.test.ts` pins the label. `TasksPage.test.tsx` and `TaskDetailPage.test.tsx` render the CI Financial link for the demo pricing follow-up.
