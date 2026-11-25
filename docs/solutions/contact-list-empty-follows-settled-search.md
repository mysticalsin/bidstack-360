# Contacts list empty state follows the settled search

**Problem:** The contacts search box updates before the list query. Clearing a miss left the rows empty while the box was already blank, so the page said "Nobody in the buying group yet" and offered a CSV import. Under the demo book that is a false empty: Klaus Vogt is still there. A box that is only spaces said "No matches" for a query the list never sent.

**Fix:** Empty copy and the result announcement follow the trimmed deferred search, which is the query the rows belong to. A miss stays "No matches". A settled empty query, including spaces, stays the first-run buying group.

**Why it works:** The rows and the copy name the same search. The keystroke buffer is only the box.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/ContactTable.empty.test.tsx src/pages/ContactsPage.test.tsx`
