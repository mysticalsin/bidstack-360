# Opportunity bid score waits for the read

## Evidence

`BidScoreCard` treated `isLoading` as the only unread state. A paused first read has `isLoading` false and no row, so the card said "No bid evaluation score has been recorded for this opportunity yet" and offered Evaluate Now. An in-flight read showed only the pulse and did not say the score had not arrived.

## Correction

`opportunityBidScorePhase` reports unread, failed, missing, or ready. Unread (in flight or paused, no row) says "Checking the bid score. The score has not arrived." A 404 still says no score was recorded and still offers Evaluate Now. Any other failed read stays on "Could not load the bid score. Refresh to try again." A settled success with no row still says the bid has no score. A score that arrived, including 61520, still shows.

## Verification

`BidScoreCard.read-honesty.test.tsx`. The paused and in-flight cases failed before the phase check.
