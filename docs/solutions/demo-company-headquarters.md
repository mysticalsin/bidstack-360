# Demo company facts include a sample headquarters

Fixture firmographics stored revenue, headcount and industry, and left `locations` as `[]`. The account strip then said the headquarters was not known. The business snapshot already named a city for some of those accounts, and the strip did not.

`hostedFirmographicLocations` returns one sample headquarters when every stored source is `fixture` and no office is stored. A stored office wins. An empty, live, or mixed provenance stays empty. The enrichment read applies that before the response, and labels the added office `fixture`. `seedCompanyLocations` writes the same office after company intel, so a re-seed stores it. Unknown companies are skipped.
