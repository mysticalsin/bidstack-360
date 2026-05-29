import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SalesIntelligenceReport } from '@bidstack/shared';

import {
  buildOpportunitySalesReport,
  buildSalesOrderReport,
  readCategoryRollup,
  readProductRollup,
  readSalesOrders,
} from '../services/reports/sales-intelligence.service.js';
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
  server.get('/reports/pipeline', { schema: { response: { 200: PipelineKpis } } }, async (req) =>
    getPipelineKpis(req.auth.orgId),
  );

  server.get(
    '/reports/sales-intelligence',
    { schema: { response: { 200: SalesIntelligenceReport } } },
    async (req) => {
      const generatedAt = new Date().toISOString();
      const contacts = await prisma.contact.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { customer: true, name: true, role: true, email: true },
        take: 500,
      });

      const salesOrders = await readSalesOrders(req.auth.orgId, req.log);
      if (salesOrders && salesOrders.length > 0) {
        const [topProducts, topCategories] = await Promise.all([
          readProductRollup(req.auth.orgId, req.log),
          readCategoryRollup(req.auth.orgId, req.log),
        ]);
        return buildSalesOrderReport({
          generatedAt,
          rows: salesOrders,
          contacts,
          productRows: topProducts,
          categoryRows: topCategories,
        });
      }

      const [opportunities, enrichments] = await Promise.all([
        prisma.opportunity.findMany({
          where: { orgId: req.auth.orgId, deletedAt: null },
          select: {
            id: true,
            code: true,
            customer: true,
            name: true,
            stage: true,
            valueMicros: true,
            dueDate: true,
            updatedAt: true,
            industry: true,
            owner: { select: { name: true } },
            territoryId: true,
            territory: { select: { name: true } },
          },
          orderBy: [{ updatedAt: 'desc' }],
          take: 500,
        }),
        prisma.companyEnrichment.findMany({
          where: { orgId: req.auth.orgId, deletedAt: null },
          select: {
            legalName: true,
            tradeName: true,
            normalizedName: true,
            providerMetadata: true,
          },
          take: 200,
        }),
      ]);

      return buildOpportunitySalesReport({
        generatedAt,
        opportunities,
        enrichments,
        contacts,
      });
    },
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
