// Write operations: createInvoice, updateInvoice, transitionInvoiceState,
// payInvoice, recordPayment, createInvoiceFromOrder.

import type { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { PaymentMethod as PrismaPaymentMethod } from '@bidstack/db';
import { INVOICE_STATE_TRANSITIONS } from '@bidstack/shared';
import type { InvoiceDetail, InvoiceState, PaymentCreate } from '@bidstack/shared';

import { tenantEntitiesBelongToOrg } from '../../lib/tenant-ownership.js';
import {
  toPrismaState,
  isUniqueViolation,
  notFound,
  conflict,
  mintNextInvoiceNumber,
  resolveLineSubtotal,
  invoiceLineProductIds,
} from './invoices.service.helpers.js';
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceLineInsert,
} from './invoices.service.helpers.js';
import { loadInvoiceDetail } from './invoices.service.read.js';
export type { CreateInvoiceInput, UpdateInvoiceInput };

/* ── Create ─────────────────────────────────────────────────────────────────── */

export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<z.infer<typeof InvoiceDetail>> {
  const {
    orgId,
    userId,
    customerName,
    countryCode,
    currency,
    salespersonId,
    netDays,
    notes,
    lines,
  } = input;

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

/* ── Update ─────────────────────────────────────────────────────────────────── */

export async function updateInvoice(
  input: UpdateInvoiceInput,
): Promise<z.infer<typeof InvoiceDetail>> {
  const {
    orgId,
    userId,
    id,
    customerName,
    countryCode,
    currency,
    salespersonId,
    notes,
    dueDate,
    lines,
  } = input;

  const invoice = await prisma.invoice.findFirst({
    where: { id, orgId },
  });
  if (!invoice) notFound('Invoice not found');
  if (invoice.state !== 'draft') {
    conflict('Only draft invoices can be updated');
  }

  let totalMicros = invoice.totalMicros;
  let linesPayload: { deleteMany: Record<string, never>; create: InvoiceLineInsert[] } | undefined;
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

/* ── State transitions ──────────────────────────────────────────────────────── */

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

/* ── Pay ────────────────────────────────────────────────────────────────────── */

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

/* ── Record payment ─────────────────────────────────────────────────────────── */

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

/* ── Create from order ──────────────────────────────────────────────────────── */

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
