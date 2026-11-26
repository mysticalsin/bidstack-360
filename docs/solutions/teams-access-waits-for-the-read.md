# Teams access waits for the read

The Teams import sheet renders chats only after `useTeamsAccess` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The sheet treated that as a failed load and said Teams access did not load. A failed read kept a stale mailbox in the header. A failed status with `isError` still false kept a stale chat. A null payload said the load failed.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and a named connection state.

Unread says the status has not arrived and does not show the failure, a connect prompt, a mailbox, or the chat list. Failed says Teams access did not load and does not keep a stale chat or mailbox. A settled null payload stays on the empty record. A settled read that is not connected still asks to connect. A loaded chat stays, including a blank mailbox.
