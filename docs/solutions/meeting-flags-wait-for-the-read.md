# Meeting flags wait for the read

## Evidence

The cross-region flags page treated a missing payload as an empty book. A paused first read has `isLoading` false and no rows, so the page said No open flags. The tab used the same Cross-region flags label as zero flags. An in-flight read showed only the skeleton. A failed read kept that zero-flag label on the tab.

## Correction

`meetingFlagsPhase` reports unread, failed, or ready. Unread says the flags have not arrived. It does not say No open flags or Nothing dismissed. The tab says Checking flags, not the zero-flag label. A failed read says Couldn't load flags on the page and on the tab. A settled empty list still says No open flags or Nothing dismissed. A loaded flag still shows, and the tab still counts the flags that arrived.

## Verification

`MeetingFlagsPage.flags-read.test.tsx`. The paused read, the in-flight read, and the failed tab failed before the phase check.
