# Agreements reference copy

## Problem

The agreements library, the agreement page, and the account card told a seller
the product was still a demo. The banner said "Sample preview" and that the
Agreements service was not live. Uploads said the same. A fixture file said
the preview would open once the service was live. An empty stored library
said "No agreements match these filters."

## Solution

A payload with `sample: true` is labelled **Reference**. The note says the
rows are reference records, not agreements on file. Uploads stay off, and the
reason says they turn on for agreements stored in this workspace. A fixture
file with no stored bytes says no file is stored for that reference record.
A live library with zero rows shows "No agreements on file."

The fixture fallback in the MSA client still returns `sample: true`. Seed
rows are unchanged.

## Why it works

A production CRM names a reference record and an empty library. It does not
describe the workspace as a preview, and it does not present fixture rows as
agreements the workspace has stored.

## Prevention

Customer-facing agreements copy lives in
`apps/web/src/components/agreements/reference-copy.ts`. Do not put "Sample",
"demo", "sandbox", "fixture", "illustrative", or "not live" back on the
library, the detail page, the upload reason, or the account card.
