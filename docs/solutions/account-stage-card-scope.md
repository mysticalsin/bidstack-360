# Account cockpit stage card counts this company

## Evidence

On an account cockpit, `PipelineByStageCard` rendered `usePipelineReport()` — the whole-book stage totals — under the heading "Portfolio pipeline" / "All-account pipeline by stage". The section around it says the figures are for this account. A Siemens cockpit with one open bid still showed every other company's stages. A failed report left the skeleton up, because a missing `report` looked the same as loading.

## Correction

The card asks for `/api/opportunities?companyId=<uuid>&limit=200` and sums those rows. The company id must be a UUID; a name, a path, or a script does not become a query and does not fall back to the book. A later page is named as a page. A failed read is an error with retry. An account that is not a company record says so.

The portfolio report stays on the workspace dashboard. This card is only the open account.

## Verification

`account-stage-bars.test.ts`, `PipelineByStageCard.test.tsx`, and `DashboardPage.test.tsx`.
