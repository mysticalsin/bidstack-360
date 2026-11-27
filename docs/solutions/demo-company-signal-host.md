# Demo company list hosts a sample signal

`seedCompanyIntel` wrote firmographics and job postings for every demo company, then rebuilt the list summary. `seed-account-intel` writes posts only for DNB Bank, MAHLE and MAPFRE. `db:seed` does not run `seed:signals`. With no public-source contact configured, the other seven accounts stored no signal. The companies list then said public sources are not connected.

`hostedSignalPost` returns one sample post for those seven. The day is relative to the seed clock, so a re-seed stays inside the six-month window. CI Financial, Logistec, Rush, Aritzia and NOS use the newest headline from the sample-signal catalog. Mantu and Northwind get one synthetic expansion post. DNB, MAHLE and MAPFRE are left on the posts they already have. The row is source `fixture`, marked sample, and upserted before the summary rebuild.
