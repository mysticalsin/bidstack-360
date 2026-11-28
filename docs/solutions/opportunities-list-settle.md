# An opportunities read that has not settled is not an empty book

## Evidence

On `/opportunities`, the header used `data?.items.length ?? 0` while the list was still loading, so the sentence was "0 bids in flight" before the demo bids arrived. A failed read used the same zero and an error that said "Try again in a moment" with no control. A later refresh that failed replaced the rows already on screen with that error.

## Correction

Until the first payload arrives, the header says the list is loading or that it did not load. The error offers Retry on the same read. A refresh that fails after a page has loaded keeps that page. A successful empty page may still say there are no bids in flight.

## Verification

`OpportunitiesPage.test.tsx`.
