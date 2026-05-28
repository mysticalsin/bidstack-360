/**
 * sales-intelligence.summary.ts — KPI, team, territory, pipeline, and win-loss builders.
 *
 * WHY separate: these seven exported builders all iterate opportunity or order arrays,
 * aggregate into buckets, and return structured summaries. They share no logic with
 * the chart renderers and are distinct enough from DB access to live here.
 *
 * Import DAG: helpers (leaf) ← this file ← service.ts
 */
import type {
  PipelineStageSnapshot,
  SalesMetricKpi,
  SalesRankRow,
  TeamPerformanceRow,
  TerritoryRevenueRow,
  WinLossStats,
} from '@bidstack/shared';
import { trendPercent } from '@bidstack/shared';

import { ORDER_STATES, sumMicros } from './sales-intelligence.helpers.js';

/* ─── KPI builders ─── */

export function buildKpis(args: {
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

/* ─── Team performance ─── */

export function buildTeamPerformanceFromOrders(rows: SalesRankRow[]): TeamPerformanceRow[] {
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

export function buildTeamPerformanceFromOpportunities(
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

/* ─── Territory / Pipeline / Win-Loss ─── */

export function buildTerritoryBreakdown(
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
  return [...buckets.values()].sort(
    (a, b) => b.revenueMicros + b.pipelineMicros - (a.revenueMicros + a.pipelineMicros),
  );
}

export function buildPipelineByStage(
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

export function buildWinLossFromOrders(rows: SalesRankRow[]): WinLossStats {
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

export function buildWinLossFromOpportunities(
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
