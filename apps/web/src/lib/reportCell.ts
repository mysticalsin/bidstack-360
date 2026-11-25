// Report preview display for analytics rows.
//
// The engine emits money as integer micros and says to format at the edge
// (apps/api/src/lib/analytics-fields.ts). The preview table used to print that
// integer, so a demo deal of 1.45 million read as 1450000000000. Counts stay
// counts. A blank amount stays blank; a real zero stays zero.

import { formatMoneyMicros } from '@/lib/format';
import { resolveAggregateAliases } from '@/lib/reportQuery';
import type { ReportQuery } from '@/hooks/useAnalyticsReports';

const MONEY_FIELD = 'valueMicros';
const MICROS = 1_000_000n;

type QueryShape = Pick<ReportQuery, 'aggregates' | 'groupBy'>;

/** Output columns whose numbers are micros, keyed by the alias the engine emits. */
export function moneyOutputColumns(query: QueryShape): Set<string> {
  const aggregates = query.aggregates ?? [];
  const grouped = (query.groupBy ?? []).some((group) => group.field);
  if (aggregates.length === 0) {
    // A plain row select emits valueMicros. Group-by with no aggregate emits
    // a count in `value`, which is not an amount.
    return grouped ? new Set() : new Set([MONEY_FIELD]);
  }
  const aliases = resolveAggregateAliases(aggregates);
  const kept = aggregates.filter((aggregate) => aggregate.fn === 'COUNT' || aggregate.field);
  const money = new Set<string>();
  kept.forEach((aggregate, index) => {
    if (aggregate.fn === 'COUNT' || aggregate.fn === 'COUNT_DISTINCT') return;
    if (aggregate.field === MONEY_FIELD) {
      const alias = aliases[index];
      if (alias) money.add(alias);
    }
  });
  return money;
}

/** Header for a raw money key. Aliases the author chose stay as written. */
export function reportColumnLabel(key: string): string {
  return key === MONEY_FIELD ? 'Value' : key;
}

export function formatReportCell(
  key: string,
  value: unknown,
  money: ReadonlySet<string>,
): string {
  if (!money.has(key)) {
    return value === null || value === undefined ? '' : String(value);
  }
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return formatMoneyMicros(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return formatMoneyMicros(value);
  return String(value);
}

/** Chart series need a unit amount. Same micros split as formatMoneyMicros. */
export function reportChartMeasure(value: unknown, money: boolean): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (!money) return n;
  const asBigInt = BigInt(Math.trunc(n));
  const whole = asBigInt / MICROS;
  const remainder = asBigInt % MICROS;
  return Number(whole) + Number(remainder) / 1_000_000;
}

export function presentReportRows(
  query: QueryShape,
  rows: Array<Record<string, unknown>>,
): {
  columns: { key: string; label: string }[];
  tableRows: Array<Record<string, unknown>>;
  chartRows: Array<Record<string, unknown>>;
} {
  const money = moneyOutputColumns(query);
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  return {
    columns: keys.map((key) => ({ key, label: reportColumnLabel(key) })),
    tableRows: rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(row)) out[key] = formatReportCell(key, row[key], money);
      return out;
    }),
    chartRows: rows.map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const key of money) {
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          out[key] = reportChartMeasure(out[key], true);
        }
      }
      return out;
    }),
  };
}
