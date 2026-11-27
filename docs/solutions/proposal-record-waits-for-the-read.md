# Proposal detail waits for the read

## Evidence

`ProposalDetailPage` treated `isLoading` as the only unread state. A paused
first read has `isLoading` false and no proposal, so the page said
"Proposal not found." An in-flight read showed the skeleton and did not say
the proposal had not arrived.

## Correction

`proposalRecordPhase` reports unread, failed, missing, or ready. Unread
(in flight or paused, no proposal) says "Checking this proposal. The
proposal has not arrived." and keeps the detail skeleton. A failed read
stays on "Failed to load proposal". A settled success with no record still
says "Proposal not found." A proposal that arrived still shows.

## Verification

`ProposalDetailPage.record-read.test.tsx`. The paused and in-flight cases
failed before the phase check.
