/**
 * invoices.ts — invoice list, detail, update, and sub-plugin orchestrator.
 *
 *   GET   /invoices        cursor-paginated list with filters
 *   GET   /invoices/:id    full detail (lines + payments + audit)
 *   PATCH /invoices/:id    update a draft invoice (fields + lines + custom fields)
 *
 * Sub-plugins (registered below) handle creation, state transitions, and export:
 *   invoiceMutationsPlugin  — POST /invoices, POST /invoices/from-order/:orderId
 *   invoicePaymentsPlugin   — /send, /cancel, /pay, /payments
 *   invoiceExportPlugin     — streaming CSV + AR-aging report
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { InvoiceDetail, InvoiceFilter, InvoicePage } from '@bidstack/shared';
import type { InvoiceState } from '@bidstack/shared';

import { tenantEntitiesBelongToOrg } from '../lib/tenant-ownership.js';
import {
  InvoiceUpdate,
  invoiceLineProductIds,
  loadInvoiceDetail,
  resolveLineSubtotal,
  toPrismaState,
} from './invoices.helpers.js';
import { invoiceExportPlugin } from './invoices.export.js';
import { invoiceMutationsPlugin } from './invoices.mutations.js';
import { invoicePaymentsPlugin } from './invoices.payments.js';

export const invoicesRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Sub-plugins ────────────────────────────────────────────────────────────
  await server.register(invoiceMutationsPlugin);
  await server.register(invoicePaymentsPlugin);
  await server.register(invoiceExportPlugin);

  // ── GET /invoices ──────────────────────────────────────────────────────────
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
          deletedAt: null,
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

  // ── GET /invoices/:id ──────────────────────────────────────────────────────
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

  // ── PATCH /invoices/:id ────────────────────────────────────────────────────
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

      if (req.body.customFieldValues !== undefined) {
        for (const { definitionId, value } of req.body.customFieldValues) {
          await prisma.customFieldValue.upsert({
            where: {
              orgId_entityType_entityId_definitionId: {
                orgId: req.auth.orgId,
                entityType: 'invoice',
                entityId: invoice.id,
                definitionId,
              },
            },
            update: { value: value as Prisma.InputJsonValue },
            create: {
              orgId: req.auth.orgId,
              definitionId,
              entityType: 'invoice',
              entityId: invoice.id,
              value: value as Prisma.InputJsonValue,
            },
          });
        }
      }

      return loadInvoiceDetail(req.auth.orgId, invoice.id);
    },
  );
};
