// Runtime feature flags for the SPA — env-driven, org-agnostic, read-only.
// One tiny endpoint so changing a flag is an API restart, not a web rebuild.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { FeatureFlags } from '@bidstack/shared';

import { getEnv } from '../env.js';

export const configFeaturesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/config/features',
    { schema: { response: { 200: FeatureFlags } } },
    async () => {
      const env = getEnv();
      return {
        winLossDataAvailable: env.WIN_LOSS_DATA_AVAILABLE === 'true',
        showRevenueBlock: env.SHOW_REVENUE_BLOCK === 'true',
        infosearchEnabled: env.INFOSEARCH_ENABLED === 'true',
        lms360Enabled: env.LMS_360L_ENABLED === 'true',
        serumEnabled: env.SERUM_ENABLED === 'true',
        serumDemoModeEnabled: env.SERUM_DEMO_MODE_ENABLED === 'true',
      };
    },
  );
};
