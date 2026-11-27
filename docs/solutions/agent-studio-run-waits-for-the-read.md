# Agent studio runs wait for the status read

## Evidence

`AgentStudioPage` printed `queued` whenever the crew run payload was missing.
A paused first read has `isLoading` false and no status, and a failed read
has no status either. Both still said queued. An in-flight read did the same.

## Correction

`agentStudioRunPhase` reports unread, failed, or ready. Unread says the status
has not arrived. It does not say queued, and it does not say the run is empty
or available. A failed read still says it could not load the run status. A
settled queued run still says queued. A settled finished run still shows its
output, including a finished run whose output is empty.

## Verification

`AgentStudioPage.run-read.test.tsx`. The paused, in-flight, and failed cases
failed before the phase check.
