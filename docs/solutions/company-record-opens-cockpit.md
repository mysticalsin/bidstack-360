# Company record opens its account cockpit

## Problem

`/companies/:id` and `/accounts/:id` are the same company. The company record shows contacts, bids, and the website. The pipeline, risks, and win rate live on the account cockpit. The record had no control that opened that cockpit, so the path was back to the accounts list and a second search.

## Solution

The loaded company header links to `/accounts/{id}` through `companyCockpitHref`. The id is encoded so a slash cannot leave that route. A failed company read does not offer the link.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/pages/CompanyDetailPage.cockpit.test.tsx src/pages/companyDetail/company-cockpit-href.test.ts`
