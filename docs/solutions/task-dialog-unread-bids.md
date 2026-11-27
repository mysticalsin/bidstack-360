# An unread bid list is not an empty link on a new task

## Evidence

The new-task dialog loads the bid book so a follow-up can be linked. A paused read leaves `isLoading` false and no payload. The opportunity control showed only None. A failed read did the same. None is the sentence for a book that arrived with no bids.

## Correction

A pending or failed read says the bids have not arrived. It does not offer None. A book that arrived with no bids still offers None. A bid that arrived stays on the list. Creating an unlinked follow-up stays available.

## Verification

`task-bid-link.test.ts` refuses a missing payload as an empty link list, and still allows an arrived book with no bids and an arrived bid. `CreateTaskDialog.bid-link.test.tsx` renders the dialog.
