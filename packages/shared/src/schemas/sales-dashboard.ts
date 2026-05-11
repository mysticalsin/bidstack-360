// Wire-format schemas for the Sales Dashboard API.
//
// All money fields land on the wire as integer micros (× 1e6) per the
// rest of BidStack — the frontend formats with `formatMoneyMicros` at the
// edge. ISO-3166 alpha-2 codes for country tiles. Dates as ISO strings.

import { z } from 'zod';

export const SalesPeriod = z.enum(['mtd', 'ytd', 'ye', 'last_90d']);
export type SalesPeriod = z.infer<typeof SalesPeriod>;

export const SalesKpi = z.object({
  /** Period the KPI summarises. */
  period: SalesPeriod,
  /** Number of quotation-state records (state in: draft, sent). */
  quotationsCount: z.number().int().nonnegative(),
  /** Number of confirmed sales orders (state in: confirmed, done). */
  ordersCount: z.number().int().nonnegative(),
  /** Sum of revenue (confirmed + done) in micros. */
  revenueMicros: z.string(),
  /** Currency code most rows use; tie-break: highest revenue. */
  currency: z.string().min(3).max(3),
  /** Average confirmed-order value in micros. */
  averageOrderMicros: z.string(),
  /** Same-shape values for the *previous* period of equal length. */
  previous: z.object({
    quotationsCount: z.number().int().nonnegative(),
    ordersCount: z.number().int().nonnegative(),
    revenueMicros: z.string(),
    averageOrderMicros: z.string(),
  }),
  /** Delta percentages — frontend just renders. Null when prev is zero. */
  delta: z.object({
    quotationsPct: z.number().nullable(),
    ordersPct: z.number().nullable(),
    revenuePct: z.number().nullable(),
    averageOrderPct: z.number().nullable(),
  }),
});
export type SalesKpi = z.infer<typeof SalesKpi>;

export const SalesDashMonthlyPoint = z.object({
  /** First day of the month, ISO date (YYYY-MM-01). */
  month: z.string(),
  /** Display label like "February 2026". */
  label: z.string(),
  revenueMicros: z.string(),
  orders: z.number().int().nonnegative(),
});
export type SalesDashMonthlyPoint = z.infer<typeof SalesDashMonthlyPoint>;

export const SalesDashMonthly = z.object({
  currency: z.string().min(3).max(3),
  points: z.array(SalesDashMonthlyPoint),
});
export type SalesDashMonthly = z.infer<typeof SalesDashMonthly>;

export const TopRow = z.object({
  id: z.string(),
  label: z.string(),
  salesperson: z.string().nullable(),
  revenueMicros: z.string(),
  currency: z.string().min(3).max(3),
});
export type TopRow = z.infer<typeof TopRow>;

export const TopList = z.object({
  items: z.array(TopRow),
});
export type TopList = z.infer<typeof TopList>;

export const CountryRow = z.object({
  code: z.string().min(2).max(2),
  name: z.string(),
  revenueMicros: z.string(),
  orders: z.number().int().nonnegative(),
});
export type CountryRow = z.infer<typeof CountryRow>;

export const TopCountries = z.object({
  currency: z.string().min(3).max(3),
  items: z.array(CountryRow),
});
export type TopCountries = z.infer<typeof TopCountries>;

export const ProductRow = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  orders: z.number().int().nonnegative(),
  revenueMicros: z.string(),
  currency: z.string().min(3).max(3),
});
export type ProductRow = z.infer<typeof ProductRow>;

export const TopProducts = z.object({
  items: z.array(ProductRow),
});
export type TopProducts = z.infer<typeof TopProducts>;

export const CategoryRow = z.object({
  id: z.string(),
  name: z.string(),
  revenueMicros: z.string(),
  orders: z.number().int().nonnegative(),
});
export type CategoryRow = z.infer<typeof CategoryRow>;

export const TopCategories = z.object({
  currency: z.string().min(3).max(3),
  items: z.array(CategoryRow),
});
export type TopCategories = z.infer<typeof TopCategories>;
