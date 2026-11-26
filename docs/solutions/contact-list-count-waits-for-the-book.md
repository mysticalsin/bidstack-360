# Contacts count waits for a settled book

**Problem:** The contacts pager announced "Page 1 · 0 contacts" before the list had a payload. A load, a pause before the first byte, and a failed read all looked like an empty buying group. On the demo book the people are still there. A pause with `isLoading` false also opened the first-run empty state and offered a CSV import.

**Fix:** The count is shown only after a payload has settled and the read is not in error. Until then the table stays on the skeleton, including a pause that has no rows yet. A failed read stays the error, with a retry. A settled empty payload still says the buying group is empty and counts zero.

**Why it works:** Zero rows are the book only when the query has answered. The pager and the empty headline now share that answer.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/ContactsPage.book-count.test.tsx src/pages/ContactsPage.test.tsx`
