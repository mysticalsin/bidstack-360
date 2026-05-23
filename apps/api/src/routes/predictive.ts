import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { PredictiveScore, PredictiveScoreFilter, PredictiveScoreKind } from '@bidstack/shared';

export const predictiveRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/predictive/scores
  server.get(
    '/predictive/scores',
    {
      schema: {
        querystring: PredictiveScoreFilter,
        response: { 200: z.object({ items: z.array(PredictiveScore) }) },
      },
    },
    async (req) => {
      const { targetType, targetId, kind, limit } = req.query;
      const rows = await prisma.predictiveScore.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(targetType ? { targetType } : {}),
          ...(targetId ? { targetId } : {}),
          ...(kind ? { kind } : {}),
          expiresAt: { gt: new Date() },
        },
        orderBy: [{ kind: 'asc' }, { score: 'desc' }],
        take: limit,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          targetType: r.targetType,
          targetId: r.targetId,
          kind: r.kind as z.infer<typeof PredictiveScoreKind>,
          score: r.score,
          confidence: r.confidence,
          features: r.features as Record<string, unknown>,
          modelVersion: r.modelVersion,
          recommendedAction: r.recommendedAction,
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/predictive/scores (compute on demand)
  server.post(
    '/predictive/scores',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('reports:write'),
      schema: {
        body: z.object({
          targetType: z.string().max(50),
          targetId: z.string().uuid(),
          kind: PredictiveScoreKind,
        }),
        response: { 200: PredictiveScore },
      },
    },
    async (req) => {
      const { targetType, targetId, kind } = req.body;
      // Simple heuristic engine — replace with real ML model
      const score = await computeHeuristicScore(req.auth.orgId, targetType, targetId, kind);
      const created = await prisma.predictiveScore.create({
        data: {
          orgId: req.auth.orgId,
          targetType,
          targetId,
          kind,
          score: score.score,
          confidence: score.confidence,
          features: score.features as Prisma.InputJsonValue,
          modelVersion: 'heuristic-v1',
          recommendedAction: score.recommendedAction,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return {
        id: created.id,
        targetType: created.targetType,
        targetId: created.targetId,
        kind: created.kind as z.infer<typeof PredictiveScoreKind>,
        score: created.score,
        confidence: created.confidence,
        features: created.features as Record<string, unknown>,
        modelVersion: created.modelVersion,
        recommendedAction: created.recommendedAction,
        expiresAt: created.expiresAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
      };
    },
  );
};

async function computeHeuristicScore(
  orgId: string,
  targetType: string,
  targetId: string,
  kind: z.infer<typeof PredictiveScoreKind>,
): Promise<{
  score: number;
  confidence: number;
  features: Record<string, unknown>;
  recommendedAction: string | null;
}> {
  if (kind === 'win_probability' && targetType === 'opportunity') {
    const opp = await prisma.opportunity.findFirst({ where: { id: targetId, orgId } });
    if (!opp) return { score: 5000, confidence: 3000, features: {}, recommendedAction: null };
    const stageScores: Record<string, number> = {
      s1_lead: 2000,
      s1_ongoing: 4000,
      s2_sent: 6500,
      s3_technical_iteration: 7500,
      s4_negotiation: 8500,
      closed_won: 10000,
      closed_lost: 0,
    };
    const base = stageScores[opp.stage] ?? 5000;
    const probBoost = (opp.probability - 50) * 50;
    const score = Math.max(0, Math.min(10000, base + probBoost));
    return {
      score,
      confidence: 7200,
      features: { stage: opp.stage, probability: opp.probability, baseScore: base },
      recommendedAction:
        score < 4000
          ? 'Schedule discovery call'
          : score > 8000
            ? 'Prepare closing documents'
            : 'Advance to next stage',
    };
  }
  if (kind === 'churn_risk' && targetType === 'account') {
    return {
      score: 2500,
      confidence: 4500,
      features: { activityGapDays: 12 },
      recommendedAction: 'Schedule quarterly business review',
    };
  }
  if (kind === 'lead_score') {
    return {
      score: 6800,
      confidence: 5500,
      features: { industryFit: 0.8, companySize: 'enterprise' },
      recommendedAction: 'Prioritize outreach within 24h',
    };
  }
  return { score: 5000, confidence: 3000, features: {}, recommendedAction: null };
}
