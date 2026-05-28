/**
 * sales-intelligence.service.ts — DB guards, raw SQL fetchers, and report orchestrators.
 *
 * WHY split: the original 831-line file violated the 400-line cap. Pure helpers, chart
 * builders, and summary builders are now in co-located sibling modules. This file is
 * the only one that touches Prisma and returns the final SalesIntelligenceReport shape.
 *
 * External API surface (imported by reports.ts):
 *   readSalesOrders, readProductRollup, readCategoryRollup,
 *   buildSalesOrderReport, buildOpportunitySalesReport
 *
 * Import DAG: helpers, charts, summary ← this file ← routes/reports.ts
 */
import { type z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  SalesIntelligenceReport,
  type CategorySalesRow,
  type ProductSalesRow,
  type SalesRankRow,
  normalizeCountry,
  normalizeName,
  pct,
  toNumber,
} from '@bidstack/shared';

import {
  buildCategoryRowsFromProducts,
  buildCountryRows,
  buildMonthlySales,
  buildOpportunityProductRows,
  buildProductRowsFromSales,
} from './sales-intelligence.charts.js';
import {
  ORDER_STATES,
  QUOTATION_STATES,
  SALES_CURRENCY,
  type ProductRollupRow,
  type SalesOrderRow,
  attribution,
  countryMapFromEnrichments,
  customerCountry,
  sortByRevenue,
} from './sales-intelligence.helpers.js';
import {
  buildKpis,
  buildPipelineByStage,
  buildTeamPerformanceFromOpportunities,
  buildTeamPerformanceFromOrders,
  buildTerritoryBreakdown,
  buildWinLossFromOpportunities,
  buildWinLossFromOrders,
} from './sales-intelligence.summary.js';

