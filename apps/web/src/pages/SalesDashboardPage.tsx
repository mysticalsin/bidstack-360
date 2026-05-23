// Sales Dashboard — ERP-style KPIs, monthly chart, top quotations/orders,
// countries, products, customers, and categories. The page uses the same
// resilient sales-intelligence endpoint as /dashboard, so it works before
// optional ERP sale.order tables are migrated and automatically switches to
// those tables when they exist.

import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

import { ArAgingCard } from '@/components/sales/ArAgingCard';
import { KpiTile } from '@/components/sales/KpiTile';
import { MonthlySalesChart } from '@/components/sales/MonthlySalesChart';
import { PipelineSnapshot } from '@/components/sales/PipelineSnapshot';
import { TeamLeaderboard } from '@/components/sales/TeamLeaderboard';
import { TerritoryRevenueCard } from '@/components/sales/TerritoryRevenueCard';
import { TopCategoriesTreemap } from '@/components/sales/TopCategoriesTreemap';
import { TopCountriesCard } from '@/components/sales/TopCountriesCard';
import { TopList } from '@/components/sales/TopList';
import { WinRateCard } from '@/components/sales/WinRateCard';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useArAging } from '@/hooks/useArAging';
import { useAutopopulateSalesCompanies } from '@/hooks/useAutopopulateSalesCompanies';
import { useSalesIntelligence } from '@/hooks/useSalesIntelligence';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft, staggerChild, staggerParent } from '@/lib/motion';

import type {
  CategoryRow,
  SalesIntelligenceReport,
  SalesMetricKpi,
  SalesRankRow,
  TopCategories,
  TopCountries,
  TopRow,
} from '@bidstack/shared';

