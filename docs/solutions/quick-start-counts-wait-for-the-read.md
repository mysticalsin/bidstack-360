# Quick Start counts wait for the read

Quick Start reads the org summary for the first lead and the first deal, and the teammate list for the invite step. A paused read has `isLoading` false and no payload. The checklist said to add a first lead, and the progress bar sat at zero. An in-flight read did the same. A failed status with `isError` still false kept a stale finished book and said the workspace was ready.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready. The summary and the teammate list each have their own phase.

Unread says the count has not arrived. It does not show the empty step, and it does not say the check failed. Failed says the check failed and does not keep a stale lead, deal, or team. A settled null payload stays empty. A settled zero stays empty. A loaded book stays, including a blank teammate name. A refresh that already has data stays on that book.
