// Invoice CRUD + state-machine routes.
//
//   GET    /api/invoices                  list + filter + cursor pagination
//   GET    /api/invoices/:id              detail with lines + payments + audit
//   POST   /api/invoices                  create draft invoice
//   PATCH  /api/invoices/:id              update (draft only)
//   POST   /api/invoices/:id/send         draft â†’ sent
//   POST   /api/invoices/:id/pay          mark as paid
//   POST   /api/invoices/:id/cancel       any â†’ cancelled
//   POST   /api/invoices/:id/payments     record a payment

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyError } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { InvoiceState as PrismaInvoiceState } from '@bidstack/db';
import type { PaymentMethod as PrismaPaymentMethod } from '@bidstack/db';
import {
  INVOICE_STATE_TRANSITIONS,
  ArAgingReport,
  InvoiceCreate,
  InvoiceCreateLine,
  InvoiceDetail,
  InvoiceFilter,
  InvoicePage,
  InvoiceTransitionBody,
  PaymentCreate,
} from '@bidstack/shared';
import type { InvoiceState, PaymentMethod } from '@bidstack/shared';

import { tenantEntitiesBelongToOrg } from '../lib/tenant-ownership.js';

const ArAgingQuery = z.object({ currency: z.string().length(3).optional() });

const toPrismaState = (s: z.infer<typeof InvoiceState>): PrismaInvoiceState =>
  s as unknown as PrismaInvoiceState;

const OptionalInvoiceTransitionBody = InvoiceTransitionBody.nullish();

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function mintNextInvoiceNumber(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  const last = await tx.invoice.findFirst({
    where: { orgId, number: { startsWith: 'INV-' } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const nextSeq = last ? Number((last.number.split('-')[1] ?? '0').replace(/\D/g, '')) + 1 : 1;
  return `INV-${String(nextSeq).padStart(5, '0')}`;
}

function resolveLineSubtotal(line: z.infer<typeof InvoiceCreateLine>) {
  const unitMicros = BigInt(line.unitPriceMicros);
  const qThousandths = BigInt(Math.round(Number(line.quantity) * 1_000));
  const subtotalMicros = (unitMicros * qThousandths) / BigInt(1_000);
  return { unitMicros, subtotalMicros };
}

function invoiceLineProductIds(lines: readonly z.infer<typeof InvoiceCreateLine>[]): string[] {
  return lines.map((line) => line.productId).filter((id): id is string => Boolean(id));
}

/** Detail shape used by GET /:id and every mutation response. */
async function loadInvoiceDetail(
  orgId: string,
  id: string,
): Promise<z.infer<typeof InvoiceDetail>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId },
    include: {
      salesperson: { select: { name: true } },
      salesOrder: { select: { number: true } },
      lines: {
        include: { product: { select: { sku: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      payments: { orderBy: { receivedAt: 'desc' } },
    },
  });
  if (!invoice) {
    const error = new Error('Invoice not found') as FastifyError;
    error.statusCode = 404;
    throw error;
  }

  const audit = await prisma.auditLog.findMany({
    where: { orgId, targetType: 'invoice', targetId: id },
    include: { user: { select: { name: true } } },
    orderBy: { at: 'desc' },
    take: 50,
  });

  const state = invoice.state as z.infer<typeof InvoiceState>;
  const totalMicros = invoice.totalMicros;
  const paidMicros = invoice.paidMicros;
  const balanceMicros = totalMicros - paidMicros;
  const daysToDue = Math.ceil(
    (new Date(invoice.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return {
    id: invoice.id,
    number: invoice.number,
    state,
    customerName: invoice.customerName,
    salesOrderId: invoice.salesOrderId,
    salesOrderNumber: invoice.salesOrder?.number ?? null,
    salespersonId: invoice.salespersonId,
    salespersonName: invoice.salesperson?.name ?? null,
    countryCode: invoice.countryCode,
    currency: invoice.currency,
    totalMicros: totalMicros.toString(),
    paidMicros: paidMicros.toString(),
    balanceMicros: balanceMicros.toString(),
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    daysToDue,
    lineCount: invoice.lines.length,
    nextStates: INVOICE_STATE_TRANSITIONS[state],
    notes: invoice.notes,
    lines: invoice.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productSku: l.product?.sku ?? null,
      productName: l.product?.name ?? null,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPriceMicros: l.unitPriceMicros.toString(),
      subtotalMicros: l.subtotalMicros.toString(),
    })),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amountMicros: p.amountMicros.toString(),
      currency: p.currency,
      method: p.method as z.infer<typeof PaymentMethod>,
      reference: p.reference,
      receivedAt: p.receivedAt.toISOString(),
    })),
    audit: audit.map((row) => {
      const diff = (row.diff ?? {}) as { from?: string; to?: string };
      return {
        id: Number(row.id),
        action: row.action,
        fromState: (diff.from as z.infer<typeof InvoiceState> | undefined) ?? null,
        toState: (diff.to as z.infer<typeof InvoiceState> | undefined) ?? null,
        actorName: row.user?.name ?? null,
        createdAt: row.at.toISOString(),
      };
    }),
  };
}

