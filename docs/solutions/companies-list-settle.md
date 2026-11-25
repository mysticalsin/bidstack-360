# A company read that has not settled is not an empty book

## Evidence

On `/companies`, the header used the missing page as "0 companies visible" while the list was still loading, and the summary tiles showed zeros. The status said the latest 50 companies were showing. A failed read used that same empty book and an error with no control. A later refresh that failed replaced the rows already on screen.

## Correction

Until the first payload arrives, the header says the list is loading or that it did not load. The summary stays hidden until a page exists. The error offers Retry on the same read. A refresh that fails after a page has loaded keeps that page. A successful empty page may still say how many companies are visible.

## Verification

`CompaniesPage.test.tsx`.
