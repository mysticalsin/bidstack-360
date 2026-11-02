/**
 * forecastsConfig — pure constants, types, and data utilities for the Forecasts
 * feature. No React/JSX — safe to import from tests or server-only code.
 */
import type { Forecast } from '@bidstack/shared';

import { unspecifiedMicrosLabel } from '@/components/dashboard/unspecified-currency';
import { formatMoneyMicros } from '@/lib/format';

export const CATEGORIES: Forecast['category'][] = ['pipeline', 'best_case', 'commit', 'closed'];

export const CATEGORY_LABELS: Record<Forecast['category'], string> = {
  pipeline: 'Pipeline',
  best_case: 'Best Case',
  commit: 'Commit',
  closed: 'Closed',
};

export const CATEGORY_COLOR: Record<Forecast['category'], string> = {
  pipeline: '#2c4bff',
  best_case: '#7c3aed',
  commit: '#d97706',
  closed: '#059669',
};

export interface ForecastRow {
  ownerId: string;
  ownerName: string | null;
  period: string;
  pipeline: string;
  bestCase: string;
  commit: string;
  closed: string;
  ids: Record<Forecast['category'], string | undefined>;
  /** Recorded currency for a filled cell. Absent until that category is stored. */
  currencies: Record<Forecast['category'], string | undefined>;
}

/** EUR is the old form default, not a chosen euro amount. Same rule as the API. */
export function isUnspecifiedForecastCurrency(currency: string | null | undefined): boolean {
  const code = (currency ?? '').trim().toUpperCase();
  return code === '' || code === 'XXX' || code === 'EUR';
}

/** A recorded currency prints in that currency. XXX and legacy EUR stay unspecified. */
export function formatForecastAmount(micros: string | bigint, currency?: string | null): string {
  if (isUnspecifiedForecastCurrency(currency)) return unspecifiedMicrosLabel(micros);
  const code = currency!.trim().toUpperCase();
  const value = typeof micros === 'bigint' ? micros : BigInt(micros);
  const units = (value < 0n ? -value : value) / 1_000_000n;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    return formatMoneyMicros(value, code, { compact: false });
  }
  return formatMoneyMicros(value, code);
}

export type PeriodFilter = 'monthly' | 'quarterly' | 'yearly';

export function groupForecasts(items: Forecast[]): ForecastRow[] {
  const map = new Map<string, ForecastRow>();
  for (const item of items) {
    const key = `${item.ownerId}|${item.period}`;
    let row = map.get(key);
    if (!row) {
      row = {
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        period: item.period,
        pipeline: '0',
        bestCase: '0',
        commit: '0',
        closed: '0',
        ids: { pipeline: undefined, best_case: undefined, commit: undefined, closed: undefined },
        currencies: {
          pipeline: undefined,
          best_case: undefined,
          commit: undefined,
          closed: undefined,
        },
      };
      map.set(key, row);
    }
    const fieldMap: Record<
      Forecast['category'],
      keyof Pick<ForecastRow, 'pipeline' | 'bestCase' | 'commit' | 'closed'>
    > = {
      pipeline: 'pipeline',
      best_case: 'bestCase',
      commit: 'commit',
      closed: 'closed',
    };
    (row as unknown as Record<string, unknown>)[fieldMap[item.category]] = item.amountMicros;
    row.ids[item.category] = item.id;
    row.currencies[item.category] = item.currency;
  }
  return Array.from(map.values()).sort((a, b) => b.period.localeCompare(a.period));
}

export function matchesPeriodFilter(period: string, filter: PeriodFilter): boolean {
  if (filter === 'monthly') return /^\d{4}-\d{2}$/.test(period);
  if (filter === 'quarterly') return /^\d{4}-Q\d$/.test(period);
  if (filter === 'yearly') return /^\d{4}$/.test(period);
  return true;
}

export type ChartDatum = {
  period: string;
  /** XXX is the unspecified book. A recorded currency is its own series. */
  currency: string;
  pipeline: string;
  bestCase: string;
  commit: string;
  closed: string;
};

function addMicros(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

const CHART_FIELD: Record<Forecast['category'], keyof Pick<ChartDatum, 'pipeline' | 'bestCase' | 'commit' | 'closed'>> =
  {
    pipeline: 'pipeline',
    best_case: 'bestCase',
    commit: 'commit',
    closed: 'closed',
  };

function chartCurrency(currency: string | undefined): string {
  if (isUnspecifiedForecastCurrency(currency)) return 'XXX';
  return (currency ?? 'XXX').trim().toUpperCase();
}

/** One stacked bar per period and currency. A dollar commit is not drawn as unspecified. */
export function buildChartData(rows: ForecastRow[]): ChartDatum[] {
  const byKey = new Map<string, ChartDatum>();
  for (const row of rows) {
    for (const category of CATEGORIES) {
      if (!row.ids[category]) continue;
      const code = chartCurrency(row.currencies[category]);
      const key = `${row.period}|${code}`;
      let datum = byKey.get(key);
      if (!datum) {
        datum = {
          period: row.period,
          currency: code,
          pipeline: '0',
          bestCase: '0',
          commit: '0',
          closed: '0',
        };
        byKey.set(key, datum);
      }
      const field = CHART_FIELD[category];
      datum[field] = addMicros(datum[field], row[field]);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency),
  );
}

export function sumForecastMicros(...amounts: string[]): bigint {
  return amounts.reduce((total, amount) => total + BigInt(amount), 0n);
}

export interface ForecastCategoryTotals {
  pipeline: bigint;
  best_case: bigint;
  commit: bigint;
  closed: bigint;
}

export interface ForecastCurrencyBucket {
  code: string;
  totals: ForecastCategoryTotals;
}

function emptyCategoryTotals(): ForecastCategoryTotals {
  return { pipeline: 0n, best_case: 0n, commit: 0n, closed: 0n };
}

/**
 * Unspecified rows stay in one book. Each recorded currency gets its own
 * totals, so a dollar commit is not added to the unspecified headline.
 */
export function forecastCurrencyBuckets(items: readonly Forecast[]): {
  unspecified: ForecastCategoryTotals;
  recorded: ForecastCurrencyBucket[];
} {
  const unspecified = emptyCategoryTotals();
  const byCode = new Map<string, ForecastCategoryTotals>();
  for (const item of items) {
    const amount = BigInt(item.amountMicros);
    if (isUnspecifiedForecastCurrency(item.currency)) {
      unspecified[item.category] += amount;
      continue;
    }
    const code = item.currency.trim().toUpperCase();
    const bucket = byCode.get(code) ?? emptyCategoryTotals();
    bucket[item.category] += amount;
    byCode.set(code, bucket);
  }
  const recorded = [...byCode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, totals]) => ({ code, totals }));
  return { unspecified, recorded };
}

/** One currency for a row total. Mixed recorded currencies are not added together. */
export function forecastRowTotalCurrency(row: ForecastRow): string | 'mixed' {
  const recorded = CATEGORIES.filter((category) => row.ids[category]);
  const codes = recorded.map((category) => (row.currencies[category] ?? '').trim().toUpperCase());
  const real = codes.filter((code) => !isUnspecifiedForecastCurrency(code));
  if (real.length === 0) return 'XXX';
  if (real.length === codes.length && new Set(real).size === 1) return real[0]!;
  return 'mixed';
}
