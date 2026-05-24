// Integration tests for /api/invoices/*.
// Covers CRUD, state transitions (send, pay, cancel), and payment recording.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const createdInvoiceIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdInvoiceIds) {
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await prisma.payment.deleteMany({ where: { invoiceId: id } });
    await prisma.auditLog.deleteMany({ where: { targetType: 'invoice', targetId: id } });
    await prisma.invoice.deleteMany({ where: { id } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      console.warn(`[skip] ${name} — DATABASE_URL not reachable or seed org missing`);
      return;
    }
    await fn();
  });

describe('invoices routes', () => {
  skipIfNoDb('GET /api/invoices returns a paginated list with summaries', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/invoices?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; state: string; totalMicros: string; balanceMicros: string }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(body.items)).toBe(true);
    for (const row of body.items) {
      expect(['draft', 'sent', 'paid', 'overdue', 'cancelled']).toContain(row.state);
      expect(BigInt(row.totalMicros) >= BigInt(0)).toBe(true);
      expect(BigInt(row.balanceMicros) >= BigInt(0)).toBe(true);
    }
  });

  skipIfNoDb('POST /api/invoices creates a draft invoice with lines', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerName: 'Integration Test Customer',
        currency: 'CAD',
        netDays: 30,
        lines: [{ description: 'Test service line', quantity: '2.5', unitPriceMicros: '1000000' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; state: string; number: string; lines: unknown[]; totalMicros: string };
    expect(body.state).toBe('draft');
    expect(body.number).toMatch(/^INV-\d{5}$/);
    expect(body.lines.length).toBe(1);
    expect(BigInt(body.totalMicros) > BigInt(0)).toBe(true);
    createdInvoiceIds.push(body.id);
  });

  skipIfNoDb('POST /api/invoices rejects product ids outside the tenant scope', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerName: 'Invalid Product Customer',
        currency: 'CAD',
        netDays: 30,
        lines: [
          {
            productId: '00000000-0000-0000-0000-000000000001',
            description: 'Invalid product line',
            quantity: '1',
            unitPriceMicros: '1000000',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('GET /api/invoices/:id returns detail with lines, payments, and audit', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    const res = await server.inject({ method: 'GET', url: `/api/invoices/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      lines: Array<{ subtotalMicros: string }>;
      payments: unknown[];
      audit: Array<{ action: string }>;
      nextStates: string[];
    };
    expect(body.id).toBe(id);
    expect(Array.isArray(body.lines)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.audit)).toBe(true);
    expect(body.nextStates).toContain('sent');
  });

  skipIfNoDb('PATCH /api/invoices/:id updates a draft invoice', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    // Ensure draft.
    await prisma.invoice.update({ where: { id }, data: { state: 'draft' } });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: { customerName: 'Updated Customer', notes: 'Integration test note' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { customerName: string; notes: string | null };
    expect(body.customerName).toBe('Updated Customer');
    expect(body.notes).toBe('Integration test note');
  });

  skipIfNoDb('PATCH /api/invoices/:id rejects updates to non-draft invoices', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    // Transition to sent so it's no longer draft.
    await prisma.invoice.update({ where: { id }, data: { state: 'sent' } });
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: { customerName: 'Should fail' },
    });
    expect(res.statusCode).toBe(409);
    // Restore to draft for downstream tests.
    await prisma.invoice.update({ where: { id }, data: { state: 'draft' } });
  });

  skipIfNoDb('POST /api/invoices/:id/send transitions draft → sent', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    await prisma.invoice.update({ where: { id }, data: { state: 'draft' } });
    const res = await server.inject({ method: 'POST', url: `/api/invoices/${id}/send` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string; audit: Array<{ action: string }> };
    expect(body.state).toBe('sent');
    expect(body.audit.some((e) => e.action === 'invoice.send')).toBe(true);
  });

  skipIfNoDb('POST /api/invoices/:id/pay transitions sent → paid', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    await prisma.invoice.update({ where: { id }, data: { state: 'sent', paidMicros: 0, paidAt: null } });
    const res = await server.inject({ method: 'POST', url: `/api/invoices/${id}/pay` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string; paidAt: string | null };
    expect(body.state).toBe('paid');
    expect(body.paidAt).toBeTruthy();
  });

  skipIfNoDb('POST /api/invoices/:id/cancel transitions sent → cancelled', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    await prisma.invoice.update({ where: { id }, data: { state: 'sent' } });
    const res = await server.inject({ method: 'POST', url: `/api/invoices/${id}/cancel` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string };
    expect(body.state).toBe('cancelled');
  });

  skipIfNoDb('POST /api/invoices/:id/pay rejects illegal transitions from cancelled', async () => {
    if (createdInvoiceIds.length === 0) return;
    const id = createdInvoiceIds[0];
    await prisma.invoice.update({ where: { id }, data: { state: 'cancelled' } });
    const res = await server.inject({ method: 'POST', url: `/api/invoices/${id}/pay` });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('POST /api/invoices/:id/payments records a payment and auto-flips to paid', async () => {
    // Create a dedicated invoice so payment state doesn't collide with transition tests.
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerName: 'Payment Test Customer',
        currency: 'CAD',
        netDays: 30,
        lines: [{ description: 'Payment test line', quantity: '1', unitPriceMicros: '5000000' }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const invoiceId = (createRes.json() as { id: string }).id;
    createdInvoiceIds.push(invoiceId);

    // Ensure draft so payments are allowed.
    await prisma.invoice.update({ where: { id: invoiceId }, data: { state: 'draft', paidMicros: 0, paidAt: null } });

    const res = await server.inject({
      method: 'POST',
      url: `/api/invoices/${invoiceId}/payments`,
      payload: {
        amountMicros: '5000000',
        currency: 'CAD',
        method: 'bank_transfer',
        reference: 'integration-test-payment',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { state: string; payments: Array<{ amountMicros: string }>; paidMicros: string };
    expect(body.state).toBe('paid');
    expect(body.payments.length).toBeGreaterThan(0);
    expect(BigInt(body.paidMicros)).toBe(BigInt(5000000));
  });

  skipIfNoDb('GET /api/invoices/ar-aging returns bucketed report', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/invoices/ar-aging?currency=CAD' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currency: string;
      buckets: Array<{ label: string; invoiceCount: number; outstandingMicros: string }>;
      totalOutstandingMicros: string;
    };
    expect(body.currency).toBe('CAD');
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.buckets.length).toBeGreaterThan(0);
    expect(BigInt(body.totalOutstandingMicros) >= BigInt(0)).toBe(true);
  });

  skipIfNoDb('GET /api/invoices/export returns CSV', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/invoices/export?limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('invoices');
    expect(res.payload).toContain('Number');
  });
});
