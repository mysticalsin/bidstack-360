import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((a.getTime() - b.getTime()) / msPerDay);
}

const PipelineKpis = z.object({
  byStage: z.array(
    z.object({
      stage: z.string(),
      count: z.number().int(),
      valueSum: z.number(),
    }),
  ),
  totalOpen: z.number().int(),
  totalValueOpen: z.number(),
  weightedPipeline: z.number(),
  velocity: z.object({
    avgDaysOpen: z.number(),
    closedThisQuarter: z.number().int(),
  }),
});

export const reportsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get('/reports/pipeline', { schema: { response: { 200: PipelineKpis } } }, async (req) => {
    const grouped = await prisma.opportunity.groupBy({
      by: ['stage'],
      where: { orgId: req.auth.orgId },
      _count: { _all: true },
      _sum: { valueEur: true },
    });

    const byStage = grouped.map((g) => ({
      stage: g.stage,
      count: g._count._all,
      valueSum: Number(g._sum.valueEur ?? 0),
    }));

    const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');

    // Weighted pipeline = Σ (value × probability/100) over open opps.
    const opens = await prisma.opportunity.findMany({
      where: {
        orgId: req.auth.orgId,
        stage: { notIn: ['closed_won', 'closed_lost'] },
      },
      select: { valueEur: true, probability: true },
    });
    const weighted = opens.reduce((acc, o) => acc + Number(o.valueEur) * (o.probability / 100), 0);

    const closedThisQuarter = await prisma.opportunity.count({
      where: {
        orgId: req.auth.orgId,
        stage: 'closed_won',
        updatedAt: { gte: quarterStart() },
      },
    });

    const allOpen = await prisma.opportunity.findMany({
      where: {
        orgId: req.auth.orgId,
        stage: { notIn: ['closed_won', 'closed_lost'] },
      },
      select: { createdAt: true },
    });
    const avgDaysOpen =
      allOpen.length > 0
        ? Math.round(
            allOpen.reduce((sum, o) => sum + daysBetween(new Date(), o.createdAt), 0) /
              allOpen.length,
          )
        : 0;

    return {
      byStage,
      totalOpen: open.reduce((acc, s) => acc + s.count, 0),
      totalValueOpen: open.reduce((acc, s) => acc + s.valueSum, 0),
      weightedPipeline: Math.round(weighted * 100) / 100,
      velocity: {
        avgDaysOpen,
        closedThisQuarter,
      },
    };
  });
};

function quarterStart(): Date {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
}
