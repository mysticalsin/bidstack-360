/**
 * sales-orders.helpers.ts — pure utilities and loadDetail for Sales Orders.
 *
 * Extracted from sales-orders.ts (BS-R1 file-size refactor).
 * No Fastify server dependency — safe to import from any route sub-file.
 */
import type { FastifyError } from 'fastify';
import { type z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import type { OrderState as PrismaOrderState } from '@bidstack/db';
import {
  ORDER_STATE_TRANSITIONS,
  type SalesOrderDetail,
  SalesOrderTransitionBody,
} from '@bidstack/shared';
import type { OrderState } from '@bidstack/shared';

// Map shared OrderState → Prisma OrderState. Both enums are string-valued
// with the same labels, but TS treats them as nominally distinct unless
// asserted at the boundary.
export const toPrismaState = (s: z.infer<typeof OrderState>): PrismaOrderState =>
  s as unknown as PrismaOrderState;

export const OptionalSalesOrderTransitionBody = SalesOrderTransitionBody.nullish();

export async function mintNextNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  prefix: 'Q' | 'SO',
): Promise<string> {
  // Take the largest existing suffix inside the active transaction so a
  // concurrent create on the same prefix sees our row before deciding its
  // own number. A unique violation can still happen on first-row-of-prefix
  // contention; the caller retries up to 5 times.
  const last = await tx.salesOrder.findFirst({
    where: { orgId, number: { startsWith: `${prefix}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const nextSeq = last ? Number((last.number.split('-')[1] ?? '0').replace(/\D/g, '')) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(5, '0')}`;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function parseQuantityThousandths(quantity: string): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  return BigInt(whole) * BigInt(1_000) + BigInt(fraction.padEnd(3, '0'));
}

/** Detail shape used by both GET /:id and every mutation response. */
export async function loadDetail(
  orgId: string,
  id: string,
): Promise<z.infer<typeof SalesOrderDetail>> {
  const order = await prisma.salesOrder.findFirst({
    where: { id, orgId, deletedAt: null },
    include: {
      salesperson: { select: { name: true } },
      lines: {
        include: {
          product: { include: { category: { select: { name: true } } } },
        },
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!order) {
    const error = new Error('Sales order not found') as FastifyError;
    error.statusCode = 404;
    throw error;
  }
  const audit = await prisma.auditLog.findMany({
    where: { orgId, targetType: 'sales_order', targetId: id },
    include: { user: { select: { name: true } } },
    orderBy: { at: 'desc' },
    take: 50,
  });
  const invoice = await prisma.invoice.findFirst({
    where: { salesOrderId: id, orgId, deletedAt: null },
    select: { id: true },
  });
  const state = order.state as z.infer<typeof OrderState>;
  return {
    id: order.id,
    number: order.number,
    state,
    customerName: order.customerName,
    salespersonId: order.salespersonId,
    salespersonName: order.salesperson?.name ?? null,
    countryCode: order.countryCode,
    currency: order.currency,
    totalMicros: order.totalMicros.toString(),
    orderDate: order.orderDate.toISOString(),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    lineCount: order.lines.length,
    invoiceId: invoice?.id ?? null,
    nextStates: ORDER_STATE_TRANSITIONS[state],
    lines: order.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productSku: l.product.sku,
      productName: l.product.name,
      categoryName: l.product.category?.name ?? null,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPriceMicros: l.unitPriceMicros.toString(),
      subtotalMicros: l.subtotalMicros.toString(),
    })),
    audit: audit.map((row) => {
      const diff = (row.diff ?? {}) as { from?: string; to?: string };
      return {
        id: Number(row.id),
        action: row.action,
        fromState: (diff.from as z.infer<typeof OrderState> | undefined) ?? null,
        toState: (diff.to as z.infer<typeof OrderState> | undefined) ?? null,
        actorName: row.user?.name ?? null,
        createdAt: row.at.toISOString(),
      };
    }),
  };
}
