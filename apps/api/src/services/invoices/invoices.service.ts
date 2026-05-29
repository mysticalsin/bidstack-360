// Invoice service — public re-export barrel + export/AR-aging operations.
// Split layout:
//   invoices.service.helpers.ts  — types, interfaces, error factories, pure helpers
//   invoices.service.read.ts     — loadInvoiceDetail, listInvoices
//   invoices.service.write.ts    — createInvoice, updateInvoice, state transitions,
//                                  payInvoice, recordPayment, createInvoiceFromOrder

import type { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { ArAgingReport } from '@bidstack/shared';

import { toPrismaState } from './invoices.service.helpers.js';
import type { InvoiceListFilter } from './invoices.service.helpers.js';

/* ── Re-exports (preserve the module's public API shape) ────────────────────── */

export {
  toPrismaState,
  isUniqueViolation,
  mintNextInvoiceNumber,
  resolveLineSubtotal,
  invoiceLineProductIds,
} from './invoices.service.helpers.js';
export type {
  InvoiceListFilter,
  InvoiceListPagination,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceLineInsert,
} from './invoices.service.helpers.js';

export { loadInvoiceDetail, listInvoices } from './invoices.service.read.js';

export {
  createInvoice,
  updateInvoice,
  transitionInvoiceState,
  payInvoice,
  recordPayment,
  createInvoiceFromOrder,
} from './invoices.service.write.js';

/* ── Export CSV ─────────────────────────────────────────────────────────────── */

function csvEscape(value: unknown): string {
  const str = value == null ? '' : String(value);
  const sanitized = str.replace(/^(=|\+|-|@|\t|\r)/, "'$1");
  if (!/[,"\r\n]/.test(sanitized)) return sanitized;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export async function exportInvoices(
  orgId: string,
  filter: Omit<InvoiceListFilter, 'cursor' | 'limit'>,
): Promise<{ csv: string; filename: string }> {
  const { state, customerName, salesOrderId, countryCode, search, overdueOnly } = filter;

  const invoices = await prisma.invoice.findMany({
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
    take: 1000,
  });

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

  return { csv: '﻿' + csv, filename: sanitized };
}

/* ── AR Aging ───────────────────────────────────────────────────────────────── */

export async function getArAgingReport(
  orgId: string,
  currency: string,
): Promise<z.infer<typeof ArAgingReport>> {
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
      const inRange = daysPastDue >= b.minDays && (b.maxDays === null || daysPastDue <= b.maxDays);
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
}
