// Sales Orders CRUD + state-machine routes.
//
//   GET    /api/sales/orders                  list + filter + cursor pagination
//   GET    /api/sales/orders/:id              detail with lines + audit trail
//   POST   /api/sales/orders                  create quotation (state=draft)
//   POST   /api/sales/orders/:id/send         draft → sent
//   POST   /api/sales/orders/:id/confirm      sent → confirmed (writes confirmedAt)
//   POST   /api/sales/orders/:id/done         confirmed → done
//   POST   /api/sales/orders/:id/cancel       any → cancelled
//   POST   /api/sales/orders/:id/reopen       cancelled → draft, sent → draft
//
// State machine mirrors ERP's sale.order lifecycle. Each transition writes
// an audit_log row with `from`/`to` state so the detail timeline can render.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyError } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { OrderState as PrismaOrderState } from '@bidstack/db';
import {
  ORDER_STATE_TRANSITIONS,
  SalesOrderCreate,
  SalesOrderDetail,
  SalesOrderFilter,
  SalesOrderPage,
  SalesOrderTransitionBody,
} from '@bidstack/shared';
import type { OrderState } from '@bidstack/shared';

// Map shared OrderState → Prisma OrderState. Both enums are string-valued
// with the same labels, but TS treats them as nominally distinct unless
// asserted at the boundary.
const toPrismaState = (s: z.infer<typeof OrderState>): PrismaOrderState =>
  s as unknown as PrismaOrderState;

const OptionalSalesOrderTransitionBody = SalesOrderTransitionBody.nullish();

async function mintNextNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  prefix: 'Q' | 'SO',
): Promise<string> {
  // Take the largest existing suffix inside the active transaction so a
  // concurrent create on the same prefix sees our row before deciding its
  // own number. A unique violation can still happen on first-row-of-prefix
  // contention; the caller retries up to 5 times.
  const last = await tx.salesOrder.findFirst({
    where: { orgId, number: { startsWith: `${prefix}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const nextSeq = last ? Number((last.number.split('-')[1] ?? '0').replace(/\D/g, '')) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(5, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const salesOrdersRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /api/sales/orders ───────────────────────────────────────────
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

  // ─── GET /api/sales/orders/:id ───────────────────────────────────────
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

  // ─── POST /api/sales/orders ──────────────────────────────────────────
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

  // ─── Transitions ─────────────────────────────────────────────────────
  // Generate the four endpoints from a single helper so the audit-log diff
  // shape is uniform and the allowed-transition table is the single source of
  // truth for which moves are legal.

  registerTransition(server, 'send', 'sent', { setConfirmedAt: false });
  registerTransition(server, 'confirm', 'confirmed', { setConfirmedAt: true });
  registerTransition(server, 'done', 'done', { setConfirmedAt: false });
  registerTransition(server, 'cancel', 'cancelled', { setConfirmedAt: false });

  // Re-open is the only "backward" transition we expose. Routes only from
  // `cancelled` or `sent` back to `draft`.
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

/** Detail shape used by both GET /:id and every mutation response. */
async function loadDetail(orgId: string, id: string): Promise<z.infer<typeof SalesOrderDetail>> {
  const order = await prisma.salesOrder.findFirst({
    where: { id, orgId, deletedAt: null },
    include: {
      salesperson: { select: { name: true } },
      lines: {
        include: {
          product: { include: { category: { select: { name: true } } } },
        },
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!order) {
    const error = new Error('Sales order not found') as FastifyError;
    error.statusCode = 404;
    throw error;
  }
  const audit = await prisma.auditLog.findMany({
    where: { orgId, targetType: 'sales_order', targetId: id },
    include: { user: { select: { name: true } } },
    orderBy: { at: 'desc' },
    take: 50,
  });
  const invoice = await prisma.invoice.findFirst({
    where: { salesOrderId: id, orgId, deletedAt: null },
    select: { id: true },
  });
  const state = order.state as z.infer<typeof OrderState>;
  return {
    id: order.id,
    number: order.number,
    state,
    customerName: order.customerName,
    salespersonId: order.salespersonId,
    salespersonName: order.salesperson?.name ?? null,
    countryCode: order.countryCode,
    currency: order.currency,
    totalMicros: order.totalMicros.toString(),
    orderDate: order.orderDate.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    lineCount: order.lines.length,
    invoiceId: invoice?.id ?? null,
    nextStates: ORDER_STATE_TRANSITIONS[state],
    lines: order.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productSku: l.product.sku,
      productName: l.product.name,
      categoryName: l.product.category?.name ?? null,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPriceMicros: l.unitPriceMicros.toString(),
      subtotalMicros: l.subtotalMicros.toString(),
    })),
    audit: audit.map((row) => {
      const diff = (row.diff ?? {}) as { from?: string; to?: string };
      return {
        id: Number(row.id),
        action: row.action,
        fromState: (diff.from as z.infer<typeof OrderState> | undefined) ?? null,
        toState: (diff.to as z.infer<typeof OrderState> | undefined) ?? null,
        actorName: row.user?.name ?? null,
        createdAt: row.at.toISOString(),
      };
    }),
  };
}

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

function parseQuantityThousandths(quantity: string): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  return BigInt(whole) * BigInt(1_000) + BigInt(fraction.padEnd(3, '0'));
}
