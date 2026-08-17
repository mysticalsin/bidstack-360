// Amaris Bid Office governance — persist the C0–C4 classification on an
// opportunity and record formal gate sign-off decisions. The class is computed
// server-side (assessBid) from FTE × commitment so it can never be free-set out
// of policy. Gate decisions are append-only; the latest per (opportunity, gate)
// is the standing decision. All queries org-scoped.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  allowedGatesForClass,
  assessBid,
  GATE_LABELS,
  GATE_OUTCOMES,
  isGateOutcomeValid,
  type BidClass,
  type GateKey,
  type GateOutcome,
} from '@bidstack/shared';

import { notifyUsers } from '../services/notification.service.js';

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

/**
 * Roles that sit on an Amaris validation committee in every class (report §3
 * committee/finalValidators). Matched by Role.name against what the org
 * actually seeds — the playbook's own position codes (LBM, GBD, CDSO…) are not
 * seeded roles yet, so this is the closest honest mapping rather than a set of
 * names that would silently match nobody.
 */
const GATE_WATCHER_ROLES = ['Manager', 'Sales Manager', 'Presales', 'Executive'];

const NEGATIVE_OUTCOMES: readonly GateOutcome[] = ['no_go', 'no_bid', 'rejected'];

async function notifyGateRecipients(
  server: Parameters<FastifyPluginAsyncZod>[0],
  input: {
    orgId: string;
    actorUserId: string;
    opportunity: { id: string; name: string; customer: string; ownerId: string | null };
    gate: GateKey;
    outcome: GateOutcome;
  },
): Promise<void> {
  const { orgId, actorUserId, opportunity, gate, outcome } = input;
  const watchers = await prisma.userRole.findMany({
    where: {
      orgId,
      deletedAt: null,
      role: { orgId, name: { in: GATE_WATCHER_ROLES }, deletedAt: null },
      user: { orgId, deletedAt: null },
    },
    select: { userId: true },
    take: 100,
  });

  const decided = NEGATIVE_OUTCOMES.includes(outcome) ? 'not cleared' : 'cleared';
  await notifyUsers({
    orgId,
    // notifyUsers de-dupes, so listing the owner alongside the committee is safe.
    userIds: [...watchers.map((w) => w.userId), ...(opportunity.ownerId ? [opportunity.ownerId] : [])],
    excludeUserId: actorUserId,
    type: 'gate_decision',
    title: `${GATE_LABELS[gate]} ${decided}: ${opportunity.name}`,
    body: `${opportunity.customer} — outcome ${outcome.replace(/_/g, ' ')}`,
    entityType: 'opportunity',
    entityId: opportunity.id,
    url: `/opportunities/${opportunity.id}`,
  });
  server.log.debug({ opportunityId: opportunity.id, gate, outcome }, 'gate decision notified');
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
      // updateMany, not update: `where` must carry orgId (rule 7). The findFirst
      // above already proves tenancy, but an unscoped write is exactly what the
      // tenant-scope guard exists to catch, and the next edit here would inherit
      // the hole.
      await prisma.opportunity.updateMany({
        where: { id: opp.id, orgId },
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
        select: { id: true, name: true, customer: true, ownerId: true, bidClass: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const gate = req.body.gate as GateKey;
      const outcome = req.body.outcome as GateOutcome;

      // The gate x outcome cross-product was unvalidated, and the two were more
      // than cosmetically mismatched: resolveStandingDecision only reads
      // go/no_go/bid/no_bid, so a `{ go_no_go, approved }` row produced NO
      // signal — and because the stage gate reads only the LATEST go_no_go /
      // bid_no_bid row, that unreadable row hid an earlier no-go and let the
      // opportunity advance. Reject the pair instead of storing a silent hole.
      if (!isGateOutcomeValid(gate, outcome)) {
        throw server.httpErrors.badRequest(
          `Outcome '${outcome}' is not valid for the ${GATE_LABELS[gate]} gate (expected: ${GATE_OUTCOMES[gate].join(' | ')})`,
        );
      }

      // Class-driven governance (report §3): the class determines which gates
      // exist. A C1 has no Strategy Validation gate, so recording one is a
      // process error, not a preference. Unclassified bids accept any gate.
      const allowed = allowedGatesForClass(opp.bidClass as BidClass | null);
      if (!allowed.includes(gate)) {
        throw server.httpErrors.conflict(
          `The ${GATE_LABELS[gate]} gate does not apply to a ${opp.bidClass} bid (its gates: ${allowed
            .map((g) => GATE_LABELS[g])
            .join(', ')})`,
        );
      }

      const row = await prisma.gateDecision.create({
        data: {
          orgId,
          opportunityId: opp.id,
          gate,
          outcome,
          bidClass: opp.bidClass,
          decidedById: userId,
          decidedByRole: req.body.decidedByRole ?? null,
          justification: req.body.justification ?? null,
        },
      });

      // A gate is a governance EVENT, not a private note: the owner and the
      // bid-office leads need to know a bid was signed off or killed. Awaited
      // for durability but never allowed to fail the decision itself.
      void notifyGateRecipients(server, {
        orgId,
        actorUserId: userId,
        opportunity: opp,
        gate,
        outcome,
      }).catch((err: unknown) => {
        req.log.warn({ err, opportunityId: opp.id, gate }, 'gate-decision notification failed');
      });

      return serializeGate(row);
    },
  );
};
