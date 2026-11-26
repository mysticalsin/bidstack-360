# Public sign waits for the read

## Problem

The public signing page treated a missing payload as a missing document. A paused read has `isLoading` false and no document, so the page showed an empty shell. An in-flight read showed only the loading shimmer. A failed read said the link was invalid.

## Correction

`publicSignPhase` reports unread, failed, settled, or ready. Unread says the document has not arrived. It does not say the link is invalid, and it does not say the link expired. A failed read says the link could not be loaded. A link the server closed as invalid, expired, or already signed stays on that sentence. A loaded document still shows.

## Verification

`PublicSignPage.read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
