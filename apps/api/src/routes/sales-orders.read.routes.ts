/**
 * sales-orders.read.routes.ts — GET /sales/orders + GET /sales/orders/:id.
 *
 * Extracted from sales-orders.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { SalesOrderDetail, SalesOrderFilter, SalesOrderPage } from '@bidstack/shared';
import type { OrderState } from '@bidstack/shared';

import { loadDetail, toPrismaState } from './sales-orders.helpers.js';

export const salesOrdersRoutesRead: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/sales/orders ────────────────────────────────────────────
  server.get(
    '/sales/orders',
    {
      schema: {
        querystring: SalesOrderFilter,
        response: { 200: SalesOrderPage },
      },
    },
    async (req) => {
      const { state, salespersonId, countryCode, search, cursor, limit } = req.query;
      const items = await prisma.salesOrder.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(state ? { state: toPrismaState(state) } : {}),
          ...(salespersonId ? { salespersonId } : {}),
          ...(countryCode ? { countryCode } : {}),
          ...(search
            ? {
                OR: [
                  { customerName: { contains: search, mode: 'insensitive' } },
                  { number: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: {
          salesperson: { select: { name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return {
        items: page.map((o) => ({
          id: o.id,
          number: o.number,
          state: o.state as z.infer<typeof OrderState>,
          customerName: o.customerName,
          salespersonId: o.salespersonId,
          salespersonName: o.salesperson?.name ?? null,
          countryCode: o.countryCode,
          currency: o.currency,
          totalMicros: o.totalMicros.toString(),
          orderDate: o.orderDate.toISOString(),
          confirmedAt: o.confirmedAt?.toISOString() ?? null,
          lineCount: o._count.lines,
        })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // ─── GET /api/sales/orders/:id ────────────────────────────────────────
  server.get(
    '/sales/orders/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: SalesOrderDetail },
      },
    },
    async (req) => {
      return loadDetail(req.auth.orgId, req.params.id);
    },
  );
};
