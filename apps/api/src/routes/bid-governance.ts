// Amaris Bid Office governance — persist the C0–C4 classification on an
// opportunity and record formal gate sign-off decisions. The class is computed
// server-side (assessBid) from FTE × commitment so it can never be free-set out
// of policy. Gate decisions are append-only; the latest per (opportunity, gate)
// is the standing decision. All queries org-scoped.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { assessBid } from '@bidstack/shared';

const IdParam = z.object({ id: z.string().uuid() });

const ClassificationBody = z.object({
  fteEstimate: z.number().min(0).max(100000),
  commitmentLevel: z.enum(['low', 'medium', 'high', 'xhigh']),
});

const GateDecisionCreate = z.object({
  gate: z.enum([
    'go_no_go',
    'bid_no_bid',
    'strategy_validation',
    'proposal_review',
    'pricing_bid_validation',
    'quality_check',
  ]),
  outcome: z.enum(['go', 'no_go', 'bid', 'no_bid', 'approved', 'rejected']),
  justification: z.string().max(2000).optional(),
  decidedByRole: z.string().max(200).optional(),
});

function serializeGate(row: {
  id: string;
  opportunityId: string;
  gate: string;
  outcome: string;
  bidClass: string | null;
  decidedById: string | null;
  decidedByRole: string | null;
  justification: string | null;
  decidedAt: Date;
}) {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    gate: row.gate,
    outcome: row.outcome,
    bidClass: row.bidClass,
    decidedById: row.decidedById,
    decidedByRole: row.decidedByRole,
    justification: row.justification,
    decidedAt: row.decidedAt.toISOString(),
  };
}

export const bidGovernanceRoutes: FastifyPluginAsyncZod = async (server) => {
  // Compute + persist the classification. Server owns the class (assessBid).
  server.post(
    '/opportunities/:id/classification',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' }, permission: 'opportunities:write' },
      preHandler: server.requirePermission('opportunities:write'),
      schema: { params: IdParam, body: ClassificationBody },
    },
    async (req) => {
      const { orgId } = req.auth;
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const assessment = assessBid(req.body.fteEstimate, req.body.commitmentLevel);
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: {
          bidClass: assessment.bidClass,
          fteEstimate: req.body.fteEstimate,
          commitmentLevel: req.body.commitmentLevel,
        },
      });
      return {
        bidClass: assessment.bidClass,
        sizeBand: assessment.sizeBand,
        fteEstimate: req.body.fteEstimate,
        commitmentLevel: req.body.commitmentLevel,
      };
    },
  );

  server.get(
    '/opportunities/:id/gate-decisions',
    {
      config: { permission: 'opportunities:read' },
      preHandler: server.requirePermission('opportunities:read'),
      schema: { params: IdParam },
    },
    async (req) => {
      const { orgId } = req.auth;
      const rows = await prisma.gateDecision.findMany({
        where: { orgId, opportunityId: req.params.id },
        orderBy: { decidedAt: 'desc' },
        // Bounded per queryGuardPlugin (no unbounded finds); a single opp never
        // has more than a handful of gates across the lifecycle.
        take: 100,
      });
      return { items: rows.map(serializeGate) };
    },
  );

  server.post(
    '/opportunities/:id/gate-decisions',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' }, permission: 'opportunities:write' },
      preHandler: server.requirePermission('opportunities:write'),
      schema: { params: IdParam, body: GateDecisionCreate },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId, deletedAt: null },
        select: { id: true, bidClass: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const row = await prisma.gateDecision.create({
        data: {
          orgId,
          opportunityId: opp.id,
          gate: req.body.gate,
          outcome: req.body.outcome,
          bidClass: opp.bidClass,
          decidedById: userId,
          decidedByRole: req.body.decidedByRole ?? null,
          justification: req.body.justification ?? null,
        },
      });
      return serializeGate(row);
    },
  );
};
