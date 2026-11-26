# MSA review waits for the signing-entity list

The review select offered Not confirmed before `useSigningEntities` returned a catalog. A paused or in-flight read has `data === undefined` and `isLoading` false. A failed status with `isError` still false kept a stale entity. Confirm could save that miss.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived, hides Not confirmed, and blocks confirm. Failed says the catalog could not be loaded, drops a stale entity, and blocks confirm. A settled null payload stays on Not confirmed. A settled empty list stays on Not confirmed. A loaded entity stays, including an unverified one.
