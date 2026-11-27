# Contact duplicate scan waits for the read

## Problem

Find duplicates on Contacts said "Every contact is one person" when the scan payload had not arrived. A paused read has `isLoading` false and no clusters. A missing payload took the same empty branch. A failed read showed the error and did not say the contacts had not arrived.

## Decision

A clean book is zero clusters only after a payload arrives. Pending and failed reads stay unread, even if a caller passes `[]`. The first fetch still uses the skeleton. A paused or missing payload says the contacts have not arrived. A failed read keeps the error and says the same. An empty payload that arrived stays the clean book. The company duplicate scan is unchanged.

## Files

- `apps/web/src/components/contact/contact-duplicate-read.ts`
- `apps/web/src/components/company/DuplicatesDialog.tsx` (contact entity only)
