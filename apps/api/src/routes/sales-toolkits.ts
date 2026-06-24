// Sales Toolkits — two surfaces:
//  1. /sales-toolkits — industry-tagged Mantu Academy (360Learning) courses,
//     live (no local storage); sample fallback when the LMS isn't configured.
//  2. /sales-toolkits/store — STORED toolkit collateral (decks/templates/
//     battle-cards), org-scoped CRUD. Normally kept in SharePoint; stored here so
//     it's managed in BidStack + readable by the MCP (the MCP tool reads this
//     same table, so an added toolkit is immediately available to agents).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SalesToolkit, SalesToolkitCreate, SalesToolkitList, SalesToolkitPatch } from '@bidstack/shared';

import { fetchLmsCourses, lmsConfigured, LmsError, sampleLmsCourses } from '../lib/lms-360learning.js';

const SalesToolkitsResponse = z.object({
  enabled: z.boolean(),
  // True when items are illustrative sample data, not a live LMS fetch.
  preview: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      sectorTags: z.array(z.string()),
      url: z.string().nullable(),
    }),
  ),
});

const TOOLKIT_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  sectorTags: true,
  url: true,
  source: true,
  externalId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ToolkitRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  sectorTags: string[];
  url: string | null;
  source: string;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSalesToolkit(row: ToolkitRow): z.infer<typeof SalesToolkit> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as z.infer<typeof SalesToolkit>['category'],
    sectorTags: row.sectorTags,
    url: row.url,
    source: row.source as z.infer<typeof SalesToolkit>['source'],
    externalId: row.externalId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const salesToolkitsRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── 1. Mantu Academy courses (live, read-only) ──────────────────────────────
  server.get(
    '/sales-toolkits',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({ sector: z.string().trim().max(120).optional() }),
        response: { 200: SalesToolkitsResponse },
      },
    },
    async (req) => {
      if (!lmsConfigured()) {
        return { enabled: false, preview: true, items: sampleLmsCourses(req.query.sector) };
      }
      try {
        const items = await fetchLmsCourses(req.query.sector);
        return { enabled: true, preview: false, items };
      } catch (err) {
        if (err instanceof LmsError) {
          req.log.warn({ err }, 'sales-toolkits LMS fetch failed');
          throw server.httpErrors.badGateway('Mantu Academy is unreachable right now');
        }
        throw err;
      }
    },
  );

  // ── 2. Stored toolkit collateral (org-scoped CRUD) ──────────────────────────
  server.get(
    '/sales-toolkits/store',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        querystring: z.object({
          sector: z.string().trim().max(120).optional(),
          category: z.string().trim().max(40).optional(),
          source: z.string().trim().max(20).optional(),
          cursor: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: SalesToolkitList },
      },
    },
    async (req) => {
      const limit = req.query.limit;
      const rows = await prisma.salesToolkit.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.category ? { category: req.query.category } : {}),
          ...(req.query.source ? { source: req.query.source } : {}),
          ...(req.query.sector ? { sectorTags: { has: req.query.sector } } : {}),
        },
        select: TOOLKIT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return { items: page.map(toSalesToolkit), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    },
  );

  server.post(
    '/sales-toolkits/store',
    {
      preHandler: server.requirePermission('documents:write'),
      schema: { body: SalesToolkitCreate, response: { 201: SalesToolkit } },
    },
    async (req, reply) => {
      const body = req.body;
      const row = await prisma.salesToolkit.create({
        data: {
          orgId: req.auth.orgId,
          title: body.title,
          description: body.description ?? null,
          category: body.category,
          sectorTags: body.sectorTags,
          url: body.url ?? null,
          source: 'manual',
          addedById: req.auth.userId,
        },
        select: TOOLKIT_SELECT,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'sales_toolkit.create',
          targetType: 'sales_toolkit',
          targetId: row.id,
        },
      });
      return reply.code(201).send(toSalesToolkit(row));
    },
  );

  server.patch(
    '/sales-toolkits/store/:id',
    {
      preHandler: server.requirePermission('documents:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SalesToolkitPatch,
        response: { 200: SalesToolkit },
      },
    },
    async (req) => {
      const existing = await prisma.salesToolkit.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Toolkit not found');

      const b = req.body;
      const data: Record<string, unknown> = {};
      if (b.title !== undefined) data.title = b.title;
      if (b.description !== undefined) data.description = b.description ?? null;
      if (b.category !== undefined) data.category = b.category;
      if (b.sectorTags !== undefined) data.sectorTags = b.sectorTags;
      if (b.url !== undefined) data.url = b.url ?? null;

      await prisma.salesToolkit.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data,
      });
      const row = await prisma.salesToolkit.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: TOOLKIT_SELECT,
      });
      return toSalesToolkit(row);
    },
  );

  server.delete(
    '/sales-toolkits/store/:id',
    {
      preHandler: server.requirePermission('documents:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const res = await prisma.salesToolkit.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (res.count === 0) throw server.httpErrors.notFound('Toolkit not found');
      return reply.code(204).send();
    },
  );
};
