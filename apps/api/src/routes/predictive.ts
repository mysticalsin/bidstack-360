import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { PredictiveScore, PredictiveScoreFilter, PredictiveScoreKind } from '@bidstack/shared';

/**
 * On-demand scoring used to invent a win probability from a stage table
 * (confidence 7200), a churn score with a fake 12-day activity gap, and a
 * lead score with a fake industry fit of 0.8. None of those were measured.
 * Until a trained model writes the row, this route does not score.
 */
export type HeuristicScoreDraft = {
  score: number;
  confidence: number;
  features: Record<string, unknown>;
  recommendedAction: string | null;
} | null;

export function heuristicScoreDraft(): HeuristicScoreDraft {
  return null;
}

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
      },
    },
    async (req) => {
      const { targetType, targetId, kind } = req.body;
      const draft = heuristicScoreDraft();
      if (draft === null) {
        throw server.httpErrors.unprocessableEntity(
          `Not scored (${kind} on ${targetType} ${targetId}). No trained model is stored, so this is not a win, churn, or lead forecast.`,
        );
      }
      return draft;
    },
  );
};