/* ─── DB guards ─── */

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass(${`public.${tableName}`})::text AS "tableName"
  `;
  return Boolean(rows[0]?.tableName);
}

/* ─── Raw SQL fetchers ─── */

export async function readSalesOrders(
  orgId: string,
  log: { debug: (obj: unknown, msg?: string) => void },
): Promise<SalesOrderRow[] | null> {
  if (!(await tableExists('sales_orders'))) return null;
  try {
    return await prisma.$queryRaw<SalesOrderRow[]>`
      SELECT
        so.id::text AS "id",
        so.number AS "number",
        so.state::text AS "state",
        so.customer_name AS "customerName",
        so.country_code AS "countryCode",
        so.currency AS "currency",
        so.total_micros AS "totalMicros",
        so.order_date AS "orderDate",
        so.confirmed_at AS "confirmedAt",
        u.name AS "salespersonName"
      FROM sales_orders so
      LEFT JOIN users u ON u.id = so.salesperson_id
      WHERE so.org_id = ${orgId}::uuid
      ORDER BY so.order_date DESC
      LIMIT 500
    `;
  } catch (err) {
    log.debug({ err }, 'sales_orders table unavailable; deriving report from opportunities');
    return null;
  }
}

export async function readProductRollup(
  orgId: string,
  log: { debug: (obj: unknown, msg?: string) => void },
): Promise<ProductSalesRow[]> {
  if (!(await tableExists('sales_order_lines')) || !(await tableExists('products'))) return [];
  try {
    const rows = await prisma.$queryRaw<ProductRollupRow[]>`
      SELECT
        p.name AS "product",
        pc.name AS "category",
        COUNT(DISTINCT sol.order_id)::int AS "orderCount",
        COALESCE(SUM(sol.subtotal_micros), 0)::bigint AS "revenueMicros",
        MAX(so.currency) AS "currencyCode"
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      JOIN products p ON p.id = sol.product_id
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE sol.org_id = ${orgId}::uuid
        AND so.state IN ('confirmed', 'done')
      GROUP BY p.name, pc.name
      ORDER BY "revenueMicros" DESC
      LIMIT 10
    `;
    return rows.map((row) => ({
      product: row.product,
      category: row.category ?? 'Uncategorized',
      orderCount: row.orderCount,
      revenueMicros: toNumber(row.revenueMicros),
      currencyCode: row.currencyCode ?? SALES_CURRENCY,
    }));
  } catch (err) {
    log.debug({ err }, 'sales_order_lines table unavailable; deriving product report');
    return [];
  }
}

export async function readCategoryRollup(
  orgId: string,
  log: { debug: (obj: unknown, msg?: string) => void },
): Promise<CategorySalesRow[]> {
  if (
    !(await tableExists('sales_order_lines')) ||
    !(await tableExists('products')) ||
    !(await tableExists('product_categories'))
  ) {
    return [];
  }
  try {
    const rows = await prisma.$queryRaw<ProductRollupRow[]>`
      SELECT
        COALESCE(pc.name, 'Uncategorized') AS "product",
        COALESCE(pc.name, 'Uncategorized') AS "category",
        COUNT(DISTINCT sol.order_id)::int AS "orderCount",
        COALESCE(SUM(sol.subtotal_micros), 0)::bigint AS "revenueMicros",
        MAX(so.currency) AS "currencyCode"
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      JOIN products p ON p.id = sol.product_id
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE sol.org_id = ${orgId}::uuid
        AND so.state IN ('confirmed', 'done')
      GROUP BY pc.name
      ORDER BY "revenueMicros" DESC
      LIMIT 10
    `;
    const total = rows.reduce((sum, row) => sum + toNumber(row.revenueMicros), 0);
    return rows.map((row) => ({
      category: row.category ?? 'Uncategorized',
      orderCount: row.orderCount,
      revenueMicros: toNumber(row.revenueMicros),
      currencyCode: row.currencyCode ?? SALES_CURRENCY,
      sharePct: pct(toNumber(row.revenueMicros), total),
    }));
  } catch (err) {
    log.debug({ err }, 'sales_order_lines table unavailable; deriving category report');
    return [];
  }
}

/* ─── Report orchestrators ─── */

export function buildSalesOrderReport(args: {
  generatedAt: string;
  rows: SalesOrderRow[];
  contacts: Array<{ customer: string; name: string; role: string | null; email: string | null }>;
  productRows: ProductSalesRow[];
  categoryRows: CategorySalesRow[];
}): z.infer<typeof SalesIntelligenceReport> {
  const rankRows = args.rows.map<SalesRankRow>((row) => ({
    id: row.id,
    number: row.number,
    customer: row.customerName,
    salesperson: row.salespersonName,
    revenueMicros: toNumber(row.totalMicros),
    currencyCode: row.currency,
    countryCode: normalizeCountry(row.countryCode) ?? customerCountry(row.customerName),
    state: row.state,
    date: (row.confirmedAt ?? row.orderDate).toISOString(),
  }));
  const quotationRows = rankRows.filter((row) => QUOTATION_STATES.has(row.state));
  const orderRows = rankRows.filter((row) => ORDER_STATES.has(row.state));
  const currencyCode = rankRows[0]?.currencyCode ?? SALES_CURRENCY;
  const sourceAttribution = [
    attribution(args.generatedAt, {
      source: 'external_erp_style_sales_module',
      label: 'External ERP-style sale.order / product.template mirror',
      confidence: 0.9,
      providerMetadata: { model: 'sales_orders' },
    }),
  ];

  const topProducts =
    args.productRows.length > 0
      ? args.productRows
      : buildProductRowsFromSales(rankRows, currencyCode);
  const topCategories =
    args.categoryRows.length > 0
      ? args.categoryRows
      : buildCategoryRowsFromProducts(topProducts, currencyCode);

  return SalesIntelligenceReport.parse({
    generatedAt: args.generatedAt,
    currencyCode,
    source: 'sales_orders',
    sourceAttribution,
    kpis: buildKpis({ generatedAt: args.generatedAt, quotationRows, orderRows, currencyCode }),
    monthlySales: buildMonthlySales(rankRows),
    topQuotations: sortByRevenue(quotationRows).slice(0, 10),
    topOrders: sortByRevenue(orderRows).slice(0, 10),
    topCountries: buildCountryRows(rankRows, args.contacts),
    topProducts,
    topCategories,
    teamPerformance: buildTeamPerformanceFromOrders(rankRows),
    territoryBreakdown: [],
    pipelineByStage: [],
    winLoss: buildWinLossFromOrders(rankRows),
  });
}

export function buildOpportunitySalesReport(args: {
  generatedAt: string;
  opportunities: Array<{
    id: string;
    code: string;
    customer: string;
    name: string;
    stage: string;
    valueMicros: bigint | number | unknown;
    dueDate: Date | null;
    updatedAt: Date;
    industry: string | null;
    owner: { name: string | null } | null;
    territoryId: string | null;
    territory: { name: string } | null;
  }>;
  enrichments: Array<{
    legalName: string;
    tradeName: string | null;
    normalizedName: string;
    providerMetadata: unknown;
  }>;
  contacts: Array<{ customer: string; name: string; role: string | null; email: string | null }>;
}): z.infer<typeof SalesIntelligenceReport> {
  const countryByCustomer = countryMapFromEnrichments(args.enrichments);
  const rankRows = args.opportunities.map<SalesRankRow>((opp) => ({
    id: opp.id,
    number: opp.code,
    customer: opp.customer,
    salesperson: opp.owner?.name ?? null,
    revenueMicros: Math.max(0, Math.round(Number(opp.valueMicros ?? 0))),
    currencyCode: SALES_CURRENCY,
    countryCode:
      countryByCustomer.get(normalizeName(opp.customer)) ?? customerCountry(opp.customer),
    state: opp.stage,
    date: (opp.dueDate ?? opp.updatedAt).toISOString(),
  }));
  const quotationRows = rankRows.filter(
    (row) => row.state !== 'closed_won' && row.state !== 'closed_lost',
  );
  const orderRows = rankRows.filter((row) => row.state === 'closed_won');
  const productRows = buildOpportunityProductRows(args.opportunities, SALES_CURRENCY);

  return SalesIntelligenceReport.parse({
    generatedAt: args.generatedAt,
    currencyCode: SALES_CURRENCY,
    source: 'opportunities',
    sourceAttribution: [
      attribution(args.generatedAt, {
        source: 'external_crm_compatible_opportunities',
        label: 'External CRM-compatible BidStack opportunity pipeline',
        confidence: 0.78,
        providerMetadata: { fallback: true, model: 'opportunities' },
      }),
    ],
    kpis: buildKpis({
      generatedAt: args.generatedAt,
      quotationRows,
      orderRows,
      currencyCode: SALES_CURRENCY,
    }),
    monthlySales: buildMonthlySales(rankRows),
    topQuotations: sortByRevenue(quotationRows).slice(0, 10),
    topOrders: sortByRevenue(orderRows).slice(0, 10),
    topCountries: buildCountryRows(rankRows, args.contacts),
    topProducts: productRows,
    topCategories: buildCategoryRowsFromProducts(productRows, SALES_CURRENCY),
    teamPerformance: buildTeamPerformanceFromOpportunities(args.opportunities),
    territoryBreakdown: buildTerritoryBreakdown(args.opportunities),
    pipelineByStage: buildPipelineByStage(args.opportunities),
    winLoss: buildWinLossFromOpportunities(args.opportunities),
  });
}
