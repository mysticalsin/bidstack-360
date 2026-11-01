import { Prisma, prisma } from '@bidstack/db';
import { microsToUnits, quarterStart } from '@bidstack/shared';

import { wonOutcomeWhere } from '../../routes/opportunities.helpers.js';

export interface PipelineKpis {
  byStage: Array<{ stage: string; count: number; valueSum: number; valueSumMicros: string }>;
  totalOpen: number;
  totalValueOpen: number;
  totalValueOpenMicros: string;
  weightedPipeline: number;
  weightedPipelineMicros: string;
  velocity: { avgDaysOpen: number | null; closedThisQuarter: number };
}

type StageSum = { stage: string; _count: { _all: number }; _sum: { valueMicros: bigint | number | null } };

function weightedMicrosFromText(value: string | null | undefined): bigint {
  const whole = (value ?? '0').split('.')[0]?.trim() || '0';
  return BigInt(whole);
}

/** Round to the cent in integer micros. Float rounding moves this amount by one cent. */
function roundToCentMicros(micros: bigint): bigint {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs + 5_000n) / 10_000n) * 10_000n;
  return negative ? -rounded : rounded;
}

function asMicros(value: bigint | number | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return 0n;
}

/** A lost flag wins over a won flag, matching closedOutcome. */
function moveFlagged(
  sums: Map<string, { count: number; micros: bigint }>,
  rows: readonly StageSum[],
  into: 'closed_lost' | 'closed_won',
): void {
  for (const row of rows) {
    const micros = asMicros(row._sum.valueMicros);
    const from = sums.get(row.stage) ?? { count: 0, micros: 0n };
    from.count -= row._count._all;
    from.micros -= micros;
    sums.set(row.stage, from);
    const dest = sums.get(into) ?? { count: 0, micros: 0n };
    dest.count += row._count._all;
    dest.micros += micros;
    sums.set(into, dest);
  }
}

