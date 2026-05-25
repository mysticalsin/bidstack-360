// Sales dashboard aggregation service — extracted from sales-dashboard.ts
// route controller. Contains: period math, delta %, dominant currency,
// KPIs, monthly sales, and all top-N leaderboard queries.

import { prisma } from '@bidstack/db';
import type { SalesPeriod } from '@bidstack/shared';
import type { z } from 'zod';

const CONFIRMED_STATES = ['confirmed', 'done'] as const;
const QUOTATION_STATES = ['draft', 'sent'] as const;

export interface Window {
  start: Date;
  end: Date;
  prev: { start: Date; end: Date };
}

export function resolveWindow(period: z.infer<typeof SalesPeriod>, now = new Date()): Window {
  const end = new Date(now);
  let start: Date;
  switch (period) {
    case 'mtd': {
      start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      break;
    }
    case 'ytd': {
      start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
      break;
    }
    case 'ye': {
      start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
      end.setUTCMonth(11, 31);
      end.setUTCHours(23, 59, 59, 999);
      break;
    }
    case 'last_90d':
    default: {
      start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    }
  }
  const lengthMs = end.getTime() - start.getTime();
  return {
    start,
    end,
    prev: { start: new Date(start.getTime() - lengthMs), end: new Date(start.getTime() - 1) },
  };
}

export function pct(curr: bigint, prev: bigint): number | null {
  if (prev === BigInt(0)) return null;
  const scaled = ((curr - prev) * BigInt(10_000)) / prev;
  return Number(scaled) / 100;
}

export function pctNum(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 10_000) / 100;
}

export const COUNTRY_NAMES: Record<string, string> = {
  CA: 'Canada',
  US: 'United States',
  IT: 'Italy',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  BR: 'Brazil',
  IN: 'India',
  AU: 'Australia',
  JP: 'Japan',
  MX: 'Mexico',
};

export async function dominantCurrency(orgId: string): Promise<string> {
  const rows = await prisma.salesOrder.groupBy({
    by: ['currency'],
    where: { orgId, state: { in: [...CONFIRMED_STATES] } },
    _sum: { totalMicros: true },
  });
  let best = { currency: 'CAD', revenue: BigInt(0) };
  for (const row of rows) {
    const rev = row._sum.totalMicros ?? BigInt(0);
    if (rev > best.revenue) best = { currency: row.currency, revenue: rev };
  }
  return best.currency;
}

export async function getSalesKpis(orgId: string, period: z.infer<typeof SalesPeriod>) {
  const { start, end, prev } = resolveWindow(period);

  const [
    quotationsCurr, ordersCurr, revenueCurr,
    quotationsPrev, ordersPrev, revenuePrev,
    currency,
  ] = await Promise.all([
    prisma.salesOrder.count({ where: { orgId, state: { in: [...QUOTATION_STATES] }, orderDate: { gte: start, lte: end } } }),
    prisma.salesOrder.count({ where: { orgId, state: { in: [...CONFIRMED_STATES] }, orderDate: { gte: start, lte: end } } }),
    prisma.salesOrder.aggregate({ where: { orgId, state: { in: [...CONFIRMED_STATES] }, orderDate: { gte: start, lte: end } }, _sum: { totalMicros: true } }),
    prisma.salesOrder.count({ where: { orgId, state: { in: [...QUOTATION_STATES] }, orderDate: { gte: prev.start, lte: prev.end } } }),
    prisma.salesOrder.count({ where: { orgId, state: { in: [...CONFIRMED_STATES] }, orderDate: { gte: prev.start, lte: prev.end } } }),
    prisma.salesOrder.aggregate({ where: { orgId, state: { in: [...CONFIRMED_STATES] }, orderDate: { gte: prev.start, lte: prev.end } }, _sum: { totalMicros: true } }),
    dominantCurrency(orgId),
  ]);

  const revenue = revenueCurr._sum.totalMicros ?? BigInt(0);
  const revenuePrevious = revenuePrev._sum.totalMicros ?? BigInt(0);
  const avg = ordersCurr > 0 ? revenue / BigInt(ordersCurr) : BigInt(0);
  const avgPrev = ordersPrev > 0 ? revenuePrevious / BigInt(ordersPrev) : BigInt(0);

  return {
    period,
    quotationsCount: quotationsCurr,
    ordersCount: ordersCurr,
    revenueMicros: revenue.toString(),
    currency,
    averageOrderMicros: avg.toString(),
    previous: {
      quotationsCount: quotationsPrev,
      ordersCount: ordersPrev,
      revenueMicros: revenuePrevious.toString(),
      averageOrderMicros: avgPrev.toString(),
    },
    delta: {
      quotationsPct: pctNum(quotationsCurr, quotationsPrev),
      ordersPct: pctNum(ordersCurr, ordersPrev),
      revenuePct: pct(revenue, revenuePrevious),
      averageOrderPct: pct(avg, avgPrev),
    },
  };
}

