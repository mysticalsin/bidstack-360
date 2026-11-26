# The pre-drafting gate waits for the admin read

A paused capability read has no manifest and `isLoading` false. The pre-drafting gate said only admins and owners can approve. An in-flight read did the same. A failed read with a stale grant still left Approve enabled.

`draftAdminPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the permission read has not arrived. Failed stays on Could not check admin access and does not keep a stale grant. A settled null payload stays on the existing denial. A settled manifest with no grants stays on that denial. A loaded admin stays, including a blank extra grant.
