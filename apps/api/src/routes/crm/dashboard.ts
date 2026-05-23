import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { CrmDashboardSnapshot, ReleaseScore } from '@bidstack/shared';

import { buildDashboardSnapshot, normalizeName } from '../../services/crm/dashboard.service.js';

export const crmDashboardRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/dashboard',
    {
      schema: {
        querystring: z.object({ account: z.string().min(1).max(255).optional() }),
        response: { 200: CrmDashboardSnapshot },
      },
    },
    async (req) => {
      try {
        const snapshot = await buildDashboardSnapshot(
          req.auth.orgId,
          req.query.account,
          prisma,
          req.log,
        );
        if (req.query.account) {
          const normalized = normalizeName(req.query.account);
          const matched = snapshot.companies.some(
            (company) =>
              company.id === req.query.account || normalizeName(company.name) === normalized,
          );
          if (!matched) throw server.httpErrors.notFound('Account not found');
        }
        return snapshot;
      } catch (err) {
        req.log.error(
          { err, account: req.query.account, orgId: req.auth.orgId },
          'Error in /crm/dashboard route',
        );
        throw err;
      }
    },
  );

  server.get('/crm/release-score', { schema: { response: { 200: ReleaseScore } } }, async (req) => {
    try {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId, undefined, prisma, req.log);
      return snapshot.releaseScore;
    } catch (err) {
      req.log.error({ err, orgId: req.auth.orgId }, 'Error in /crm/release-score route');
      throw err;
    }
  });
};
