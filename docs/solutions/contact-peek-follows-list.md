# Contact peek follows the visible list

**Problem:** Space on the contacts list peeks one person. A search, a sort, or a refresh then replaces the rows. The card kept the first snapshot. After Klaus Vogt left the page, Quick Look still showed "VP Operations" and `+49 30 1234 5670`. A refresh that blanked his title left that title on the card. The highlight also reset, so the next move landed on whoever was now first.

**Fix:** When the visible list settles, keep the highlight on that person and point an open peek at the new row. If the list no longer has them, close the peek and clear the highlight. A closed peek stays closed. A list that is still loading does not count as empty.

**Why it works:** The card is a snapshot. The next rows already know whether that id is still there, and they carry the current title and phone.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/ContactsPage.peek-list.test.tsx`
