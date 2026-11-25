# Contact context menu opens the person and calls the printed phone

**Problem:** Right-click on the contacts list offered Edit, Copy email, Copy phone, and Delete. Michael Johnson could not be opened from the menu. The phone `+1 416 555 0142` could be copied, and seeded phones include spaces, so the copied string is not a dial target. Menu rows were a line box, under 44px, and ArrowDown also moved the table cursor.

**Fix:** A contact id opens `/contacts/<id>`. A full address is `mailto:` of that address. A phone that starts with `+` and is 7–15 digits once spaces, dots, dashes, and parentheses are removed is `tel:+` of those digits. The menu still shows the printed phone. A fragment, a word, a missing value, or a name that is not a contact id is not a reach action. Copy stays. Each row is 44px, and a key handled by the menu does not continue to the table.

**Why it works:** The menu already had the name, the address, and the phone. The name was not a route, and the demo numbers are not digit-only.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/pages/contacts/ContactContextMenu.test.tsx src/pages/contacts/contact-menu-href.test.ts`
