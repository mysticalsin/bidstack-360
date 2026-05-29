/**
 * crm.analytics.ts — Sales intelligence and ERP analytics schemas.
 *
 * Extracted from crm.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from crm.ts barrel).
 */
import { z } from 'zod';
import { SourceAttribution } from './crm.base.js';

export const SalesMetricKpi = z.object({
  id: z.enum(['quotations', 'orders', 'revenue', 'average_order']),
  label: z.string().min(1),
  kind: z.enum(['count', 'money']),
  value: z.number().nonnegative(),
  currencyCode: z.string().length(3).nullable(),
  percentChange: z.number(),
  trend: z.enum(['up', 'down', 'flat']),
  tone: z.enum(['blue', 'jade', 'amber', 'purple']),
});
export type SalesMetricKpi = z.infer<typeof SalesMetricKpi>;

export const MonthlySalesPoint = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  quotationCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});
export type MonthlySalesPoint = z.infer<typeof MonthlySalesPoint>;

export const SalesRankRow = z.object({
  id: z.string().min(1),
  number: z.string().nullable(),
  customer: z.string().min(1),
  salesperson: z.string().nullable(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  countryCode: z.string().length(2).nullable(),
  state: z.string().min(1),
  date: z.string().datetime().nullable(),
});
export type SalesRankRow = z.infer<typeof SalesRankRow>;

export const CountrySalesPerson = z.object({
  name: z.string().min(1),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  customer: z.string().min(1),
});
export type CountrySalesPerson = z.infer<typeof CountrySalesPerson>;

export const CountrySalesRow = z.object({
  countryCode: z.string().length(2),
  countryName: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  quotationCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  customerCount: z.number().int().nonnegative(),
  topCustomers: z.array(z.string().min(1)),
  people: z.array(CountrySalesPerson),
  salespeople: z.array(z.string().min(1)),
  sharePct: z.number().min(0).max(100),
});
export type CountrySalesRow = z.infer<typeof CountrySalesRow>;

export const ProductSalesRow = z.object({
  product: z.string().min(1),
  category: z.string().min(1),
  orderCount: z.number().int().nonnegative(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
});
export type ProductSalesRow = z.infer<typeof ProductSalesRow>;

export const CategorySalesRow = z.object({
  category: z.string().min(1),
  orderCount: z.number().int().nonnegative(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  sharePct: z.number().min(0).max(100),
});
export type CategorySalesRow = z.infer<typeof CategorySalesRow>;

export const TeamPerformanceRow = z.object({
  name: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  pipelineMicros: z.number().int().nonnegative(),
  wonCount: z.number().int().nonnegative(),
  lostCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
});
export type TeamPerformanceRow = z.infer<typeof TeamPerformanceRow>;

export const TerritoryRevenueRow = z.object({
  territoryId: z.string().nullable(),
  territoryName: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  pipelineMicros: z.number().int().nonnegative(),
  opportunityCount: z.number().int().nonnegative(),
});
export type TerritoryRevenueRow = z.infer<typeof TerritoryRevenueRow>;

export const PipelineStageSnapshot = z.object({
  stage: z.string().min(1),
  count: z.number().int().nonnegative(),
  valueMicros: z.number().int().nonnegative(),
});
export type PipelineStageSnapshot = z.infer<typeof PipelineStageSnapshot>;

export const WinLossStats = z.object({
  wonCount: z.number().int().nonnegative(),
  lostCount: z.number().int().nonnegative(),
  wonRevenueMicros: z.number().int().nonnegative(),
  lostRevenueMicros: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(100),
});
export type WinLossStats = z.infer<typeof WinLossStats>;

export const SalesIntelligenceReport = z.object({
  generatedAt: z.string().datetime(),
  currencyCode: z.string().length(3),
  source: z.enum(['sales_orders', 'opportunities']),
  sourceAttribution: z.array(SourceAttribution),
  kpis: z.array(SalesMetricKpi),
  monthlySales: z.array(MonthlySalesPoint),
  topQuotations: z.array(SalesRankRow),
  topOrders: z.array(SalesRankRow),
  topCountries: z.array(CountrySalesRow),
  topProducts: z.array(ProductSalesRow),
  topCategories: z.array(CategorySalesRow),
  teamPerformance: z.array(TeamPerformanceRow),
  territoryBreakdown: z.array(TerritoryRevenueRow),
  pipelineByStage: z.array(PipelineStageSnapshot),
  winLoss: WinLossStats,
});
export type SalesIntelligenceReport = z.infer<typeof SalesIntelligenceReport>;
