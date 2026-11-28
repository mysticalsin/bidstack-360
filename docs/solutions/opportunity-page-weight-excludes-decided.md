# Page-weighted opportunity figures exclude decided bids

## Evidence

The opportunities KPI strip computed WR (page) and the pre-summary Open (page)
card from rows whose `pipelineStage` was not flagged won or lost. Demo seed
writes `closed_won` / `closed_lost` on the legacy `stage` field and leaves
`pipelineStage` null. Stellantis (620,000 at probability 100) was added in
full, so WR (page) read 1,340,000 instead of 720,000 next to an open Siemens
bid of 1,200,000 at 60%. The server summary already excludes those stages.

## Correction

`weightedOpenPageValue` and `openPagePipelineValue` resolve the stage the same
way the row does (`resolvePipelineStage`) and skip won or lost bids. An
attached pipeline stage's won/lost flags still win over a stale stage string.
Unfiltered headline counts stay on the server summary.
