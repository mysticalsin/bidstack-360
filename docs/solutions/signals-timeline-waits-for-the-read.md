# Signals timeline waits for the read

The signals timeline opens before the account timeline returns. A paused read has `isLoading` false and no payload, so the section said the timeline could not be loaded. An in-flight read showed only a blank skeleton. A failed status with `isError` still false kept a stale event.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the payload has not arrived. It does not say the list is empty, and it does not say the load failed. Failed says the timeline did not load. It does not keep a stale event. A settled timeline with no events still says nothing is on the timeline yet. A loaded event stays, including a sample mark.
