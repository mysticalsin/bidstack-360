import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { CrmDashboardSnapshot, ReleaseScore } from '@bidstack/shared';

import { isExpectedClientAbortError } from '../../lib/http-client-abort.js';
import { buildDashboardSnapshot, normalizeName } from '../../services/crm/dashboard.service.js';
import { getReleaseScore } from '../../services/crm/dashboard.queries.js';
import { getAccessScope, scopeCacheTag, type AccessScope } from '../../lib/access-scope.js';

type DashboardSnapshot = Awaited<ReturnType<typeof buildDashboardSnapshot>>;
type ReleaseScoreResult = Awaited<ReturnType<typeof getReleaseScore>>;
type AbortRequestState = Parameters<typeof isExpectedClientAbortError>[1];
type DashboardCacheEntry = {
  expiresAt: number;
  promise: Promise<DashboardSnapshot>;
};
type ReleaseScoreCacheEntry = {
  expiresAt: number;
  promise: Promise<ReleaseScoreResult>;
};

const DASHBOARD_CACHE_TTL_MS = 10_000;
// Cap so the in-process cache can't grow unbounded across the process lifetime
// (many orgs × accounts). At the ceiling we clear wholesale — entries are
// cheap to rebuild and 10s-lived. Mirrors access-scope.ts.
const DASHBOARD_CACHE_MAX = 500;
const dashboardCache = new Map<string, DashboardCacheEntry>();
// Release score is org-wide and scope-independent, so it gets its own tiny
// org-keyed cache instead of riding the (org × scope × account)-keyed snapshot
// cache. Same TTL/cap/clear-on-ceiling discipline as the snapshot cache above.
const releaseScoreCache = new Map<string, ReleaseScoreCacheEntry>();

function shouldSuppressRouteErrorLog(err: unknown, request: AbortRequestState): boolean {
  if (isExpectedClientAbortError(err, request)) return true;
  const statusCode = (err as { statusCode?: unknown } | undefined)?.statusCode;
  return typeof statusCode === 'number' && statusCode < 500;
}

function dashboardCacheKey(
  orgId: string,
  account: string | undefined,
  scope: AccessScope,
): string {
  return `${orgId}:${scopeCacheTag(scope)}:${account ?? ''}`;
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
  scope: AccessScope,
  log: Parameters<typeof buildDashboardSnapshot>[3],
): Promise<DashboardSnapshot> {
  const key = dashboardCacheKey(orgId, account, scope);
  const now = Date.now();
  const cached = dashboardCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildDashboardSnapshot(orgId, account, prisma, log, scope);
  if (dashboardCache.size >= DASHBOARD_CACHE_MAX) dashboardCache.clear();
  dashboardCache.set(key, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    dashboardCache.delete(key);
    throw err;
  }
}

async function cachedReleaseScore(orgId: string): Promise<ReleaseScoreResult> {
  const now = Date.now();
  const cached = releaseScoreCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = getReleaseScore(orgId, prisma);
  if (releaseScoreCache.size >= DASHBOARD_CACHE_MAX) releaseScoreCache.clear();
  releaseScoreCache.set(orgId, { expiresAt: now + DASHBOARD_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    releaseScoreCache.delete(orgId);
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
        const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
        const snapshot = await req.cache(
          () => cachedDashboardSnapshot(req.auth.orgId, req.query.account, scope, req.log),
          { ttlSeconds: 30, tags: ['crm-dashboard', scopeCacheTag(scope)] },
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
        if (!shouldSuppressRouteErrorLog(err, req.raw)) {
          req.log.error(
            { err, account: req.query.account, orgId: req.auth.orgId },
            'Error in /crm/dashboard route',
          );
        }
        throw err;
      }
    },
  );

  server.get('/crm/release-score', { schema: { response: { 200: ReleaseScore } } }, async (req) => {
    try {
      // Release score is org-wide and scope-independent, so this skips both the
      // access-scope lookup and the full 12-query dashboard snapshot the route
      // used to build just to read this one row.
      return await req.cache(() => cachedReleaseScore(req.auth.orgId), {
        ttlSeconds: 30,
        tags: ['crm-release-score'],
      });
    } catch (err) {
      if (!shouldSuppressRouteErrorLog(err, req.raw)) {
        req.log.error({ err, orgId: req.auth.orgId }, 'Error in /crm/release-score route');
      }
      throw err;
    }
  });
};
