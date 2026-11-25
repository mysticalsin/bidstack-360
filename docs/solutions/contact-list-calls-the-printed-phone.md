# Contacts list calls the phone the row prints

**Problem:** On the contacts list the phone under the email was plain text. Klaus Vogt's number `+49 30 1234 5670` could not be dialed. Seeded phones include spaces, so the printed string is not a dial target. A fragment such as `12` is not a number.

**Fix:** A phone that starts with `+` and is 7–15 digits once spaces, dots, dashes, and parentheses are removed is `tel:+` of those digits. The row still shows the printed phone. A fragment, a word, a missing value, or a scheme stays text. The link is a 44px target and uses the dark foreground green.

**Why it works:** The list already prints the number next to the mail link. The demo numbers are not digit-only.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/ContactTable.call.test.tsx src/pages/contacts/contact-list-dial.test.ts src/pages/ContactsPage.test.tsx`
