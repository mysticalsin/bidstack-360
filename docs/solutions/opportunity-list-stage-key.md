# Opportunity list stage chips use the seeded key

## Problem

Demo pipeline stages are UUIDs. The seed writes `stage = s3_technical_iteration` and leaves `pipelineStageId` null (OP-2041). The opportunities list chip stored the UUID and sent it as `pipelineStageId`. The filtered list and its CSV export came back empty while the chip stayed pressed.

## Rule

When the stage catalog key is a legacy enum, the list and the export ask for `stage`, the value the seed stored and the value the API writes when a bid moves. A custom stage whose key is not that enum still asks for `pipelineStageId`. A chip that is already a legacy id stays on `stage`.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/pages/opportunities/opportunity-list-stage.test.ts src/pages/OpportunitiesPage.stage-filter.test.tsx src/pages/OpportunitiesPage.test.tsx src/pages/OpportunitiesPage.export.test.tsx`
