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
// Cap so the in-process cache can't grow unbounded across the process lifetime
// (many orgs × accounts). At the ceiling we clear wholesale — entries are
// cheap to rebuild and 10s-lived. Mirrors access-scope.ts.
const DASHBOARD_CACHE_MAX = 500;
const dashboardCache = new Map<string, DashboardCacheEntry>();

function dashboardCacheKey(orgId: string, account: string | undefined): string {
  return `${orgId}:${account ?? ''}`;
}

/** Drop the in-process snapshot cache for one org (field-override writes call this). */
export function invalidateDashboardSnapshotCache(orgId: string): void {
  for (const key of dashboardCache.keys()) {
    if (key.startsWith(`${orgId}:`)) dashboardCache.delete(key);
  }
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
  if (dashboardCache.size >= DASHBOARD_CACHE_MAX) dashboardCache.clear();
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
        const snapshot = await req.cache(
          () => cachedDashboardSnapshot(req.auth.orgId, req.query.account, req.log),
          { ttlSeconds: 30, tags: ['crm-dashboard'] },
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
      const snapshot = await req.cache(
        () => cachedDashboardSnapshot(req.auth.orgId, undefined, req.log),
        { ttlSeconds: 30, tags: ['crm-release-score'] },
      );
      return snapshot.releaseScore;
    } catch (err) {
      req.log.error({ err, orgId: req.auth.orgId }, 'Error in /crm/release-score route');
      throw err;
    }
  });
};