export async function getMonthlySales(orgId: string, fromQuery?: string, toQuery?: string) {
  const to = toQuery ? new Date(toQuery) : new Date();
  const from = fromQuery ? new Date(fromQuery) : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<
    Array<{ month: Date; total_micros: bigint; orders: bigint; currency: string }>
  >`
    SELECT
      date_trunc('month', "order_date") AS month,
      SUM("total_micros")::bigint AS total_micros,
      COUNT(*)::bigint AS orders,
      "currency" AS currency
    FROM "sales_orders"
    WHERE "org_id" = ${orgId}::uuid
      AND "state" IN ('confirmed', 'done')
      AND "order_date" >= ${from}
      AND "order_date" <= ${to}
    GROUP BY 1, 4
    ORDER BY 1 ASC
  `;

  const currency = await dominantCurrency(orgId);
  const byMonth = new Map<string, { revenueMicros: bigint; orders: number }>();
  for (const row of rows) {
    const key = row.month.toISOString().slice(0, 10);
    const existing = byMonth.get(key) ?? { revenueMicros: BigInt(0), orders: 0 };
    existing.revenueMicros += row.total_micros;
    existing.orders += Number(row.orders);
    byMonth.set(key, existing);
  }

  const points = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, agg]) => {
      const date = new Date(month + 'T00:00:00Z');
      return {
        month,
        label: date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        revenueMicros: agg.revenueMicros.toString(),
        orders: agg.orders,
      };
    });

  return { currency, points };
}

export async function getTopQuotations(orgId: string, limit: number) {
  const rows = await prisma.salesOrder.findMany({
    where: { orgId, state: { in: [...QUOTATION_STATES] } },
    orderBy: { totalMicros: 'desc' },
    take: limit,
    include: { salesperson: { select: { name: true } } },
  });
  return {
    items: rows.map((r) => ({
      id: r.id, label: r.customerName, salesperson: r.salesperson?.name ?? null,
      revenueMicros: r.totalMicros.toString(), currency: r.currency,
    })),
  };
}

export async function getTopOrders(orgId: string, limit: number) {
  const rows = await prisma.salesOrder.findMany({
    where: { orgId, state: { in: [...CONFIRMED_STATES] } },
    orderBy: { totalMicros: 'desc' },
    take: limit,
    include: { salesperson: { select: { name: true } } },
  });
  return {
    items: rows.map((r) => ({
      id: r.id, label: r.customerName, salesperson: r.salesperson?.name ?? null,
      revenueMicros: r.totalMicros.toString(), currency: r.currency,
    })),
  };
}

