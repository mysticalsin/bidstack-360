# Empty activity list on a closed deal

**Problem:** Historical demo wins and losses (the OP-H book) are stored as `closed_won` or `closed_lost` and have no audit, task, or chatter rows. The activity tab said "No activity yet" and that stage moves would appear.

**Fix:** When the activity list is empty, read the deal record the page already loaded. A won or lost record gets a sentence that names that outcome. An open bid keeps "No activity yet". Logged rows still render. The list waits for the record so the open sentence does not flash first.
