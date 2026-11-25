# Contact list opens the stored account

**Problem:** On the contacts list the customer name was plain text. Demo contacts already store a company id (CI Financial, Logistec, Rush). Opening the account meant leaving the list and searching, and a name search can match a different company.

**Fix:** A customer whose `companyId` is a uuid links to `/accounts/<id>`. A missing id, a name, or a path stays text. The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the row opens that account.

**Why it works:** The id the list already holds is the address. The visible name is only the label.

**Validation:** `apps/web` vitest `src/pages/contacts/contact-account-href.test.ts` and `src/pages/contacts/ContactTable.account.test.tsx`.
