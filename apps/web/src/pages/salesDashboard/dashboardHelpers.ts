// Pure data-transform helpers for SalesDashboardPage.
// No React, no hooks — safe to import anywhere.

import type {
  CategoryRow,
  SalesIntelligenceReport,
  SalesMetricKpi,
  SalesRankRow,
  TopCategories,
  TopCountries,
  TopRow,
} from '@bidstack/shared';

export function metric(report: SalesIntelligenceReport | undefined, id: SalesMetricKpi['id']) {
  return report?.kpis.find((kpi) => kpi.id === id);
}

export function metricValue(
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

export function metricDelta(
  report: SalesIntelligenceReport | undefined,
  id: SalesMetricKpi['id'],
): number | null {
  return metric(report, id)?.percentChange ?? null;
}

export function monthlyPoints(report: SalesIntelligenceReport | undefined) {
  return (report?.monthlySales ?? []).map((point) => ({
    month: `${point.month}-01`,
    label: point.label,
    revenueMicros: String(point.revenueMicros),
    orders: point.orderCount,
  }));
}

export function toTopRows(rows: SalesRankRow[]): TopRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.customer,
    salesperson: row.salesperson,
    revenueMicros: String(row.revenueMicros),
    currency: row.currencyCode,
  }));
}

export function toCountries(report: SalesIntelligenceReport | undefined): TopCountries | undefined {
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

export function toCategories(
  report: SalesIntelligenceReport | undefined,
): TopCategories | undefined {
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

export function topCustomers(report: SalesIntelligenceReport | undefined): TopRow[] {
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
