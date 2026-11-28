# People follow-up opens the task record

**Problem:** The People tab on a company and on a deal lists internal follow-ups as plain titles. Demo rows such as "Submit revised pricing & SoW v2" already have a task id, but the title does not use it. Opening that follow-up means leaving the account and searching Tasks, and a title search can match a different row.

**Fix:**

- A task whose id is a uuid links to `/tasks/<id>`. The visible title is not part of the address.
- A script, a path, a blank, or any other non-uuid stays text.
- The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the row opens the follow-up.

**Why it works:** The follow-up is already on the account. The click goes to that task record.

**Validation:**

- `pnpm --filter @bidstack/web exec vitest run src/components/people/AccountPeopleSection.taskLink.test.tsx src/components/people/task-record-href.test.ts src/pages/accountsSafetyCopy.test.ts`
