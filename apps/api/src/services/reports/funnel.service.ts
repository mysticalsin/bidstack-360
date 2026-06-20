import { Prisma, prisma } from '@bidstack/db';
import { quarterStart } from '@bidstack/shared';

export interface PipelineKpis {
  byStage: Array<{ stage: string; count: number; valueSum: number }>;
  totalOpen: number;
  totalValueOpen: number;
  weightedPipeline: number;
  velocity: { avgDaysOpen: number; closedThisQuarter: number };
}

export async function getPipelineKpis(orgId: string): Promise<PipelineKpis> {
  const grouped = await prisma.opportunity.groupBy({
    by: ['stage'],
    where: { orgId, deletedAt: null },
    _count: { _all: true },
    _sum: { valueMicros: true },
  });

  const byStage = grouped.map((g) => ({
    stage: g.stage,
    count: g._count._all,
    valueSum: Number(g._sum.valueMicros ?? 0) / 1_000_000,
  }));

  const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');

  const closedThisQuarter = await prisma.opportunity.count({
    where: { orgId, deletedAt: null, stage: 'closed_won', updatedAt: { gte: quarterStart() } },
  });

  // Weighted pipeline + avg-open-age over the FULL open set, not a take:1000
  // sample. WHY raw SQL: weighted = SUM(value/1e6 * prob/100) is a row-wise
  // product reduced to a scalar, and avg-open-age floors fractional days PER ROW
  // (matching the prior daysBetween → Math.floor) before averaging — neither is
  // expressible via prisma.aggregate. floor(epoch/86400) mirrors Math.floor on
  // (now - created_at) in whole days.
  const [agg] = await prisma.$queryRaw<
    Array<{ weighted: number | null; avgDaysOpen: number | null; openCount: number }>
  >(Prisma.sql`
    SELECT
      SUM((o.value_micros::float8 / 1000000.0) * (o.probability::float8 / 100.0)) AS "weighted",
      AVG(floor(EXTRACT(EPOCH FROM (now() - o.created_at)) / 86400.0)) AS "avgDaysOpen",
      COUNT(*)::int AS "openCount"
    FROM opportunities o
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND o.stage NOT IN ('closed_won', 'closed_lost')
  `);
  const weighted = agg?.weighted ?? 0;
  const avgDaysOpen = agg && agg.openCount > 0 ? Math.round(agg.avgDaysOpen ?? 0) : 0;

  return {
    byStage,
    totalOpen: open.reduce((acc, s) => acc + s.count, 0),
    totalValueOpen: open.reduce((acc, s) => acc + s.valueSum, 0),
    weightedPipeline: Math.round(weighted * 100) / 100,
    velocity: { avgDaysOpen, closedThisQuarter },
  };
}

export interface LeadFunnel {
  byStatus: Array<{ status: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  total: number;
  converted: number;
  conversionRate: number;
  avgScore: number;
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
    conversionRate: total > 0 ? Math.round((converted / total) * 10_000) / 100 : 0,
    avgScore: Math.round((scoreAgg._avg.score ?? 0) * 100) / 100,
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
