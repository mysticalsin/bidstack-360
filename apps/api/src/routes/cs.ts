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

import { prisma, type Prisma } from '@bidstack/db';
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
  score: z.number(),
  factors: z.record(z.unknown()),
  trend: z.enum(['IMPROVING', 'STABLE', 'DECLINING']),
});

const MessageResponse = z.object({ message: z.string() });
const asPinoLog = (log: unknown): PinoLogger => log as PinoLogger;

// ─── Route plugin ─────────────────────────────────────────────────────────

export const csRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /accounts/:id/health ──────────────────────────────────────────
  app.get(
    '/accounts/:id/health',
    {
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
        prisma.healthScore.findMany({
          where: { orgId },
          orderBy: { capturedAt: 'desc' },
          take: 50,
          distinct: ['accountId'],
          select: { accountId: true, score: true, trend: true, capturedAt: true },
        }),
      ]);

      const healthy = recentHealthScores.filter((h) => h.score >= 75).length;
      const atRisk = recentHealthScores.filter((h) => h.score >= 50 && h.score < 75).length;
      const critical = recentHealthScores.filter((h) => h.score < 50).length;

      return {
        activeSubscriptions,
        openChurnSignals,
        pendingRenewals,
        accountsByHealth: { healthy, atRisk, critical },
        latestHealthScores: recentHealthScores.slice(0, 10),
      };
    },
  );
};
