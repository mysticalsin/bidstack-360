# Document templates wait for the read

## Problem

The send-for-signature document template menu treated a missing payload as an empty catalog. A paused read has `isLoading` false and no rows, so the menu showed only "Select a template…". An in-flight read was only a pulse. A failed read used that same empty menu.

## Correction

`documentTemplateCatalogPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not show an empty menu. A failed read stays on the error. A settled empty catalog still shows the empty menu. A loaded template still shows.

## Verification

`TemplateStep.list-read.test.tsx`. The paused, in-flight, and failed cases failed before the phase check.
