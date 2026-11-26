# Contact email waits for the mailbox read

**Problem:** Mail filed on a contact said "No email yet" when the first read was paused. A paused query has `isLoading` false and no rows, so the empty mailbox and an unread one looked the same. An in-flight read showed only the skeleton.

**Fix:** The list says "Checking email. The list has not arrived." until a payload exists. A failed read stays on "Could not load email". A settled empty list still says "No email yet". A loaded message still shows.

**Why it works:** Empty is only a settled read. The phase follows the payload, not `isLoading`.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/email/EmailPanel.list-read.test.tsx src/components/email/EmailPanel.test.tsx`
