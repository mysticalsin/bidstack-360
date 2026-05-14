import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DataQualityReport, ProviderHealth } from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildDataQualityReport,
} from '../../services/crm/dashboard.service.js';

export const crmHealthRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/data-quality',
    { schema: { response: { 200: DataQualityReport } } },
    async (req) =>
      buildDataQualityReport(
        await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log),
      ),
  );

  server.get(
    '/crm/provider-health',
    { schema: { response: { 200: z.object({ items: z.array(ProviderHealth) }) } } },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      return { items: snapshot.providerHealth };
    },
  );
};
