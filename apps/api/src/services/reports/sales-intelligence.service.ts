import { type z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  SalesIntelligenceReport,
  type CategorySalesRow,
  type CountrySalesPerson,
  type CountrySalesRow,
  type MonthlySalesPoint,
  type PipelineStageSnapshot,
  type ProductSalesRow,
  type SalesMetricKpi,
  type SalesRankRow,
  type SourceAttribution,
  type TeamPerformanceRow,
  type TerritoryRevenueRow,
  type WinLossStats,
  asRecord,
  normalizeCountry,
  normalizeName,
  pct,
  toNumber,
  trendPercent,
} from '@bidstack/shared';

const SALES_CURRENCY = 'CAD';
const QUOTATION_STATES = new Set(['draft', 'sent']);
const ORDER_STATES = new Set(['confirmed', 'done', 'closed_won']);

const COUNTRY_META: Record<string, { name: string }> = {
  CA: { name: 'Canada' },
  US: { name: 'United States' },
  FR: { name: 'France' },
  ES: { name: 'Spain' },
  DE: { name: 'Germany' },
  PT: { name: 'Portugal' },
  NO: { name: 'Norway' },
};

const CUSTOMER_COUNTRY: Record<string, string> = {
  Mantu: 'FR',
  'CI Financial': 'CA',
  'Logistec Corporation': 'CA',
  'Rush University System for Health': 'US',
  MAPFRE: 'ES',
  MAHLE: 'DE',
  Aritzia: 'CA',
  NOS: 'PT',
  'DNB Bank': 'NO',
};

interface SalesOrderRow {
  id: string;
  number: string;
  state: string;
  customerName: string;
  countryCode: string | null;
  currency: string;
  totalMicros: bigint | number;
  orderDate: Date;
  confirmedAt: Date | null;
  salespersonName: string | null;
}

interface ProductRollupRow {
  product: string;
  category: string | null;
  orderCount: number;
  revenueMicros: bigint | number;
  currencyCode: string | null;
}

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

/* ─── Report builders ─── */

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

/* ─── KPI builders ─── */

function buildKpis(args: {
  generatedAt: string;
  quotationRows: SalesRankRow[];
  orderRows: SalesRankRow[];
  currencyCode: string;
}): SalesMetricKpi[] {
  const revenueMicros = sumMicros(args.orderRows);
  const averageOrderMicros =
    args.orderRows.length > 0 ? Math.round(revenueMicros / args.orderRows.length) : 0;
  const previous = priorPeriodStats([...args.quotationRows, ...args.orderRows], args.generatedAt);
  return [
    kpi('quotations', 'Quotations', 'count', args.quotationRows.length, null, previous.quotations),
    kpi('orders', 'Orders', 'count', args.orderRows.length, null, previous.orders),
    kpi('revenue', 'Revenue', 'money', revenueMicros, args.currencyCode, previous.revenueMicros),
    kpi(
      'average_order',
      'Average order',
      'money',
      averageOrderMicros,
      args.currencyCode,
      previous.averageOrderMicros,
    ),
  ];
}

function kpi(
  id: SalesMetricKpi['id'],
  label: string,
  kind: SalesMetricKpi['kind'],
  value: number,
  currencyCode: string | null,
  previous: number,
): SalesMetricKpi {
  const percentChange = trendPercent(value, previous);
  return {
    id,
    label,
    kind,
    value,
    currencyCode,
    percentChange,
    trend: percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat',
    tone:
      id === 'quotations'
        ? 'blue'
        : id === 'orders'
          ? 'jade'
          : id === 'revenue'
            ? 'amber'
            : 'purple',
  };
}

function priorPeriodStats(rows: SalesRankRow[], generatedAt: string) {
  const now = new Date(generatedAt);
  const current = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 3, 1));
  const previousRows = rows.filter((row) => {
    if (!row.date) return false;
    const date = new Date(row.date);
    return date >= previous && date < current;
  });
  const orders = previousRows.filter((row) => ORDER_STATES.has(row.state));
  const revenueMicros = sumMicros(orders);
  return {
    quotations: previousRows.filter((row) => !ORDER_STATES.has(row.state)).length,
    orders: orders.length,
    revenueMicros,
    averageOrderMicros: orders.length > 0 ? Math.round(revenueMicros / orders.length) : 0,
  };
}

/* ─── Monthly / Country / Product builders ─── */

