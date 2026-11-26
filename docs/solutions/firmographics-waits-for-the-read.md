# Firmographics wait for the read

A paused firmographics read has no enrichment and `isLoading` false. The strip rendered nothing. An in-flight read did the same. A failed read rendered nothing, and a failed read with a stale industry kept that industry.

`firmographicsPhase` returns `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Any other payload is ready.

Unread says the enrichment has not arrived. Failed stays on Could not load company facts and drops a stale industry. A settled null payload stays blank. A loaded strip stays, including a blank industry that says Not known.
