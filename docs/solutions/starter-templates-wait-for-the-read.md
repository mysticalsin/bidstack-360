# Starter templates wait for the read

## Problem

The starter pipeline picker treated a missing payload as an empty catalog. A paused read has `isLoading` false and no rows, so the picker showed a blank list and a disabled install. An in-flight read was only a skeleton.

## Correction

`templateCatalogPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not show a blank catalog. A failed read stays on the error. A settled empty catalog still shows no templates. A loaded template still shows.

## Verification

`TemplatePicker.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
