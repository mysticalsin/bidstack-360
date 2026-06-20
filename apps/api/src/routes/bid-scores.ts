import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { notifyUsers } from '../services/notification.service.js';
import {
  BID_CRITERIA,
  BidScoreCreate,
  BidScoreItem,
  BidScoreList,
  BidScoreFilter,
  BidScoreAICalibrateResponse,
  BidScoreDefendResponse,
  computeBidComposite,
} from '@bidstack/shared';
import { MemOSService } from '@bidstack/memos';
import { defendBidScore } from '../services/ai/dust-agent.service.js';
import { isUniqueViolation } from './opportunities.helpers.js';

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
  overrideJustification: string | null;
  overriddenBy: string | null;
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
    overrideJustification: row.overrideJustification,
    overriddenBy: row.overriddenBy,
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
      const { opportunityId, criteria, notes, decision, override } = req.body;
      const opportunity = await prisma.opportunity.findFirst({
        where: { orgId: req.auth.orgId, id: opportunityId, deletedAt: null },
        select: { id: true },
      });
      if (!opportunity) {
        return reply.notFound('Opportunity not found');
      }

      const { totalScore, categoryScores, weightedSum, totalWeight, recommendation } =
        computeBidComposite(criteria);

      // Below-threshold bypass: proceeding against a non-bid recommendation
      // REQUIRES an acknowledged justification (≥ 30 chars, enforced by Zod).
      if (decision === 'override') {
        if (recommendation === 'bid') {
          return reply.badRequest(
            'Recommendation is already "bid" — there is nothing to override.',
          );
        }
        if (!override) {
          return reply.badRequest(
            'Overriding a below-threshold recommendation requires an acknowledged justification (min 30 characters).',
          );
        }
      } else if (override) {
        return reply.badRequest('An override payload requires decision: "override".');
      }
      const isOverride = decision === 'override' && Boolean(override);

      // Fetch historical policies from MemOS for calibration
      const policies = await memos.getPoliciesForScope(
        req.auth.orgId,
        'opportunity',
        opportunityId,
        'bid_pattern',
        5,
      );

      // Version is minted INSIDE the tx (read-then-insert atomically) and the
      // unique (orgId, opportunityId, version) guards concurrent scorers: a
      // colliding insert throws P2002 and the bounded loop re-reads + retries.
      let nextVersion = 0;
      let row: Awaited<ReturnType<typeof prisma.bidScore.create>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          row = await prisma.$transaction(async (tx) => {
            const latest = await tx.bidScore.findFirst({
              where: { orgId: req.auth.orgId, opportunityId },
              orderBy: { version: 'desc' },
              select: { version: true },
            });
            nextVersion = (latest?.version ?? 0) + 1;

            const created = await tx.bidScore.create({
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
                overrideJustification: isOverride ? (override?.justification ?? null) : null,
                overriddenBy: isOverride ? req.auth.userId : null,
              },
            });
            if (isOverride && override) {
              // Director/VP visibility surface: explicit audit row (the generic
              // mutation-audit safety net only logs an opaque http.mutation entry).
              await tx.auditLog.create({
                data: {
                  orgId: req.auth.orgId,
                  userId: req.auth.userId,
                  action: 'bid_score.override',
                  targetType: 'bid_score',
                  targetId: created.id,
                  diff: {
                    opportunityId,
                    version: nextVersion,
                    totalScore,
                    recommendation,
                    justification: override.justification,
                  },
                },
              });
            }
            return created;
          });
          break;
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      if (!row) {
        throw server.httpErrors.conflict('Could not allocate a unique bid-score version; retry.');
      }

      // Director/VP push: a below-threshold override is escalated as an in-app
      // notification to managers, not just buried in the audit log. Best-effort.
      if (isOverride && override) {
        const managers = await prisma.userRole.findMany({
          where: {
            orgId: req.auth.orgId,
            role: { orgId: req.auth.orgId, name: { in: ['Manager', 'Sales Manager'] }, deletedAt: null },
            user: { orgId: req.auth.orgId, deletedAt: null },
          },
          select: { userId: true },
          take: 100,
        });
        await notifyUsers({
          orgId: req.auth.orgId,
          userIds: managers.map((m) => m.userId),
          excludeUserId: req.auth.userId,
          type: 'bid_override',
          title: 'Bid/No-Bid override needs review',
          body: `An opportunity was advanced against a ${recommendation} recommendation (score ${totalScore}). Justification: ${override.justification.slice(0, 160)}`,
          entityType: 'opportunity',
          entityId: opportunityId,
          url: `/opportunities/${opportunityId}`,
        });
      }

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
          // Crystallized only for extreme scores, so conviction is uniformly high.
          confidence: 8500,
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

      // Default heuristic calibration: neutral 3 across the shared registry.
      const calibratedCriteria: Record<string, number> = Object.fromEntries(
        BID_CRITERIA.map((c) => [c.id, 3]),
      );

      // Adjust based on policies. profitability/risk_profile keyword bumps
      // both map onto financial_risk in the unified registry.
      for (const policy of policies) {
        const insight = (policy.insight ?? '').toLowerCase();
        if (insight.includes('strong')) {
          calibratedCriteria.strategic_fit = Math.min(
            5,
            (calibratedCriteria.strategic_fit ?? 3) + 1,
          );
        }
        if (insight.includes('weak') || insight.includes('risk')) {
          calibratedCriteria.financial_risk = Math.max(
            0,
            (calibratedCriteria.financial_risk ?? 3) - 1,
          );
        }
        if (insight.includes('profit') || insight.includes('margin')) {
          calibratedCriteria.financial_risk = Math.min(
            5,
            (calibratedCriteria.financial_risk ?? 3) + 1,
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
        if (opp.valueMicros > 10_000_000_000_000) {
          // > 10M EUR in micros (10M × 1e6 — the old 1e10 bound fired at €10k)
          calibratedCriteria.deal_size = 5;
        }
      }

      const { totalScore, categoryScores, recommendation } =
        computeBidComposite(calibratedCriteria);

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
