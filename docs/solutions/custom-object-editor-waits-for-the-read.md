# Custom object editor waits for the read

## Problem

The custom object editor treated a missing catalog as a missing object. A paused read has `isLoading` false and no payload, so the page said Object not found. An in-flight read showed only the pulse.

## Correction

`customObjectEditorPhase` reports unread, failed, or ready. Unread says the record has not arrived. It does not say the object is missing. A failed read stays on the error and does not keep a stale object. A settled catalog that has no such id still says Object not found. A loaded object still shows.

## Verification

`CustomObjectEditorPage.read.test.tsx`. The paused and in-flight cases failed before the phase check.
