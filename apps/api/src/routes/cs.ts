/**
 * Customer Success routes.
 *
 * All routes require authenticated org context via authPlugin.
 * Exception: POST /nps/surveys/:id/respond uses signed token auth (public endpoint).
 *
 * Routes:
 *   GET  /accounts/:id/health
 *   GET  /accounts/:id/renewals
 *   GET  /accounts/:id/churn-signals
 *   POST /accounts/:id/churn-signals/:signalId/acknowledge
 *   POST /accounts/:id/churn-signals/:signalId/resolve
 *   GET  /accounts/:id/expansion-opportunities
 *   POST /nps/surveys/:id/respond          (public — token auth)
 *   GET  /cs/dashboard                     (CS team summary view)
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import { getLatestHealthScore } from '../services/cs/health-score.service.js';
import { listRenewalOpportunities } from '../services/cs/renewal.service.js';
import { recordNpsResponse } from '../services/cs/nps.service.js';
import { listExpansionOpportunities } from '../services/cs/expansion.service.js';

// ─── Param / body schemas ─────────────────────────────────────────────────

const AccountParams = z.object({ id: z.string().uuid() });
const SignalParams = z.object({ id: z.string().uuid(), signalId: z.string().uuid() });
const SurveyParams = z.object({ id: z.string().uuid() });

const ChurnSignalsQuery = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL']).default('OPEN'),
});

const ResolveBody = z.object({
  resolution: z.string().min(1).max(2000),
});

const NpsRespondBody = z.object({
  token: z.string().min(32).max(128),
  score11: z.number().int().min(0).max(10),
  feedback: z.string().max(2000).optional(),
});

// ─── Response schemas ─────────────────────────────────────────────────────

const HealthScoreResponse = z.object({
  accountId: z.string().uuid(),
  score: z.number().nullable(),
  factors: z.record(z.unknown()),
  trend: z.enum(['IMPROVING', 'STABLE', 'DECLINING']).nullable(),
});

const MessageResponse = z.object({ message: z.string() });
const asPinoLog = (log: unknown): PinoLogger => log as PinoLogger;

// ─── Route plugin ─────────────────────────────────────────────────────────

export const csRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /accounts/:id/health ──────────────────────────────────────────
  app.get(
    '/accounts/:id/health',
    {
      config: { permission: 'accounts:read' },
      schema: {
        params: AccountParams,
        response: { 200: HealthScoreResponse, 404: z.object({ message: z.string() }) },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id: accountId } = req.params;

      const result = await getLatestHealthScore(orgId, accountId);
      if (!result) {
        return reply.code(404).send({ message: 'No health score found for this account' });
      }
      return result;
    },
  );

  // ── GET /accounts/:id/renewals ────────────────────────────────────────
  app.get(
    '/accounts/:id/renewals',
    {
      config: { permission: 'accounts:read' },
      schema: {
        params: AccountParams,
        response: { 200: z.array(z.record(z.unknown())) },
      },
    },
    async (req, _reply) => {
      const { orgId } = req.auth;
      const { id: accountId } = req.params;
      return listRenewalOpportunities(orgId, accountId);
    },
  );

  // ── GET /accounts/:id/churn-signals ───────────────────────────────────
  app.get(
    '/accounts/:id/churn-signals',
    {
      config: { permission: 'accounts:read' },
      schema: {
        params: AccountParams,
        querystring: ChurnSignalsQuery,
        response: { 200: z.array(z.record(z.unknown())) },
      },
    },
    async (req, _reply) => {
      const { orgId } = req.auth;
      const { id: accountId } = req.params;
      const { status } = req.query;

      const where: Prisma.ChurnSignalWhereInput = {
        orgId,
        accountId,
        deletedAt: null,
      };

      if (status === 'OPEN') {
        where.resolvedAt = null;
        where.acknowledgedAt = null;
      } else if (status === 'ACKNOWLEDGED') {
        where.acknowledgedAt = { not: null };
        where.resolvedAt = null;
      } else if (status === 'RESOLVED') {
        where.resolvedAt = { not: null };
      }
      // ALL: no additional filters

      return prisma.churnSignal.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      });
    },
  );

  // ── POST /accounts/:id/churn-signals/:signalId/acknowledge ────────────
  app.post(
    '/accounts/:id/churn-signals/:signalId/acknowledge',
    {
      // Mutates churn-signal workflow state — gate as an account write.
      preHandler: [app.requirePermission('accounts:write')],
      schema: {
        params: SignalParams,
        response: { 200: MessageResponse, 404: MessageResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id: accountId, signalId } = req.params;

      const signal = await prisma.churnSignal.findFirst({
        where: { id: signalId, orgId, accountId, deletedAt: null },
      });
      if (!signal) return reply.code(404).send({ message: 'Signal not found' });

      await prisma.churnSignal.update({
        where: { id: signalId },
        data: { acknowledgedAt: new Date() },
      });
      return { message: 'Signal acknowledged' };
    },
  );

  // ── POST /accounts/:id/churn-signals/:signalId/resolve ───────────────
  app.post(
    '/accounts/:id/churn-signals/:signalId/resolve',
    {
      // Mutates churn-signal workflow state — gate as an account write.
      preHandler: [app.requirePermission('accounts:write')],
      schema: {
        params: SignalParams,
        body: ResolveBody,
        response: { 200: MessageResponse, 404: MessageResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { id: accountId, signalId } = req.params;
      const { resolution } = req.body;

      const signal = await prisma.churnSignal.findFirst({
        where: { id: signalId, orgId, accountId, deletedAt: null },
      });
      if (!signal) return reply.code(404).send({ message: 'Signal not found' });

      await prisma.churnSignal.update({
        where: { id: signalId },
        data: { resolvedAt: new Date(), resolution },
      });
      return { message: 'Signal resolved' };
    },
  );

  // ── GET /accounts/:id/expansion-opportunities ─────────────────────────
  app.get(
    '/accounts/:id/expansion-opportunities',
    {
      config: { permission: 'accounts:read' },
      schema: {
        params: AccountParams,
        response: { 200: z.array(z.record(z.unknown())) },
      },
    },
    async (req, _reply) => {
      const { orgId } = req.auth;
      const { id: accountId } = req.params;
      return listExpansionOpportunities(orgId, accountId);
    },
  );

  // ── POST /nps/surveys/:id/respond (public — token auth) ───────────────
  // WHY no authPlugin: public URL embedded in email; respondent is not a CRM user.
  // Token signed with HMAC proves survey ownership without requiring Clerk auth.
  app.post(
    '/nps/surveys/:id/respond',
    {
      config: { public: true },
      schema: {
        params: SurveyParams,
        body: NpsRespondBody,
        response: {
          200: z.object({ message: z.string(), category: z.string() }),
          400: z.object({ message: z.string() }),
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { token, score11, feedback } = req.body;

      try {
        const result = await recordNpsResponse({ token, score11, feedback }, asPinoLog(req.log));
        return { message: 'Thank you for your feedback!', category: result.category };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid request';
        if (message.includes('not found') || message.includes('invalid')) {
          return reply.code(404).send({ message });
        }
        if (message.includes('expired') || message.includes('already responded')) {
          return reply.code(400).send({ message });
        }
        throw err;
      }
    },
  );

  // ── GET /cs/dashboard (CS team overview) ─────────────────────────────
  app.get(
    '/cs/dashboard',
    {
      config: { permission: 'accounts:read' },
      schema: {
        response: { 200: z.record(z.unknown()) },
      },
    },
    async (req, _reply) => {
      const { orgId } = req.auth;

      const [
        activeSubscriptions,
        openChurnSignals,
        pendingRenewals,
        healthBuckets,
        recentHealthScores,
      ] = await Promise.all([
        prisma.subscription.count({ where: { orgId, status: 'ACTIVE', deletedAt: null } }),
        prisma.churnSignal.count({ where: { orgId, resolvedAt: null, deletedAt: null } }),
        prisma.renewalOpportunity.count({
          where: {
            orgId,
            status: { in: ['UPCOMING', 'ENGAGED', 'AT_RISK'] },
            deletedAt: null,
          },
        }),
        prisma.$queryRaw<
          Array<{ healthy: number; atRisk: number; critical: number }>
        >(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE score >= 75)::int AS healthy,
            COUNT(*) FILTER (WHERE score >= 50 AND score < 75)::int AS "atRisk",
            COUNT(*) FILTER (WHERE score < 50)::int AS critical
          FROM (
            SELECT DISTINCT ON (account_id) score
            FROM health_scores
            WHERE org_id = ${orgId}::uuid
            ORDER BY account_id, captured_at DESC
          ) latest
        `),
        prisma.$queryRaw<
          Array<{
            accountId: string;
            score: number;
            trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
            capturedAt: Date;
          }>
        >(Prisma.sql`
          SELECT "accountId", score, trend, "capturedAt"
          FROM (
            SELECT DISTINCT ON (account_id)
              account_id AS "accountId",
              score,
              trend::text AS trend,
              captured_at AS "capturedAt"
            FROM health_scores
            WHERE org_id = ${orgId}::uuid
            ORDER BY account_id, captured_at DESC
          ) latest
          ORDER BY "capturedAt" DESC
          LIMIT 10
        `),
      ]);

      const bucket = healthBuckets[0] ?? { healthy: 0, atRisk: 0, critical: 0 };
      const accountIds = recentHealthScores.map((row) => row.accountId);
      const counts =
        accountIds.length === 0
          ? []
          : await prisma.healthScore.groupBy({
              by: ['accountId'],
              where: { orgId, accountId: { in: accountIds } },
              _count: { _all: true },
            });
      const snapshots = new Map(counts.map((row) => [row.accountId, row._count._all]));
      const latestHealthScores = recentHealthScores.map((row) => ({
        ...row,
        // One snapshot has no earlier score. The column default is not a trend.
        trend: (snapshots.get(row.accountId) ?? 0) < 2 ? null : row.trend,
      }));

      return {
        activeSubscriptions,
        openChurnSignals,
        pendingRenewals,
        accountsByHealth: {
          healthy: Number(bucket.healthy),
          atRisk: Number(bucket.atRisk),
          critical: Number(bucket.critical),
        },
        latestHealthScores,
      };
    },
  );
};
