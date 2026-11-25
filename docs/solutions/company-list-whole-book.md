# A complete company page is not the latest 50

## Evidence

On `/companies`, the status said "Showing latest 50 companies" for every unfiltered read. The demo book is ten companies and the response has no next page. The header already said how many companies were visible. The status claimed a window that was not there.

## Correction

When the page has rows and no next cursor, and no intel view or direction is set, the status says how many companies are on the page. A next cursor keeps "Showing latest 50 companies". An empty read keeps that sentence too. Search keeps the search sentence. The Industries card is unchanged.

## Verification

`apps/web/src/pages/CompaniesPage.whole-book.test.tsx` and `apps/web/src/pages/companiesPage/company-list-window.test.ts`.
