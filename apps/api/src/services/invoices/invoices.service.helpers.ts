// Shared helpers, interfaces, and error factories for the invoice service.
// No Prisma queries — pure domain logic that all sub-modules depend on.

import type { FastifyError } from 'fastify';
import type { z } from 'zod';

import { Prisma } from '@bidstack/db';
import type { InvoiceState as PrismaInvoiceState } from '@bidstack/db';
import type { InvoiceCreateLine, InvoiceState } from '@bidstack/shared';

/* ── Type coercion ──────────────────────────────────────────────────────────── */

export const toPrismaState = (s: z.infer<typeof InvoiceState>): PrismaInvoiceState =>
  s as unknown as PrismaInvoiceState;

/* ── Error factories ────────────────────────────────────────────────────────── */

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function notFound(message: string): never {
  const error = new Error(message) as FastifyError;
  error.statusCode = 404;
  throw error;
}

export function conflict(message: string): never {
  const error = new Error(message) as FastifyError;
  error.statusCode = 409;
  throw error;
}

/* ── Invoice number sequencer ───────────────────────────────────────────────── */

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

/* ── Line resolvers ─────────────────────────────────────────────────────────── */

export function resolveLineSubtotal(line: z.infer<typeof InvoiceCreateLine>) {
  const unitMicros = BigInt(line.unitPriceMicros);
  const qThousandths = BigInt(Math.round(Number(line.quantity) * 1_000));
  const subtotalMicros = (unitMicros * qThousandths) / BigInt(1_000);
  return { unitMicros, subtotalMicros };
}

export function invoiceLineProductIds(
  lines: readonly z.infer<typeof InvoiceCreateLine>[],
): string[] {
  return lines.map((line) => line.productId).filter((id): id is string => Boolean(id));
}

/* ── Shared interfaces ──────────────────────────────────────────────────────── */

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

export type InvoiceLineInsert = {
  orgId: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPriceMicros: bigint;
  subtotalMicros: bigint;
};
