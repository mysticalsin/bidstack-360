# Account cockpit does not invent a vendor catalog

## Problem

Demo accounts often have no detected technical stack. The cockpit still merged a canned catalog (Microsoft 365, Azure, AWS, Google Cloud, and the rest, source `verified_tech_profile`) onto every account. The tech stack card showed those vendors, and funding eligibility recommended ECIF, AWS MAP, and Google PSF.

## Solution

`buildCockpit` returns a saved manual stack when one exists, and otherwise the account's own detected stack. An account with nothing on file gets an empty stack. The canned catalog is gone, including its Security category.

## Verification

`pnpm --filter @bidstack/api exec vitest run src/services/crm/dashboard.cockpit.test.ts`
