// Inbound activity API for Dust and external CRMs, plus the account activity
// summary behind the account page charts.
//
//   POST /api/v1/ingest/activities              ingest:write (API key or admin)
//   GET  /api/v1/companies/:id/activity-summary activities:read
//
// The handler only authorises and shapes the call; dedupe, mapping, PII and
// audit live in @bidstack/db ingestActivities, which the MCP write tool also
// calls. Idempotency-Key replays are served by the global idempotency plugin.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { getCompanyActivitySummary, ingestActivities, prisma } from '@bidstack/db';
import {
  ACTIVITY_SUMMARY_DEFAULT_WEEKS,
  ACTIVITY_SUMMARY_MAX_WEEKS,
  CompanyActivitySummary,
  IngestActivitiesRequest,
  IngestActivitiesResponse,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope, isApiKeyActor } from '../lib/access-scope.js';

const INGEST_RATE_LIMIT_PER_MINUTE = 60;

const KNOWN_TIME_ZONES = new Set(
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [],
);

export function isKnownTimeZone(tz: string): boolean {
  if (tz === 'UTC' || KNOWN_TIME_ZONES.has(tz)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const activityIngestRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/ingest/activities',
    {
      config: {
        permission: 'ingest:write',
        rateLimit: {
          max: INGEST_RATE_LIMIT_PER_MINUTE,
          timeWindow: '1 minute',
          // One bucket per API key (or user) per org, separate from the
          // global per-user bucket so a CRM backfill cannot starve the UI.
          keyGenerator: (req) => {
            const auth = (req as unknown as { auth?: { orgId?: string; userId?: string } }).auth;
            return `ingest:${auth?.orgId ?? 'no-org'}:${auth?.userId ?? req.ip}`;
          },
        },
      },
      schema: {
        tags: ['Activities'],
        summary: 'Push calls, emails, meetings, notes and stage changes (up to 500 per batch)',
        body: IngestActivitiesRequest,
        response: { 200: IngestActivitiesResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const apiKey = isApiKeyActor(userId);
      const scope = await getAccessScope(orgId, userId);
      return ingestActivities({
        orgId,
        channel: 'rest',
        actor: apiKey
          ? { kind: 'api_key', keyId: userId.slice('apikey:'.length) }
          : { kind: 'user', userId },
        companyScope: apiKey && !scope.unrestricted ? scope.companyIds : null,
        activities: req.body.activities,
      });
    },
  );

  server.get(
    '/companies/:id/activity-summary',
    {
      config: { permission: 'activities:read' },
      schema: {
        tags: ['Activities'],
        summary: 'Activity by hour and per week by type, with overdue follow-ups',
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          tz: z
            .string()
            .max(64)
            .default('UTC')
            .refine(isKnownTimeZone, { message: 'Unknown time zone' }),
          weeks: z.coerce
            .number()
            .int()
            .min(1)
            .max(ACTIVITY_SUMMARY_MAX_WEEKS)
            .default(ACTIVITY_SUMMARY_DEFAULT_WEEKS),
        }),
        response: { 200: CompanyActivitySummary },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const scope = await getAccessScope(orgId, userId);
      const company = await prisma.company.findFirst({
        where: applyCompanyScope({ id: req.params.id, orgId, deletedAt: null }, scope),
        select: { id: true },
      });
      if (!company) throw server.httpErrors.notFound('Company not found');
      return getCompanyActivitySummary({
        orgId,
        companyId: company.id,
        tz: req.query.tz,
        weeks: req.query.weeks,
      });
    },
  );
};
