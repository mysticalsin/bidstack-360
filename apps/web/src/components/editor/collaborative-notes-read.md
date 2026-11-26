# Collaborative notes wait for the document

## Problem

The collaborative notes section mounted the pad before the Y.Doc arrived. An idle read has no entity. A paused read is disconnected and has no text. An in-flight read can hold a local empty Y.Text. The section still passed the empty invitation, so the pad said Start writing collaborative notes, or it showed a blank editor. A failed read used that same invitation.

## Correction

`collaborativeNotesPhase` reports unread, failed, empty, or ready. Unread says the notes have not arrived. It does not invite writing, and it does not mount the pad. A failed read stays on the error and offers retry. A connected empty document still mounts the pad. A note that arrived still shows, including when a later read fails.

## Verification

`CollaborativeNotesSection.read.test.tsx`. The idle, paused, in-flight, and failed cases failed before the phase check.
