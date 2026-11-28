# Dashboard activity late clock

## Problem

The workspace dashboard recent-activity feed listed open follow-ups and open bids with a created-at or updated-at stamp. Under the demo book those rows are already past due (follow-ups in May 2026, open bids through September 2026), so the feed read as ordinary recent work.

## Pattern

- Carry the due date on the CRM summary activity row. A missing date stays null.
- Keep the task status and the bid stage on the same row so a done follow-up or a won/lost bid does not stay on the late clock.
- Count lateness in whole UTC days. A row due today is not late.
- Say the lateness in text (`Nd overdue`) on the tomato badge tokens. The record link stays `/tasks/:id` or `/opportunities/:id`.

## Example

- `GET /api/crm/summary` activity items include `dueDate`.
- `RecentActivityCard` renders the late badge only for an open follow-up or an open bid whose due date is a previous UTC day.

## Verification

- `apps/web` `activity-late.test.ts` and `RecentActivityCard.test.tsx`
- `apps/api` `summary-activity.test.ts`
