# A deal record stage change has to move the board column

## Evidence

Demo OP-2041 is backfilled onto the pipeline stage named Technical Iteration. The detail serializer then sends that name in `stage`. The record's stage control still listed the legacy enum (S1 Lead through Closed Lost) and PATCHed `{ stage }`. That write updates the enum and leaves `pipelineStageId` on the open column. The deal board groups by that id, so the card stays put, and a refetch paints the old column name. Opening the control also landed on S1 Lead, because the name does not match an enum value. A failed stage-list read fell through to the same enum.

## Correction

When the org has pipeline stages, the control lists those column names and posts the stage id through the stage move. An org with no pipeline stages still patches the legacy enum. If the stage list fails, the record shows the current column and says the list did not load. It does not offer the enum.
