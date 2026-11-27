# Allocation total waits for the read

The account-team edit dialog quoted a cross-account percent from `totalPct ?? 0`. A payload with no total printed 0% across accounts. A paused or failed read had no total and no status, so the person looked free.

`allocationReadPhase` is unread, failed, or ready. A finite `totalPct` is ready, including 0. An error, or a body with no total, is failed. Missing data is unread.

Unread says the total has not arrived and does not print a percent. Failed says allocation did not load and does not print 0%. A settled 0 stays 0%. A settled total that later fails to refresh stays on that total.
