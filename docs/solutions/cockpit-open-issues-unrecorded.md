# Open issues does not call an empty register all clear

**Problem:** Demo accounts have no risk or compliance rows. The cockpit Open issues card still captioned that file "All clear". Spanish, French, Italian, Portuguese, and Chinese went further and said the empty file was all green. A mitigated risk used the same "nothing recorded" sentence, so a closed file looked like a blank one.

**Fix:** An empty file says nothing is recorded. "All clear" waits until rows exist and none are still open, and that case says the recorded items are closed. Open rows still count as items to action. The severity buckets are unchanged.

**Why it works:** The sentence follows whether any row exists, then whether any of those rows are still open. An empty file and a closed file are different facts.

**Validation:** `apps/web` vitest `src/components/cockpit/OpenIssuesCard.test.tsx`, `src/components/cockpit/open-issues-posture.test.ts`, and `src/components/cockpit/open-issues-copy.test.ts`.
