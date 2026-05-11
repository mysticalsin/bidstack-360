import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  SalesIntelligenceReport,
  type CategorySalesRow,
  type CountrySalesPerson,
  type CountrySalesRow,
  type MonthlySalesPoint,
  type ProductSalesRow,
  type SalesMetricKpi,
  type SalesRankRow,
  type SourceAttribution,
} from '@bidstack/shared';

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((a.getTime() - b.getTime()) / msPerDay);
}

const PipelineKpis = z.object({
  byStage: z.array(
    z.object({
      stage: z.string(),
      count: z.number().int(),
      valueSum: z.number(),
    }),
  ),
  totalOpen: z.number().int(),
  totalValueOpen: z.number(),
  weightedPipeline: z.number(),
  velocity: z.object({
    avgDaysOpen: z.number(),
    closedThisQuarter: z.number().int(),
  }),
});

const MICROS = 1_000_000;
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

export const reportsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get('/reports/pipeline', { schema: { response: { 200: PipelineKpis } } }, async (req) => {
    const grouped = await prisma.opportunity.groupBy({
      by: ['stage'],
      where: { orgId: req.auth.orgId },
      _count: { _all: true },
      _sum: { valueEur: true },
    });

    const byStage = grouped.map((g) => ({
      stage: g.stage,
      count: g._count._all,
      valueSum: Number(g._sum.valueEur ?? 0),
    }));

    const open = byStage.filter((s) => s.stage !== 'closed_won' && s.stage !== 'closed_lost');

    // Weighted pipeline = Σ (value × probability/100) over open opps.
    const opens = await prisma.opportunity.findMany({
      where: {
        orgId: req.auth.orgId,
        stage: { notIn: ['closed_won', 'closed_lost'] },
      },
      select: { valueEur: true, probability: true },
    });
    const weighted = opens.reduce((acc, o) => acc + Number(o.valueEur) * (o.probability / 100), 0);

    const closedThisQuarter = await prisma.opportunity.count({
      where: {
        orgId: req.auth.orgId,
        stage: 'closed_won',
        updatedAt: { gte: quarterStart() },
      },
    });

    const allOpen = await prisma.opportunity.findMany({
      where: {
        orgId: req.auth.orgId,
        stage: { notIn: ['closed_won', 'closed_lost'] },
      },
      select: { createdAt: true },
    });
    const avgDaysOpen =
      allOpen.length > 0
        ? Math.round(
            allOpen.reduce((sum, o) => sum + daysBetween(new Date(), o.createdAt), 0) /
              allOpen.length,
          )
        : 0;

    return {
      byStage,
      totalOpen: open.reduce((acc, s) => acc + s.count, 0),
      totalValueOpen: open.reduce((acc, s) => acc + s.valueSum, 0),
      weightedPipeline: Math.round(weighted * 100) / 100,
      velocity: {
        avgDaysOpen,
        closedThisQuarter,
      },
    };
  });

  server.get(
    '/reports/sales-intelligence',
    { schema: { response: { 200: SalesIntelligenceReport } } },
    async (req) => {
      const generatedAt = new Date().toISOString();
      const contacts = await prisma.contact.findMany({
        where: { orgId: req.auth.orgId },
        select: { customer: true, name: true, role: true, email: true },
      });

      const salesOrders = await readSalesOrders(req.auth.orgId, req.log);
      if (salesOrders && salesOrders.length > 0) {
        const [topProducts, topCategories] = await Promise.all([
          readProductRollup(req.auth.orgId, req.log),
          readCategoryRollup(req.auth.orgId, req.log),
        ]);
        return buildSalesOrderReport({
          generatedAt,
          rows: salesOrders,
          contacts,
          productRows: topProducts,
          categoryRows: topCategories,
        });
      }

      const [opportunities, enrichments] = await Promise.all([
        prisma.opportunity.findMany({
          where: { orgId: req.auth.orgId },
          include: { owner: { select: { name: true } } },
          orderBy: [{ updatedAt: 'desc' }],
        }),
        prisma.companyEnrichment.findMany({
          where: { orgId: req.auth.orgId },
          select: {
            legalName: true,
            tradeName: true,
            normalizedName: true,
            providerMetadata: true,
          },
        }),
      ]);

      return buildOpportunitySalesReport({
        generatedAt,
        opportunities,
        enrichments,
        contacts,
      });
    },
  );
};

function quarterStart(): Date {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
}

async function readSalesOrders(
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

async function readProductRollup(
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

async function readCategoryRollup(
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

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass(${`public.${tableName}`})::text AS "tableName"
  `;
  return Boolean(rows[0]?.tableName);
}

function buildSalesOrderReport(args: {
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
      source: 'odoo_style_sales_module',
      label: 'Odoo-style sale.order / product.template mirror',
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
  });
}

function buildOpportunitySalesReport(args: {
  generatedAt: string;
  opportunities: Array<{
    id: string;
    code: string;
    customer: string;
    name: string;
    stage: string;
    valueEur: unknown;
    dueDate: Date | null;
    updatedAt: Date;
    industry: string | null;
    owner: { name: string | null } | null;
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
    revenueMicros: Math.max(0, Math.round(Number(opp.valueEur ?? 0) * MICROS)),
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
        source: 'twenty_compatible_opportunities',
        label: 'Twenty-compatible BidStack opportunity pipeline',
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
  });
}

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
  const current = new Date(
    Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
  );
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
    .map(([countryCode, bucket]) => ({
      countryCode,
      countryName: COUNTRY_META[countryCode]?.name ?? countryCode,
      revenueMicros: bucket.revenueMicros,
      quotationCount: bucket.quotationCount,
      orderCount: bucket.orderCount,
      customerCount: bucket.customers.size,
      topCustomers: [...bucket.customers].slice(0, 4),
      people: [...bucket.people.values()]
        .sort((a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name))
        .slice(0, 5),
      salespeople: [...bucket.salespeople].slice(0, 4),
      sharePct: pct(bucket.revenueMicros, totalRevenue),
    }))
    .sort((a, b) => b.revenueMicros - a.revenueMicros)
    .slice(0, 10);
}

function buildOpportunityProductRows(
  opportunities: Array<{ name: string; industry: string | null; stage: string; valueEur: unknown }>,
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
    existing.revenueMicros += Math.max(0, Math.round(Number(opp.valueEur ?? 0) * MICROS));
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

function classifyProduct(
  name: string,
  industry: string | null,
): { product: string; category: string } {
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
    const country = normalizeCountry(
      typeof metadata.country === 'string' ? metadata.country : null,
    );
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

function normalizeCountry(country: string | null): string | null {
  if (!country) return null;
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sortByRevenue(rows: SalesRankRow[]): SalesRankRow[] {
  return [...rows].sort((a, b) => b.revenueMicros - a.revenueMicros);
}

function sumMicros(rows: SalesRankRow[]): number {
  return rows.reduce((sum, row) => sum + row.revenueMicros, 0);
}

function toNumber(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10_000) / 100;
}

function trendPercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}
