# Matched stories wait for the read

## Problem

The matched stories panel treated a missing payload as an empty catalog. A paused read has `isLoading` false and no rows, so the panel said "No stories matched". An in-flight read was only a skeleton.

## Correction

`storyMatchPhase` reports unread, failed, or ready. Unread says the list has not arrived. It does not say "No stories matched", and it does not count 0. A failed read stays on the error. A settled empty list still says "No stories matched". A loaded story still shows.

## Verification

`StoryMatchPanel.list-read.test.tsx`. The paused and in-flight cases failed before the phase check.
