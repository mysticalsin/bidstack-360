# Account distribution waits for the read

The account distribution chart reads a React Query company list. A paused read has `isLoading` false and no companies. The chart showed only a skeleton. An in-flight read did the same. A failed read said Could not load this view.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the companies have not arrived. It does not draw the slices, and it does not say the load failed. Failed says the distribution could not be loaded and does not keep a stale industry. A settled read with no companies stays empty. A settled null payload stays empty. A loaded industry stays, including a blank industry labeled Unspecified.
