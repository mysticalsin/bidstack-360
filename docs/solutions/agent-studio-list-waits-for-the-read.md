# Agent studio lists wait for the read

## Evidence

`AgentStudioPage` treated a missing agents payload as an empty catalog, and a
missing crews payload the same way. A paused first read has `isLoading` false
and no rows, so the page said No agents yet and No crews yet. An in-flight
read showed only the skeleton.

## Correction

`agentStudioListPhase` reports unread, failed, or ready. Unread says the list
has not arrived. It does not say No agents yet or No crews yet, and it does
not count 0. A failed read still says it could not load that list. A settled
empty list still says No agents yet or No crews yet. A loaded agent and a
loaded crew still show.

## Verification

`AgentStudioPage.list-read.test.tsx`. The paused and in-flight cases failed
before the phase check.
