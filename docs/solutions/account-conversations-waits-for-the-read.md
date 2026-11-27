# Account conversations wait for the read

Account conversations render the list only after `useAccountConversations` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as a failed load and said the conversations did not load. It still offered Import from Teams. A failed status with `isError` still false kept a stale conversation. A null payload said the load failed.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null and an empty list.

Unread says the list has not arrived and does not show the card, Import from Teams, or the load error. Failed says the conversations did not load and does not keep a stale conversation or Import from Teams. A settled null payload stays on the empty list. A settled empty list stays empty. A loaded conversation stays, including a blank subject.
