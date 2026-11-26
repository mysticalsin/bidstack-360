# The weighted pipeline waits for the read

Forecast projection opens before the quarter list returns. A paused read has `isLoading` false and no payload. The card said there was no open pipeline. An in-flight read did the same. A failed status with `isError` still false kept a stale quarter.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the projection has not arrived. It does not say the pipeline is empty, and it does not say the load failed. Failed stays on the existing error. It does not keep a stale quarter. A settled null payload stays empty. A settled book with no pipeline stays empty. A loaded quarter stays, including a blank owner name.