export async function getTopCountries(orgId: string, limit: number) {
  const [rows, currency] = await Promise.all([
    prisma.salesOrder.groupBy({
      by: ['countryCode'],
      where: { orgId, state: { in: [...CONFIRMED_STATES] }, countryCode: { not: null } },
      _sum: { totalMicros: true },
      _count: { _all: true },
      orderBy: { _sum: { totalMicros: 'desc' } },
      take: limit,
    }),
    dominantCurrency(orgId),
  ]);
  return {
    currency,
    items: rows
      .filter((r): r is typeof r & { countryCode: string } => r.countryCode !== null)
      .map((r) => ({
        code: r.countryCode, name: COUNTRY_NAMES[r.countryCode] ?? r.countryCode,
        revenueMicros: (r._sum.totalMicros ?? BigInt(0)).toString(), orders: r._count._all,
      })),
  };
}

export async function getTopProducts(orgId: string, limit: number) {
  const grouped = await prisma.$queryRaw<
    Array<{ product_id: string; orders: bigint; revenue_micros: bigint }>
  >`
    SELECT l."product_id" AS product_id, COUNT(DISTINCT l."order_id")::bigint AS orders,
      SUM(l."subtotal_micros")::bigint AS revenue_micros
    FROM "sales_order_lines" l JOIN "sales_orders" o ON o."id" = l."order_id"
    WHERE l."org_id" = ${orgId}::uuid AND o."state" IN ('confirmed', 'done')
    GROUP BY l."product_id" ORDER BY revenue_micros DESC LIMIT ${limit}
  `;
  if (grouped.length === 0) return { items: [] };
  const products = await prisma.product.findMany({
    where: { orgId, id: { in: grouped.map((g) => g.product_id) } },
    include: { category: { select: { name: true } } },
    take: grouped.length,
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  return {
    items: grouped
      .map((g) => {
        const p = productById.get(g.product_id);
        if (!p) return null;
        return {
          id: p.id, sku: p.sku, name: p.name, category: p.category?.name ?? null,
          orders: Number(g.orders), revenueMicros: g.revenue_micros.toString(), currency: p.currency,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  };
}

export async function getTopCustomers(orgId: string, limit: number) {
  const rows = await prisma.salesOrder.groupBy({
    by: ['customerName', 'currency'],
    where: { orgId, state: { in: [...CONFIRMED_STATES] } },
    _sum: { totalMicros: true },
    _count: { _all: true },
    orderBy: { _sum: { totalMicros: 'desc' } },
    take: limit,
  });
  return {
    items: rows.map((r, idx) => ({
      id: `${r.customerName}-${idx}`, label: r.customerName, salesperson: null,
      revenueMicros: (r._sum.totalMicros ?? BigInt(0)).toString(), currency: r.currency,
    })),
  };
}

export async function getTopCategories(orgId: string, limit: number) {
  const grouped = await prisma.$queryRaw<
    Array<{ category_id: string | null; orders: bigint; revenue_micros: bigint }>
  >`
    SELECT p."category_id" AS category_id, COUNT(DISTINCT l."order_id")::bigint AS orders,
      SUM(l."subtotal_micros")::bigint AS revenue_micros
    FROM "sales_order_lines" l JOIN "sales_orders" o ON o."id" = l."order_id"
      JOIN "products" p ON p."id" = l."product_id"
    WHERE l."org_id" = ${orgId}::uuid AND o."state" IN ('confirmed', 'done')
    GROUP BY p."category_id" ORDER BY revenue_micros DESC LIMIT ${limit}
  `;
  const ids = grouped.map((g) => g.category_id).filter((id): id is string => id !== null);
  const [categories, currency] = await Promise.all([
    ids.length
      ? prisma.productCategory.findMany({ where: { orgId, id: { in: ids } }, take: ids.length })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.productCategory.findMany>>),
    dominantCurrency(orgId),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  return {
    currency,
    items: grouped.map((g) => ({
      id: g.category_id ?? 'uncategorized',
      name: g.category_id ? (byId.get(g.category_id)?.name ?? 'Unknown') : 'Uncategorized',
      revenueMicros: g.revenue_micros.toString(), orders: Number(g.orders),
    })),
  };
}
