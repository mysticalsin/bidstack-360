# Follow status waits for the read

A paused follow read has no status and `isLoading` false. The control rendered nothing. An in-flight read did the same. A failed read hid the error, and a failed read with a stale status kept Following.

`followAccountPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the status has not arrived. Failed stays on Could not load the follow status and drops a stale Follow, Following, or Muted control. A settled null payload stays empty. A loaded status stays, including not following, following, and muted.
