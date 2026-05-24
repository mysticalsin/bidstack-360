// Wire-format schemas for /api/sales/invoices/* (list + detail + payments).
// Mirrors the sales-orders contract: micros are string-encoded BigInts on
// the wire, parsed at the edge via BigInt() and rendered via
// formatMoneyMicros. Lifecycle mirrors Odoo's account.move:
//
//   draft       → editable, not yet sent to customer
//   sent        → emailed; awaiting payment
//   paid        → paid_micros >= total_micros (flips automatically)
//   overdue     → past due_date and unpaid (computed/derived, never persisted
//                 by mutation — a nightly job or read-time projection sets it)
//   cancelled   → terminal; reversible only via reopen-to-draft
//
// AR (accounts receivable) aging buckets default to 0-30 / 31-60 / 61-90 / 90+
// days **past due_date** with state in (sent, overdue). The dashboard panel
// uses these to show "what's owed and how stale."

import { z } from 'zod';
import { CustomFieldValueLite } from './custom-fields.js';

export const InvoiceState = z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']);
export type InvoiceState = z.infer<typeof InvoiceState>;

/** Allowed transitions for `account.move`-style invoice lifecycle. */
export const INVOICE_STATE_TRANSITIONS: Record<InvoiceState, InvoiceState[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['paid', 'overdue', 'cancelled', 'draft'],
  overdue: ['paid', 'cancelled', 'sent'],
  paid: [],
  cancelled: ['draft'],
};

export const PaymentMethod = z.enum(['bank_transfer', 'credit_card', 'cheque', 'cash', 'other']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** Filter shape for GET /api/sales/invoices. */
export const InvoiceFilter = z.object({
  state: InvoiceState.optional(),
  customerName: z.string().trim().max(255).optional(),
  salesOrderId: z.string().uuid().optional(),
  countryCode: z.string().length(2).optional(),
  search: z.string().trim().max(120).optional(),
  /** Filter to only invoices past `due_date` — irrespective of state. */
  overdueOnly: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type InvoiceFilter = z.infer<typeof InvoiceFilter>;

export const InvoiceSummary = z.object({
  id: z.string().uuid(),
  number: z.string(),
  state: InvoiceState,
  customerName: z.string(),
  salesOrderId: z.string().uuid().nullable(),
  salesOrderNumber: z.string().nullable(),
  salespersonId: z.string().uuid().nullable(),
  salespersonName: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  currency: z.string().length(3),
  totalMicros: z.string(),
  paidMicros: z.string(),
  /** total - paid; computed server-side for the UI's "balance due" column. */
  balanceMicros: z.string(),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
  /** Days from now to due_date (negative = overdue). Computed server-side. */
  daysToDue: z.number().int(),
  lineCount: z.number().int().nonnegative(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummary>;

export const InvoicePage = z.object({
  items: z.array(InvoiceSummary),
  nextCursor: z.string().uuid().nullable(),
});
export type InvoicePage = z.infer<typeof InvoicePage>;

export const InvoiceLineDetail = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  productSku: z.string().nullable(),
  productName: z.string().nullable(),
  description: z.string(),
  quantity: z.string(),
  unitPriceMicros: z.string(),
  subtotalMicros: z.string(),
});
export type InvoiceLineDetail = z.infer<typeof InvoiceLineDetail>;

export const PaymentEntry = z.object({
  id: z.string().uuid(),
  amountMicros: z.string(),
  currency: z.string().length(3),
  method: PaymentMethod,
  reference: z.string().nullable(),
  receivedAt: z.string().datetime(),
});
export type PaymentEntry = z.infer<typeof PaymentEntry>;

export const InvoiceAuditEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  fromState: InvoiceState.nullable(),
  toState: InvoiceState.nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type InvoiceAuditEntry = z.infer<typeof InvoiceAuditEntry>;

export const InvoiceDetail = InvoiceSummary.extend({
  nextStates: z.array(InvoiceState),
  notes: z.string().nullable(),
  lines: z.array(InvoiceLineDetail),
  payments: z.array(PaymentEntry),
  audit: z.array(InvoiceAuditEntry),
  customFieldValues: z.array(CustomFieldValueLite).optional(),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

// ─── Mutations ──────────────────────────────────────────────────────────

export const InvoiceCreateLine = z.object({
  /** Product is optional — invoices can carry one-off / freeform lines. */
  productId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitPriceMicros: z.string().regex(/^\d+$/),
});
export type InvoiceCreateLine = z.infer<typeof InvoiceCreateLine>;

export const InvoiceCreate = z.object({
  customerName: z.string().min(1).max(255),
  countryCode: z.string().length(2).optional(),
  currency: z.string().length(3).default('CAD'),
  salespersonId: z.string().uuid().optional(),
  /** Net N days from invoice date — server materializes due_date. */
  netDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().max(2000).optional(),
  lines: z.array(InvoiceCreateLine).min(1).max(100),
});
export type InvoiceCreate = z.infer<typeof InvoiceCreate>;

/** Body for POST /api/sales/invoices/from-order/:orderId. */
export const InvoiceFromOrderBody = z.object({
  netDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().max(2000).optional(),
});
export type InvoiceFromOrderBody = z.infer<typeof InvoiceFromOrderBody>;

export const PaymentCreate = z.object({
  amountMicros: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  method: PaymentMethod,
  reference: z.string().max(120).optional(),
  receivedAt: z.string().datetime().optional(),
});
export type PaymentCreate = z.infer<typeof PaymentCreate>;

export const InvoiceTransitionBody = z.object({
  reason: z.string().max(500).optional(),
});
export type InvoiceTransitionBody = z.infer<typeof InvoiceTransitionBody>;

// ─── AR aging dashboard widget ──────────────────────────────────────────

/** A single aging bucket (0-30 / 31-60 / 61-90 / 90+ days past due). */
export const ArAgingBucket = z.object({
  label: z.string(),
  /** Inclusive min/max in days. `null` max = "and older". */
  minDays: z.number().int().nonnegative(),
  maxDays: z.number().int().nullable(),
  invoiceCount: z.number().int().nonnegative(),
  outstandingMicros: z.string(),
});
export type ArAgingBucket = z.infer<typeof ArAgingBucket>;

export const ArAgingReport = z.object({
  currency: z.string().length(3),
  generatedAt: z.string().datetime(),
  buckets: z.array(ArAgingBucket),
  /** Sum across all buckets — convenience for the headline. */
  totalOutstandingMicros: z.string(),
});
export type ArAgingReport = z.infer<typeof ArAgingReport>;
