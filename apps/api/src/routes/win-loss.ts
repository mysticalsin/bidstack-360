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
  WinLossOutcome,
  WinLossReasonCode,
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

// ── Analysis (dedicated /win-loss page) ──────────────────────────────────────
// Time-bucketed + filterable aggregate for the quarterly retrospective. Unlike
// /patterns (index-only groupBy), the owner + date filters need the opportunity
// join, so we scan a bounded window of the most recent records and aggregate in
// code — 1 000 closed-bid records is years of bid history for one org, and it
// is the largest `take` the query-guard plugin accepts as bounded.

const ANALYSIS_SCAN_CAP = 1000;
const ANALYSIS_RECENT_LIMIT = 50;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const AnalysisQuery = z.object({
  from: z.string().regex(DATE_ONLY).optional(),
  to: z.string().regex(DATE_ONLY).optional(),
  ownerId: z.string().uuid().optional(),
});

const OutcomeCounts = z.object({
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
});

const WinLossAnalysis = z.object({
  totalWon: z.number().int().nonnegative(),
  totalLost: z.number().int().nonnegative(),
  /** 0–100, one decimal; null when the range has no closed records. */
  winRatePct: z.number().nullable(),
  quarters: z.array(OutcomeCounts.extend({ quarter: z.string() })),
  reasons: z.array(OutcomeCounts.extend({ reason: WinLossReasonCode })),
  competitors: z.array(OutcomeCounts.extend({ competitor: z.string() })),
  recent: z.array(
    z.object({
      opportunityId: z.string().uuid(),
      name: z.string(),
      customer: z.string(),
      outcome: WinLossOutcome,
      reason: WinLossReasonCode,
      competitor: z.string().nullable(),
      /** BigInt-safe micros on the wire; format at the edge. */
      valueMicros: z.string(),
      ownerId: z.string().uuid().nullable(),
      ownerName: z.string().nullable(),
      decidedAt: z.string().datetime(),
    }),
  ),
});
type WinLossAnalysisBody = z.infer<typeof WinLossAnalysis>;

interface AnalysisScanRow {
  outcome: string;
  reason: string;
  competitor: string | null;
  createdAt: Date;
  opportunity: {
    id: string;
    name: string;
    customer: string;
    valueMicros: bigint;
    ownerId: string | null;
    owner: { name: string | null; email: string } | null;
  };
}

function quarterKey(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function bump(map: Map<string, { won: number; lost: number }>, key: string, won: boolean): void {
  const entry = map.get(key) ?? { won: 0, lost: 0 };
  if (won) entry.won += 1;
  else entry.lost += 1;
  map.set(key, entry);
}

function serializeRecent(r: AnalysisScanRow): WinLossAnalysisBody['recent'][number] {
  return {
    opportunityId: r.opportunity.id,
    name: r.opportunity.name,
    customer: r.opportunity.customer,
    outcome: r.outcome as z.infer<typeof WinLossOutcome>,
    reason: r.reason as WinLossReasonCode,
    competitor: r.competitor,
    valueMicros: r.opportunity.valueMicros.toString(),
    ownerId: r.opportunity.ownerId,
    ownerName: r.opportunity.owner?.name ?? r.opportunity.owner?.email ?? null,
    decidedAt: r.createdAt.toISOString(),
  };
}

function aggregateAnalysis(rows: AnalysisScanRow[]): WinLossAnalysisBody {
  const quarters = new Map<string, { won: number; lost: number }>();
  const reasons = new Map<string, { won: number; lost: number }>();
  const competitors = new Map<string, { won: number; lost: number }>();
  let totalWon = 0;
  let totalLost = 0;
  for (const r of rows) {
    const won = r.outcome === 'won';
    if (won) totalWon += 1;
    else totalLost += 1;
    bump(quarters, quarterKey(r.createdAt), won);
    bump(reasons, r.reason, won);
    const competitor = r.competitor?.trim();
    if (competitor) bump(competitors, competitor, won);
  }
  const total = totalWon + totalLost;
  const byLostDesc = (a: { lost: number }, b: { lost: number }) => b.lost - a.lost;
  return {
    totalWon,
    totalLost,
    winRatePct: total === 0 ? null : Math.round((totalWon / total) * 1000) / 10,
    // "2026-Q1" sorts lexically because the year is zero-padded to 4 digits.
    quarters: [...quarters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, counts]) => ({ quarter, ...counts })),
    reasons: [...reasons.entries()]
      .map(([reason, counts]) => ({ reason: reason as WinLossReasonCode, ...counts }))
      .sort(byLostDesc),
    competitors: [...competitors.entries()]
      .map(([competitor, counts]) => ({ competitor, ...counts }))
      .sort(byLostDesc)
      .slice(0, 10),
    recent: rows.slice(0, ANALYSIS_RECENT_LIMIT).map(serializeRecent),
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

  // Time-bucketed retrospective for the dedicated /win-loss page. Static path —
  // like "patterns", registered before /:opportunityId so it isn't captured as
  // an opportunity id.
  server.get(
    '/win-loss/analysis',
    {
      preHandler: [server.requirePermission('opportunities:read')],
      schema: { querystring: AnalysisQuery, response: { 200: WinLossAnalysis } },
    },
    async (req) => {
      const { from, to, ownerId } = req.query;
      const rows = await prisma.winLossRecord.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                  ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
                },
              }
            : {}),
          // Owner lives on the opportunity; the join also hides soft-deleted opps.
          opportunity: { deletedAt: null, ...(ownerId ? { ownerId } : {}) },
        },
        orderBy: { createdAt: 'desc' },
        take: ANALYSIS_SCAN_CAP,
        select: {
          outcome: true,
          reason: true,
          competitor: true,
          createdAt: true,
          opportunity: {
            select: {
              id: true,
              name: true,
              customer: true,
              valueMicros: true,
              ownerId: true,
              owner: { select: { name: true, email: true } },
            },
          },
        },
      });
      return aggregateAnalysis(rows);
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
