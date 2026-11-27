# Opportunity export names the country

## Problem

Demo bids store an ISO country and no territory. OP-2041 is CI Financial, country CA. The opportunities list names that code Canada under a Country heading. The CSV still headed the column Territory and wrote only the territory name, so the cell was blank and the download dropped the country.

## Rule

When the filtered export has no territory, the heading is Country and a resolved code prints the English region name. CA prints Canada. A stored territory name still wins, and one territory in the export keeps the Territory heading. A code that is not a region, including ZZ, stays as written. A bid with neither says No country. The value column stays where it is.

## Verification

`pnpm --filter @bidstack/api exec vitest run src/routes/opportunity-export-place.test.ts`
