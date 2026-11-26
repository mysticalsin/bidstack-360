# An unread leads list is not an empty funnel

## Evidence

The leads list summary counts Pipeline-ready from the loaded page. A paused read leaves `isLoading` false and no payload. The summary said Pipeline-ready 0. The card said "The funnel is empty". The status line said "0 lead". A failed read kept the error text and did not say the list had not arrived.

## Correction

A pending read says "Checking leads. They have not arrived." It does not count Pipeline-ready, and it does not use the empty funnel. A failed read keeps the error and says "The leads have not arrived." A payload that arrived empty still says the funnel is empty and Pipeline-ready 0. A qualified lead that arrived, including a cold outreach source, still shows and counts as pipeline-ready. The first fetch still uses the skeleton.

## Verification

`leads-list-read.test.ts` refuses a count of 0 while the read is pending or failed, and still allows an arrived empty funnel. `LeadsPage.unread.test.tsx` renders the list without the empty funnel or Pipeline-ready until the payload arrives.
