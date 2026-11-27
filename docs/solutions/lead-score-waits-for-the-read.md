# Lead score waits for the read

The lead score chip reads a React Query score. A paused read has `isLoading` false and no score. The chip rendered nothing, which looks off. An in-flight read showed only the skeleton. A failed read did the same, including when a stale score was still in memory.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the score has not arrived. It does not paint a number, and it does not say the load failed. Failed says the score could not be loaded and does not keep a stale number. A settled read with no score stays empty. A loaded score stays, including zero. A score the parent already loaded stays.
