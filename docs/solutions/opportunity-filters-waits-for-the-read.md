# Opportunity filters wait for the read

Settings opportunity filters render the saved rules only after `useOpportunityFilters` returns a payload. A paused or in-flight read has `data === undefined` and `isLoading` false. The section treated that as a failed load and said it could not load filter rules.

The phase is `unread`, `failed`, or `ready`. An error is `failed`. Undefined data is `unread`. A payload that arrived is `ready`, including null.

Unread says the rules have not arrived and does not show the form or the load error. Failed says the rules could not be loaded and does not keep a stale form. A settled null payload says no opportunity filters are saved. A loaded payload stays, including an empty expertise list.
