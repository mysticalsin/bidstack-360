/**
 * invoices.helpers.ts — leaf node for the invoice module.
 *
 * Pure utilities, Zod schemas, and the loadInvoiceDetail DB helper shared
 * across all invoice sub-plugins. Has zero local sibling imports.
 */
import type { FastifyError } from 'fastify';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { InvoiceState as PrismaInvoiceState } from '@bidstack/db';
import {
  INVOICE_STATE_TRANSITIONS,
  InvoiceCreateLine,
  InvoiceTransitionBody,
} from '@bidstack/shared';
import type { InvoiceDetail, InvoiceState, PaymentMethod } from '@bidstack/shared';

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

// ── State helpers ─────────────────────────────────────────────────────────────

/** Cast shared InvoiceState literal → Prisma enum (identical underlying strings). */
export const toPrismaState = (s: z.infer<typeof InvoiceState>): PrismaInvoiceState =>
  s as unknown as PrismaInvoiceState;

// ── Pure functions ────────────────────────────────────────────────────────────

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Allocate the next INV-XXXXX number inside a transaction.
 *  Callers must wrap this in a retry loop to handle concurrent allocations. */
export async function mintNextInvoiceNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<string> {
  const last = await tx.invoice.findFirst({
    where: { orgId, number: { startsWith: 'INV-' } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const nextSeq = last ? Number((last.number.split('-')[1] ?? '0').replace(/\D/g, '')) + 1 : 1;
  return `INV-${String(nextSeq).padStart(5, '0')}`;
}

/** Compute per-line micros from quantity × unitPrice (fixed-point, 3 decimal places). */
export function resolveLineSubtotal(line: z.infer<typeof InvoiceCreateLine>) {
  const unitMicros = BigInt(line.unitPriceMicros);
  const qThousandths = BigInt(Math.round(Number(line.quantity) * 1_000));
  const subtotalMicros = (unitMicros * qThousandths) / BigInt(1_000);
  return { unitMicros, subtotalMicros };
}

/** Extract non-null productIds from invoice lines for org-ownership checks. */
export function invoiceLineProductIds(
  lines: readonly z.infer<typeof InvoiceCreateLine>[],
): string[] {
  return lines.map((line) => line.productId).filter((id): id is string => Boolean(id));
}

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
