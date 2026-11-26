# Contact access waits for the read

A paused contact-access read has no manifest and `isLoading` false. The dialog said the caller needs contacts write access. An in-flight read did the same. A failed read showed that same refusal, and a failed read with a stale grant kept Create contact enabled.

`contactAccessPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the permission has not arrived. Failed stays on Could not load contact access and drops a stale Save or Create. A settled null manifest stays denied. A loaded manifest stays, including no write grant, a write grant, and an admin grant.
