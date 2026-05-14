// Sales Dashboard aggregations API.
// Mirrors Odoo's sales/revenue dashboard widgets:
//
//   GET /api/sales-dashboard/kpis?period=mtd|ytd|ye|last_90d
//   GET /api/sales-dashboard/monthly-sales?from&to
//   GET /api/sales-dashboard/top-quotations?limit=10
//   GET /api/sales-dashboard/top-orders?limit=10
//   GET /api/sales-dashboard/top-countries?limit=10
//   GET /api/sales-dashboard/top-products?limit=10
//   GET /api/sales-dashboard/top-customers?limit=10
//   GET /api/sales-dashboard/top-categories?limit=10
//
// Every endpoint is org-scoped via `req.auth.orgId`. Aggregations are pushed
// to Postgres (groupBy / aggregate / countDistinct) — never iterate in JS.
//
// Money lands on the wire as **string-encoded micros** so BigInt survives
// JSON without precision loss; the web side parses with BigInt(s) and
// formats via `formatMoneyMicros`.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  SalesDashMonthly,
  SalesKpi,
  SalesPeriod,
  TopCategories,
  TopCountries,
  TopList,
  TopProducts,
} from '@bidstack/shared';

const PeriodQuery = z.object({ period: SalesPeriod.default('last_90d') });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const MonthlyQuery = z.object({
  /** Inclusive start. Defaults to (now - 90d). */
  from: z.string().datetime().optional(),
  /** Inclusive end. Defaults to now. */
  to: z.string().datetime().optional(),
});

const CONFIRMED_STATES = ['confirmed', 'done'] as const;
const QUOTATION_STATES = ['draft', 'sent'] as const;

// ─── Period math ────────────────────────────────────────────────────────

interface Window {
  start: Date;
  end: Date;
  /** Equal-length previous window (for delta %). */
  prev: { start: Date; end: Date };
}

function resolveWindow(period: z.infer<typeof SalesPeriod>, now = new Date()): Window {
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
      // Full current calendar year (Jan 1 → Dec 31).
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

function pct(curr: bigint, prev: bigint): number | null {
  if (prev === BigInt(0)) return null;
  // Percentage with 2-decimal precision via bigint math.
  const scaled = ((curr - prev) * BigInt(10_000)) / prev;
  return Number(scaled) / 100;
}

function pctNum(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 10_000) / 100;
}