const InvoiceUpdate = z.object({
  customerName: z.string().min(1).max(255).optional(),
  countryCode: z.string().length(2).optional().nullable(),
  currency: z.string().length(3).optional(),
  salespersonId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  dueDate: z.string().datetime().optional(),
  lines: z.array(InvoiceCreateLine).min(1).max(100).optional(),
});

export const invoicesRoutes: FastifyPluginAsyncZod = async (server) => {
  // â”€â”€â”€ GET /api/invoices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.get(
    '/invoices',
    {
      schema: {
        querystring: InvoiceFilter,
        response: { 200: InvoicePage },
      },
    },
    async (req) => {
      const { state, customerName, salesOrderId, countryCode, search, overdueOnly, cursor, limit } =
        req.query;

      const items = await prisma.invoice.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(state ? { state: toPrismaState(state) } : {}),
          ...(customerName
            ? { customerName: { contains: customerName, mode: 'insensitive' } }
            : {}),
          ...(salesOrderId ? { salesOrderId } : {}),
          ...(countryCode ? { countryCode } : {}),
          ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
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
          salesOrder: { select: { number: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;

      return {
        items: page.map((inv) => {
          const totalMicros = inv.totalMicros;
          const paidMicros = inv.paidMicros;
          const balanceMicros = totalMicros - paidMicros;
          const daysToDue = Math.ceil(
            (new Date(inv.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          return {
            id: inv.id,
            number: inv.number,
            state: inv.state as z.infer<typeof InvoiceState>,
            customerName: inv.customerName,
            salesOrderId: inv.salesOrderId,
            salesOrderNumber: inv.salesOrder?.number ?? null,
            salespersonId: inv.salespersonId,
            salespersonName: inv.salesperson?.name ?? null,
            countryCode: inv.countryCode,
            currency: inv.currency,
            totalMicros: totalMicros.toString(),
            paidMicros: paidMicros.toString(),
            balanceMicros: balanceMicros.toString(),
            invoiceDate: inv.invoiceDate.toISOString(),
            dueDate: inv.dueDate.toISOString(),
            paidAt: inv.paidAt?.toISOString() ?? null,
            daysToDue,
            lineCount: inv._count.lines,
          };
        }),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // â”€â”€â”€ GET /api/invoices/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.get(
    '/invoices/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: InvoiceDetail },
      },
    },
    async (req) => {
      return loadInvoiceDetail(req.auth.orgId, req.params.id);
    },
  );

  // â”€â”€â”€ POST /api/invoices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.post(
    '/invoices',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        body: InvoiceCreate,
        response: { 201: InvoiceDetail },
      },
    },
    async (req, reply) => {
      const { customerName, countryCode, currency, salespersonId, netDays, notes, lines } =
        req.body;

      const productIds = invoiceLineProductIds(lines);
      if (!(await tenantEntitiesBelongToOrg('product', productIds, req.auth.orgId))) {
        throw server.httpErrors.notFound('Product not found');
      }

      const resolvedLines = lines.map((line) => {
        const { unitMicros, subtotalMicros } = resolveLineSubtotal(line);
        return {
          orgId: req.auth.orgId,
          productId: line.productId ?? null,
          description: line.description,
          quantity: line.quantity,
          unitPriceMicros: unitMicros,
          subtotalMicros,
        };
      });
      const total = resolvedLines.reduce((acc, l) => acc + l.subtotalMicros, BigInt(0));

      const invoiceDate = new Date();
      const dueDate = new Date(invoiceDate.getTime() + netDays * 24 * 60 * 60 * 1000);

      let createdId: string | null = null;
      for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
        try {
          createdId = await prisma.$transaction(async (tx) => {
            const number = await mintNextInvoiceNumber(tx, req.auth.orgId);
            const created = await tx.invoice.create({
              data: {
                orgId: req.auth.orgId,
                number,
                state: 'draft',
                customerName,
                countryCode: countryCode ?? null,
                currency,
                salespersonId: salespersonId ?? null,
                totalMicros: total,
                paidMicros: BigInt(0),
                invoiceDate,
                dueDate,
                notes: notes ?? null,
                lines: { create: resolvedLines },
              },
            });
            await tx.auditLog.create({
              data: {
                orgId: req.auth.orgId,
                userId: req.auth.userId,
                action: 'invoice.create',
                targetType: 'invoice',
                targetId: created.id,
                diff: {
                  number,
                  customerName,
                  lineCount: resolvedLines.length,
                  totalMicros: total.toString(),
                },
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
        throw server.httpErrors.conflict('Could not allocate a unique invoice number; retry.');
      }

      return reply.code(201).send(await loadInvoiceDetail(req.auth.orgId, createdId));
    },
  );

  // â”€â”€â”€ PATCH /api/invoices/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.patch(
    '/invoices/:id',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: InvoiceUpdate,
        response: { 200: InvoiceDetail },
      },
    },
    async (req) => {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!invoice) throw server.httpErrors.notFound('Invoice not found');
      if (invoice.state !== 'draft') {
        throw server.httpErrors.conflict('Only draft invoices can be updated');
      }

      const { customerName, countryCode, currency, salespersonId, notes, dueDate, lines } =
        req.body;

      let totalMicros = invoice.totalMicros;
      type InvoiceLineInsert = {
        orgId: string;
        productId: string | null;
        description: string;
        quantity: string;
        unitPriceMicros: bigint;
        subtotalMicros: bigint;
      };
      let linesPayload:
        | { deleteMany: Record<string, never>; create: InvoiceLineInsert[] }
        | undefined;
      let resolvedLines: InvoiceLineInsert[];

      if (lines && lines.length > 0) {
        const productIds = invoiceLineProductIds(lines);
        if (!(await tenantEntitiesBelongToOrg('product', productIds, req.auth.orgId))) {
          throw server.httpErrors.notFound('Product not found');
        }

        resolvedLines = lines.map((line) => {
          const { unitMicros, subtotalMicros } = resolveLineSubtotal(line);
          return {
            orgId: req.auth.orgId,
            productId: line.productId ?? null,
            description: line.description,
            quantity: line.quantity,
            unitPriceMicros: unitMicros,
            subtotalMicros,
          };
        });
        totalMicros = resolvedLines.reduce((acc, l) => acc + l.subtotalMicros, BigInt(0));
        linesPayload = { deleteMany: {}, create: resolvedLines };
      }

      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(customerName !== undefined ? { customerName } : {}),
            ...(countryCode !== undefined ? { countryCode } : {}),
            ...(currency !== undefined ? { currency } : {}),
            ...(salespersonId !== undefined ? { salespersonId } : {}),
            ...(notes !== undefined ? { notes } : {}),
            ...(dueDate !== undefined ? { dueDate: new Date(dueDate) } : {}),
            ...(linesPayload ? { lines: linesPayload, totalMicros } : {}),
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.update',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: { fields: Object.keys(req.body) },
          },
        }),
      ]);

      return loadInvoiceDetail(req.auth.orgId, invoice.id);
    },
  );

  // â”€â”€â”€ State transitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  for (const [action, to] of [
    ['send', 'sent'],
    ['cancel', 'cancelled'],
  ] as const) {
    server.post(
      `/invoices/:id/${action}`,
      {
        preHandler: server.requireRole('admin', 'finance'),
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: OptionalInvoiceTransitionBody,
          response: { 200: InvoiceDetail },
        },
      },
      async (req) => {
        const invoice = await prisma.invoice.findFirst({
          where: { id: req.params.id, orgId: req.auth.orgId },
        });
        if (!invoice) throw server.httpErrors.notFound('Invoice not found');
        const from = invoice.state as z.infer<typeof InvoiceState>;
        if (!INVOICE_STATE_TRANSITIONS[from].includes(to)) {
          throw server.httpErrors.conflict(
            `Cannot transition from '${from}' to '${to}'. Allowed: ${INVOICE_STATE_TRANSITIONS[from].join(', ')}.`,
          );
        }
        await prisma.$transaction([
          prisma.invoice.update({
            where: { id: invoice.id },
            data: { state: toPrismaState(to) },
          }),
          prisma.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: `invoice.${action}`,
              targetType: 'invoice',
              targetId: invoice.id,
              diff: { from, to, reason: req.body?.reason ?? null },
            },
          }),
        ]);
        return loadInvoiceDetail(req.auth.orgId, invoice.id);
      },
    );
  }

  // Pay is special: it also flips paidMicros and writes paidAt.
  server.post(
    '/invoices/:id/pay',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OptionalInvoiceTransitionBody,
        response: { 200: InvoiceDetail },
      },
    },
    async (req) => {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!invoice) throw server.httpErrors.notFound('Invoice not found');
      const from = invoice.state as z.infer<typeof InvoiceState>;
      if (!INVOICE_STATE_TRANSITIONS[from].includes('paid')) {
        throw server.httpErrors.conflict(
          `Cannot mark as paid from state '${from}'. Allowed: ${INVOICE_STATE_TRANSITIONS[from].join(', ')}.`,
        );
      }
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            state: toPrismaState('paid'),
            paidAt: new Date(),
            paidMicros: invoice.totalMicros,
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.pay',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: { from, to: 'paid', reason: req.body?.reason ?? null },
          },
        }),
      ]);
      return loadInvoiceDetail(req.auth.orgId, invoice.id);
    },
  );

  // â”€â”€â”€ POST /api/invoices/:id/payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.post(
    '/invoices/:id/payments',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PaymentCreate,
        response: { 201: InvoiceDetail },
      },
    },
    async (req, reply) => {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!invoice) throw server.httpErrors.notFound('Invoice not found');
      if (invoice.state === 'cancelled' || invoice.state === 'paid') {
        throw server.httpErrors.conflict(`Cannot record payments on a ${invoice.state} invoice`);
      }

      const { amountMicros, currency, method, reference, receivedAt } = req.body;
      const amount = BigInt(amountMicros);
      const newPaidMicros = invoice.paidMicros + amount;
      const nowPaid = newPaidMicros >= invoice.totalMicros;

      await prisma.$transaction([
        prisma.payment.create({
          data: {
            orgId: req.auth.orgId,
            invoiceId: invoice.id,
            amountMicros: amount,
            currency,
            method: method as unknown as PrismaPaymentMethod,
            reference: reference ?? null,
            receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          },
        }),
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            paidMicros: newPaidMicros,
            ...(nowPaid ? { state: toPrismaState('paid'), paidAt: new Date() } : {}),
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.payment',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: {
              amountMicros: amount.toString(),
              method,
              newPaidMicros: newPaidMicros.toString(),
              autoPaid: nowPaid,
            },
          },
        }),
      ]);

      return reply.code(201).send(await loadInvoiceDetail(req.auth.orgId, invoice.id));
    },
  );

  // â”€â”€â”€ POST /api/invoices/from-order/:orderId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.post(
    '/invoices/from-order/:orderId',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        params: z.object({ orderId: z.string().uuid() }),
        body: z.object({
          netDays: z.number().int().min(0).max(365).default(30),
          notes: z.string().max(2000).optional(),
        }),
        response: { 201: InvoiceDetail },
      },
    },
    async (req, reply) => {
      const created = await prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.findFirst({
          where: { id: req.params.orderId, orgId: req.auth.orgId },
          include: { lines: true },
        });
        if (!order) throw server.httpErrors.notFound('Sales order not found');
        if (order.state !== 'confirmed' && order.state !== 'done') {
          throw server.httpErrors.conflict('Can only invoice confirmed or done orders');
        }

        const existingInvoice = await tx.invoice.findFirst({
          where: { salesOrderId: order.id, orgId: req.auth.orgId },
        });
        if (existingInvoice) {
          throw server.httpErrors.conflict('An invoice already exists for this order');
        }

        const { netDays, notes } = req.body;
        const invoiceDate = new Date();
        const dueDate = new Date(invoiceDate.getTime() + netDays * 24 * 60 * 60 * 1000);
        const number = await mintNextInvoiceNumber(tx, req.auth.orgId);

        const invoice = await tx.invoice.create({
          data: {
            orgId: req.auth.orgId,
            number,
            state: 'draft',
            customerName: order.customerName,
            countryCode: order.countryCode,
            currency: order.currency,
            salespersonId: order.salespersonId,
            salesOrderId: order.id,
            totalMicros: order.totalMicros,
            paidMicros: BigInt(0),
            invoiceDate,
            dueDate,
            notes: notes ?? null,
            lines: {
              create: order.lines.map((line) => ({
                orgId: req.auth.orgId,
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPriceMicros: line.unitPriceMicros,
                subtotalMicros: line.subtotalMicros,
              })),
            },
          },
        });

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'invoice.create.from_order',
            targetType: 'invoice',
            targetId: invoice.id,
            diff: { salesOrderId: order.id, number },
          },
        });

        return invoice;
      });

      return reply.code(201).send(await loadInvoiceDetail(req.auth.orgId, created.id));
    },
  );

  // â”€â”€â”€ GET /api/invoices/export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  server.get(
    '/invoices/export',
    {
      preHandler: server.requireRole('admin', 'finance'),
      schema: {
        querystring: InvoiceFilter,
      },
    },
    async (req, reply) => {
      const { state, customerName, salesOrderId, countryCode, search, overdueOnly } = req.query;

      const invoices = await prisma.invoice.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(state ? { state: toPrismaState(state) } : {}),
          ...(customerName
            ? { customerName: { contains: customerName, mode: 'insensitive' } }
            : {}),
          ...(salesOrderId ? { salesOrderId } : {}),
          ...(countryCode ? { countryCode } : {}),
          ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
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
          salesOrder: { select: { number: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        take: 1000,
      });

      function csvEscape(value: unknown): string {
        const str = value == null ? '' : String(value);
        const sanitized = str.replace(/^(=|\+|-|@|\t|\r)/, "'$1");
        if (!/[,"\r\n]/.test(sanitized)) return sanitized;
        return `"${sanitized.replace(/"/g, '""')}"`;
      }

      const headers = [
        'Number',
        'State',
        'Customer',
        'Currency',
        'Total',
        'Paid',
        'Balance',
        'Invoice Date',
        'Due Date',
        'Salesperson',
        'Lines',
      ];

      const rows = invoices.map((inv) => {
        const totalMicros = inv.totalMicros;
        const paidMicros = inv.paidMicros;
        const balanceMicros = totalMicros - paidMicros;
        return [
          inv.number,
          inv.state,
          inv.customerName,
          inv.currency,
          (Number(totalMicros) / 1_000_000).toFixed(2),
          (Number(paidMicros) / 1_000_000).toFixed(2),
          (Number(balanceMicros) / 1_000_000).toFixed(2),
          inv.invoiceDate.toISOString().slice(0, 10),
          inv.dueDate.toISOString().slice(0, 10),
          inv.salesperson?.name ?? '',
          inv._count.lines,
        ];
      });

      const csv = [
        headers.map(csvEscape).join(','),
        ...rows.map((r) => r.map(csvEscape).join(',')),
      ].join('\r\n');
      const stamp = new Date().toISOString().slice(0, 10);
      const tag = state ? `-${state}` : '';
      const filename = `invoices${tag}-${stamp}.csv`;
      const sanitized = Array.from(filename)
        .filter((char) => {
          const code = char.charCodeAt(0);
          return code >= 0x20 && code !== 0x7f && char !== '"';
        })
        .join('');
      const encodedFilename = `attachment; filename*=UTF-8''${encodeURIComponent(sanitized)}`;

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', encodedFilename)
        .send('\uFEFF' + csv);
    },
  );

  // ————————————————————————————————————————————————————————————————————————
  server.get(
    '/invoices/ar-aging',
    {
      preHandler: [
        server.requirePermission('invoices:read'),
        server.requireRole('admin', 'finance'),
      ],
      schema: {
        querystring: ArAgingQuery,
        response: { 200: ArAgingReport },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const currency = req.query.currency ?? 'CAD';
      const now = new Date();

      const invoices = await prisma.invoice.findMany({
        where: {
          orgId,
          currency,
          state: { in: ['sent', 'overdue'] },
        },
        select: {
          id: true,
          totalMicros: true,
          paidMicros: true,
          dueDate: true,
        },
      });

      const BUCKETS = [
        { label: 'Current (0â€“30 days)', minDays: 0, maxDays: 30 },
        { label: '31â€“60 days', minDays: 31, maxDays: 60 },
        { label: '61â€“90 days', minDays: 61, maxDays: 90 },
        { label: '90+ days', minDays: 91, maxDays: null },
      ];

      let totalOutstandingMicros = 0n;
      const bucketResults = BUCKETS.map((b) => {
        const rows = invoices.filter((inv) => {
          const daysPastDue = Math.floor(
            (now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          const inRange =
            daysPastDue >= b.minDays && (b.maxDays === null || daysPastDue <= b.maxDays);
          return inRange;
        });
        const outstandingMicros = rows.reduce(
          (sum, inv) => sum + BigInt(inv.totalMicros) - BigInt(inv.paidMicros),
          0n,
        );
        totalOutstandingMicros += outstandingMicros;
        return {
          ...b,
          invoiceCount: rows.length,
          outstandingMicros: String(outstandingMicros),
        };
      });

      return {
        currency,
        generatedAt: now.toISOString(),
        buckets: bucketResults,
        totalOutstandingMicros: String(totalOutstandingMicros),
      };
    },
  );
};
