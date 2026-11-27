# Document template preview waits for the read

## Problem

The send-for-signature review step treated a missing template payload as no preview. A paused read has `isLoading` false and no body, so Send for Signature stayed enabled with nothing on screen. An in-flight read did the same. A failed read used that same blank and still looked ready to send.

## Correction

`documentTemplatePreviewPhase` reports absent, unread, failed, or ready. Unread says the preview has not arrived and keeps Send disabled. It does not say there is no preview. A failed read stays on the error and keeps Send disabled. A settled empty body still says there is no preview, and Send stays available. A loaded proposal template still shows. A review that never asked for a template still sends.

## Verification

`ReviewStep.template-read.test.tsx`. The paused, in-flight, failed, and settled-empty cases failed before the phase check.
