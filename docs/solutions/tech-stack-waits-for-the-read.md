# Technology stack waits for the read

A paused technology stack read has no payload and `isLoading` false. The wall said no technology was detected. An in-flight read showed only a skeleton. A failed read kept a stale technology.

`techStackPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the stack has not arrived. Failed stays on Could not load technology stack and drops a stale technology. A settled null payload stays empty. A settled empty stack stays empty. A loaded technology stays, including a blank category and a confidence of zero.
