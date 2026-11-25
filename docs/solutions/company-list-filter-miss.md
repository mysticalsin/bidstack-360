# A company filter miss is not an empty book

## Evidence

On `/companies`, Revenue over 1B, Hiring fast, Contracting, and the direction select are server filters. A miss still said "No accounts on the radar", offered Add company and a CSV import, and the status still said the latest 50 companies were showing. A search miss already had its own sentence.

## Correction

A view or direction names itself in the status ("Showing Revenue over 1B") and, when the page is empty, says that filter matched no companies. Clear filters removes the view, the direction, and the search, and leaves sort alone. Search alone still uses the search empty state. An unfiltered empty page still offers Add company.

## Verification

`apps/web/src/pages/CompaniesPage.filter-empty.test.tsx` and `apps/web/src/pages/companiesPage/company-list-narrowing.test.ts`.
