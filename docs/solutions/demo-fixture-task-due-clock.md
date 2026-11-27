# Demo fixture tasks stay on the bid clock

Open fixture tasks store absolute due dates from 2026-05-12 through 2026-05-23. On a later clock every one of those dates is past, so the task calendar for the current month is empty, due-soon is 0, and the overdue badge counts the whole set.

`projectFixtureTaskDueDate` runs when the mode is exactly `demo`. It slides an open row whose id and due date still match the seed, so the earliest of that set is tomorrow. The gaps stay. The stored row is not changed.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A different id, an edited date, and a done task stay on the stored day. While the seeded dates are still today or later, the shift is zero.

The task list, the task summary, and the dashboard overdue count use that clock. The shift is added as `due_date + shift::integer`. Prisma binds the number as bigint, and Postgres has no `date + bigint` operator. The workload aggregate and the due-alert worker still read the stored date.
