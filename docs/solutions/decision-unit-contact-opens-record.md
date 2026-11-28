# Decision unit contact opens the record

**Problem:** The decision unit is the default tab on a deal. CRM stakeholder names rendered as plain text, so opening the person meant leaving the deal and searching Contacts. A name search can match a different person.

**Fix:**

- A CRM row whose id is a contact uuid links to `/contacts/<id>`. The visible name is not part of the address.
- A Dust-only member stays text, even when its id looks like a uuid. That person is not a CRM contact yet.
- A script, a path, a blank, or any other non-uuid stays text.
- The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the row opens the contact.

**Why it works:** The buying committee is already on the deal. The click goes to that contact record.

**Validation:**

- `pnpm --filter @bidstack/web exec vitest run src/components/opportunity/OpportunityTabs.decisionUnit.test.tsx src/components/opportunity/decision-unit-contact-href.test.ts src/components/opportunity/OpportunityTabs.test.tsx`
