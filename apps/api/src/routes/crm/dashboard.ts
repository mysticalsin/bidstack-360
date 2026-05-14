import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { CrmDashboardSnapshot, ReleaseScore } from '@bidstack/shared';

import {
  buildDashboardSnapshot,
  buildCockpitFromCompany,
  normalizeName,
} from '../../services/crm/dashboard.service.js';

export const crmDashboardRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/dashboard',
    {
      schema: {
        querystring: z.object({ account: z.string().min(1).optional() }),
        response: { 200: CrmDashboardSnapshot },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      if (!req.query.account) return snapshot;
      const target =
        snapshot.companies.find((c) => c.id === req.query.account) ??
        snapshot.companies.find((c) => normalizeName(c.name) === req.query.account);
      if (!target) return snapshot;
      return { ...snapshot, cockpit: buildCockpitFromCompany(snapshot, target) };
    },
  );

  server.get('/crm/release-score', { schema: { response: { 200: ReleaseScore } } }, async (req) => {
    const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
    return snapshot.releaseScore;
  });
};
