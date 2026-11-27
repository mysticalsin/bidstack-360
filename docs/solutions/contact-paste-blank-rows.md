# Pasted contact CSV ignores blank spreadsheet rows

## Problem

Excel leaves empty rows as commas, and it writes an empty cell as `""`. The paste importer treated a leading comma-only row as the header, so the real contacts looked missing. A row of quoted empty cells was offered as a contact to create. A paste that contained only those rows said the box was still waiting, or that rows needed fixes.

## Solution

Drop a record whose cells are all empty before the header is chosen. Treat a cell that is only `""` as empty, so it is not a name or an email. When the paste has text and no contacts remain, say that the paste has no contact rows.

## Why This Shape

The file import wizard already ignores blank rows. This dialog has its own splitter. The same rule belongs here, in the parser, so the preview, the import count, and the create request all see the same rows.

## Verification

`ContactCsvImportDialog.test.tsx` covers a real contact surrounded by blank rows, a quoted empty email, a paste of only blank rows, and a whitespace-only box.
