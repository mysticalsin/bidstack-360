# Contact notes follow the company

**Problem:** A linked contact asked `/api/notes` for the customer display name. Demo notes are stored with `accountId` and `companyId` set to the company id, so the contact page said there were no notes and never showed the sentence.

**Fix:** When `companyId` is set, request that company and list the notes the server returns, including a trimmed body under the title. An unlinked contact still reads by customer name and keeps an exact `accountId` match. A whitespace-only body adds no line.

**Why it works:** The notes route already unions `companyId` with the account tag. The contact page was the caller that never passed the company id.
