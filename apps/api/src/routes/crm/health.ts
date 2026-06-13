import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DataQualityReport, ProviderHealth } from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildDataQualityReport,
} from '../../services/crm/dashboard.service.js';
import { defaultProviderHealth } from '../../services/crm/dashboard.providers.js';

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

  // On-demand liveness re-check. "Test now" in Settings → Integrations calls
  // this to re-evaluate every provider's connectivity/config RIGHT NOW (fresh
  // timestamp), instead of waiting for the 30s poll — so an admin can confirm a
  // connector is still alive after fixing credentials. Admin + integrations
  // gated; reads no tenant data.
  server.post(
    '/crm/provider-health/test',
    {
      preHandler: [server.requirePermission('integrations:read'), server.requireRole('admin')],
      schema: {
        response: {
          200: z.object({ items: z.array(ProviderHealth), checkedAt: z.string().datetime() }),
        },
      },
    },
    async () => {
      // Re-reads env/config and re-runs the connector catalog at call time, so
      // status + lastCheckedAt reflect the current moment.
      return { items: defaultProviderHealth(), checkedAt: new Date().toISOString() };
    },
  );
};
