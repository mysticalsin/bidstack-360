# Agreement accounts wait for the read

The new-agreement dialog lists companies only after `useCompanies` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The account picker treated that as an empty catalog and offered Choose an account. A failed read with no payload did the same. A failed read kept a stale account. A failed status with `isError` still false kept that account.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not show Choose an account or a company. Failed says accounts did not load and does not keep a stale company. A settled null payload stays on Choose an account. A settled empty list stays empty. A loaded account stays, including a blank industry.
