import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  BidScoreCreate,
  BidScoreItem,
  BidScoreList,
  BidScoreFilter,
  BidScoreAICalibrateResponse,
  BidScoreDefendResponse,
} from '@bidstack/shared';
import { MemOSService } from '@bidstack/memos';
import { defendBidScore } from '../services/ai/dust-agent.service.js';

const CRITERIA_WEIGHTS: Record<string, { weight: number; category: string }> = {
  fit: { weight: 15, category: 'strategic' },
  relationship: { weight: 10, category: 'strategic' },
  competitive: { weight: 12, category: 'strategic' },
  tech_capability: { weight: 15, category: 'technical' },
  resource_avail: { weight: 10, category: 'technical' },
  solution_ready: { weight: 8, category: 'technical' },
  deal_size: { weight: 10, category: 'commercial' },
  profitability: { weight: 10, category: 'commercial' },
  timeline_fit: { weight: 5, category: 'commercial' },
  risk_profile: { weight: 5, category: 'risk' },
};

function computeBidScore(criteria: Record<string, number>): {
  totalScore: number;
  categoryScores: Record<string, number>;
  weightedSum: number;
  totalWeight: number;
  recommendation: 'bid' | 'no_bid' | 'proceed_with_caution';
} {
  const catMap: Record<string, { sum: number; weight: number }> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weightInfo] of Object.entries(CRITERIA_WEIGHTS)) {
    const score = criteria[key] ?? 0;
    const normalized = (score / 5) * weightInfo.weight;
    weightedSum += normalized;
    totalWeight += weightInfo.weight;

    let entry = catMap[weightInfo.category];
    if (!entry) {
      entry = { sum: 0, weight: 0 };
      catMap[weightInfo.category] = entry;
    }
    entry.sum += normalized;
    entry.weight += weightInfo.weight;
  }

  const totalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
  const categoryScores: Record<string, number> = {};
  for (const [cat, data] of Object.entries(catMap)) {
    categoryScores[cat] = data.weight > 0 ? Math.round((data.sum / data.weight) * 100) : 0;
  }

  let recommendation: 'bid' | 'no_bid' | 'proceed_with_caution' = 'no_bid';
  if (totalScore >= 75) recommendation = 'bid';
  else if (totalScore >= 50) recommendation = 'proceed_with_caution';

  return { totalScore, categoryScores, weightedSum, totalWeight, recommendation };
}

