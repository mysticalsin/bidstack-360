# Activity by hour waits for the read

The activity-by-hour card opens before the log returns. A paused read has `isLoading` false and no payload. The card said there was no activity logged, and the count said 0. An in-flight read did the same. A failed status with `isError` still false kept a stale hour.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the log has not arrived. It does not say there is no activity, and it does not say the load failed. Failed stays on the existing error. It does not keep a stale hour. A settled null payload stays empty. A settled log with no activity stays empty. A loaded hour stays, including a blank activity type.
