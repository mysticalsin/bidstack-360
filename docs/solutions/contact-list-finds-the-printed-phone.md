# Contacts list finds the phone the row prints

**Problem:** Searching the contacts list for a demo phone such as Klaus Vogt's `+49 30 1234 5670` matched only name, customer, and role. The page said there were no matches. Phone stays off the server `contains` clause because the column is encrypted.

**Fix:** A full number (leading `+`, 7 to 15 digits once spaces, dots, dashes, and parentheses are removed) is not sent as the server search. The loaded page is filtered by those digits. A name, a fragment, or a scheme stays a server text search. A miss still says there are no matches, not that the buying group is empty.

**Why it works:** The demo book is one page, and every seeded phone is already on that page. The printed form and the digit form are the same number.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/contact-list-phone-query.test.ts src/pages/ContactsPage.phone-search.test.tsx src/pages/ContactsPage.test.tsx`
