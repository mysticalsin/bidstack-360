import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AccountCockpitSnapshot,
  CrmDashboardSnapshot,
  DataQualityReport,
  ProviderHealth,
  ReleaseScore,
} from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildDataQualityReport,
  normalizeName,
} from '../services/crm/dashboard.service.js';

export const crmDashboardRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/dashboard',
    {
      schema: {
        querystring: z.object({ account: z.string().min(1).optional() }),
        response: { 200: CrmDashboardSnapshot },
      },
    },
    async (req) => buildDashboardSnapshot(req.auth.orgId, req.query.account, prisma, req.log),
  );

  server.get(
    '/crm/companies/:id',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        response: { 200: AccountCockpitSnapshot },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, req.params.id, prisma, req.log);
      const company =
        snapshot.companies.find((item) => item.id === req.params.id) ??
        snapshot.companies.find((item) => normalizeName(item.name) === req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      return snapshot.cockpit;
    },
  );

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

  server.get('/crm/release-score', { schema: { response: { 200: ReleaseScore } } }, async (req) => {
    const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
    return snapshot.releaseScore;
  });
};
