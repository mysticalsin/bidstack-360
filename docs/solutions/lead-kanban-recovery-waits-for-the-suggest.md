# Recovery plays wait for the suggest

## Problem

The lead kanban recovery menu treated a missing play list as no suggestions. Opening the menu awaits the suggest. Until that payload arrived, the menu said "No suggestions." A rejected suggest used the same sentence.

## Correction

The menu phase is unread, failed, empty, or ready. Unread says the plays have not arrived. It does not say there are no suggestions. A failed suggest stays on the error and does not say there are no suggestions. A suggest that arrived with no plays still says there are no suggestions. A play that arrived still shows.

## Verification

`recovery-menu-read.test.ts` refuses an empty answer while the suggest is pending or failed, and still allows an arrived empty list. `LeadKanbanView.recovery.test.tsx` opens the menu. The in-flight and failed cases said "No suggestions." before the phase check.
