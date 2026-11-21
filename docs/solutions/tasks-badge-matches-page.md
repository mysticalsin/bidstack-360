# Tasks badge matches the Tasks page

## Problem

The navigation badge and the Tasks page each counted tasks with their own filter. The badge used the org-wide overdue aggregate (`status <> done` and `due_date < UTC today`). The page listed every non-deleted task and printed `items.length`. A task due on the UTC day was listed and not badged. `formatDate` parsed that `YYYY-MM-DD` as UTC midnight, so America/Sao_Paulo showed the previous calendar day and the row looked overdue.

## Pattern

- One server predicate, `openTasksForUserWhere`, defines open tasks for the signed-in user: this org, this assignee, not deleted, status not `done`. Due date is not part of membership.
- `GET /api/tasks/summary` returns that count as `openForUser`. The sidebar and the mobile nav read it.
- `GET /api/tasks?scope=mine` lists that same where-clause. The Tasks page requests `scope=mine` and shows `openForUser` as the active-task count.
- Create, complete, and delete invalidate `['tasks', 'summary']`.
- Date-only strings format and compare as UTC calendar days. Do not use elapsed milliseconds from UTC midnight, and do not format them in the viewer's zone.

## Verification

```
pnpm --filter @bidstack/api exec vitest run src/routes/open-tasks-for-user.test.ts -t "reproduces badge 7 vs tasks page 8"
```
