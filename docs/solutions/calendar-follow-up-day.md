# Open follow-ups fill the calendar day

**Problem:** Demo seed files open follow-ups inside the current week (pricing annex, security questionnaire) and a finished handover on Monday. The calendar lane only reads bid and proposal due dates, which sit 30 and 45 days out, so Saturday and Sunday paint empty.

**Fix:** `GET /calendar/deadlines` adds open, in-progress, and blocked follow-ups whose due day is inside the window, and only when the caller can read tasks. A done row is not a chip. A blank title becomes `Follow-up`. The chip opens `/tasks/:id` and does not say Google or Microsoft.

**Do not:** paint a finished follow-up on its old day, or copy follow-ups for a caller who cannot read tasks.