export async function getPipelineKpis(orgId: string): Promise<PipelineKpis> {
  const live = { orgId, deletedAt: null };
  const [grouped, lostFlagged, wonFlagged] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['stage'],
      where: live,
      _count: { _all: true },
      _sum: { valueMicros: true },
    }),
    prisma.opportunity.groupBy({
      by: ['stage'],
      where: {
        ...live,
        NOT: { stage: 'closed_lost' },
        pipelineStage: { isLost: true, deletedAt: null },
      },
      _count: { _all: true },
      _sum: { valueMicros: true },
    }),
    prisma.opportunity.groupBy({
      by: ['stage'],
      where: {
        ...live,
        NOT: { stage: 'closed_won' },
        pipelineStage: { isLost: false, isWon: true, deletedAt: null },
      },
      _count: { _all: true },
      _sum: { valueMicros: true },
    }),
  ]);

  const sums = new Map<string, { count: number; micros: bigint }>();
  for (const row of grouped) {
    sums.set(row.stage, { count: row._count._all, micros: asMicros(row._sum.valueMicros) });
  }
  // The enum key can still say an open stage after the stage row is marked
  // lost or won. Those deals belong with the closed outcome, not the open book.
  // A deleted stage row does not.
  moveFlagged(sums, lostFlagged, 'closed_lost');
  moveFlagged(sums, wonFlagged, 'closed_won');

  const byStage = [...sums.entries()]
    .filter(([, row]) => row.count > 0)
    .map(([stage, row]) => ({
      stage,
      count: row.count,
      // WHY microsToUnits (not Number(x) / 1_000_000): the naive form rounds the
      // BigInt→Number conversion *before* dividing, so a per-stage aggregate past
      // Number.MAX_SAFE_INTEGER micros (~$9.007B) silently corrupts. The shared
      // helper keeps BigInt arithmetic through the whole/remainder split.
      valueSum: microsToUnits(row.micros),
      valueSumMicros: row.micros >= 0n ? row.micros.toString() : '0',
    }));

  const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');

  // Close date is the due date. A later edit must not move last quarter's win
  // into this quarter, and a win with no close date is not counted.
  const quarterBegin = quarterStart();
  const quarterEnd = new Date(Date.UTC(quarterBegin.getUTCFullYear(), quarterBegin.getUTCMonth() + 3, 1));
  const closedThisQuarter = await prisma.opportunity.count({
    where: {
      orgId,
      deletedAt: null,
      dueDate: { gte: quarterBegin, lt: quarterEnd },
      ...wonOutcomeWhere(),
    },
  });

  // Weighted pipeline + avg-open-age over the FULL open set, not a take:1000
  // sample. WHY raw SQL: weighted micros are a row-wise product reduced to a
  // scalar, kept in numeric so a large amount is not rounded before the cent.
  // Avg-open-age floors fractional days per row. Neither is a prisma aggregate.
  // floor(epoch/86400) mirrors Math.floor on (now - created_at) in whole days.
  const [agg] = await prisma.$queryRaw<
    Array<{ weightedMicros: string | null; avgDaysOpen: number | null; openCount: number }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(ROUND((o.value_micros::numeric * o.probability) / 100)), 0)::text AS "weightedMicros",
      AVG(floor(EXTRACT(EPOCH FROM (now() - o.created_at)) / 86400.0)) AS "avgDaysOpen",
      COUNT(*)::int AS "openCount"
    FROM opportunities o
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND o.stage NOT IN ('closed_won', 'closed_lost')
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_stages ps
        WHERE ps.id = o.pipeline_stage_id
          AND ps.deleted_at IS NULL
          AND (ps.is_lost OR ps.is_won)
      )
  `);
  const weightedMicros = roundToCentMicros(weightedMicrosFromText(agg?.weightedMicros));
  const weighted = microsToUnits(weightedMicros);
  const openMicros = [...sums.entries()].reduce((sum, [stage, row]) => {
    if (row.count <= 0 || stage === 'closed_won' || stage === 'closed_lost') return sum;
    return sum + (row.micros > 0n ? row.micros : 0n);
  }, 0n);
  const avgDaysOpen =
    agg && agg.openCount > 0 && agg.avgDaysOpen != null ? Math.round(agg.avgDaysOpen) : null;

  return {
    byStage,
    totalOpen: open.reduce((acc, s) => acc + s.count, 0),
    totalValueOpen: microsToUnits(openMicros),
    totalValueOpenMicros: openMicros.toString(),
    weightedPipeline: weighted,
    weightedPipelineMicros: weightedMicros.toString(),
    velocity: { avgDaysOpen, closedThisQuarter },
  };
}

export interface LeadFunnel {
  byStatus: Array<{ status: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  total: number;
  converted: number;
  conversionRate: number | null;
  avgScore: number | null;
}

export async function getLeadFunnel(orgId: string): Promise<LeadFunnel> {
  const [byStatus, bySource, total, converted, scoreAgg] = await Promise.all([
    prisma.lead.groupBy({
      by: ['status'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['source'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: { orgId, deletedAt: null } }),
    prisma.lead.count({ where: { orgId, deletedAt: null, status: 'converted' } }),
    prisma.lead.aggregate({
      where: { orgId, deletedAt: null },
      _avg: { score: true },
    }),
  ]);

  return {
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    bySource: bySource.map((s) => ({ source: s.source ?? 'unknown', count: s._count._all })),
    total,
    converted,
    conversionRate: total > 0 ? Math.round((converted / total) * 10_000) / 100 : null,
    avgScore: scoreAgg._avg.score == null ? null : Math.round(scoreAgg._avg.score * 100) / 100,
  };
}

export interface ServiceDeskReport {
  byStatus: Array<{ status: string; count: number }>;
  byPriority: Array<{ priority: string; count: number }>;
  total: number;
  open: number;
  resolvedThisMonth: number;
  avgSatisfaction: number | null;
}

export async function getServiceDeskReport(orgId: string): Promise<ServiceDeskReport> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [byStatus, byPriority, total, open, resolvedThisMonth, satAgg] = await Promise.all([
    prisma.serviceCase.groupBy({
      by: ['status'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.serviceCase.groupBy({
      by: ['priority'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.serviceCase.count({ where: { orgId, deletedAt: null } }),
    prisma.serviceCase.count({ where: { orgId, deletedAt: null, status: { not: 'closed' } } }),
    prisma.serviceCase.count({
      where: { orgId, deletedAt: null, status: 'closed', resolvedAt: { gte: monthStart } },
    }),
    prisma.serviceCase.aggregate({
      where: { orgId, deletedAt: null, satisfaction: { not: null } },
      _avg: { satisfaction: true },
    }),
  ]);

  return {
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    byPriority: byPriority.map((p) => ({ priority: p.priority, count: p._count._all })),
    total,
    open,
    resolvedThisMonth,
    avgSatisfaction: satAgg._avg.satisfaction
      ? Math.round(satAgg._avg.satisfaction * 100) / 100
      : null,
  };
}

export interface TasksReport {
  byStatus: Array<{ status: string; count: number }>;
  total: number;
  completed: number;
  overdue: number;
  completionRate: number;
}

export async function getTasksReport(orgId: string): Promise<TasksReport> {
  const now = new Date();
  const [byStatus, total, completed, overdue] = await Promise.all([
    prisma.task.groupBy({
      by: ['status'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.task.count({ where: { orgId, deletedAt: null } }),
    prisma.task.count({ where: { orgId, deletedAt: null, status: 'done' } }),
    prisma.task.count({
      where: { orgId, deletedAt: null, status: { not: 'done' }, dueDate: { lt: now } },
    }),
  ]);

  return {
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    total,
    completed,
    overdue,
    completionRate: total > 0 ? Math.round((completed / total) * 10_000) / 100 : 0,
  };
}
