# Currency locale waits for the read

Settings currency and locale renders the saved form only after `useOrgLocaleSettings` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as a failed load and said it could not load currency and locale.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null.

Unread says the settings have not arrived and does not show the form or the load error. Failed says the settings could not be loaded and does not keep a stale form. A settled null payload says no currency and locale are saved. A loaded payload stays, including a blank date format.