function buildMonthlySales(rows: SalesRankRow[]): MonthlySalesPoint[] {
  const buckets = new Map<string, MonthlySalesPoint>();
  for (const row of rows) {
    const date = row.date ? new Date(row.date) : new Date();
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing =
      buckets.get(month) ??
      ({
        month,
        label: date.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        revenueMicros: 0,
        quotationCount: 0,
        orderCount: 0,
      } satisfies MonthlySalesPoint);
    existing.revenueMicros += row.revenueMicros;
    if (ORDER_STATES.has(row.state)) existing.orderCount += 1;
    else if (row.state !== 'closed_lost' && row.state !== 'cancelled') existing.quotationCount += 1;
    buckets.set(month, existing);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-8);
}

function buildCountryRows(
  rows: SalesRankRow[],
  contacts: Array<{ customer: string; name: string; role: string | null; email: string | null }>,
): CountrySalesRow[] {
  const totalRevenue = Math.max(sumMicros(rows), 1);
  const contactsByCustomer = new Map<string, CountrySalesPerson[]>();
  for (const contact of contacts) {
    const people = contactsByCustomer.get(contact.customer) ?? [];
    people.push({
      name: contact.name,
      title: contact.role,
      email: contact.email,
      customer: contact.customer,
    });
    contactsByCustomer.set(contact.customer, people);
  }

  const buckets = new Map<
    string,
    {
      revenueMicros: number;
      quotationCount: number;
      orderCount: number;
      customers: Set<string>;
      people: Map<string, CountrySalesPerson>;
      salespeople: Set<string>;
    }
  >();

  for (const row of rows) {
    const code = row.countryCode ?? customerCountry(row.customer);
    if (!code) continue;
    const bucket = buckets.get(code) ?? {
      revenueMicros: 0,
      quotationCount: 0,
      orderCount: 0,
      customers: new Set<string>(),
      people: new Map<string, CountrySalesPerson>(),
      salespeople: new Set<string>(),
    };
    bucket.revenueMicros += row.revenueMicros;
    bucket.customers.add(row.customer);
    if (ORDER_STATES.has(row.state)) bucket.orderCount += 1;
    else if (row.state !== 'closed_lost' && row.state !== 'cancelled') bucket.quotationCount += 1;
    if (row.salesperson) bucket.salespeople.add(row.salesperson);
    for (const person of contactsByCustomer.get(row.customer) ?? []) {
      bucket.people.set(`${person.customer}:${person.email ?? person.name}`, person);
    }
    buckets.set(code, bucket);
  }

  return [...buckets.entries()]
    .map(([countryCode, bucket]) => {
      const topCustomers = [...bucket.customers].slice(0, 4);
      const salespeople = [...bucket.salespeople].slice(0, 4);
      const contactPeople = [...bucket.people.values()].sort(
        (a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name),
      );
      const salespersonPeople = salespeople.map<CountrySalesPerson>((name, index) => ({
        name,
        title: 'Sales owner',
        email: null,
        customer: topCustomers[index % Math.max(topCustomers.length, 1)] ?? 'Country portfolio',
      }));
      const people = mergePeople(contactPeople, salespersonPeople).slice(0, 5);

      return {
        countryCode,
        countryName: COUNTRY_META[countryCode]?.name ?? countryCode,
        revenueMicros: bucket.revenueMicros,
        quotationCount: bucket.quotationCount,
        orderCount: bucket.orderCount,
        customerCount: bucket.customers.size,
        topCustomers,
        people,
        salespeople,
        sharePct: pct(bucket.revenueMicros, totalRevenue),
      };
    })
    .sort((a, b) => b.revenueMicros - a.revenueMicros)
    .slice(0, 10);
}

