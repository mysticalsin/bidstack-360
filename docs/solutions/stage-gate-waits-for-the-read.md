# Stage-gate enforcement waits for the read

Settings stage-gate enforcement renders the mode form only after `useStageGateMode` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as a failed load and said it could not load stage-gate enforcement.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null.

Unread says the setting has not arrived and does not show the mode form, Off, or the load error. Failed says the mode could not be loaded and does not keep a stale mode. A settled null payload says no stage-gate enforcement is saved. A loaded mode stays, including Off and a mode that inherits the server default.
