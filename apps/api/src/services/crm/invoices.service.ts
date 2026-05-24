// Invoice service layer — domain logic extracted from invoices.ts controller.
// Contains: invoice number minting, line subtotal calculation, invoice detail
// loading, and AR aging bucket math.

import type { FastifyError } from 'fastify';
import type { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { InvoiceState as PrismaInvoiceState } from '@bidstack/db';
import {
  INVOICE_STATE_TRANSITIONS,
} from '@bidstack/shared';
import type {
  InvoiceCreateLine,
  InvoiceDetail,
  InvoiceState,
  PaymentMethod,
} from '@bidstack/shared';

export const toPrismaState = (s: z.infer<typeof InvoiceState>): PrismaInvoiceState =>
  s as unknown as PrismaInvoiceState;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

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

export function resolveLineSubtotal(line: z.infer<typeof InvoiceCreateLine>) {
  const unitMicros = BigInt(line.unitPriceMicros);
  const qThousandths = BigInt(Math.round(Number(line.quantity) * 1_000));
  const subtotalMicros = (unitMicros * qThousandths) / BigInt(1_000);
  return { unitMicros, subtotalMicros };
}

/** Detail shape used by GET /:id and every mutation response. */
export async function loadInvoiceDetail(
  orgId: string,
  id: string,
): Promise<z.infer<typeof InvoiceDetail>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId, deletedAt: null },
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

/** Compute AR aging buckets for a given org and currency. */
export async function computeArAging(orgId: string, currency: string) {
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: {
      orgId,
      currency,
      state: { in: ['sent', 'overdue'] },
      deletedAt: null,
    },
    select: {
      id: true,
      totalMicros: true,
      paidMicros: true,
      dueDate: true,
    },
  });

  const BUCKETS = [
    { label: 'Current (0–30 days)', minDays: 0, maxDays: 30 },
    { label: '31–60 days', minDays: 31, maxDays: 60 },
    { label: '61–90 days', minDays: 61, maxDays: 90 },
    { label: '90+ days', minDays: 91, maxDays: null },
  ];

  let totalOutstandingMicros = 0n;
  const bucketResults = BUCKETS.map((b) => {
    const rows = invoices.filter((inv) => {
      const daysPastDue = Math.floor(
        (now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysPastDue >= b.minDays && (b.maxDays === null || daysPastDue <= b.maxDays);
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
}
