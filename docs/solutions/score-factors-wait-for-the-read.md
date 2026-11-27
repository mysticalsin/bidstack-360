# Score factors wait for the read

The score factors panel reads a React Query score for a lead or an opportunity. A paused read has `isLoading` false and no payload. The panel rendered nothing, which looks off. An in-flight read showed only the skeleton. A failed read did the same, including when a stale score was still in memory.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the factors have not arrived. It does not paint a score, and it does not say the load failed. Failed says the factors could not be loaded and does not keep a stale score. A settled read with no score stays empty. A loaded score stays, including zero.
