# Company lookup waits for the read

A paused company lookup has no profile and `isLoading` false. The dialog said the profile was ready to enrich. An in-flight read said it was resolving the profile and still painted a name signal. A failed read did the same, and a failed read with a stale company kept that company.

`companyLookupPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the profile has not arrived. Failed stays on Could not load the company lookup and drops a stale company. A settled miss stays ready to enrich. A loaded company stays, including a blank industry.
