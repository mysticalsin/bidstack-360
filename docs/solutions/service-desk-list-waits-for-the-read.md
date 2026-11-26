# Service desk list waits for the read

The service desk list reads React Query cases. A paused read has `isLoading` false and no list. The page said there were no cases yet. An in-flight read did the same. A failed status with `isError` still false kept a stale case.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the list has not arrived. It does not say there are no cases, and it does not say the load failed. Failed says Failed to load cases and does not keep a stale case. A settled null payload stays empty. A settled empty list stays empty. A loaded case stays, including a blank owner name.
