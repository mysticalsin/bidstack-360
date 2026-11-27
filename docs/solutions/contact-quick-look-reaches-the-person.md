# Contact Quick Look opens the person and calls the printed phone

**Problem:** Space on the contacts list peeks the person. Michael Johnson's name was plain text, so the peek could not open the record. The phone `+1 416 555 0142` was plain text. Seeded phones include spaces, so the printed string is not a dial target. The email link used the fill green (`--brand-primary`) as text, and the hit area was the line box.

**Fix:** A contact id on the name opens `/contacts/<id>`. A full address is `mailto:` of that address. A phone that starts with `+` and is 7–15 digits once spaces, dots, dashes, and parentheses are removed is `tel:+` of those digits. The card still shows the printed phone. A fragment, a word, a missing value, or a name that is not a contact id stays text. The account name stays text. The links use the dark foreground green and a 44px target.

**Why it works:** The peek already had the name, the address, and the phone. The name was not a route, and the demo numbers are not digit-only.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/contact/ContactQuickLook.test.tsx src/components/contact/contact-peek-href.test.ts`
