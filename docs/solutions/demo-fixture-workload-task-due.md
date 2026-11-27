# Demo fixture tasks do not mark a desk over capacity

Open fixture tasks store absolute due dates from 2026-05-12 through 2026-05-23. The workload overdue count compares the stored date with today. On a later clock every one of those dates is past. Three overdue follow-ups mark a desk over capacity, and one owner holds three of these tasks.

`fixtureWorkloadTasksNotOverdue` runs when the mode is exactly `demo`. It names an open row whose id and due date still match the seed, once that date projects onto today or later. The earliest of that set lands on tomorrow. The gaps stay. The stored row is not changed. The overdue query leaves those rows out.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A different id, an edited date, and a done task stay on the stored day. While the seeded dates are still today or later, the list is empty. The route passes `getPoloDataMode`, so an unset mode is demo and exact `real` is not.

This count does not write the task row. It does not change the bid close-within-7-days count on the same route.
