# SERUM status waits for the read

## Problem

SERUM Mission Control treated a status read that had not arrived as a settled answer. A paused read has `isLoading` false and no snapshot, and the page said the control plane was unavailable. An in-flight read was only a skeleton in the place a settled empty mission uses for "no ledger", "no heartbeats", "no queue snapshots", "none recorded", and zero counts.

## Pattern

- Say the ledger, heartbeats, queues, approvals, and zero counts only after the status payload arrives.
- A missing snapshot is unread, including a paused read. Say the status has not arrived.
- A failed read stays on the SERUM error state. It does not say the mission is empty.
- A snapshot that arrived empty still says so. A loaded module and provider still show.

## Implementation

- `apps/web/src/pages/serum-status-read.ts`
- `apps/web/src/pages/SerumMissionControlPage.tsx`
- `apps/web/src/pages/SerumMissionControlPage.status-read.test.tsx`

Settings SERUM switches stay on their own slice. This page does not change them.
