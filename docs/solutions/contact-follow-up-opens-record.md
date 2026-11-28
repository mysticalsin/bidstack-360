# Contact follow-up opens the task record

**Problem:** A contact lists related follow-ups as plain titles. Demo rows such as "Submit revised pricing & SoW v2" already have a task id, but the title does not use it. Opening that follow-up means leaving the contact and searching Tasks, and a title search can match a different row.

**Fix:**

- A task whose id is a uuid links to `/tasks/<id>`. The visible title is not part of the address.
- A script, a path, a blank, or any other non-uuid stays text.
- The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the row opens the follow-up.

**Why it works:** The follow-up is already on the contact, through the deal it belongs to. The click goes to that task record.

**Validation:**

- `pnpm --filter @bidstack/web exec vitest run src/pages/ContactDetailPage.taskLink.test.tsx src/pages/contact-task-href.test.ts src/pages/ContactDetailPage.test.tsx`
