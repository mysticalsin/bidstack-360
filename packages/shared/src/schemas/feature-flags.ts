// Runtime feature flags served by GET /api/v1/config/features.
// Env-driven on the API (see apps/api/src/env.ts) so a flag flip is a
// restart, not a SPA rebuild. The brief's rule: a disabled flag HIDES its
// block entirely — never an empty or null state.
import { z } from 'zod';

export const FeatureFlags = z.object({
  /** Win/Loss block on the account view — gated until the OM API ships the field. */
  winLossDataAvailable: z.boolean(),
  /** Revenue + revenue-evolution block — gated until the ABC revenue API is live. */
  showRevenueBlock: z.boolean(),
  /** InfoSearch lead-intel integration (MCP). */
  infosearchEnabled: z.boolean(),
  /** 360Learning Sales Toolkits section. */
  lms360Enabled: z.boolean(),
  /** SERUM control-plane surfaces. Defaults off until the backend is configured. */
  serumEnabled: z.boolean(),
  /** Explicit demo/safe-mode surfaces. Defaults off and must never mimic production activity. */
  serumDemoModeEnabled: z.boolean(),
});
export type FeatureFlags = z.infer<typeof FeatureFlags>;
