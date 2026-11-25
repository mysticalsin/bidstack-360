# Deal timeline overdue mark

**Problem:** The account timeline drew an open deal only when it was created inside the window, and the row said "Deal opened". Demo bids such as CI Financial are still open with a close date of 22 Jul 2026. On a later day that row looked current, and a deal opened before the window disappeared, so the timeline looked empty of that deal.

**Fix:** An open deal whose due day is inside the window and before today (UTC) gets `Overdue: <name>` on that due day. Due today, a future day, a missing or invalid day, and a won or lost deal do not. A due day before the window stays off this picture. Opened and closed rows are unchanged.

**Do not:** call a closed deal overdue, or treat a blank due day as late. Do not move sample news rows.
