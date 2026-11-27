# Sync status waits for the read

The sync control names a last sync only after the overview read returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The control treated that as never synced. A failed read with no payload did the same. A failed read kept a stale last sync and a finished run. A failed status with `isError` still false kept that time.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an overview with no last sync.

Unread says the status has not arrived and does not say never synced. Failed says the sync status did not load and does not keep a stale time. A settled null payload stays on never synced. A settled overview with no last sync stays never synced. A loaded time stays, including a blank last run.
