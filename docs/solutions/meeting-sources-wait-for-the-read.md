# Meeting sources wait for the read

## Problem

Settings, Meeting sources treated a missing source list as not connected. A paused first read has `isLoading` false and no payload, so the panel offered Connect Métis and Sync now. That is the settled not-connected book. The list had not arrived.

## Correction

A missing payload says the sources have not arrived. It does not offer Connect or Sync, and it does not say Not connected or Not configured. An in-flight read stays on Loading sources. A failed read stays on Meeting sources are unavailable. A settled not-connected row still offers Connect. A connected Métis row still shows Connected and Revoke.

## Verification

`meeting-sources-read.test.tsx`. The paused case failed before the missing-payload check.
