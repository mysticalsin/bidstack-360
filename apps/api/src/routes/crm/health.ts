import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DataQualityReport, ProviderHealth } from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildDataQualityReport,
} from '../../services/crm/dashboard.service.js';
import { defaultProviderHealth } from '../../services/crm/dashboard.providers.js';
import { probeSillageConnectivity } from '../../providers/sillage-signals.js';

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
      const items = defaultProviderHealth();
      const checkedAt = new Date().toISOString();
      // Sillage additionally gets a REAL connectivity check (MCP initialize
      // round trip, or a minimal REST call) instead of the catalog's
      // credential-presence guess — the point of "Test now" is proving the
      // configured lane actually answers. Skipped (lane null) when no
      // SILLAGE_* credential is set, leaving the catalog's 'disabled' row.
      const probe = await probeSillageConnectivity();
      const sillage = items.find((row) => row.provider === 'Sillage Buying Signals');
      if (sillage && probe.lane) {
        sillage.status = probe.ok ? 'healthy' : 'down';
        sillage.latencyMs = probe.latencyMs;
        sillage.lastCheckedAt = checkedAt;
        sillage.message = probe.ok
          ? `Sillage ${probe.lane} probe ok`
          : `Sillage ${probe.lane} probe failed: ${probe.error ?? 'unknown error'}`;
      }
      return { items, checkedAt };
    },
  );
};
