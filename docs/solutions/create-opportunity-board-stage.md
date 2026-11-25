# Create opportunity board stage

## Problem

New opportunity offered the legacy stage keys (`s1_ongoing`, `s4_negotiation`, …). The create route ignores `stage` unless `pipelineStageId` is set, then files the bid on the first pipeline column. Picking a later stage did not change where the bid landed.

## Fix

The dialog loads the org's pipeline stages and submits the chosen stage id plus that stage's key. Until the read settles, Create stays disabled. A failed read says so and does not fall back to the legacy keys. The default column is the first open stage.

## Verification

- `create-opportunity-stage.test.ts`
- `CreateOpportunityDialog.test.tsx`
