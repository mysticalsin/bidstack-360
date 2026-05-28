/**
 * invoices.mutations.ts — invoice-creation sub-plugin.
 *
 *   POST /invoices                    create draft (retry loop for INV-XXXXX number collision)
 *   POST /invoices/from-order/:orderId create from a confirmed/done sales order
 *
 * WHY separate from invoices.ts: creation logic is ~165 lines on its own and
 * reads more clearly in isolation from the list/detail/update handlers.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { InvoiceCreate, InvoiceDetail } from '@bidstack/shared';

import { tenantEntitiesBelongToOrg } from '../lib/tenant-ownership.js';
import {
  invoiceLineProductIds,
  isUniqueViolation,
  loadInvoiceDetail,
  mintNextInvoiceNumber,
  resolveLineSubtotal,
} from './invoices.helpers.js';

export const invoiceMutationsPlugin: FastifyPluginAsyncZod = async (server) => {
  // ── POST /invoices ─────────────────────────────────────────────────────────
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

      // WHY retry loop: mintNextInvoiceNumber uses a non-atomic SELECT-then-INSERT
      // to derive the next sequence, so two concurrent POSTs may pick the same number.
      // Retrying on P2002 (unique violation) self-heals up to 5 times before giving up.
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

  // ── POST /invoices/from-order/:orderId ────────────────────────────────────
  // Copies line items from a confirmed/done sales order into a new draft invoice.
  // find-my-way prioritises the static segment 'from-order' over the dynamic
  // ':id' registered in the parent plugin, so route ordering doesn't matter.
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
};
