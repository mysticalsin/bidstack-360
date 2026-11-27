# Contact record dials the printed phone

**Problem:** On a contact, the phone link used the stored string as the `tel` href. Demo phones include spaces (`+49 30 1234 5670`, `+1 416 555 0142`). That string is not a dial target. A fragment such as `ext 12` was also turned into a `tel` link. The email beside it was already `mailto` of the stored address.

**Fix:** A phone that starts with `+` and is 7 to 15 digits once spaces, dots, dashes, and parentheses are removed becomes `tel:+` of those digits. The record still shows the printed phone. A fragment, a word, a missing value, or a scheme stays text. The call link is a 44px target with a 2px focus ring, and the dark focus ring uses the foreground green.

**Why it works:** The digits are the number. The printed form is only the label.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/ContactDetailPage.phone.test.tsx src/pages/contact-record-dial.test.ts src/pages/ContactDetailPage.test.tsx`
