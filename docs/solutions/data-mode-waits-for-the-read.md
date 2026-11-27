# Data mode waits for the read

A paused data-mode read has no identity and `isLoading` false. The banner hid. An in-flight read painted DEMO MODE. A failed read hid, and a failed read with a stale mode kept that mode.

`dataModePhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the mode has not arrived. Failed stays on Could not load the data mode and drops a stale mode. A settled null payload stays hidden. A loaded mode stays, including a demo identity whose banner flag is false.
