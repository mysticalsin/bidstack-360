# Integration summary waits for the setup contract

**Problem:** The integrations control plane said Needs setup, and the Dust metric said Not synced, while the setup contract and Dust status were still undefined.

**Diagnosis:** `buildIntegrationSummary` treated a missing guide as an unconfigured contract (`!guide`) and a missing Dust status as a status with no `lastSyncAt`. Both undefined values are an unread or failed read, not a settled payload.

**Fix:** In `apps/web/src/pages/integrations/integration-helpers.ts`, an absent guide uses posture "Setup contract has not arrived" (gray). An absent Dust status uses "Sync time has not arrived". A returned unconfigured contract still says Needs setup. A returned status with a null sync time still says Not synced. A returned, configured contract with no event errors still says Ready.

**Why it works:** The settings page passes `setupGuide.data` and `status.data` through. Those stay undefined until the query settles, including a paused read and a failed read that stored nothing. The hero prints `postureLabel` and `latestSyncLabel` as written, so the words have to be honest before they reach the card.

**Prevention:** `apps/web/src/pages/integrations/integration-summary-read.test.ts` rejects Needs setup, Ready, and Not synced when both payloads are missing, and keeps those words for settled results.
