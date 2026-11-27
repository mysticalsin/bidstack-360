# Opportunity list stage chips use the demo stage once

## Problem

Demo pipeline stages are named Technical Iteration, Lead, Ongoing, and the rest. OP-2041 stores `stage = s3_technical_iteration` and leaves `pipelineStageId` null. The opportunities list drew both the catalog chip and a second chip named S3 Technical Iteration. The catalog chip matched no row, so it read as an empty stage. The row badge looked the stage up by that display name, and `stageTone` only knows the legacy key, so the badge was gray.

## Rule

One chip per catalog stage. When the catalog key is a legacy enum, the chip id is that key, which is what the list query already sends as `stage`, and the name is the catalog name. The row badge uses that same chip. Tone comes from the legacy key, including when the visible name is the demo name. A custom stage whose key is not a legacy enum stays on its id. Until the catalog has loaded, the legacy chip row stays.

## Verification

`pnpm --filter @bidstack/web exec vitest run src/pages/opportunities/opportunity-stage-chips.test.ts src/pages/OpportunitiesPage.stage-chips.test.tsx src/pages/OpportunitiesPage.test.tsx src/pages/OpportunitiesPage.export.test.tsx`
