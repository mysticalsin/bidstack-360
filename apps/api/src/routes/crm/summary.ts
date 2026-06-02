import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

type SummaryCounts = {
  companies: number;
  contacts: number;
  leads: number;
  opportunities: number;
  openOpportunities: number;
  pipelineValueMicros: bigint | number | string | null;
  tasks: number;
  overdueTasks: number;
  serviceCases: number;
  openServiceCases: number;
};

type CrmSummaryPayload = {
  companies: number;
  contacts: number;
  leads: number;
  opportunities: number;
  openOpportunities: number;
  pipelineValue: number;
  tasks: number;
  overdueTasks: number;
  serviceCases: number;
  openServiceCases: number;
  recentActivity: Array<{
    type: 'opportunity' | 'lead' | 'task' | 'case';
    title: string;
    subtitle: string | null;
    date: string;
    url: string;
  }>;
};

type CrmSummaryCacheEntry = {
  expiresAt: number;
  promise: Promise<CrmSummaryPayload>;
};

const CRM_SUMMARY_CACHE_TTL_MS = 10_000;
const crmSummaryCache = new Map<string, CrmSummaryCacheEntry>();

function crmSummaryCacheKey(orgId: string, limit: number): string {
  return `${orgId}:${limit}`;
}

async function buildCrmSummary(orgId: string, limit: number): Promise<CrmSummaryPayload> {
  // NOTE: 'closed_won' and 'closed_lost' are inlined as SQL text (not interpolated
  // parameters) because Prisma's $queryRaw tagged-template serializer cannot encode
  // a JS array as a PostgreSQL enum-array parameter. Static enum literals are safe
  // to inline since they are not derived from user input.
  const [countsRow, recentOpportunities, recentLeads, recentTasks, recentCases] = await Promise.all(
    [
      prisma.$queryRaw<SummaryCounts[]>`
      SELECT
        (SELECT COUNT(*)::int FROM companies WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS companies,
        (SELECT COUNT(*)::int FROM contacts WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS contacts,
        (SELECT COUNT(*)::int FROM leads WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS leads,
        (SELECT COUNT(*)::int FROM opportunities WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS opportunities,
        (
          SELECT COUNT(*)::int
          FROM opportunities
          WHERE org_id = ${orgId}::uuid
            AND stage NOT IN ('closed_won', 'closed_lost')
            AND deleted_at IS NULL
        ) AS "openOpportunities",
        (
          SELECT COALESCE(SUM(value_micros), 0)
          FROM opportunities
          WHERE org_id = ${orgId}::uuid
            AND stage NOT IN ('closed_won', 'closed_lost')
            AND deleted_at IS NULL
        ) AS "pipelineValueMicros",
        (SELECT COUNT(*)::int FROM tasks WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS tasks,
        (
          SELECT COUNT(*)::int
          FROM tasks
          WHERE org_id = ${orgId}::uuid
            AND status <> 'done'
            AND due_date < CURRENT_DATE
            AND deleted_at IS NULL
        ) AS "overdueTasks",
        (SELECT COUNT(*)::int FROM service_cases WHERE org_id = ${orgId}::uuid AND deleted_at IS NULL) AS "serviceCases",
        (
          SELECT COUNT(*)::int
          FROM service_cases
          WHERE org_id = ${orgId}::uuid
            AND status = 'open'
            AND deleted_at IS NULL
        ) AS "openServiceCases"
    `,
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
    ],
  );

  const counts = countsRow[0] ?? {
    companies: 0,
    contacts: 0,
    leads: 0,
    opportunities: 0,
    openOpportunities: 0,
    pipelineValueMicros: 0,
    tasks: 0,
    overdueTasks: 0,
    serviceCases: 0,
    openServiceCases: 0,
  };
  const pipelineValueMicros = Number(counts.pipelineValueMicros ?? 0);

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
    .slice(0, limit);

  return {
    companies: counts.companies,
    contacts: counts.contacts,
    leads: counts.leads,
    opportunities: counts.opportunities,
    openOpportunities: counts.openOpportunities,
    pipelineValue: pipelineValueMicros / 1_000_000,
    tasks: counts.tasks,
    overdueTasks: counts.overdueTasks,
    serviceCases: counts.serviceCases,
    openServiceCases: counts.openServiceCases,
    recentActivity,
  };
}

async function cachedCrmSummary(orgId: string, limit: number): Promise<CrmSummaryPayload> {
  const key = crmSummaryCacheKey(orgId, limit);
  const now = Date.now();
  const cached = crmSummaryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildCrmSummary(orgId, limit);
  crmSummaryCache.set(key, { expiresAt: now + CRM_SUMMARY_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    crmSummaryCache.delete(key);
    throw err;
  }
}

export async function crmSummaryRoutes(app: FastifyInstance) {
  app.get('/crm/summary', async (req, reply) => {
    // req.auth is decorated globally by the auth plugin (fastify-plugin, so
    // non-encapsulating). The onRequest hook guarantees it is set on every
    // non-public route before we reach this handler.
    const orgId = req.auth?.orgId;
    if (!orgId) return reply.code(401).send({ error: 'Unauthorized' });

    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query parameters', issues: queryResult.error.issues });
    }

    return req.cache(() => cachedCrmSummary(orgId, queryResult.data.limit), {
      ttlSeconds: 30,
      tags: ['crm-summary'],
    });
  });
}
