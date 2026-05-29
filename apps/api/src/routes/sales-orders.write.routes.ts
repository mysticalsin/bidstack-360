/**
 * sales-orders.write.routes.ts — POST create + state-machine transitions.
 *
 *   POST /api/sales/orders
 *   POST /api/sales/orders/:id/send
 *   POST /api/sales/orders/:id/confirm
 *   POST /api/sales/orders/:id/done
 *   POST /api/sales/orders/:id/cancel
 *   POST /api/sales/orders/:id/reopen
 *
 * Extracted from sales-orders.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  ORDER_STATE_TRANSITIONS,
  SalesOrderCreate,
  SalesOrderDetail,
  type SalesOrderTransitionBody,
} from '@bidstack/shared';
import type { OrderState } from '@bidstack/shared';

import {
  isUniqueViolation,
  loadDetail,
  mintNextNumber,
  OptionalSalesOrderTransitionBody,
  parseQuantityThousandths,
  toPrismaState,
} from './sales-orders.helpers.js';

export const salesOrdersRoutesWrite: FastifyPluginAsyncZod = async (server) => {
  // ─── POST /api/sales/orders ───────────────────────────────────────────
  server.post(
    '/sales/orders',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: SalesOrderCreate,
        response: { 201: SalesOrderDetail },
      },
    },
    async (req, reply) => {
      const { customerName, countryCode, salespersonId, lines } = req.body;
      const currency = req.body.currency.trim().toUpperCase();

      if (salespersonId) {
        const salesperson = await prisma.user.findFirst({
          where: { id: salespersonId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!salesperson) {
          throw server.httpErrors.badRequest('Salesperson does not belong to this org');
        }
      }

      // Look up products in one query so a bad productId fails fast.
      const productIds = lines.map((l) => l.productId);
      const products = await prisma.product.findMany({
        where: {
          orgId: req.auth.orgId,
          id: { in: productIds },
          active: true,
          deletedAt: null,
        },
        include: { category: { select: { name: true } } },
        take: productIds.length || 1,
      });
      if (products.length !== new Set(productIds).size) {
        throw server.httpErrors.badRequest(
          'One or more products are unknown, inactive, or deleted for this org',
        );
      }
      const currencyMismatch = products.find((p) => p.currency !== currency);
      if (currencyMismatch) {
        throw server.httpErrors.badRequest(
          `Product ${currencyMismatch.sku} is priced in ${currencyMismatch.currency}, not ${currency}`,
        );
      }
      const productById = new Map(products.map((p) => [p.id, p]));

      // Compute line subtotals + the grand total in BigInt to preserve precision.
      type ResolvedLine = {
        orgId: string;
        productId: string;
        description: string;
        quantity: string;
        unitPriceMicros: bigint;
        subtotalMicros: bigint;
      };
      const resolvedLines: ResolvedLine[] = lines.map((line) => {
        const product = productById.get(line.productId)!;
        const unitMicros = line.unitPriceMicros
          ? BigInt(line.unitPriceMicros)
          : product.listPriceMicros;
        // Quantity → millis (q × 1000) for integer math, then divide back at
        // subtotal-write time so we don't lose three decimal places.
        const qThousandths = parseQuantityThousandths(line.quantity);
        const subtotal = (unitMicros * qThousandths) / BigInt(1_000);
        return {
          orgId: req.auth.orgId,
          productId: line.productId,
          description: product.name,
          quantity: line.quantity,
          unitPriceMicros: unitMicros,
          subtotalMicros: subtotal,
        };
      });
      const total = resolvedLines.reduce((acc, l) => acc + l.subtotalMicros, BigInt(0));

      // Order create + audit row land atomically. On a Q-NNNNN collision (two
      // concurrent quote creates), retry up to 5 times — each retry re-mints
      // the next free number inside a fresh transaction.
      let createdId: string | null = null;
      for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
        try {
          createdId = await prisma.$transaction(async (tx) => {
            const number = await mintNextNumber(tx, req.auth.orgId, 'Q');
            const created = await tx.salesOrder.create({
              data: {
                orgId: req.auth.orgId,
                number,
                state: 'draft',
                customerName,
                countryCode,
                currency,
                salespersonId: salespersonId ?? null,
                totalMicros: total,
                orderDate: new Date(),
                lines: { create: resolvedLines },
              },
            });
            await tx.auditLog.create({
              data: {
                orgId: req.auth.orgId,
                userId: req.auth.userId,
                action: 'sales_order.create',
                targetType: 'sales_order',
                targetId: created.id,
                diff: { number, customerName, lineCount: resolvedLines.length },
              },
            });
            return created.id;
          });
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      if (!createdId) {
        throw server.httpErrors.conflict('Could not allocate a unique quotation number; retry.');
      }

      // Re-load via the detail handler shape so the client gets a single canonical
      // representation back from any mutation.
      return reply.code(201).send(await loadDetail(req.auth.orgId, createdId));
    },
  );

  // ─── Transitions ──────────────────────────────────────────────────────
  // Generate four endpoints from a single helper so the audit-log diff
  // shape is uniform and the allowed-transition table is the single source
  // of truth for which moves are legal.
  registerTransition(server, 'send', 'sent', { setConfirmedAt: false });
  registerTransition(server, 'confirm', 'confirmed', { setConfirmedAt: true });
  registerTransition(server, 'done', 'done', { setConfirmedAt: false });
  registerTransition(server, 'cancel', 'cancelled', { setConfirmedAt: false });

  // Re-open is the only "backward" transition. Routes only from `cancelled`
  // or `sent` back to `draft`.
  server.post(
    '/sales/orders/:id/reopen',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OptionalSalesOrderTransitionBody,
        response: { 200: SalesOrderDetail },
      },
    },
    async (req) => {
      const order = await prisma.salesOrder.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!order) throw server.httpErrors.notFound('Sales order not found');
      const from = order.state as z.infer<typeof OrderState>;
      if (!ORDER_STATE_TRANSITIONS[from].includes('draft')) {
        throw server.httpErrors.conflict(
          `Cannot reopen from state '${from}'. Allowed next states: ${ORDER_STATE_TRANSITIONS[from].join(', ')}.`,
        );
      }
      await prisma.$transaction([
        prisma.salesOrder.update({
          where: { id: order.id },
          data: { state: 'draft', confirmedAt: null },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'sales_order.reopen',
            targetType: 'sales_order',
            targetId: order.id,
            diff: { from, to: 'draft', reason: req.body?.reason ?? null },
          },
        }),
      ]);
      return loadDetail(req.auth.orgId, order.id);
    },
  );
};

/** Bind a `POST /sales/orders/:id/{action}` that transitions to `to`. */
function registerTransition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any, // Fastify+Zod type gymnastics — keeps the route file flat.
  action: string,
  to: z.infer<typeof OrderState>,
  opts: { setConfirmedAt: boolean },
): void {
  server.post(
    `/sales/orders/:id/${action}`,
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OptionalSalesOrderTransitionBody,
        response: { 200: SalesOrderDetail },
      },
    },
    async (
      req: {
        params: { id: string };
        auth: { orgId: string; userId: string };
        body?: z.infer<typeof SalesOrderTransitionBody> | null;
      },
      _reply: unknown,
    ) => {
      const order = await prisma.salesOrder.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!order) throw server.httpErrors.notFound('Sales order not found');
      const from = order.state as z.infer<typeof OrderState>;
      if (!ORDER_STATE_TRANSITIONS[from].includes(to)) {
        throw server.httpErrors.conflict(
          `Cannot transition from '${from}' to '${to}'. Allowed: ${ORDER_STATE_TRANSITIONS[from].join(', ')}.`,
        );
      }
      await prisma.$transaction([
        prisma.salesOrder.update({
          where: { id: order.id },
          data: {
            state: toPrismaState(to),
            ...(opts.setConfirmedAt && !order.confirmedAt ? { confirmedAt: new Date() } : {}),
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: `sales_order.${action}`,
            targetType: 'sales_order',
            targetId: order.id,
            diff: { from, to, reason: req.body?.reason ?? null },
          },
        }),
      ]);
      return loadDetail(req.auth.orgId, order.id);
    },
  );
}
