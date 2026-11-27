# Document search waits for the read

## Problem

Document search treated a missing payload as a blank result under Found inside documents. A paused read has `isLoading` false and no hits, so the section rendered only its heading. An in-flight read said only that it was searching the files.

## Correction

`documentHitsReadPhase` reports unread, failed, or ready. Unread says the hits have not arrived. It does not say no file text matches. A failed read stays on the error. A settled search with no hits still says no file text matches. A loaded hit still shows.

## Verification

`DocumentHits.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
