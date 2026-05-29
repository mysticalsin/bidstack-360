// Read-only invoice queries: detail loader and paginated list.

import type { z } from 'zod';

import { prisma } from '@bidstack/db';
import { INVOICE_STATE_TRANSITIONS } from '@bidstack/shared';
import type { InvoiceDetail, InvoicePage, InvoiceState, PaymentMethod } from '@bidstack/shared';

import { toPrismaState, notFound } from './invoices.service.helpers.js';
import type { InvoiceListFilter, InvoiceListPagination } from './invoices.service.helpers.js';

export type { InvoiceListFilter, InvoiceListPagination };

/* ── Detail loader ──────────────────────────────────────────────────────────── */

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
  if (!invoice) notFound('Invoice not found');

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

/* ── List ───────────────────────────────────────────────────────────────────── */

export async function listInvoices(
  orgId: string,
  filter: InvoiceListFilter,
  pagination: InvoiceListPagination,
): Promise<z.infer<typeof InvoicePage>> {
  const { state, customerName, salesOrderId, countryCode, search, overdueOnly } = filter;
  const { cursor, limit } = pagination;

  const items = await prisma.invoice.findMany({
    where: {
      orgId,
      ...(state ? { state: toPrismaState(state) } : {}),
      ...(customerName ? { customerName: { contains: customerName, mode: 'insensitive' } } : {}),
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
}
