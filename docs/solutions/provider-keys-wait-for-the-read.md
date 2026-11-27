# Provider keys wait for the read

## Problem

The model provider card treated a missing payload as an empty catalog. A paused read has `isLoading` false and no rows, so the card said No provider list returned. An in-flight read showed only the loading skeleton.

## Correction

`agentProviderCredentialsPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say no provider list returned. A failed read stays on the error. A settled empty catalog still says no provider list returned. A loaded provider still shows.

## Verification

`AgentProviderCredentialsCard.read.test.tsx`. The paused and in-flight cases failed before the phase check.
