# A follow-up record says when it is late

## Evidence

Demo follow-ups are dated May 2026. The tasks list prints "Overdue: Nd late". Opening the record only printed "Due May 15, 2026", so the lateness disappeared on the way in. A follow-up due today, and one already marked done, are not late.

## Correction

The record counts whole UTC days with the same clock as the due-date chip. An open, in-progress, or blocked follow-up past that day says how many days late, in text, in the danger color. Today, the future, a missing date, and a finished follow-up stay on the date alone.

## Verification

`task-follow-up-late.test.ts` pins 15 May 2026 as 194 days late at 18:00 UTC on 25 Nov 2026, and pins today, the future, done, and a missing date. `TaskDetailPage.test.tsx` renders the May demo title and the overdue sentence, and withholds it for today and done.
