# An email thread waits for its read

**Problem:** Opening a thread said "Could not load this thread" when the first read was paused. A paused query has `isLoading` false and no messages, so an unread thread and a failed one looked the same. An in-flight read showed only the skeleton.

**Fix:** The sheet says "Checking this thread. The messages have not arrived." until a payload exists. A failed read stays on "Could not load this thread". A settled empty thread still lists nothing. A loaded message still shows.

**Why it works:** Failure is only a settled miss. The phase follows the payload, not `isLoading`.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/email/EmailThreadView.read.test.tsx src/components/email/EmailPanel.test.tsx`
