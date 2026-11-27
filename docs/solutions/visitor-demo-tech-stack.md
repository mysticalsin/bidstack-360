# Visitor demo hosts a sample technology stack

`seedOrgData` is the workspace a public demo sign-in creates. It wrote an enrichment row with empty `providerMetadata`. The account page reads `openTechStack` from that metadata, so Siemens, IKEA, Sanofi, HSBC, Stellantis, Spotify and Northwind said "No technology detected yet". The dev fixture seed already wrote sample stacks, and the visitor door never called it.

`seedTechStacks` now includes those accounts. Every row is `sample: true`, source `open_data:*`, and the evidence record starts with "Sample". There is no link. Both demo doors call it after `seedOrgData`, inside the sign-in transaction. A stored snapshot with `sample: false` is left in place. Accounts that are not in the org are skipped.
