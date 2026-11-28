# The task calendar opens on the month that holds the follow-ups

## Evidence

Demo follow-ups are due in May 2026. On 25 Nov 2026 the calendar opened on November, so the grid was empty. A day chip linked to `/tasks?search=…`, and the tasks page does not read `search`, so the click landed on the unfiltered list. While the read was in flight, the same empty month painted, and a failed read did too.

A date-only due day is a UTC calendar day. Parsing it with the local date moved the chip to the previous day west of UTC.

## Correction

The calendar waits for the task read. It opens on the current UTC month when that month has an open follow-up. Otherwise it opens on the latest month in the loaded list that still has one, or the next month that has one. Done follow-ups do not move the grid. A day chip opens `/tasks/:id`. The due day is the UTC day.

## Verification

`apps/web/src/components/task/task-calendar-focus.test.ts` pins the month choice and the record path. `TaskCalendar.test.tsx` renders May 2026, the day-15 chip, and the reason line. `TasksPage.test.tsx` holds the calendar while the read is pending, shows the load error, and opens the May follow-up.
