# Companies list industries are distinct

## Evidence

On `/companies`, the Industries card counted every row that had an industry. Countries already counted distinct codes. On the demo book CI Financial and DNB Bank are both `financial_services`, and a blank industry still counted, so the card matched the visible-company total and read as one industry per company. The caption said "classified profiles".

## Correction

The card counts distinct non-blank industry strings on the current page. The caption says "on this page". It does not fold case or underscores into one label. Countries, domain coverage, and the visible-company count are unchanged.

## Verification

`apps/web/src/pages/CompaniesPage.industry-count.test.tsx` and `apps/web/src/pages/companiesPage/company-list-industries.test.ts`.
