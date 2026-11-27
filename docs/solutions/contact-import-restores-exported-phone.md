# Contact import restores the phone the list export printed

**Problem:** Demo phones start with `+`, including `+1 416 555 0142` and `+49 30 1234 5670`. The contacts export prefixes an apostrophe so a spreadsheet does not run the cell as a formula. Pasting that file into Import CSV stored the escape and still marked the row ready.

**Fix:** A cell whose first character is that apostrophe and whose next character is `+`, `=`, `-`, `@`, a tab, or a carriage return is restored to the printed value before preview and before POST. A name, a sentiment, or an apostrophe that is part of the text stays as pasted. The export escape itself is unchanged.

**Why it works:** The importer already had the exported text. It was keeping the spreadsheet prefix as the phone.

**Validation:** `pnpm --filter @bidstack/web exec vitest run src/components/contact/ContactCsvImportDialog.test.tsx src/components/contact/contact-csv-cell.test.ts`
