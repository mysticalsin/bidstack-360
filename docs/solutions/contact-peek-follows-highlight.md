# Contact peek follows the highlighted person

**Problem:** Space on the contacts list peeks one person. j, k, arrows, gg, and G then move the highlight. The peek stayed on the first person. After the highlight moved from Klaus Vogt to Lena Fischer, the card still showed "VP Operations" and `+49 30 1234 5670`. A contact with no title kept the previous title.

**Fix:** While a peek is open, those highlight moves also set the peek to the row now highlighted. A closed peek stays closed. Space still opens and closes it.

**Why it works:** The card is a snapshot taken when it opened. The highlight already knew the next person. The card has to use that row, including a blank title.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/useContactsKeyboard.peek.test.tsx`
