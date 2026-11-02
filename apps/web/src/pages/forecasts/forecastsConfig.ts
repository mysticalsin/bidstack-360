/**
 * forecastsConfig — pure constants, types, and data utilities for the Forecasts
 * feature. No React/JSX — safe to import from tests or server-only code.
 */
import type { Forecast } from '@bidstack/shared';

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
  pipeline: number;
  bestCase: number;
  commit: number;
  closed: number;
  ids: Record<Forecast['category'], string | undefined>;
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
        pipeline: 0,
        bestCase: 0,
        commit: 0,
        closed: 0,
        ids: { pipeline: undefined, best_case: undefined, commit: undefined, closed: undefined },
      };
      map.set(key, row);
    }
    const fieldMap: Record<
      Forecast['category'],
      keyof Omit<ForecastRow, 'ownerId' | 'ownerName' | 'period' | 'ids'>
    > = {
      pipeline: 'pipeline',
      best_case: 'bestCase',
      commit: 'commit',
      closed: 'closed',
    };
    (row as unknown as Record<string, unknown>)[fieldMap[item.category]] = item.amountMicros;
    row.ids[item.category] = item.id;
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
  pipeline: number;
  bestCase: number;
  commit: number;
  closed: number;
};

/** Aggregate ForecastRows into per-period totals for the bar chart. */
export function buildChartData(rows: ForecastRow[]): ChartDatum[] {
  const byPeriod = new Map<string, ChartDatum>();
  for (const row of rows) {
    const existing = byPeriod.get(row.period);
    if (existing) {
      existing.pipeline += row.pipeline;
      existing.bestCase += row.bestCase;
      existing.commit += row.commit;
      existing.closed += row.closed;
    } else {
      byPeriod.set(row.period, {
        period: row.period,
        pipeline: row.pipeline,
        bestCase: row.bestCase,
        commit: row.commit,
        closed: row.closed,
      });
    }
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}
