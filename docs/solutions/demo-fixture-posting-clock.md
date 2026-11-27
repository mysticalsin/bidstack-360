# Demo fixture postings stay inside the open-role window

Open roles count a posting seen within 45 days. Fixture `postedAt` and `lastSeenAt` are absolute. A restored demo snapshot keeps those dates, so the count later falls to 0.

`projectFixturePostings` runs only when the mode is exactly `demo`, or unset. It slides `source = 'fixture'` rows so the newest seen time in that set is yesterday. The gap between posted and seen stays. Other sources stay. The stored rows are not written.

`real`, `Demo`, `DEMO`, `demo-x`, and `notdemo` do not slide. A greenhouse row next to a fixture row keeps its stored time.

The key-number count, the account intel read, and the summary rebuild use that clock. A posting whose stored `postedAt` is older than 365 days is still outside the read, so this does not revive it.
