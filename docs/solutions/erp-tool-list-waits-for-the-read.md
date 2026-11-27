# ERP tool list waits for the read

## Evidence

`buildPresalesKit` treated a failed tool probe as a live local fallback. The
route passes `tools: []` and `lastError` when `listTools` throws or SERUM
denies the probe. `nextActions[0]` still said the local Polo PreSales fallback
remains active. The integrations card prints that line. The module catalog was
still there, so the kit did not look empty, but the sentence said local.

## Correction

When `lastError` is set, the only next action is "The ERP tool list has not
arrived." The module ids stay. A settled unset kit, `lastError` null, still
says to set `ERP_MCP_URL` and still marks modules ready. A tool list that
arrived still marks the partner module sidecar.

## Verification

`erp.kit.failed-read.test.ts`. The failed-list case failed before the
`lastError` check.
