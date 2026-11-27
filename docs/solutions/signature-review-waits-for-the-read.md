# Signature review waits for the read

## Problem

The send-for-signature review step treated a missing template as a missing preview. A paused read has `isLoading` false and no payload, so the step showed the message form with no document. An in-flight read did the same. A failed read, including one that still held a stale body, kept or hid the preview instead of staying on the error.

## Correction

`signatureReviewPhase` reports unread, failed, or ready. Unread says the preview has not arrived. It does not show the document, and it does not say the preview is unavailable. A failed read stays on the error and does not keep a stale document. A settled template with an empty body stays an empty preview. A loaded document still shows.

## Verification

`ReviewStep.read.test.tsx`. The paused, in-flight, failed, and stale-document cases failed before the phase check.
