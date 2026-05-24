// Invoice service layer — domain logic extracted from invoices route.
// Contains: CRUD, state transitions, payments, export, AR aging.

import type { FastifyError } from 'fastify';
import type { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { InvoiceState as PrismaInvoiceState } from '@bidstack/db';
import type { PaymentMethod as PrismaPaymentMethod } from '@bidstack/db';
import { INVOICE_STATE_TRANSITIONS } from '@bidstack/shared';
import type {
  InvoiceCreateLine,
  InvoiceDetail,
  InvoicePage,
  PaymentCreate,
  ArAgingReport,
  InvoiceState,
  PaymentMethod,
} from '@bidstack/shared';

import { tenantEntitiesBelongToOrg } from '../../lib/tenant-ownership.js';

/* ── Helpers ────────────────────────────────────────────────────────────── */

export const toPrismaState = (s: z.infer<typeof InvoiceState>): PrismaInvoiceState =>
  s as unknown as PrismaInvoiceState;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function notFound(message: string): never {
  const error = new Error(message) as FastifyError;
  error.statusCode = 404;
  throw error;
}

function conflict(message: string): never {
  const error = new Error(message) as FastifyError;
  error.statusCode = 409;
  throw error;
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

export function invoiceLineProductIds(lines: readonly z.infer<typeof InvoiceCreateLine>[]): string[] {
  return lines.map((line) => line.productId).filter((id): id is string => Boolean(id));
}

/* ── Detail loader ──────────────────────────────────────────────────────── */

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

/* ── List ───────────────────────────────────────────────────────────────── */

export interface InvoiceListFilter {
  state?: z.infer<typeof InvoiceState>;
  customerName?: string;
  salesOrderId?: string;
  countryCode?: string;
  search?: string;
  overdueOnly?: boolean;
}

export interface InvoiceListPagination {
  cursor?: string;
  limit: number;
}

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
}

/* ── Create ─────────────────────────────────────────────────────────────── */

export interface CreateInvoiceInput {
  orgId: string;
  userId: string;
  customerName: string;
  countryCode?: string | null;
  currency: string;
  salespersonId?: string | null;
  netDays: number;
  notes?: string | null;
  lines: z.infer<typeof InvoiceCreateLine>[];
}

export async function createInvoice(input: CreateInvoiceInput): Promise<z.infer<typeof InvoiceDetail>> {
  const { orgId, userId, customerName, countryCode, currency, salespersonId, netDays, notes, lines } =
    input;

  const productIds = invoiceLineProductIds(lines);
  if (!(await tenantEntitiesBelongToOrg('product', productIds, orgId))) {
    notFound('Product not found');
  }

  const resolvedLines = lines.map((line) => {
    const { unitMicros, subtotalMicros } = resolveLineSubtotal(line);
    return {
      orgId,
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
        const number = await mintNextInvoiceNumber(tx, orgId);
        const created = await tx.invoice.create({
          data: {
            orgId,
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
            orgId,
            userId,
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
    conflict('Could not allocate a unique invoice number; retry.');
  }

  return loadInvoiceDetail(orgId, createdId);
}

/* ── Update ─────────────────────────────────────────────────────────────── */

export interface UpdateInvoiceInput {
  orgId: string;
  userId: string;
  id: string;
  customerName?: string;
  countryCode?: string | null;
  currency?: string;
  salespersonId?: string | null;
  notes?: string | null;
  dueDate?: string;
  lines?: z.infer<typeof InvoiceCreateLine>[];
  updatedFields: string[];
}

type InvoiceLineInsert = {
  orgId: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPriceMicros: bigint;
  subtotalMicros: bigint;
};

export async function updateInvoice(input: UpdateInvoiceInput): Promise<z.infer<typeof InvoiceDetail>> {
  const { orgId, userId, id, customerName, countryCode, currency, salespersonId, notes, dueDate, lines } =
    input;

  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId },
  });
  if (!invoice) notFound('Invoice not found');
  if (invoice.state !== 'draft') {
    conflict('Only draft invoices can be updated');
  }

  let totalMicros = invoice.totalMicros;
  let linesPayload:
    | { deleteMany: Record<string, never>; create: InvoiceLineInsert[] }
    | undefined;
  let resolvedLines: InvoiceLineInsert[];

  if (lines && lines.length > 0) {
    const productIds = invoiceLineProductIds(lines);
    if (!(await tenantEntitiesBelongToOrg('product', productIds, orgId))) {
      notFound('Product not found');
    }

    resolvedLines = lines.map((line) => {
      const { unitMicros, subtotalMicros } = resolveLineSubtotal(line);
      return {
        orgId,
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
        orgId,
        userId,
        action: 'invoice.update',
        targetType: 'invoice',
        targetId: invoice.id,
        diff: { fields: input.updatedFields },
      },
    }),
  ]);

  return loadInvoiceDetail(orgId, invoice.id);
}

/* ── State transitions ──────────────────────────────────────────────────── */

export async function transitionInvoiceState(
  orgId: string,
  userId: string,
  id: string,
  action: 'send' | 'cancel',
  to: 'sent' | 'cancelled',
  reason?: string | null,
): Promise<z.infer<typeof InvoiceDetail>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId },
  });
  if (!invoice) notFound('Invoice not found');

  const from = invoice.state as z.infer<typeof InvoiceState>;
  if (!INVOICE_STATE_TRANSITIONS[from].includes(to)) {
    conflict(
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
        orgId,
        userId,
        action: `invoice.${action}`,
        targetType: 'invoice',
        targetId: invoice.id,
        diff: { from, to, reason: reason ?? null },
      },
    }),
  ]);

  return loadInvoiceDetail(orgId, invoice.id);
}

