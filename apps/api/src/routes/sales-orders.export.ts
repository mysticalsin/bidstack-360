/**
 * sales-orders.export.ts — streaming CSV export for sales orders.
 *
 *   GET /sales/orders/export
 *
 * WHY backend streaming: the previous client-side export was capped at the
 * in-memory page (50 rows). This endpoint cursor-paginates Postgres with a
 * BATCH_SIZE of 200 rows, writing each batch directly to reply.raw — heap
 * stays flat regardless of result set size, and the browser's progress
 * dialog appears immediately.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { OrderState } from '@bidstack/shared';

import { toPrismaState } from './sales-orders.helpers.js';

const SalesOrderExportQuery = z.object({
  state: OrderState.optional(),
  salespersonId: z.string().uuid().optional(),
  countryCode: z.string().length(2).optional(),
  search: z.string().trim().max(120).optional(),
});

export const salesOrdersExportRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/sales/orders/export',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: { querystring: SalesOrderExportQuery },
    },
    async (req, reply) => {
      const { state, salespersonId, countryCode, search } = req.query;

      const EXPORT_HARD_CAP = 10_000;
      const BATCH_SIZE = 200;

      function csvEscape(value: unknown): string {
        const str = value == null ? '' : String(value);
        // Prefix formula-injection chars per OWASP CSV injection guidance
        const sanitized = str.replace(/^(=|\+|-|@|\t|\r)/, "'$1");
        if (!/[,"\r\n]/.test(sanitized)) return sanitized;
        return `"${sanitized.replace(/"/g, '""')}"`;
      }

      const HEADERS = [
        'Number',
        'State',
        'Customer',
        'Salesperson',
        'Country',
        'Currency',
        'Total',
        'Lines',
        'Order Date',
        'Confirmed',
      ];

      const where = {
        orgId: req.auth.orgId,
        deletedAt: null,
        ...(state ? { state: toPrismaState(state) } : {}),
        ...(salespersonId ? { salespersonId } : {}),
        ...(countryCode ? { countryCode } : {}),
        ...(search
          ? {
              OR: [
                { customerName: { contains: search, mode: 'insensitive' as const } },
                { number: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const stamp = new Date().toISOString().slice(0, 10);
      const tag = state ? `-${state}` : '';
      const filename = `sales-orders${tag}-${stamp}.csv`;
      const sanitizedName = Array.from(filename)
        .filter((char) => {
          const code = char.charCodeAt(0);
          return code >= 0x20 && code !== 0x7f && char !== '"';
        })
        .join('');
      const encodedFilename = `attachment; filename*=UTF-8''${encodeURIComponent(sanitizedName)}`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', encodedFilename)
        // WHY hijack: takes the reply out of Fastify's send pipeline so we can
        // write to res.raw directly without going through the JSON serializer.
        .hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': encodedFilename,
        'Transfer-Encoding': 'chunked',
      });
      // BOM so Excel auto-detects UTF-8
      reply.raw.write('﻿' + HEADERS.map(csvEscape).join(',') + '\r\n');

      let cursor: string | undefined;
      let total = 0;
      while (total < EXPORT_HARD_CAP) {
        const batch = await prisma.salesOrder.findMany({
          where,
          include: {
            salesperson: { select: { name: true } },
            _count: { select: { lines: true } },
          },
          orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        for (const order of batch) {
          const row = [
            order.number,
            order.state,
            order.customerName,
            order.salesperson?.name ?? '',
            order.countryCode ?? '',
            order.currency,
            (Number(order.totalMicros) / 1_000_000).toFixed(2),
            order._count.lines,
            order.orderDate.toISOString().slice(0, 10),
            order.confirmedAt?.toISOString().slice(0, 10) ?? '',
          ];
          reply.raw.write(row.map(csvEscape).join(',') + '\r\n');
        }
        cursor = batch[batch.length - 1]?.id;
        if (!cursor) break;
        total += batch.length;
      }

      if (total >= EXPORT_HARD_CAP) {
        req.log.warn(
          { orgId: req.auth.orgId, exported: total, cap: EXPORT_HARD_CAP },
          'sales-order CSV export hit hard cap — consider a background-job export for this org',
        );
      }
      reply.raw.end();
    },
  );
};
