# A case study says when it was last used

The reference library rendered `lastUsedAt` with `toLocaleDateString()` and rendered nothing when the timestamp was missing. On the seeded library, DNB Bank has never been used, so the cell was the same em dash as a missing document. CI Financial was used 12 days ago and Rush 30 days ago, and a numeric locale date does not say that. The browser locale also ignored `bidstack-locale`.

A missing timestamp now reads "Never". A use in the last 30 days reads as a recency, with the absolute date on the title. Older than that, and a future timestamp, the cell shows the absolute date in the app locale. An unreadable timestamp stays empty.
