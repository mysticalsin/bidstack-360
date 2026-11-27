# RFP analytics waits for the read

The admin RFP analytics rollup opens before the read returns. A paused read has `isLoading` false and no payload. The section showed 0 RFPs, a zero pipeline, and said there were no RFPs yet. An in-flight read did the same. A failed status with `isError` still false kept a stale rollup.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the rollup has not arrived. It does not show a zero, and it does not say the load failed. Failed says the analytics could not load. It does not keep a stale rollup. A settled null payload stays on the empty rollup. A settled zero rollup stays empty. A loaded rollup stays, including a blank owner name.