export function SalesDashboardPage() {
  const report = useSalesIntelligence();
  const autopopulate = useAutopopulateSalesCompanies();
  const isError = report.isError;
  const reducedMotion = useReducedMotion();
  const data = report.data;
  const arAging = useArAging(data?.currencyCode);
  const { currency, formatMoneyMicros } = useFormatMoney();
  const sourceCurrency = data?.currencyCode ?? 'CAD';
  const topProducts = useMemo(() => data?.topProducts ?? [], [data?.topProducts]);
  const monthly = useMemo(() => monthlyPoints(data), [data]);
  const countries = useMemo(() => toCountries(data), [data]);
  const categories = useMemo(() => toCategories(data), [data]);
  const customers = useMemo(() => topCustomers(data), [data]);
  const quotations = useMemo(() => toTopRows(data?.topQuotations ?? []), [data?.topQuotations]);
  const orders = useMemo(() => toTopRows(data?.topOrders ?? []), [data?.topOrders]);
  const topProductMax = useMemo(
    () => topProducts.reduce((max, product) => Math.max(max, product.revenueMicros), 1),
    [topProducts],
  );
  const navigate = useNavigate();
  const drill = useMemo(
    () =>
      (state: 'draft' | 'sent' | 'confirmed' | 'all'): (() => void) =>
      () => {
        navigate(state === 'all' ? '/sales/orders' : `/sales/orders?state=${state}`);
      },
    [navigate],
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Sales Dashboard
          </h1>
        </header>
        <ErrorState
          title="Could not load sales data"
          message={report.error instanceof Error ? report.error.message : 'Please try again.'}
          action={
            <button
              type="button"
              onClick={() => report.refetch()}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Sales Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Quotations, orders, revenue, pipeline, team, territories, and geography.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {autopopulate.data ? (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-xs font-semibold text-[var(--fg-secondary)]">
              {autopopulate.data.enriched} enriched / {autopopulate.data.cached} cached
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={autopopulate.isPending}
            onClick={() => autopopulate.mutate({ limit: 8 })}
            title="Auto-populate company logos, websites, and profiles for top sales accounts"
          >
            {autopopulate.isPending ? (
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                aria-hidden
              />
            ) : (
              <Icon name="building" size={14} />
            )}
            {autopopulate.isPending ? 'Populating...' : 'Auto-populate'}
          </button>
          {data ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-xs font-semibold text-[var(--fg-secondary)]">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full bg-[var(--success)] ${
                  reducedMotion ? '' : 'animate-pulse'
                }`}
              />
              {data.source === 'sales_orders' ? 'ERP sale.order mirror' : 'Opportunity pipeline'}
            </div>
          ) : null}
        </div>
      </motion.header>

      {/* KPI Row */}
      <motion.section
        variants={reducedMotion ? undefined : staggerChild}
        aria-label="Key performance indicators"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiTile
          label="Quotations"
          value={metricValue(data, 'quotations', formatMoneyMicros, sourceCurrency)}
          deltaPct={metricDelta(data, 'quotations')}
          tone="blue"
          onClick={drill('sent')}
        />
        <KpiTile
          label="Orders"
          value={metricValue(data, 'orders', formatMoneyMicros, sourceCurrency)}
          deltaPct={metricDelta(data, 'orders')}
          tone="gray"
          onClick={drill('confirmed')}
        />
        <KpiTile
          label="Revenue"
          value={metricValue(data, 'revenue', formatMoneyMicros, sourceCurrency)}
          deltaPct={metricDelta(data, 'revenue')}
          tone="amber"
          onClick={drill('confirmed')}
        />
        <KpiTile
          label="Average Order"
          value={metricValue(data, 'average_order', formatMoneyMicros, sourceCurrency)}
          deltaPct={metricDelta(data, 'average_order')}
          tone="amber"
          onClick={drill('confirmed')}
        />
      </motion.section>

      {/* Pipeline + Win/Loss */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <PipelineSnapshot stages={data?.pipelineByStage ?? []} isLoading={report.isLoading} />
        <WinRateCard stats={data?.winLoss} isLoading={report.isLoading} />
      </motion.div>

      {/* Monthly Sales */}
      <motion.div variants={reducedMotion ? undefined : staggerChild}>
        <Card>
          <SectionHeader title="Monthly Sales" caption={`Currency: ${currency}`} />
          <div className="px-5 pb-5">
            {report.isLoading ? (
              <LoadingSkeleton rows={3} />
            ) : (
              <MonthlySalesChart points={monthly} sourceCurrency={sourceCurrency} />
            )}
          </div>
        </Card>
      </motion.div>

      {/* Top Quotations + Orders */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <Card>
          <SectionHeader title="Top Quotations" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : (
            <TopList items={quotations} variant="quotation" />
          )}
        </Card>
        <Card>
          <SectionHeader title="Top Sales Orders" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : (
            <TopList items={orders} variant="order" />
          )}
        </Card>
      </motion.div>

      {/* Team + Territory */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <TeamLeaderboard members={data?.teamPerformance ?? []} isLoading={report.isLoading} />
        <TerritoryRevenueCard
          territories={data?.territoryBreakdown ?? []}
          isLoading={report.isLoading}
        />
      </motion.div>

      {/* Countries + A/R + Products */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        <TopCountriesCard data={countries} isLoading={report.isLoading} />
        <ArAgingCard data={arAging.data} isLoading={arAging.isLoading} />
        <Card>
          <SectionHeader title="Top Products" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={5} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--fg-tertiary)]">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Product
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Orders
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product, index) => {
                  const pct =
                    topProductMax > 0
                      ? Math.min(100, (product.revenueMicros / topProductMax) * 100)
                      : 0;
                  return (
                    <motion.tr
                      key={product.product}
                      initial={reducedMotion ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      whileHover={reducedMotion ? undefined : { x: 2 }}
                      transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.025 }}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <td className="relative px-4 py-2.5 text-[var(--fg-primary)]">
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-1 rounded bg-[#eef4ff]"
                          initial={reducedMotion ? false : { width: 0 }}
                          animate={{ width: `calc(${pct.toFixed(2)}% - 8px)` }}
                          transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.025 }}
                        />
                        <div className="relative truncate font-medium">{product.product}</div>
                        <div className="relative text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                          {product.category}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                        {product.orderCount}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-primary)] whitespace-nowrap">
                        {formatMoneyMicros(
                          product.revenueMicros,
                          product.currencyCode ?? sourceCurrency,
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </motion.div>

      {/* Customers + Categories */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <Card>
          <SectionHeader title="Top Customers" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={5} />
            </div>
          ) : (
            <TopList items={customers} showSalesperson={false} variant="customer" />
          )}
        </Card>
        <TopCategoriesTreemap data={categories} isLoading={report.isLoading} />
      </motion.div>
    </motion.div>
  );
}

function metric(report: SalesIntelligenceReport | undefined, id: SalesMetricKpi['id']) {
  return report?.kpis.find((kpi) => kpi.id === id);
}

function metricValue(
  report: SalesIntelligenceReport | undefined,
  id: SalesMetricKpi['id'],
  formatMoneyMicros: (micros: string | number | bigint, sourceCurrency?: string) => string,
  sourceCurrency: string,
): string {
  const kpi = metric(report, id);
  if (!kpi) return '—';
  if (kpi.kind === 'money') {
    const from = kpi.currencyCode ?? sourceCurrency;
    return formatMoneyMicros(kpi.value, from);
  }
  return new Intl.NumberFormat('en-US').format(kpi.value);
}

function metricDelta(
  report: SalesIntelligenceReport | undefined,
  id: SalesMetricKpi['id'],
): number | null {
  return metric(report, id)?.percentChange ?? null;
}

function monthlyPoints(report: SalesIntelligenceReport | undefined) {
  return (report?.monthlySales ?? []).map((point) => ({
    month: `${point.month}-01`,
    label: point.label,
    revenueMicros: String(point.revenueMicros),
    orders: point.orderCount,
  }));
}

function toTopRows(rows: SalesRankRow[]): TopRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.customer,
    salesperson: row.salesperson,
    revenueMicros: String(row.revenueMicros),
    currency: row.currencyCode,
  }));
}

function toCountries(report: SalesIntelligenceReport | undefined): TopCountries | undefined {
  if (!report) return undefined;
  return {
    currency: report.currencyCode,
    items: report.topCountries.map((country) => ({
      code: country.countryCode,
      name: country.countryName,
      revenueMicros: String(country.revenueMicros),
      orders: country.orderCount + country.quotationCount,
    })),
  };
}

function toCategories(report: SalesIntelligenceReport | undefined): TopCategories | undefined {
  if (!report) return undefined;
  return {
    currency: report.currencyCode,
    items: report.topCategories.map<CategoryRow>((category) => ({
      id: category.category,
      name: category.category,
      revenueMicros: String(category.revenueMicros),
      orders: category.orderCount,
    })),
  };
}

function topCustomers(report: SalesIntelligenceReport | undefined): TopRow[] {
  if (!report) return [];
  const byCustomer = new Map<string, TopRow>();
  for (const row of [...report.topQuotations, ...report.topOrders]) {
    const existing =
      byCustomer.get(row.customer) ??
      ({
        id: row.customer,
        label: row.customer,
        salesperson: null,
        revenueMicros: '0',
        currency: row.currencyCode,
      } satisfies TopRow);
    existing.revenueMicros = String(Number(existing.revenueMicros) + row.revenueMicros);
    byCustomer.set(row.customer, existing);
  }
  return [...byCustomer.values()]
    .sort((a, b) => Number(b.revenueMicros) - Number(a.revenueMicros))
    .slice(0, 10);
}
