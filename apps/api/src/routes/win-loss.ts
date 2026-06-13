// Win/Loss reason capture + pattern flagging. One record per opportunity
// (upsert). The patterns aggregate is index-backed (orgId, outcome, reason) so
// it scales without scanning opportunities.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  WinLossRecord,
  WinLossRecordUpsert,
  WinLossPatterns,
  type WinLossReasonCode,
} from '@bidstack/shared';

interface DbRow {
  id: string;
  opportunityId: string;
  outcome: string;
  reason: string;
  competitor: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(r: DbRow): z.infer<typeof WinLossRecord> {
  return {
    id: r.id,
    opportunityId: r.opportunityId,
    outcome: r.outcome as z.infer<typeof WinLossRecord>['outcome'],
    reason: r.reason as WinLossReasonCode,
    competitor: r.competitor,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const OppParam = z.object({ opportunityId: z.string().uuid() });
const SELECT = {
  id: true,
  opportunityId: true,
  outcome: true,
  reason: true,
  competitor: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const winLossRoutes: FastifyPluginAsyncZod = async (server) => {
  // Pattern flagging across the org. Registered BEFORE the :opportunityId route
  // so "patterns" is not captured as an opportunity id.
  server.get(
    '/win-loss/patterns',
    {
      preHandler: [server.requirePermission('opportunities:read')],
      schema: { response: { 200: WinLossPatterns } },
    },
    async (req) => {
      const grouped = await prisma.winLossRecord.groupBy({
        by: ['outcome', 'reason'],
        where: { orgId: req.auth.orgId },
        _count: { _all: true },
      });
      const rows = grouped.map((g) => ({
        outcome: g.outcome as z.infer<typeof WinLossPatterns>['rows'][number]['outcome'],
        reason: g.reason as WinLossReasonCode,
        count: g._count._all,
      }));
      const totalWon = rows.filter((r) => r.outcome === 'won').reduce((s, r) => s + r.count, 0);
      const totalLost = rows.filter((r) => r.outcome === 'lost').reduce((s, r) => s + r.count, 0);
      const topLoss = rows
        .filter((r) => r.outcome === 'lost')
        .sort((a, b) => b.count - a.count)[0];
      return { rows, totalWon, totalLost, topLossReason: topLoss?.reason ?? null };
    },
  );

  server.get(
    '/win-loss/:opportunityId',
    {
      preHandler: [server.requirePermission('opportunities:read')],
      schema: { params: OppParam, response: { 200: WinLossRecord.nullable() } },
    },
    async (req) => {
      const row = await prisma.winLossRecord.findFirst({
        where: { orgId: req.auth.orgId, opportunityId: req.params.opportunityId },
        select: SELECT,
      });
      return row ? serialize(row) : null;
    },
  );

  server.put(
    '/win-loss/:opportunityId',
    {
      preHandler: [server.requirePermission('opportunities:write')],
      schema: { params: OppParam, body: WinLossRecordUpsert, response: { 200: WinLossRecord } },
    },
    async (req) => {
      // The opportunity must belong to the caller's org (tenant guard).
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.opportunityId, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const row = await prisma.winLossRecord.upsert({
        where: { opportunityId: req.params.opportunityId },
        create: {
          orgId: req.auth.orgId,
          opportunityId: req.params.opportunityId,
          outcome: req.body.outcome,
          reason: req.body.reason,
          competitor: req.body.competitor ?? null,
          note: req.body.note ?? null,
          recordedById: req.auth.userId,
        },
        update: {
          outcome: req.body.outcome,
          reason: req.body.reason,
          competitor: req.body.competitor ?? null,
          note: req.body.note ?? null,
          recordedById: req.auth.userId,
        },
        select: SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'win_loss.record',
          targetType: 'opportunity',
          targetId: req.params.opportunityId,
          diff: { outcome: row.outcome, reason: row.reason },
        },
      });
      return serialize(row);
    },
  );
};
