# An unread notes list is not an empty account

## Evidence

The account notes panel treats `isLoading` as the only unread state. A paused read leaves `isLoading` false and no payload, so the card said "No notes yet". A failed read said "Couldn't load notes" and "Unknown error". The row is the note detail, so that miss reads as a settled empty account.

## Correction

A pending read says "Checking notes. They have not arrived." A failed read says "Could not load notes. The notes have not arrived." Neither sentence says the list is empty, and neither says the error is unknown. A payload that arrived empty still says no notes yet. A note that arrived still shows its title, body, and author. A missing account still asks for an account.

## Verification

`notes-list-read.test.ts` refuses a count of 0 while the read is pending or failed, and still allows an arrived empty list. `NotesPanel.unread.test.tsx` renders the panel without the empty or unknown sentences until the payload arrives.
