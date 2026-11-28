# Overdue opportunity list is open bids only

`GET /api/opportunities?overdue=true` and the opportunities CSV export share one window: close day before today (UTC), and stage not `closed_won` or `closed_lost`.

A decided bid whose close date is in the past is not an open bid waiting on you. The dashboard Needs you count is already open-only, and this list is the click target of that row and of the Overdue chip.

Due within N days stays a calendar window. A stage the caller picked, including a decided stage, still applies there.
