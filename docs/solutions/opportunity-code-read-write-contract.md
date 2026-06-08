# Opportunity Code Read/Write Contract

## Problem

Opportunity API responses were serialized with the same strict code regex used
for new opportunity creation. That made list views fragile: any persisted
legacy, imported, test, or RFP-derived opportunity code outside `OP-NNNN` could
turn a normal read into a `500` response even though the record was otherwise
valid.

For enterprise CRM data, reads must tolerate historical identifiers. Writes can
still enforce the current canonical format, but read schemas should not reject
real persisted records and crash list/detail pages.

## Solution

- Split opportunity code validation into two contracts:
  - `OpportunityCode`: read contract, non-empty bounded string.
  - `CanonicalOpportunityCode`: write/import contract, `OP-NNNN`.
- Use the tolerant contract on `Opportunity` response parsing.
- Keep `OpportunityCreate` and import-supplied codes canonical so new data does
  not drift further.
- Add tests for both sides: legacy persisted code reads succeed, noncanonical
  write-supplied codes fail.

## Verification

- `pnpm --filter @bidstack/shared build`
- `pnpm --filter @bidstack/shared test`
- `pnpm --filter @bidstack/api exec vitest run src/routes/opportunities.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api test`
- Live Vite-proxied `GET /api/v1/opportunities?limit=20` returns `200`.

