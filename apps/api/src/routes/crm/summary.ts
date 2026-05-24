import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export async function crmSummaryRoutes(app: FastifyInstance) {
  app.get('/crm/summary', async (req, reply) => {
    const orgId = (req as unknown as { auth?: { orgId: string } }).auth?.orgId;
    if (!orgId) return reply.code(401).send({ error: 'Unauthorized' });

    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', issues: queryResult.error.issues });
    }

    const closedStages = ['closed_won', 'closed_lost'] as ['closed_won', 'closed_lost'];

    const [
      companies,
      contacts,
      leads,
      opportunities,
      openOpportunities,
      pipelineAgg,
      tasks,
      overdueTasks,
      serviceCases,
      openServiceCases,
      recentOpportunities,
      recentLeads,
      recentTasks,
      recentCases,
    ] = await Promise.all([
      prisma.company.count({ where: { orgId, deletedAt: null } }),
      prisma.contact.count({ where: { orgId, deletedAt: null } }),
      prisma.lead.count({ where: { orgId, deletedAt: null } }),
      prisma.opportunity.count({ where: { orgId, deletedAt: null } }),
      prisma.opportunity.count({
        where: { orgId, stage: { notIn: closedStages }, deletedAt: null },
      }),
      prisma.opportunity.aggregate({
        where: { orgId, stage: { notIn: closedStages }, deletedAt: null },
        _sum: { valueMicros: true },
      }),
      prisma.task.count({ where: { orgId, deletedAt: null } }),
      prisma.task.count({
        where: {
          orgId,
          status: { not: 'done' },
          dueDate: { lt: new Date() },
          deletedAt: null,
        },
      }),
      prisma.serviceCase.count({ where: { orgId, deletedAt: null } }),
      prisma.serviceCase.count({ where: { orgId, status: 'open', deletedAt: null } }),
      prisma.opportunity.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        where: { orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          stage: true,
          updatedAt: true,
          company: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        where: { orgId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          updatedAt: true,
        },
      }),
      prisma.task.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        where: { orgId, deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.serviceCase.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        where: { orgId, deletedAt: null },
        select: {
          id: true,
          subject: true,
          priority: true,
          status: true,
          updatedAt: true,
          company: { select: { id: true, name: true } },
        },
      }),
    ]);

    const recentActivity = [
      ...recentOpportunities.map((o) => ({
        type: 'opportunity' as const,
        title: o.name,
        subtitle: o.stage,
        date: o.updatedAt.toISOString(),
        url: `/opportunities/${o.id}`,
      })),
      ...recentLeads.map((l) => ({
        type: 'lead' as const,
        title: `${l.firstName} ${l.lastName ?? ''}`.trim(),
        subtitle: l.status,
        date: l.updatedAt.toISOString(),
        url: `/leads/${l.id}`,
      })),
      ...recentTasks.map((t) => ({
        type: 'task' as const,
        title: t.title,
        subtitle: t.status,
        date: t.createdAt.toISOString(),
        url: `/tasks/${t.id}`,
      })),
      ...recentCases.map((c) => ({
        type: 'case' as const,
        title: c.subject,
        subtitle: c.status,
        date: c.updatedAt.toISOString(),
        url: `/service-desk/${c.id}`,
      })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);

    return {
      companies,
      contacts,
      leads,
      opportunities,
      openOpportunities,
      pipelineValue: Number(pipelineAgg._sum?.valueMicros ?? 0n) / 1_000_000,
      tasks,
      overdueTasks,
      serviceCases,
      openServiceCases,
      recentActivity,
    };
  });
}
