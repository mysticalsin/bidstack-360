# Key-account candidates wait for the read

The designate dialog lists companies only after `useKamCandidates` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. Once the search is long enough to run, the dialog treated that as no matching companies. A failed read with no payload said the same. A failed read kept a stale company. A failed status with `isError` still false kept that company.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not show the empty sentence or a company. Failed says companies did not load and does not keep a stale company. A settled null payload stays on the empty sentence. A settled empty list stays empty. A loaded company stays, including a blank industry. A search shorter than two characters stays idle, because that read has not started.
