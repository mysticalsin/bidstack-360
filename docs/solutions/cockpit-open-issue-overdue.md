# Open cockpit risks say when the date has passed

**Problem:** The account cockpit Open issues card appended the raw due date. Demo fallbacks are dated May 2026 (`Security scope needs final sign-off` on 2026-05-22, `Incumbent MSP has renewal advantage` on 2026-05-29). On a later day those open risks looked like the current plan.

**Fix:** An open or in-progress risk whose UTC due day is before today says `Overdue: {n}d late` in `--danger` (6.38:1 on white, 7.26:1 on the dark card). The date is the UTC calendar day, formatted, so the label and the count name the same day. A risk due today, or still ahead, keeps the date and does not say overdue. A mitigated risk stays off this list.

**Why it works:** The row is already limited to risks that still need action. The clock matches the bid due chip, so the due day itself is not late.

**Validation:** `apps/web` vitest `src/components/cockpit/OpenIssuesCard.test.tsx`.
