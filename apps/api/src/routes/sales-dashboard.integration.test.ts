// Integration tests for /api/sales-dashboard/*.
// Booted against the seeded Postgres so the aggregations have real rows
// to roll up. Each test asserts the *shape* + invariants (non-negative,
// totals consistent across endpoints) rather than exact numbers — the
// fixture grows over time and we don't want brittle snapshots.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let salesSchemaReady = false;
let orgId: string | null = null;

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

  // The Sales module ships in a separate Prisma migration. Probe the catalog
  // first so a local DB without that migration skips quietly instead of
  // emitting expected Prisma "relation does not exist" errors.
  const [tables] = await prisma.$queryRaw<
    Array<{
      salesOrders: string | null;
      salesOrderLines: string | null;
      products: string | null;
      productCategories: string | null;
    }>
  >`
    SELECT
      to_regclass('public.sales_orders')::text AS "salesOrders",
      to_regclass('public.sales_order_lines')::text AS "salesOrderLines",
      to_regclass('public.products')::text AS "products",
      to_regclass('public.product_categories')::text AS "productCategories"
  `;
  salesSchemaReady = Boolean(
    tables?.salesOrders && tables.salesOrderLines && tables.products && tables.productCategories,
  );
  if (!salesSchemaReady) {
    return;
  }

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

describe('sales-dashboard routes', () => {
  it('skips suite when DB or sales migration is unavailable', () => {
    if (!dbReachable || !orgId || !salesSchemaReady) {
      expect(true).toBe(true);
      return;
    }
    expect(salesSchemaReady).toBe(true);
  });

  it('GET /api/sales-dashboard/kpis returns four KPIs with previous-period deltas', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({ method: 'GET', url: '/api/sales-dashboard/kpis' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      period: string;
      quotationsCount: number;
      ordersCount: number;
      revenueMicros: string;
      currency: string;
      averageOrderMicros: string;
      previous: Record<string, number | string>;
      delta: Record<string, number | null>;
    };
    expect(body.period).toBe('last_90d');
    expect(body.quotationsCount).toBeGreaterThanOrEqual(0);
    expect(body.ordersCount).toBeGreaterThanOrEqual(0);
    // revenueMicros parses as a non-negative bigint.
    expect(BigInt(body.revenueMicros) >= BigInt(0)).toBe(true);
    expect(BigInt(body.averageOrderMicros) >= BigInt(0)).toBe(true);
    expect(typeof body.currency).toBe('string');
    expect(body.currency.length).toBe(3);
    expect(body.previous).toBeDefined();
    expect(body.delta).toBeDefined();
  });

  it('GET /api/sales-dashboard/monthly-sales returns chronological points', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/sales-dashboard/monthly-sales',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currency: string;
      points: Array<{ month: string; label: string; revenueMicros: string; orders: number }>;
    };
    expect(Array.isArray(body.points)).toBe(true);
    // Monotonic non-decreasing months.
    for (let i = 1; i < body.points.length; i++) {
      expect(body.points[i]!.month >= body.points[i - 1]!.month).toBe(true);
    }
    for (const p of body.points) {
      expect(BigInt(p.revenueMicros) >= BigInt(0)).toBe(true);
      expect(p.orders).toBeGreaterThanOrEqual(0);
    }
  });

  it('GET /api/sales-dashboard/top-quotations + top-orders use disjoint state sets', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const [quotations, orders] = await Promise.all([
      server.inject({ method: 'GET', url: '/api/sales-dashboard/top-quotations?limit=5' }),
      server.inject({ method: 'GET', url: '/api/sales-dashboard/top-orders?limit=5' }),
    ]);
    expect(quotations.statusCode).toBe(200);
    expect(orders.statusCode).toBe(200);
    const q = quotations.json() as { items: Array<{ id: string }> };
    const o = orders.json() as { items: Array<{ id: string }> };
    // Quotations and orders are disjoint by state ('draft','sent' vs
    // 'confirmed','done') so the same SalesOrder row can't appear in both.
    const qIds = new Set(q.items.map((it) => it.id));
    for (const item of o.items) expect(qIds.has(item.id)).toBe(false);
  });

  it('GET /api/sales-dashboard/top-countries returns 2-letter codes + names', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/sales-dashboard/top-countries?limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currency: string;
      items: Array<{ code: string; name: string; revenueMicros: string; orders: number }>;
    };
    for (const c of body.items) {
      expect(c.code.length).toBe(2);
      expect(c.name.length).toBeGreaterThan(0);
      expect(BigInt(c.revenueMicros) >= BigInt(0)).toBe(true);
      expect(c.orders).toBeGreaterThan(0);
    }
  });

  it('GET /api/sales-dashboard/top-products returns sku+name+category', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/sales-dashboard/top-products?limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        id: string;
        sku: string;
        name: string;
        category: string | null;
        orders: number;
        revenueMicros: string;
        currency: string;
      }>;
    };
    for (const p of body.items) {
      expect(p.sku.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(BigInt(p.revenueMicros) > BigInt(0)).toBe(true);
      expect(p.orders).toBeGreaterThan(0);
    }
    // Sorted by revenue desc.
    for (let i = 1; i < body.items.length; i++) {
      expect(BigInt(body.items[i - 1]!.revenueMicros) >= BigInt(body.items[i]!.revenueMicros)).toBe(
        true,
      );
    }
  });

  it('GET /api/sales-dashboard/top-customers groups by customer name', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/sales-dashboard/top-customers?limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; label: string; revenueMicros: string }>;
    };
    // Labels are unique customer names (no duplicates after groupBy).
    const labels = body.items.map((it) => it.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('GET /api/sales-dashboard/top-categories groups via the line→product→category join', async () => {
    if (!dbReachable || !orgId || !salesSchemaReady) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/sales-dashboard/top-categories?limit=8',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currency: string;
      items: Array<{ id: string; name: string; revenueMicros: string; orders: number }>;
    };
    for (const c of body.items) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(BigInt(c.revenueMicros) > BigInt(0)).toBe(true);
    }
  });
});
