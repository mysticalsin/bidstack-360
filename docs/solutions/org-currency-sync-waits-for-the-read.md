# Workspace currency sync waits for the read

A paused workspace-currency read has no code and `isLoading` false. The sync rendered nothing, so the bar kept the default and looked ready. An in-flight read did the same. A failed read rendered nothing, and a failed read with a stale code still applied that code.

`orgCurrencyPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the currency has not arrived and does not apply a code. Failed stays on Could not load the workspace currency and does not apply a stale code. A settled null payload stays empty. A loaded currency is applied. A loaded blank currency and a loaded zero stay, and neither is replaced with a default code.
