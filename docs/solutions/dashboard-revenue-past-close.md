# Dashboard revenue chart names past-close pipeline

## Context

The forecast projection rolls an open bid whose close date is before this quarter into the current quarter. On 25 Nov 2026 the demo book’s open bids all close between April and September, so the dashboard Revenue chart’s Q4 bar is that slipped book. The forecast page can say so. This chart did not.

## Change

`pastCloseOpenValue` sums open bids dated before the UTC quarter that contains now. A blank close date stays out. A won or lost bid stays an actual. When that sum is above zero, Revenue and forecast says “{quarter} open pipeline includes {amount} past its close date.” The same sentence is the chart’s text alternative. The amount uses the chart’s compact formatter. The line uses the danger token (6.38:1 on the white card).

## Not this change

The forecast page’s `overdueOpenMicros` field is a separate draft. This sentence is computed from the bid rows the dashboard chart already draws. It does not stack on the dashboard bid-read drafts.
