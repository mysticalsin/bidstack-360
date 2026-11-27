# Bid score waits for the read

## Evidence

`BidNoBidPage` treated a missing latest-score payload as an unscored deal. A paused first read has `isLoading` false and no row, so the matrix said Not yet rated and showed a composite of 0. An in-flight read did the same. A failed read did the same.

## Correction

`bidScoreReadPhase` reports idle, unread, missing, failed, or ready. Unread says the score has not arrived. It does not say Not yet rated, and it does not show a composite of 0. A failed read says Could not load the bid score. A settled 404 still says Not yet rated and still shows 0. A loaded score still shows.

## Verification

`BidNoBidPage.score-read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
