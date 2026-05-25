/**
 * Predictive scoring routes — Wave 8 ML-backed lead + opportunity scoring.
 *
 * Routes:
 *   GET  /leads/:id/score                  — score a lead (0-100)
 *   GET  /opportunities/:id/score          — score an opportunity (win probability 0-100)
 *   POST /admin/predictive/retrain         — trigger manual model retrain
 *   GET  /admin/predictive/models          — list trained models with accuracy metrics
 *
 * Auth: standard Clerk JWT (via auth plugin). Admin routes require 'admin' role.
 * Rate limiting: score routes 60/min per user; retrain 5/min (heavy operation).
 *
 * Multi-tenancy: all DB queries scoped by req.auth.orgId. Redis cache keys
 * include orgId. S3 model paths include orgId.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { prisma } from '@bidstack/db';
import { PREDICTIVE_RETRAIN } from '@bidstack/shared';

import {
  scoreLead,
  scoreOpportunity,
} from '../services/predictive-scoring.service.js';
import { redis } from '../redis.js';

// ─── Zod schemas ──────────────────────────────────────────────────────────

const ScoreFactor = z.object({
  feature: z.string(),
  contribution: z.number(),
});

const LeadScoreResponse = z.object({
  score: z.number().int().min(0).max(100).describe('Lead score 0-100'),
  factors: z.array(ScoreFactor).max(5).describe('Top SHAP-attributed factors'),
  modelVersion: z.string(),
  scoredAt: z.string().datetime(),
});

const OppScoreResponse = z.object({
  winProbability: z.number().int().min(0).max(100),
  predictedCloseDate: z.string().datetime().nullable(),
  factors: z.array(ScoreFactor).max(5),
  recommendation: z.string(),
  modelVersion: z.string(),
  scoredAt: z.string().datetime(),
});

const RetrainBody = z.object({
  entityType: z.enum(['lead', 'opportunity']).optional(),
});

const ModelMetrics = z.object({
  precision: z.number(),
  recall: z.number(),
  auc: z.number(),
  f1: z.number(),
});

const PredictiveModelRow = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  version: z.number(),
  isActive: z.boolean(),
  sampleCount: z.number(),
  accuracyMetrics: ModelMetrics,
  trainedAt: z.string().datetime(),
  modelArtifactS3Key: z.string(),
});

// ─── Lazy BullMQ producer ─────────────────────────────────────────────────

let retrainQueue: Queue | null = null;

function getRetrainQueue(): Queue {
  if (!retrainQueue) {
    const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
      maxRetriesPerRequest: null,
    });
    retrainQueue = new Queue(PREDICTIVE_RETRAIN.name, {
      connection,
      defaultJobOptions: PREDICTIVE_RETRAIN.defaultJobOptions,
    });
  }
  return retrainQueue;
}

// ─── Route definitions ────────────────────────────────────────────────────

export const predictiveScoringRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /leads/:id/score ───────────────────────────────────────────────
  server.get(
    '/leads/:id/score',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: LeadScoreResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      // Verify lead belongs to org before scoring (prevents oracle attacks)
      const lead = await prisma.lead.findFirst({
        where: { id, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) throw server.httpErrors.notFound('Lead not found');

      return scoreLead(orgId, id, redis);
    },
  );

  // ── GET /opportunities/:id/score ───────────────────────────────────────
  server.get(
    '/opportunities/:id/score',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: OppScoreResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { id } = req.params;

      const opp = await prisma.opportunity.findFirst({
        where: { id, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      return scoreOpportunity(orgId, id, redis);
    },
  );

  // ── POST /admin/predictive/retrain ─────────────────────────────────────
  server.post(
    '/admin/predictive/retrain',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        body: RetrainBody,
        response: {
          202: z.object({
            jobId: z.string().nullable(),
            message: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const { entityType } = req.body;

      const queue = getRetrainQueue();

      if (entityType) {
        const job = await queue.add(
          `manual-retrain:${orgId}:${entityType}`,
          { orgId, entityType },
          { jobId: `manual:${orgId}:${entityType}:${Date.now()}` },
        );
        reply.code(202);
        return { jobId: job.id ?? null, message: `Retrain queued for ${entityType}` };
      }

      // Retrain both entity types
      const jobs = await Promise.all(
        (['lead', 'opportunity'] as const).map((et) =>
          queue.add(`manual-retrain:${orgId}:${et}`, { orgId, entityType: et }),
        ),
      );
      reply.code(202);
      return {
        jobId: jobs[0]?.id ?? null,
        message: 'Retrain queued for lead and opportunity models',
      };
    },
  );

  // ── GET /admin/predictive/models ───────────────────────────────────────
  server.get(
    '/admin/predictive/models',
    {
      preHandler: server.requirePermission('settings:read'),
      schema: {
        querystring: z.object({
          entityType: z.enum(['lead', 'opportunity']).optional(),
        }),
        response: {
          200: z.object({ items: z.array(PredictiveModelRow) }),
        },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { entityType } = req.query;

      const models = await prisma.predictiveModel.findMany({
        where: {
          orgId,
          ...(entityType ? { entityType } : {}),
        },
        orderBy: [{ entityType: 'asc' }, { version: 'desc' }],
        take: 50,
      });

      return {
        items: models.map((m) => ({
          id: m.id,
          entityType: m.entityType,
          version: m.version,
          isActive: m.isActive,
          sampleCount: m.sampleCount,
          accuracyMetrics: m.accuracyMetrics as z.infer<typeof ModelMetrics>,
          trainedAt: m.trainedAt.toISOString(),
          modelArtifactS3Key: m.modelArtifactS3Key,
        })),
      };
    },
  );
};
