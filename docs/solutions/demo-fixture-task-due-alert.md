# Demo fixture tasks do not raise an overdue due-alert

Open fixture tasks store absolute due dates from 2026-05-12 through 2026-05-23. The task-due scan compares the stored date with today. On a later clock every one of those dates is past, so the assignee gets an overdue nudge and the May rows sort first in the 1000-row batch.

`projectFixtureTaskAlertDue` runs when the mode is exactly `demo`. It slides an open row whose id and due date still match the seed, so the earliest of that set is tomorrow. The gaps stay. The stored row is not changed. Rows whose projected date is after tomorrow are left out of the scan query.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A different id, an edited date, and a done task stay on the stored day. While the seeded dates are still today or later, the shift is zero. An omitted mode treats only exact `POLO_DATA_MODE=real` as real.

The task list and the dashboard overdue count are a separate clock. This scan does not write the task row.
