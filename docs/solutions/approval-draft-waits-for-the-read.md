# Approval draft waits for the read

The review gate draws while an RFP is awaiting approval. That gate reads the draft with React Query. A paused read has `isLoading` false and no proposal. The checklist still appeared. An in-flight read did the same. A failed read did not stay on the error, including when a stale draft was still in memory.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the proposal has not arrived. It does not draw the checklist. Failed says the draft could not be loaded and does not keep a stale checklist. A settled draft with no proposal still shows the gate. A loaded draft still shows the checklist.
