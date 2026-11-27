# Data residency waits for the read

Settings data residency renders the region form only after `useDataResidency` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as a failed load and said it could not load the data region.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null.

Unread says the setting has not arrived and does not show the form, strict mode, or the load error. Failed says the region could not be loaded and does not keep a stale region. A settled null payload says no data region is saved. A loaded region stays, including a region that is not pinned and strict mode off.