function serializeBidScore(row: {
  id: string;
  opportunityId: string;
  scoredBy: string;
  version: number;
  criteria: unknown;
  totalScore: number;
  categoryScores: unknown;
  weightedSum: number;
  totalWeight: number;
  aiSuggested: boolean;
  memosPolicies: string[];
  recommendation: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof BidScoreItem> {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    scoredBy: row.scoredBy,
    version: row.version,
    criteria: row.criteria as Record<string, number>,
    totalScore: row.totalScore,
    categoryScores: row.categoryScores as Record<string, number>,
    weightedSum: row.weightedSum,
    totalWeight: row.totalWeight,
    aiSuggested: row.aiSuggested,
    memosPolicies: row.memosPolicies,
    recommendation: row.recommendation as 'bid' | 'no_bid' | 'proceed_with_caution',
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const bidScoreRoutes: FastifyPluginAsyncZod = async (server) => {
  const memos = new MemOSService();

  // GET /api/bid-scores
  server.get(
    '/bid-scores',
    {
      schema: {
        querystring: BidScoreFilter,
        response: { 200: BidScoreList },
      },
    },
    async (req) => {
      const { opportunityId, recommendation, limit, offset } = req.query;
      const rows = await prisma.bidScore.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(opportunityId ? { opportunityId } : {}),
          ...(recommendation ? { recommendation } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return { items: rows.map(serializeBidScore) };
    },
  );

  // GET /api/bid-scores/:opportunityId/latest
  server.get(
    '/bid-scores/:opportunityId/latest',
    {
      schema: {
        params: z.object({ opportunityId: z.string().uuid() }),
        response: { 200: BidScoreItem },
      },
    },
    async (req, reply) => {
      const row = await prisma.bidScore.findFirst({
        where: { orgId: req.auth.orgId, opportunityId: req.params.opportunityId, deletedAt: null },
        orderBy: { version: 'desc' },
      });
      if (!row) {
        return reply.notFound('No bid score found for this opportunity');
      }
      return serializeBidScore(row);
    },
  );

  // POST /api/bid-scores
  server.post(
    '/bid-scores',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('bid-scores:write'),
      schema: {
        body: BidScoreCreate,
        response: { 201: BidScoreItem },
      },
    },
    async (req, reply) => {
      const { opportunityId, criteria, notes } = req.body;
      const opportunity = await prisma.opportunity.findFirst({
        where: { orgId: req.auth.orgId, id: opportunityId, deletedAt: null },
        select: { id: true },
      });
      if (!opportunity) {
        return reply.notFound('Opportunity not found');
      }

      const { totalScore, categoryScores, weightedSum, totalWeight, recommendation } =
        computeBidScore(criteria);

      // Fetch historical policies from MemOS for calibration
      const policies = await memos.getPoliciesForScope(
        req.auth.orgId,
        'opportunity',
        opportunityId,
        'bid_pattern',
        5,
      );

      const latest = await prisma.bidScore.findFirst({
        where: { orgId: req.auth.orgId, opportunityId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      const row = await prisma.bidScore.create({
        data: {
          orgId: req.auth.orgId,
          opportunityId,
          scoredBy: req.auth.userId,
          version: nextVersion,
          criteria: criteria as Record<string, number>,
          totalScore,
          categoryScores: categoryScores as Record<string, number>,
          weightedSum,
          totalWeight,
          aiSuggested: false,
          memosPolicies: policies.map((p) => p.id),
          recommendation,
          notes: notes ?? null,
        },
      });

      // Log to MemOS L1
      await memos.logTrace({
        orgId: req.auth.orgId,
        tier: 'l1',
        module: 'bid_nobid',
        entityType: 'opportunity',
        entityId: opportunityId,
        action: 'score',
        userId: req.auth.userId,
        payload: { totalScore, recommendation, criteria },
      });

      // Crystallize L2 policy if score is extreme (very high or very low)
      if (totalScore >= 90 || totalScore <= 20) {
        await memos.crystallizePolicy({
          orgId: req.auth.orgId,
          key: `bidscore_${opportunityId}_v${nextVersion}`,
          category: 'bid_pattern',
          scopeType: 'opportunity',
          scopeId: opportunityId,
          insight: `Opportunity scored ${totalScore}/100 (${recommendation}). ${totalScore >= 90 ? 'Strong bid candidate.' : 'Weak bid candidate.'}`,
          confidence: totalScore >= 90 ? 8500 : 8500,
          evidence: { totalScore, categoryScores, criteria },
          sourceTraces: [row.id],
        });
      }

      reply.status(201);
      return serializeBidScore(row);
    },
  );

  // POST /api/bid-scores/:opportunityId/ai-calibrate
  server.post(
    '/bid-scores/:opportunityId/ai-calibrate',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('bid-scores:read'),
      schema: {
        params: z.object({ opportunityId: z.string().uuid() }),
        response: { 200: BidScoreAICalibrateResponse },
      },
    },
    async (req, reply) => {
      const { opportunityId } = req.params;
      const opp = await prisma.opportunity.findFirst({
        where: { orgId: req.auth.orgId, id: opportunityId, deletedAt: null },
        include: { territory: true },
      });
      if (!opp) {
        return reply.notFound('Opportunity not found');
      }

      // Fetch MemOS policies for calibration
      const policies = await memos.getPoliciesForScope(
        req.auth.orgId,
        'opportunity',
        opportunityId,
        undefined,
        10,
      );
      const worldModels = await memos.retrieveContext('', {
        orgId: req.auth.orgId,
        tier: 'l3',
        domain: 'win_rate',
        limit: 5,
      });

      // Build context for AI calibration (stub when no Dust key)
      const hasDust = Boolean(process.env.DUST_API_KEY);

      // Default heuristic calibration based on MemOS policies
      const calibratedCriteria: Record<string, number> = {
        fit: 3,
        relationship: 3,
        competitive: 3,
        tech_capability: 3,
        resource_avail: 3,
        solution_ready: 3,
        deal_size: 3,
        profitability: 3,
        timeline_fit: 3,
        risk_profile: 3,
      };

      // Adjust based on policies
      for (const policy of policies) {
        const insight = policy.insight ?? '';
        if (insight.toLowerCase().includes('strong')) {
          calibratedCriteria.fit = Math.min(5, (calibratedCriteria.fit ?? 3) + 1);
        }
        if (insight.toLowerCase().includes('weak') || insight.toLowerCase().includes('risk')) {
          calibratedCriteria.risk_profile = Math.max(0, (calibratedCriteria.risk_profile ?? 3) - 1);
        }
        if (insight.toLowerCase().includes('profit') || insight.toLowerCase().includes('margin')) {
          calibratedCriteria.profitability = Math.min(
            5,
            (calibratedCriteria.profitability ?? 3) + 1,
          );
        }
      }

      // Adjust based on world models
      for (const model of worldModels) {
        if (model.value && typeof model.value === 'object') {
          const v = model.value as Record<string, unknown>;
          if (v.trend === 'up') {
            calibratedCriteria.competitive = Math.min(5, (calibratedCriteria.competitive ?? 3) + 1);
          }
        }
      }

      // Opportunity-specific boosts
      if (opp) {
        if (opp.probability && opp.probability > 70) {
          calibratedCriteria.relationship = Math.min(5, (calibratedCriteria.relationship ?? 3) + 1);
        }
        if (opp.valueMicros > 10_000_000_000) {
          // > 10M EUR in micros
          calibratedCriteria.deal_size = 5;
        }
      }

      const { totalScore, categoryScores, recommendation } = computeBidScore(calibratedCriteria);

      const reasoning = [
        `Calibrated from ${policies.length} MemOS policy(ies) and ${worldModels.length} world model(s).`,
        hasDust
          ? 'Dust AI layer available for deeper analysis.'
          : 'Dust AI layer in stub mode; using heuristic calibration.',
        opp ? `Opportunity stage: ${opp.stage}, probability: ${opp.probability}%.` : '',
      ]
        .filter(Boolean)
        .join(' ');

      return {
        criteria: calibratedCriteria,
        totalScore,
        categoryScores,
        recommendation,
        reasoning,
        memosPolicies: policies.map((p) => p.id),
      };
    },
  );

  // POST /api/bid-scores/:id/defend
  server.post(
    '/bid-scores/:id/defend',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('bid-scores:read'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: BidScoreDefendResponse },
      },
    },
    async (req, reply) => {
      const row = await prisma.bidScore.findFirst({
        where: { orgId: req.auth.orgId, id: req.params.id, deletedAt: null },
        include: { opportunity: { include: { company: true } } },
      });
      if (!row) return reply.notFound('Bid score not found');

      const opp = row.opportunity;
      const customer = opp?.company?.name ?? 'Unknown';
      const opportunityName = opp?.name ?? 'Unknown';

      // Build MemOS context
      const policies = await memos.getPoliciesForScope(
        req.auth.orgId,
        'opportunity',
        row.opportunityId,
        undefined,
        10,
      );
      const worldModels = await memos.retrieveContext('', {
        orgId: req.auth.orgId,
        tier: 'l3',
        domain: 'win_rate',
        limit: 5,
      });

      const memosContext = [
        `Policies:`,
        ...policies.map((p) => `- ${p.key}: ${p.insight} (confidence: ${p.confidence})`),
        `World Models:`,
        ...worldModels.map((m) => `- ${m.key}: ${JSON.stringify(m.value)}`),
      ].join('\n');

      const result = await defendBidScore({
        orgId: req.auth.orgId,
        opportunityName,
        customer,
        totalScore: row.totalScore,
        recommendation: row.recommendation,
        criteria: row.criteria as Record<string, number>,
        memosContext,
      });

      return result;
    },
  );
};
