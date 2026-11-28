# Contact record opens the stored account

**Problem:** On a contact, the company name linked to `/companies?search=<name>`. Demo contacts such as Klaus Vogt at Siemens already store a company id, but the name went into a search. A search can match a different company, and the account is still another click away. A contact marked needs_review has no safe company, and the same search still ran.

**Fix:**

- A company id that is a uuid links to `/accounts/<id>`. The visible name is not part of the address.
- A name, a script, a path, or a blank stays text.
- The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the header opens that account.

**Why it works:** The id the contact already holds is the account. The name is only the label.

**Validation:**

- `pnpm --filter @bidstack/web exec vitest run src/pages/ContactDetailPage.account.test.tsx src/pages/contact-record-account-href.test.ts src/pages/ContactDetailPage.test.tsx`
