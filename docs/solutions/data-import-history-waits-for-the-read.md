# Data import history waits for the read

The data import settings tab names recent imports only after the job list returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The tab had no list, so a workspace with imports looked like none. A failed read with no payload did the same. A failed read kept a stale imported row. A failed status with `isError` still false kept that row.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not say no imports yet. Failed says the list did not load and does not keep a stale imported row. A settled null payload stays on no imports yet. A settled empty list stays on no imports yet. A loaded running job stays on Importing. A loaded complete job stays on Imported.
