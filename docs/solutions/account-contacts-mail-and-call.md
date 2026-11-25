# Account contacts roster can mail and call the person it prints

**Problem:** Opening a demo account lands on Contacts. Klaus Vogt's row prints `klaus.vogt.demo@example.com` and `+49 30 1234 5670` as plain text. The name already opens the record. The address and the phone do not mail or call. Seeded phones include spaces, so a raw `tel:` of the printed string is the wrong target.

**Fix:** A full address is `mailto:` of that address. A phone that starts with `+` and is 7–15 digits once spaces, dots, dashes, and parentheses are removed is `tel:+` of those digits. The cell still shows the printed phone. A fragment, a word, or a missing value stays text. The links use the dark foreground green and a 44px target.

**Why it works:** The roster already has the address and the phone. It was not turning them into actions, and the demo numbers are not digit-only.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/companyDetail/CompanyTabs.contacts.test.tsx src/pages/companyDetail/contact-method-href.test.ts src/pages/companyDetail/CompanyTabs.test.tsx`
