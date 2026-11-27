# Deal catalog waits for the read

The company people tab walks every opportunity page when the detail payload is at the cap. A paused read has `isLoading` false and no pages. The tab offered the newest 200 deals, which is how a settled catalog of that size looks. An in-flight read did the same. A failed status with `isError` still false kept a stale catalog.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the full list has not arrived. It does not offer the newest deals, and it does not say the load failed. Failed says Could not load every deal and keeps only the newest deals named by that error. It does not keep a stale catalog. A settled null payload stays on the newest deals. A settled empty catalog stays empty. Under the cap, the detail deals stay and the catalog read stays off. A loaded catalog stays, including a blank name.
