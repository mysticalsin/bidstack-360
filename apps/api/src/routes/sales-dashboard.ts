// Sales Dashboard aggregations API.
// Mirrors ERP's sales/revenue dashboard widgets:
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

import {
  SalesDashMonthly,
  SalesKpi,
  SalesPeriod,
  TopCategories,
  TopCountries,
  TopList,
  TopProducts,
} from '@bidstack/shared';

import {
  getSalesKpis,
  getMonthlySales,
  getTopQuotations,
  getTopOrders,
  getTopCountries,
  getTopProducts,
  getTopCustomers,
  getTopCategories,
} from '../services/crm/sales-dashboard.service.js';

const PeriodQuery = z.object({ period: SalesPeriod.default('last_90d') });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const MonthlyQuery = z.object({
  /** Inclusive start. Defaults to (now - 90d). */
  from: z.string().datetime().optional(),
  /** Inclusive end. Defaults to now. */
  to: z.string().datetime().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────

export const salesDashboardRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/sales-dashboard/kpis',
    {
      schema: {
        querystring: PeriodQuery,
        response: { 200: SalesKpi },
      },
    },
    async (req) => {
      return getSalesKpis(req.auth.orgId, req.query.period);
    },
  );

  server.get(
    '/sales-dashboard/monthly-sales',
    {
      schema: {
        querystring: MonthlyQuery,
        response: { 200: SalesDashMonthly },
      },
    },
    async (req) => {
      return getMonthlySales(req.auth.orgId, req.query.from, req.query.to);
    },
  );

  server.get(
    '/sales-dashboard/top-quotations',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      return getTopQuotations(req.auth.orgId, req.query.limit);
    },
  );

  server.get(
    '/sales-dashboard/top-orders',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      return getTopOrders(req.auth.orgId, req.query.limit);
    },
  );

  server.get(
    '/sales-dashboard/top-countries',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopCountries },
      },
    },
    async (req) => {
      return getTopCountries(req.auth.orgId, req.query.limit);
    },
  );

  server.get(
    '/sales-dashboard/top-products',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopProducts },
      },
    },
    async (req) => {
      return getTopProducts(req.auth.orgId, req.query.limit);
    },
  );

  server.get(
    '/sales-dashboard/top-customers',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopList },
      },
    },
    async (req) => {
      return getTopCustomers(req.auth.orgId, req.query.limit);
    },
  );

  server.get(
    '/sales-dashboard/top-categories',
    {
      schema: {
        querystring: LimitQuery,
        response: { 200: TopCategories },
      },
    },
    async (req) => {
      return getTopCategories(req.auth.orgId, req.query.limit);
    },
  );
};
