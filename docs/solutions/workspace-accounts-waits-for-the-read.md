# Workspace mail waits for the read

## Problem

The email and calendar card treated a missing payload as an empty provider list. A paused read has `isLoading` false and no payload, so the card drew no mailboxes. An in-flight read showed only the skeleton. A failed read, including one that still held a stale mailbox, belongs on the error.

## Correction

`workspaceAccountsPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not draw an empty list, and it does not say the load failed. A failed read stays on the error and does not keep a stale mailbox. A settled list with no providers stays empty. A loaded mailbox still shows.

## Verification

`WorkspaceAccountsCard.read.test.tsx`. The paused and in-flight cases failed before the phase check.
