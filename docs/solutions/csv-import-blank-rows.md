# CSV import ignores blank spreadsheet rows

## Problem

A sheet saved as CSV writes an empty row as commas. The importer kept that row. A file of only those rows opened column mapping, as if there were an account to import. A real row kept the blank row beside it. An Excel parse can return the same blank row.

## Rule

A row with no value in any cell is not a record. The CSV parser drops it. The wizard drops it again for a server-parsed spreadsheet. When nothing remains, the wizard stays on upload and says the file has no data rows. The previous workbook is cleared, so the last account is not still on screen.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/lib/csv-parse.test.ts src/components/import/CsvImportWizard.empty-file.test.tsx src/components/import/CsvImportWizard.test.tsx`
