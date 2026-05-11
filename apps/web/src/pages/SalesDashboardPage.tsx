// Sales Dashboard — Odoo-style KPIs, monthly chart, top quotations/orders,
// countries, products, customers, and categories. The page uses the same
// resilient sales-intelligence endpoint as /dashboard, so it works before
// optional Odoo sale.order tables are migrated and automatically switches to
// those tables when they exist.

import { KpiTile } from '@/components/sales/KpiTile';
import { MonthlySalesChart } from '@/components/sales/MonthlySalesChart';
import { TopCategoriesTreemap } from '@/components/sales/TopCategoriesTreemap';
import { TopCountriesCard } from '@/components/sales/TopCountriesCard';
import { TopList } from '@/components/sales/TopList';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useSalesIntelligence } from '@/hooks/useSalesIntelligence';
import { formatMoneyMicros } from '@/lib/format';

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
  const data = report.data;
  const currency = data?.currencyCode ?? 'CAD';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Sales Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Quotations, orders, revenue, geography, products, and customer ownership.
          </p>
        </div>
        {data ? (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-xs font-semibold text-[var(--fg-secondary)]">
            {data.source === 'sales_orders' ? 'Odoo sale.order mirror' : 'Opportunity pipeline'}
          </div>
        ) : null}
      </header>

      <section
        aria-label="Key performance indicators"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiTile
          label="Quotations"
          value={metricValue(data, 'quotations', currency)}
          deltaPct={metricDelta(data, 'quotations')}
          tone="blue"
        />
        <KpiTile
          label="Orders"
          value={metricValue(data, 'orders', currency)}
          deltaPct={metricDelta(data, 'orders')}
          tone="gray"
        />
        <KpiTile
          label="Revenue"
          value={metricValue(data, 'revenue', currency)}
          deltaPct={metricDelta(data, 'revenue')}
          tone="amber"
        />
        <KpiTile
          label="Average Order"
          value={metricValue(data, 'average_order', currency)}
          deltaPct={metricDelta(data, 'average_order')}
          tone="amber"
        />
      </section>

      <Card>
        <SectionHeader title="Monthly Sales" caption={`Currency: ${currency}`} />
        <div className="px-5 pb-5">
          {report.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <MonthlySalesChart points={monthlyPoints(data)} currency={currency} />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Top Quotations" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : (
            <TopList items={toTopRows(data?.topQuotations ?? [])} variant="quotation" />
          )}
        </Card>
        <Card>
          <SectionHeader title="Top Sales Orders" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={4} />
            </div>
          ) : (
            <TopList items={toTopRows(data?.topOrders ?? [])} variant="order" />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopCountriesCard data={toCountries(data)} isLoading={report.isLoading} />
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
                {(data?.topProducts ?? []).map((product) => (
                  <tr key={product.product} className="border-t border-[var(--border-subtle)]">
                    <td className="px-4 py-2.5 text-[var(--fg-primary)]">
                      <div className="truncate">{product.product}</div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                        {product.category}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-secondary)]">
                      {product.orderCount}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-primary)] whitespace-nowrap">
                      {formatMoneyMicros(product.revenueMicros, product.currencyCode)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Top Customers" />
          {report.isLoading ? (
            <div className="p-5">
              <LoadingSkeleton rows={5} />
            </div>
          ) : (
            <TopList items={topCustomers(data)} showSalesperson={false} variant="customer" />
          )}
        </Card>
        <TopCategoriesTreemap data={toCategories(data)} isLoading={report.isLoading} />
      </div>
    </div>
  );
}

function metric(report: SalesIntelligenceReport | undefined, id: SalesMetricKpi['id']) {
  return report?.kpis.find((kpi) => kpi.id === id);
}

function metricValue(
  report: SalesIntelligenceReport | undefined,
  id: SalesMetricKpi['id'],
  fallbackCurrency: string,
): string {
  const kpi = metric(report, id);
  if (!kpi) return '—';
  if (kpi.kind === 'money')
    return formatMoneyMicros(kpi.value, kpi.currencyCode ?? fallbackCurrency);
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
