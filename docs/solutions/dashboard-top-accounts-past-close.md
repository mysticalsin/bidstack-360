# Top accounts names open value that is already past close

## Context

On 25 Nov 2026 the demo book's open bids close between 30 Jun and 30 Sep. Performance → Top accounts still labelled that money "Open". Rush read as 4.8m of live pipeline. The revenue chart's past-close sentence is a separate draft and does not cover this tab.

## Change

`topAccountPastClose` sums open value on the six bars whose UTC close day is before today. A bid due today stays open. A blank date stays unscheduled. Won value stays won. Lost bids are not on the bars. Logistec is past close but outside the top six, so its 320k stays out of the 11.57m sentence. The same sentence is the chart's text alternative. The table gains a Past close column, and each late account's chip says how much of its total is past close.
