# Win probability waits for the read

The win probability chip reads a React Query score for an opportunity. A paused read has `isLoading` false and no probability. The chip rendered nothing, which looks off. An in-flight read showed only the skeleton. A failed read did the same, including when a stale probability was still in memory.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the probability has not arrived. It does not paint a number, and it does not say the load failed. Failed says the probability could not be loaded and does not keep a stale number. A settled read with no probability stays empty. A loaded probability stays, including zero. A probability the parent already loaded stays.
