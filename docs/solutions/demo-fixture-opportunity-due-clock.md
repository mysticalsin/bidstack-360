# Demo fixture opportunity due dates stay on the bid clock

Open fixture deals store absolute due dates from 2026-06-30 through 2026-09-30. After the last of those days, Closing this week is empty and every open fixture card is overdue. A restored demo snapshot keeps the dates.

`projectFixtureOpportunityDueDate` runs only when the mode is exactly `demo`. It slides an open row whose code and due date still match the seed, so the earliest of that set is tomorrow. The gaps stay. A different code, an edited date, a closed stage, and `real` stay on the stored day. Nothing is written back.

The list filter, the calendar, the forecast quarter, the workload 7-day count, and the dashboard close date use that clock. A live row beside a fixture row keeps its stored date.
