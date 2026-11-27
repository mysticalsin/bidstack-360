# Intake account picker waits for the read

A paused company read has no list and `isLoading` false. The picker said there were no matching accounts. An in-flight read showed only a skeleton.

`intakeAccountPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the list has not arrived. Failed stays on Could not load accounts and drops a stale name. A settled empty list stays empty. A settled null payload stays empty. A loaded account stays, including a blank industry.
