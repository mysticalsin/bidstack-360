# The opportunity brief waits for the read

Ask Dust opens before `POST /api/opportunities/:id/brief` returns. A paused or in-flight read has `data === undefined` and `isPending` false. The dialog body was blank. A failed status with `isError` still false kept a stale brief.

`briefReadPhase` reports `unread`, `failed`, or `ready`. Error wins, then undefined data is unread, else the read is ready. Unread says the brief has not arrived. It does not paint the brief, Copy, or Regenerate, and it does not say the load failed. Failed says "Could not load the brief." and drops a stale brief. A settled null payload says no brief text was returned. A brief that arrived still shows, including a blank brief.
