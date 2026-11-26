# Call transcript waits for the read

## Evidence

`CallTranscriptViewer` treated an empty segment list as a missing transcript.
The calls detail panel passes that empty list until `useCall` returns. A paused
or in-flight read therefore said "Transcript not yet available." A failed read
said the same thing.

## Correction

`callTranscriptPhase` reports local, unread, failed, or ready. A call id makes
the viewer own the read. Unread says the call has not arrived. A failed read
says the transcript failed to load. A settled call with no transcript still
says "Transcript not yet available." A transcript on the payload still shows.
A caller that already holds segments and passes no call id still shows them.

## Verification

`CallTranscriptViewer.read.test.tsx`. The paused, in-flight, failed, and
arrived cases failed before the phase check.
