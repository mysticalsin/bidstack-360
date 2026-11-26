# Workflows list waits for the read

## Evidence

`WorkflowsPage` treated a missing list payload as an empty book. A paused first
read has `isLoading` false and no rows, so the page said No workflows yet. An
in-flight read showed only the skeleton.

## Correction

`workflowsListPhase` reports unread, failed, or ready. Unread says the list has
not arrived. It does not say No workflows yet, and it does not count 0. A failed
read still says Failed to load workflows. A settled empty list still says No
workflows yet and still counts 0. A loaded workflow still shows.

## Verification

`WorkflowsPage.list-read.test.tsx`. The paused and in-flight cases failed before
the phase check.
