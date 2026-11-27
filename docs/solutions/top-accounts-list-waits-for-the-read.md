# Top accounts wait for the read

Account Ranking renders the list only after `useTopAccounts` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The segment treated that as an empty ranking and said no accounts were ranked yet. A failed status with `isError` still false kept a stale account.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not show the catalog, the empty ranking, or the load error. Failed says the list could not be loaded and does not keep a stale account. A settled null payload stays on the empty ranking. A settled empty list stays empty. A loaded account stays, including a blank industry.
