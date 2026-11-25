# Contact list person links stay readable in dark mode

**Problem:** On the contacts list the person's name and email use `--brand-primary`. In dark mode that token is a fill (`#00805e`, 3.95:1 on the page), under the 4.5:1 text floor. `--brand-deep` (`#3fbe93`) is the foreground accent at 8.38:1. The hit area was the line box, under 44px. Demo rows such as Michael Johnson and `mjohnson@ci.com` are these two links.

**Fix:** Both links keep the light-mode fill green, switch to `--brand-deep` for text and the focus ring in dark mode, and use a 44px-tall target. A row with no email does not invent a mail link.

**Why it works:** The tokens already split fill and foreground. The list was still using the fill as text.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/ContactTable.person.test.tsx src/pages/ContactsPage.test.tsx`
