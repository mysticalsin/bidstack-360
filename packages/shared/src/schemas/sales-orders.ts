// Wire-format schemas for /api/sales/orders/* (list + detail + transitions).
// Money fields are string-encoded micros (BigInt-safe over JSON), parsed at
// the edge via BigInt(s) and rendered via formatMoneyMicros.

import { z } from 'zod';

export const OrderState = z.enum(['draft', 'sent', 'confirmed', 'done', 'cancelled']);
export type OrderState = z.infer<typeof OrderState>;

/** Allowed transitions per Odoo's sale.order lifecycle. */
export const ORDER_STATE_TRANSITIONS: Record<OrderState, OrderState[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['confirmed', 'cancelled', 'draft'],
  confirmed: ['done', 'cancelled'],
  done: [],
  cancelled: ['draft'],
};

/** Filter shape for GET /api/sales/orders. */
export const SalesOrderFilter = z.object({
  state: OrderState.optional(),
  /** When set, only orders authored by this salesperson (UUID). */
  salespersonId: z.string().uuid().optional(),
  /** ISO-3166 alpha-2 country code. */
  countryCode: z.string().length(2).optional(),
  /** Fuzzy match on customerName / number. */
  search: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SalesOrderFilter = z.infer<typeof SalesOrderFilter>;

export const SalesOrderSummary = z.object({
  id: z.string().uuid(),
  number: z.string(),
  state: OrderState,
  customerName: z.string(),
  salespersonId: z.string().uuid().nullable(),
  salespersonName: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  currency: z.string().length(3),
  totalMicros: z.string(),
  orderDate: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  lineCount: z.number().int().nonnegative(),
});
export type SalesOrderSummary = z.infer<typeof SalesOrderSummary>;

export const SalesOrderPage = z.object({
  items: z.array(SalesOrderSummary),
  nextCursor: z.string().uuid().nullable(),
});
export type SalesOrderPage = z.infer<typeof SalesOrderPage>;

export const SalesOrderLineDetail = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productSku: z.string(),
  productName: z.string(),
  categoryName: z.string().nullable(),
  description: z.string(),
  /** Stringified so decimal quantity (e.g. "0.500") survives intact. */
  quantity: z.string(),
  unitPriceMicros: z.string(),
  subtotalMicros: z.string(),
});
export type SalesOrderLineDetail = z.infer<typeof SalesOrderLineDetail>;

export const SalesOrderAuditEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  fromState: OrderState.nullable(),
  toState: OrderState.nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type SalesOrderAuditEntry = z.infer<typeof SalesOrderAuditEntry>;

export const SalesOrderDetail = SalesOrderSummary.extend({
  /** State machine: list of states this order can transition to right now. */
  nextStates: z.array(OrderState),
  lines: z.array(SalesOrderLineDetail),
  audit: z.array(SalesOrderAuditEntry),
});
export type SalesOrderDetail = z.infer<typeof SalesOrderDetail>;

// ─── Mutations ──────────────────────────────────────────────────────────

export const SalesOrderCreateLine = z.object({
  productId: z.string().uuid(),
  /** Stringified decimal to avoid float loss. */
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  /** Optional override of the product's list price (micros). */
  unitPriceMicros: z.string().regex(/^\d+$/).optional(),
});
export type SalesOrderCreateLine = z.infer<typeof SalesOrderCreateLine>;

export const SalesOrderCreate = z.object({
  customerName: z.string().min(1).max(255),
  countryCode: z.string().length(2).optional(),
  currency: z.string().length(3).default('CAD'),
  salespersonId: z.string().uuid().optional(),
  lines: z.array(SalesOrderCreateLine).min(1).max(50),
});
export type SalesOrderCreate = z.infer<typeof SalesOrderCreate>;

export const SalesOrderTransitionBody = z.object({
  /** Optional human-visible reason; lands in the audit-log diff. */
  reason: z.string().max(500).optional(),
});
export type SalesOrderTransitionBody = z.infer<typeof SalesOrderTransitionBody>;
