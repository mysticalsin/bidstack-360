# A fresh demo date chip is not an empty book

**Problem:** A new demo org files open follow-ups a few days out: the IKEA pricing annex in 3 days, the Siemens technical volume in 5, and a finished Stellantis handover already past. Today and Overdue match nothing. The empty card said "No tasks match this filter", so the book looked empty while those rows were still on All.

**Diagnosis:** Today and Overdue are cuts of the loaded page, not a server filter. On a fresh org every open due day is still ahead, so both chips are empty. The card reused the generic filter miss. A finished row is not overdue, so it does not fill that chip either.

**Fix:** `dateChipAheadEmpty` in `apps/web/src/components/task/task-list-ahead.ts`. `TasksPage` uses it for the empty card. An empty Today chip names the soonest open follow-up. An empty Overdue chip also counts how many open rows are still ahead. A book that already has a late follow-up returns null, so the generic filter title stays. Copy is in en, es, fr, it, pt, and zh.

**Why it works:** The helper uses the same `daysUntil` clock as the chips. Done rows are skipped. Due today is not "ahead". The soonest title is the first minimum in loaded order.

**Prevention:** `apps/web/src/components/task/task-list-ahead.test.ts` pins the IKEA annex at 3 days and leaves the finished handover out. `apps/web/src/pages/TasksPage.ahead-empty.test.tsx` renders Today and Overdue for that book, and leaves the May pricing follow-up on the generic title.
