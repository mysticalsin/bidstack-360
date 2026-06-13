import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  getLeadFunnel,
  getPipelineKpis,
  getServiceDeskReport,
  getTasksReport,
} from '../services/reports/funnel.service.js';

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

  // RBAC: these are read endpoints; gate the whole plugin on the read permission.
  server.addHook('preHandler', server.requirePermission('reports:read'));
  server.get('/reports/pipeline', { schema: { response: { 200: PipelineKpis } } }, async (req) =>
    getPipelineKpis(req.auth.orgId),
  );

  server.get(
    '/reports/leads',
    {
      schema: {
        response: {
          200: z.object({
            byStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
            bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
            total: z.number().int(),
            converted: z.number().int(),
            conversionRate: z.number(),
            avgScore: z.number(),
          }),
        },
      },
    },
    async (req) => getLeadFunnel(req.auth.orgId),
  );

  server.get(
    '/reports/service-desk',
    {
      schema: {
        response: {
          200: z.object({
            byStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
            byPriority: z.array(z.object({ priority: z.string(), count: z.number().int() })),
            total: z.number().int(),
            open: z.number().int(),
            resolvedThisMonth: z.number().int(),
            avgSatisfaction: z.number().nullable(),
          }),
        },
      },
    },
    async (req) => getServiceDeskReport(req.auth.orgId),
  );

  server.get(
    '/reports/tasks',
    {
      schema: {
        response: {
          200: z.object({
            byStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
            total: z.number().int(),
            completed: z.number().int(),
            overdue: z.number().int(),
            completionRate: z.number(),
          }),
        },
      },
    },
    async (req) => getTasksReport(req.auth.orgId),
  );
};
