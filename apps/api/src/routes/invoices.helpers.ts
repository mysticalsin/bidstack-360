/**
 * invoices.helpers.ts — leaf node for the invoice module.
 *
 * Zod schemas and the loadInvoiceDetail DB helper shared across all invoice
 * sub-plugins. Pure utility functions (toPrismaState, isUniqueViolation, etc.)
 * are re-exported from the canonical service layer to avoid duplication.
 */
import type { FastifyError } from 'fastify';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  INVOICE_STATE_TRANSITIONS,
  InvoiceCreateLine,
  InvoiceTransitionBody,
} from '@bidstack/shared';
import type { InvoiceDetail, InvoiceState, PaymentMethod } from '@bidstack/shared';

// WHY re-export: toPrismaState, isUniqueViolation, mintNextInvoiceNumber,
// resolveLineSubtotal, invoiceLineProductIds were duplicated verbatim in the
// service layer. Routes import from here; service layer owns the canonical
// copy. Callers on both sides remain unchanged.
export {
  toPrismaState,
  isUniqueViolation,
  mintNextInvoiceNumber,
  resolveLineSubtotal,
  invoiceLineProductIds,
} from '../services/invoices/invoices.service.helpers.js';

// ── Zod schemas ──────────────────────────────────────────────────────────────

export const ArAgingQuery = z.object({ currency: z.string().length(3).optional() });

export const OptionalInvoiceTransitionBody = InvoiceTransitionBody.nullish();

export const InvoiceUpdate = z.object({
  customerName: z.string().min(1).max(255).optional(),
  countryCode: z.string().length(2).optional().nullable(),
  currency: z.string().length(3).optional(),
  salespersonId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  dueDate: z.string().datetime().optional(),
  lines: z.array(InvoiceCreateLine).min(1).max(100).optional(),
  customFieldValues: z
    .array(z.object({ definitionId: z.string().uuid(), value: z.unknown() }))
    .optional(),
});

// ── DB query helper ───────────────────────────────────────────────────────────

/** Full detail shape used by GET /:id and every mutation response. */
export async function loadInvoiceDetail(
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

  const customFieldValues = await prisma.customFieldValue.findMany({
    where: { orgId, entityType: 'invoice', entityId: id },
    select: { id: true, definitionId: true, value: true },
    take: 100,
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
    customFieldValues,
  };
}
