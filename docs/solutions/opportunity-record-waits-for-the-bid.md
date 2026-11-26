# Opportunity detail waits for the bid

## Evidence

`OpportunityDetailPage` treated `isLoading` as the only unread state. A paused
first read has `isLoading` false and no record, so the page said "Opportunity
not found" and that the bid may have been deleted. An in-flight read showed
the skeleton and did not say the opportunity had not arrived.

## Correction

`opportunityRecordPhase` reports unread, failed, missing, or ready. Unread
(in flight or paused, no record) says "Checking this opportunity. The
opportunity has not arrived." and keeps the detail skeleton. A 404 still
says "Opportunity not found". Any other failed read stays on "Couldn't load
this opportunity" and offers Retry. A settled success with no record still
says the opportunity is missing. A record that arrived still shows.

## Verification

`OpportunityDetailPage.record-read.test.tsx`. The paused and in-flight cases
failed before the phase check.
