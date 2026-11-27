# Signing entities wait for the read

Settings signing entities render the catalog only after `useSigningEntities` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as an empty catalog and offered Add brand or branch. A failed status with `isError` still false kept a stale entity.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not show the catalog, Add brand, or the load error. Failed says the list could not be loaded and does not keep a stale entity. A settled null payload stays on the empty catalog. A settled empty list stays empty. A loaded entity stays, including a blank legal name.
