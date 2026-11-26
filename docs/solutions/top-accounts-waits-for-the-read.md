# Top accounts wait for the read

The settings curator for the global Top 10 opens before `GET /api/accounts/top` returns. A paused read has `isLoading` false and `data` undefined. The section then said there were no curated accounts and that the page was auto-ranked.

`topAccountsReadPhase` is error, then unread, then ready. Error wins, including `status === 'error'` while `isError` is still false. Undefined data is unread. A settled null payload and a settled empty or auto list stay on the empty sentence. A loaded account stays, including a blank industry and a zero pipeline.

The company search under the list is a separate read and is unchanged.