function mergePeople(
  contacts: CountrySalesPerson[],
  salespeople: CountrySalesPerson[],
): CountrySalesPerson[] {
  const seen = new Set<string>();
  const merged: CountrySalesPerson[] = [];
  for (const person of [...contacts, ...salespeople]) {
    const key = `${person.customer}:${person.email ?? person.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(person);
  }
  return merged;
}

function buildOpportunityProductRows(
  opportunities: Array<{
    name: string;
    industry: string | null;
    stage: string;
    valueMicros: bigint | number | unknown;
  }>,
  currencyCode: string,
): ProductSalesRow[] {
  const buckets = new Map<string, ProductSalesRow>();
  for (const opp of opportunities) {
    if (opp.stage === 'closed_lost') continue;
    const product = classifyProduct(opp.name, opp.industry);
    const existing =
      buckets.get(product.product) ??
      ({
        product: product.product,
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
      } satisfies ProductSalesRow);
    existing.orderCount += 1;
    existing.revenueMicros += Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    buckets.set(product.product, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros).slice(0, 10);
}

function buildProductRowsFromSales(rows: SalesRankRow[], currencyCode: string): ProductSalesRow[] {
  const buckets = new Map<string, ProductSalesRow>();
  for (const row of rows) {
    if (row.state === 'cancelled') continue;
    const product = classifyProduct(row.customer, null);
    const existing =
      buckets.get(product.product) ??
      ({
        product: product.product,
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
      } satisfies ProductSalesRow);
    existing.orderCount += 1;
    existing.revenueMicros += row.revenueMicros;
    buckets.set(product.product, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros).slice(0, 10);
}

function buildCategoryRowsFromProducts(
  products: ProductSalesRow[],
  currencyCode: string,
): CategorySalesRow[] {
  const total = products.reduce((sum, row) => sum + row.revenueMicros, 0);
  const buckets = new Map<string, CategorySalesRow>();
  for (const product of products) {
    const existing =
      buckets.get(product.category) ??
      ({
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
        sharePct: 0,
      } satisfies CategorySalesRow);
    existing.orderCount += product.orderCount;
    existing.revenueMicros += product.revenueMicros;
    buckets.set(product.category, existing);
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, sharePct: pct(row.revenueMicros, total) }))
    .sort((a, b) => b.revenueMicros - a.revenueMicros)
    .slice(0, 10);
}

/* ─── Classification / normalization helpers ─── */

function classifyProduct(name: string, industry: string | null): { product: string; category: string } {
  const text = `${name} ${industry ?? ''}`.toLowerCase();
  if (text.includes('soc') || text.includes('security') || text.includes('cyber')) {
    return { product: 'Managed SOC & Compliance', category: 'Cybersecurity' };
  }
  if (text.includes('identity') || text.includes('access')) {
    return { product: 'Identity Governance Accelerator', category: 'Identity & Access' };
  }
  if (text.includes('endpoint')) {
    return { product: 'Endpoint Refresh Program', category: 'Endpoint Management' };
  }
  if (text.includes('ehr') || text.includes('cloud') || text.includes('landing zone')) {
    return { product: 'Cloud Migration Factory', category: 'Cloud & Infrastructure' };
  }
  if (text.includes('ot/it') || text.includes('manufacturing') || text.includes('plant')) {
    return { product: 'Industrial IT Assessment', category: 'Industrial Technology' };
  }
  if (text.includes('msp') || text.includes('modernization')) {
    return { product: 'Managed IT Modernization', category: 'Managed Services' };
  }
  return { product: 'Presales Advisory Pack', category: 'Consulting' };
}

function countryMapFromEnrichments(
  rows: Array<{
    legalName: string;
    tradeName: string | null;
    normalizedName: string;
    providerMetadata: unknown;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const metadata = asRecord(row.providerMetadata);
    const country = normalizeCountry(typeof metadata.country === 'string' ? metadata.country : null);
    if (!country) continue;
    map.set(normalizeName(row.legalName), country);
    if (row.tradeName) map.set(normalizeName(row.tradeName), country);
    map.set(normalizeName(row.normalizedName), country);
  }
  return map;
}

function attribution(
  fetchedAt: string,
  input: {
    source: string;
    label: string;
    confidence: number;
    providerMetadata: Record<string, unknown>;
  },
): SourceAttribution {
  return {
    source: input.source,
    label: input.label,
    sourceUrl: null,
    fetchedAt,
    confidence: input.confidence,
    providerMetadata: input.providerMetadata,
  };
}

function customerCountry(customer: string): string | null {
  return CUSTOMER_COUNTRY[customer] ?? null;
}

/* ─── Team / Territory / Pipeline / Win-Loss builders ─── */

function buildTeamPerformanceFromOrders(rows: SalesRankRow[]): TeamPerformanceRow[] {
  const buckets = new Map<string, TeamPerformanceRow>();
  for (const row of rows) {
    const name = row.salesperson ?? 'Unassigned';
    const existing = buckets.get(name) ?? {
      name,
      revenueMicros: 0,
      pipelineMicros: 0,
      wonCount: 0,
      lostCount: 0,
      openCount: 0,
    };
    if (ORDER_STATES.has(row.state)) {
      existing.revenueMicros += row.revenueMicros;
      existing.wonCount += 1;
    } else if (row.state === 'closed_lost') {
      existing.lostCount += 1;
    } else {
      existing.pipelineMicros += row.revenueMicros;
      existing.openCount += 1;
    }
    buckets.set(name, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros);
}

function buildTeamPerformanceFromOpportunities(
  opportunities: Array<{
    stage: string;
    valueMicros: bigint | number | unknown;
    owner: { name: string | null } | null;
  }>,
): TeamPerformanceRow[] {
  const buckets = new Map<string, TeamPerformanceRow>();
  for (const opp of opportunities) {
    const name = opp.owner?.name ?? 'Unassigned';
    const value = Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    const existing = buckets.get(name) ?? {
      name,
      revenueMicros: 0,
      pipelineMicros: 0,
      wonCount: 0,
      lostCount: 0,
      openCount: 0,
    };
    if (opp.stage === 'closed_won') {
      existing.revenueMicros += value;
      existing.wonCount += 1;
    } else if (opp.stage === 'closed_lost') {
      existing.lostCount += 1;
    } else {
      existing.pipelineMicros += value;
      existing.openCount += 1;
    }
    buckets.set(name, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros);
}

function buildTerritoryBreakdown(
  opportunities: Array<{
    stage: string;
    valueMicros: bigint | number | unknown;
    territoryId: string | null;
    territory: { name: string } | null;
  }>,
): TerritoryRevenueRow[] {
  const buckets = new Map<string, TerritoryRevenueRow>();
  for (const opp of opportunities) {
    const key = opp.territoryId ?? '__unassigned';
    const name = opp.territory?.name ?? 'Unassigned';
    const value = Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    const existing = buckets.get(key) ?? {
      territoryId: opp.territoryId,
      territoryName: name,
      revenueMicros: 0,
      pipelineMicros: 0,
      opportunityCount: 0,
    };
    if (opp.stage === 'closed_won') {
      existing.revenueMicros += value;
    } else if (opp.stage !== 'closed_lost') {
      existing.pipelineMicros += value;
    }
    existing.opportunityCount += 1;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros + b.pipelineMicros - (a.revenueMicros + a.pipelineMicros));
}

function buildPipelineByStage(
  opportunities: Array<{
    stage: string;
    valueMicros: bigint | number | unknown;
  }>,
): PipelineStageSnapshot[] {
  const buckets = new Map<string, PipelineStageSnapshot>();
  for (const opp of opportunities) {
    if (opp.stage === 'closed_won' || opp.stage === 'closed_lost') continue;
    const value = Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    const existing = buckets.get(opp.stage) ?? { stage: opp.stage, count: 0, valueMicros: 0 };
    existing.count += 1;
    existing.valueMicros += value;
    buckets.set(opp.stage, existing);
  }
  return [...buckets.values()].sort((a, b) => b.valueMicros - a.valueMicros);
}

function buildWinLossFromOrders(rows: SalesRankRow[]): WinLossStats {
  const won = rows.filter((r) => ORDER_STATES.has(r.state));
  const lost = rows.filter((r) => r.state === 'cancelled');
  const wonRevenue = sumMicros(won);
  const lostRevenue = sumMicros(lost);
  const total = won.length + lost.length;
  return {
    wonCount: won.length,
    lostCount: lost.length,
    wonRevenueMicros: wonRevenue,
    lostRevenueMicros: lostRevenue,
    winRate: total > 0 ? Math.round((won.length / total) * 1000) / 10 : 0,
  };
}

function buildWinLossFromOpportunities(
  opportunities: Array<{ stage: string; valueMicros: bigint | number | unknown }>,
): WinLossStats {
  let wonCount = 0;
  let lostCount = 0;
  let wonRevenue = 0;
  let lostRevenue = 0;
  for (const opp of opportunities) {
    const value = Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    if (opp.stage === 'closed_won') {
      wonCount += 1;
      wonRevenue += value;
    } else if (opp.stage === 'closed_lost') {
      lostCount += 1;
      lostRevenue += value;
    }
  }
  const total = wonCount + lostCount;
  return {
    wonCount,
    lostCount,
    wonRevenueMicros: wonRevenue,
    lostRevenueMicros: lostRevenue,
    winRate: total > 0 ? Math.round((wonCount / total) * 1000) / 10 : 0,
  };
}

/* ─── Math / aggregation utilities ─── */

function sortByRevenue(rows: SalesRankRow[]): SalesRankRow[] {
  return [...rows].sort((a, b) => b.revenueMicros - a.revenueMicros);
}

function sumMicros(rows: SalesRankRow[]): number {
  return rows.reduce((sum, row) => sum + row.revenueMicros, 0);
}
