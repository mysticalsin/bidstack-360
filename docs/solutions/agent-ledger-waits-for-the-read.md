# Agent ledger waits for the read

The compliance matrix asks for bid facts as soon as the visible rows are known. A paused read and an in-flight read both have `data === undefined` and `isLoading === false`. The ledger treated that as an empty book: the agent has not proposed anything yet. A later failure kept a stale proposal on screen.

`agentLedgerPhase` decides the status. An error wins. Undefined data is unread. Anything else, including a settled null, is ready. Unread says Checking what the agent did and does not draw the table. A failed read says Could not load what the agent did and drops a stale proposal. A settled empty list stays empty. A loaded proposal stays, including a blank claim, a claim of 0, and a confidence of zero.