// Country-code → display name. ISO-3166 alpha-2, only entries we seed.
const COUNTRY_NAMES: Record<string, string> = {
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

// ─── Helpers ────────────────────────────────────────────────────────────

async function dominantCurrency(orgId: string): Promise<string> {
  // Single-pass aggregate: the currency with the highest confirmed revenue
  // becomes the "headline" currency for currency-agnostic widgets. Falls
  // back to CAD when there's nothing confirmed yet.
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

// ─── Routes ─────────────────────────────────────────────────────────────

export const salesDashboardRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /sales-dashboard/kpis
  server.get(
    '/sales-dashboard/kpis',
    {
      schema: {
        querystring: PeriodQuery,
        response: { 200: SalesKpi },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const { start, end, prev } = resolveWindow(req.query.period);

      const [
        quotationsCurr,
        ordersCurr,
        revenueCurr,
        quotationsPrev,
        ordersPrev,
        revenuePrev,
        currency,
      ] = await Promise.all([
        prisma.salesOrder.count({
          where: {
            orgId,
            state: { in: [...QUOTATION_STATES] },
            orderDate: { gte: start, lte: end },
          },
        }),
        prisma.salesOrder.count({
          where: {
            orgId,
            state: { in: [...CONFIRMED_STATES] },
            orderDate: { gte: start, lte: end },
          },
        }),
        prisma.salesOrder.aggregate({
          where: {
            orgId,
            state: { in: [...CONFIRMED_STATES] },
            orderDate: { gte: start, lte: end },
          },
          _sum: { totalMicros: true },
        }),
        prisma.salesOrder.count({
          where: {
            orgId,
            state: { in: [...QUOTATION_STATES] },
            orderDate: { gte: prev.start, lte: prev.end },
          },
        }),
        prisma.salesOrder.count({
          where: {
            orgId,
            state: { in: [...CONFIRMED_STATES] },
            orderDate: { gte: prev.start, lte: prev.end },
          },
        }),
        prisma.salesOrder.aggregate({
          where: {
            orgId,
            state: { in: [...CONFIRMED_STATES] },
            orderDate: { gte: prev.start, lte: prev.end },
          },
          _sum: { totalMicros: true },
        }),
        dominantCurrency(orgId),
      ]);

      const revenue = revenueCurr._sum.totalMicros ?? BigInt(0);
      const revenuePrevious = revenuePrev._sum.totalMicros ?? BigInt(0);
      const avg = ordersCurr > 0 ? revenue / BigInt(ordersCurr) : BigInt(0);
      const avgPrev = ordersPrev > 0 ? revenuePrevious / BigInt(ordersPrev) : BigInt(0);

      return {
        period: req.query.period,
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
    },
  );

  // GET /sales-dashboard/monthly-sales
  server.get(
    '/sales-dashboard/monthly-sales',
    {
      schema: {
        querystring: MonthlyQuery,
        response: { 200: SalesDashMonthly },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const to = req.query.to ? new Date(req.query.to) : new Date();
      const from = req.query.from
        ? new Date(req.query.from)
        : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Postgres-native month bucketing via raw SQL. Returns one row per
      // (month, currency) pair — we aggregate to the dominant currency below.
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
      // Aggregate per-month across currencies — the headline number is the
      // dominant-currency revenue; secondary currencies are summed as if they
      // were the same (consistent with Odoo's single-currency dashboard view).
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
            label: date.toLocaleString('en-US', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }),
            revenueMicros: agg.revenueMicros.toString(),
            orders: agg.orders,
          };
        });

      return { currency, points };
    },
  );

  // GET /sales-dashboard/top-quotations
  server.get(
    '/sales-dashboard/top-quotations',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const rows = await prisma.salesOrder.findMany({
        where: { orgId, state: { in: [...QUOTATION_STATES] } },
        orderBy: { totalMicros: 'desc' },
        take: req.query.limit,
        include: { salesperson: { select: { name: true } } },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          label: r.customerName,
          salesperson: r.salesperson?.name ?? null,
          revenueMicros: r.totalMicros.toString(),
          currency: r.currency,
        })),
      };
    },
  );

  // GET /sales-dashboard/top-orders
  server.get(
    '/sales-dashboard/top-orders',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const rows = await prisma.salesOrder.findMany({
        where: { orgId, state: { in: [...CONFIRMED_STATES] } },
        orderBy: { totalMicros: 'desc' },
        take: req.query.limit,
        include: { salesperson: { select: { name: true } } },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          label: r.customerName,
          salesperson: r.salesperson?.name ?? null,
          revenueMicros: r.totalMicros.toString(),
          currency: r.currency,
        })),
      };
    },
  );

  // GET /sales-dashboard/top-countries
  server.get(
    '/sales-dashboard/top-countries',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopCountries },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const [rows, currency] = await Promise.all([
        prisma.salesOrder.groupBy({
          by: ['countryCode'],
          where: {
            orgId,
            state: { in: [...CONFIRMED_STATES] },
            countryCode: { not: null },
          },
          _sum: { totalMicros: true },
          _count: { _all: true },
          orderBy: { _sum: { totalMicros: 'desc' } },
          take: req.query.limit,
        }),
        dominantCurrency(orgId),
      ]);
      return {
        currency,
        items: rows
          .filter((r): r is typeof r & { countryCode: string } => r.countryCode !== null)
          .map((r) => ({
            code: r.countryCode,
            name: COUNTRY_NAMES[r.countryCode] ?? r.countryCode,
            revenueMicros: (r._sum.totalMicros ?? BigInt(0)).toString(),
            orders: r._count._all,
          })),
      };
    },
  );

  // GET /sales-dashboard/top-products
  server.get(
    '/sales-dashboard/top-products',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopProducts },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      // Aggregate over sales_order_lines, restricted to confirmed parents.
      // We need (product, orders count, revenue) — single grouped query plus
      // a follow-up product lookup so we don't re-issue per row.
      const grouped = await prisma.$queryRaw<
        Array<{ product_id: string; orders: bigint; revenue_micros: bigint }>
      >`
        SELECT
          l."product_id" AS product_id,
          COUNT(DISTINCT l."order_id")::bigint AS orders,
          SUM(l."subtotal_micros")::bigint AS revenue_micros
        FROM "sales_order_lines" l
        JOIN "sales_orders" o ON o."id" = l."order_id"
        WHERE l."org_id" = ${orgId}::uuid
          AND o."state" IN ('confirmed', 'done')
        GROUP BY l."product_id"
        ORDER BY revenue_micros DESC
        LIMIT ${req.query.limit}
      `;

      if (grouped.length === 0) return { items: [] };

      const products = await prisma.product.findMany({
        where: { orgId, id: { in: grouped.map((g) => g.product_id) } },
        include: { category: { select: { name: true } } },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      return {
        items: grouped
          .map((g) => {
            const p = productById.get(g.product_id);
            if (!p) return null;
            return {
              id: p.id,
              sku: p.sku,
              name: p.name,
              category: p.category?.name ?? null,
              orders: Number(g.orders),
              revenueMicros: g.revenue_micros.toString(),
              currency: p.currency,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null),
      };
    },
  );

  // GET /sales-dashboard/top-customers
  server.get(
    '/sales-dashboard/top-customers',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const rows = await prisma.salesOrder.groupBy({
        by: ['customerName', 'currency'],
        where: { orgId, state: { in: [...CONFIRMED_STATES] } },
        _sum: { totalMicros: true },
        _count: { _all: true },
        orderBy: { _sum: { totalMicros: 'desc' } },
        take: req.query.limit,
      });
      return {
        items: rows.map((r, idx) => ({
          id: `${r.customerName}-${idx}`,
          label: r.customerName,
          salesperson: null,
          revenueMicros: (r._sum.totalMicros ?? BigInt(0)).toString(),
          currency: r.currency,
        })),
      };
    },
  );

  // GET /sales-dashboard/top-categories
  server.get(
    '/sales-dashboard/top-categories',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopCategories },
      },
    },
    async (req) => {
      const orgId = req.auth.orgId;
      const grouped = await prisma.$queryRaw<
        Array<{ category_id: string | null; orders: bigint; revenue_micros: bigint }>
      >`
        SELECT
          p."category_id" AS category_id,
          COUNT(DISTINCT l."order_id")::bigint AS orders,
          SUM(l."subtotal_micros")::bigint AS revenue_micros
        FROM "sales_order_lines" l
        JOIN "sales_orders"  o ON o."id" = l."order_id"
        JOIN "products"      p ON p."id" = l."product_id"
        WHERE l."org_id" = ${orgId}::uuid
          AND o."state" IN ('confirmed', 'done')
        GROUP BY p."category_id"
        ORDER BY revenue_micros DESC
        LIMIT ${req.query.limit}
      `;

      const ids = grouped.map((g) => g.category_id).filter((id): id is string => id !== null);
      const [categories, currency] = await Promise.all([
        ids.length
          ? prisma.productCategory.findMany({ where: { orgId, id: { in: ids } } })
          : Promise.resolve([] as Awaited<ReturnType<typeof prisma.productCategory.findMany>>),
        dominantCurrency(orgId),
      ]);
      const byId = new Map(categories.map((c) => [c.id, c]));

      return {
        currency,
        items: grouped.map((g) => ({
          id: g.category_id ?? 'uncategorized',
          name: g.category_id ? (byId.get(g.category_id)?.name ?? 'Unknown') : 'Uncategorized',
          revenueMicros: g.revenue_micros.toString(),
          orders: Number(g.orders),
        })),
      };
    },
  );
};