/* ── Pay ────────────────────────────────────────────────────────────────── */

export async function payInvoice(
  orgId: string,
  userId: string,
  id: string,
  reason?: string | null,
): Promise<z.infer<typeof InvoiceDetail>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId },
  });
  if (!invoice) notFound('Invoice not found');

  const from = invoice.state as z.infer<typeof InvoiceState>;
  if (!INVOICE_STATE_TRANSITIONS[from].includes('paid')) {
    conflict(
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
        orgId,
        userId,
        action: 'invoice.pay',
        targetType: 'invoice',
        targetId: invoice.id,
        diff: { from, to: 'paid', reason: reason ?? null },
      },
    }),
  ]);

  return loadInvoiceDetail(orgId, invoice.id);
}

/* ── Record payment ─────────────────────────────────────────────────────── */

export async function recordPayment(
  orgId: string,
  userId: string,
  invoiceId: string,
  payment: z.infer<typeof PaymentCreate>,
): Promise<z.infer<typeof InvoiceDetail>> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, orgId },
  });
  if (!invoice) notFound('Invoice not found');
  if (invoice.state === 'cancelled' || invoice.state === 'paid') {
    conflict(`Cannot record payments on a ${invoice.state} invoice`);
  }

  const { amountMicros, currency, method, reference, receivedAt } = payment;
  const amount = BigInt(amountMicros);
  const newPaidMicros = invoice.paidMicros + amount;
  const nowPaid = newPaidMicros >= invoice.totalMicros;

  await prisma.$transaction([
    prisma.payment.create({
      data: {
        orgId,
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
        orgId,
        userId,
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

  return loadInvoiceDetail(orgId, invoice.id);
}

/* ── Create from order ──────────────────────────────────────────────────── */

export async function createInvoiceFromOrder(
  orgId: string,
  userId: string,
  orderId: string,
  netDays: number,
  notes?: string | null,
): Promise<z.infer<typeof InvoiceDetail>> {
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findFirst({
      where: { id: orderId, orgId },
      include: { lines: true },
    });
    if (!order) notFound('Sales order not found');
    if (order.state !== 'confirmed' && order.state !== 'done') {
      conflict('Can only invoice confirmed or done orders');
    }

    const existingInvoice = await tx.invoice.findFirst({
      where: { salesOrderId: order.id, orgId },
    });
    if (existingInvoice) {
      conflict('An invoice already exists for this order');
    }

    const invoiceDate = new Date();
    const dueDate = new Date(invoiceDate.getTime() + netDays * 24 * 60 * 60 * 1000);
    const number = await mintNextInvoiceNumber(tx, orgId);

    const invoice = await tx.invoice.create({
      data: {
        orgId,
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
            orgId,
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
        orgId,
        userId,
        action: 'invoice.create.from_order',
        targetType: 'invoice',
        targetId: invoice.id,
        diff: { salesOrderId: order.id, number },
      },
    });

    return invoice;
  });

  return loadInvoiceDetail(orgId, created.id);
}

/* ── Export CSV ─────────────────────────────────────────────────────────── */

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

  return { csv: '\uFEFF' + csv, filename: sanitized };
}

/* ── AR Aging ───────────────────────────────────────────────────────────── */

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
}
