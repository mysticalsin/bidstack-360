# Visitor demo hosts sample company info

`seedOrgData` is the workspace a public demo sign-in creates. It wrote the CRM company and an enrichment row, and no firmographics, job postings, or posts. The company strip reads the stored intel summary, so revenue, open roles, and news stayed "Not refreshed yet" until a live source was connected.

`hostedIntelSummaryInput` builds a sample revenue estimate from the account's own approximation, three fixture postings seen yesterday, and one sample post. Live sources stay off. No filing period is written. `seedVisitorDemoCompanyIntel` stores those rows and rebuilds the summary. Fixture postings already stored for another account, including the Pfizer whitespace fixture, are summarised too. The stored rows are not a live fetch.
