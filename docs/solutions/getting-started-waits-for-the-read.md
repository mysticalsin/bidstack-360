# First-run waits for the workspace summary

The dashboard first-run screen said the workspace was ready when the org summary had not arrived. A paused read has `isLoading` false and no counts, so the cards said there was nothing here yet. An in-flight read with `isLoading` still false did the same. A failed status with `isError` still false kept that empty workspace, including over a stale payload.

`gettingStartedPhase` reports unread, failed, or ready. Error wins. Undefined data is unread. Anything else is ready.

Unread says the summary has not arrived. It does not say the workspace is ready, and it does not say the summary did not load. Failed says the summary did not load and does not keep the first-run cards. A settled null payload stays on the empty workspace. A settled zero stays empty. A loaded summary stays on those cards.
