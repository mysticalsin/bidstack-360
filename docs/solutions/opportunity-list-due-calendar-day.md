# Opportunity list due dates are calendar days

**Problem:** Demo bids store `dueDate` as a date (`2026-07-22` on OP-2041). The opportunities list printed it with `new Date('YYYY-MM-DD')`, which is UTC midnight. In America/Toronto that instant is still the previous evening, so the Due cell read Jul 21 while the date on the bid stayed the 22nd. The urgency chip's accessible name used the same instant formatter, so it named the wrong day too. The chip's day count was already UTC calendar days.

**Fix:** `formatOpportunityDueDate` prints an exact `YYYY-MM-DD` on that calendar day (`timeZone: 'UTC'`). The list Due cell and the chip's accessible name on that row use it. A value that is not a real calendar date, including 31 February, stays as written. Other surfaces keep the shared instant formatter unless they pass `formatAbsoluteDate`.

**Do not:** format a bid due date with `new Date('YYYY-MM-DD').toLocaleDateString()` on the opportunities list. An updated-at timestamp is an instant and does not belong in this helper.
