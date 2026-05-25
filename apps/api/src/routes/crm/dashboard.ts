import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { CrmDashboardSnapshot, ReleaseScore } from '@bidstack/shared';

import { buildDashboardSnapshot, normalizeName } from '../../services/crm/dashboard.service.js';

type DashboardSnapshot = Awaited<ReturnType<typeof buildDashboardSnapshot>>;
type DashboardCacheEntry = {
  expiresAt: number;
  promise: Promise<DashboardSnapshot>;
};

const DASHBOARD_CACHE_TTL_MS = 10_000;
const dashboardCache = new Map<string, DashboardCacheEntry>();

function dashboardCacheKey(orgId: string, account: string | undefined): string {
  return `${orgId}:${account ?? ''}`;
}

async function cachedDashboardSnapshot(
  orgId: string,
  account: string | undefined,
  log: Parameters<typeof buildDashboardSnapshot>[3],
): Promise<DashboardSnapshot> {
  const key = dashboardCacheKey(orgId, account);
  const now = Date.now();
  const cached = dashboardCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildDashboardSnapshot(orgId, account, prisma, log);
  dashboardCache.set(key, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    dashboardCache.delete(key);
    throw err;
  }
}

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
        const snapshot = await cachedDashboardSnapshot(req.auth.orgId, req.query.account, req.log);
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
      const snapshot = await cachedDashboardSnapshot(req.auth.orgId, undefined, req.log);
      return snapshot.releaseScore;
    } catch (err) {
      req.log.error({ err, orgId: req.auth.orgId }, 'Error in /crm/release-score route');
      throw err;
    }
  });
};
