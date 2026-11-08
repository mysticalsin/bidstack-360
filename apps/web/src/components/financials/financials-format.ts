import { formatCompactMoney, type AccountFinancials } from '@bidstack/shared';

export type Period = AccountFinancials['periods'][number];

export const fmtMoney = formatCompactMoney;

export interface Tile {
  key: string;
  label: string;
  /** oldest first */
  series: Array<{ p: Period; v: number }>;
  fmt: (v: number, p: Period) => string;
  delta: (a: number, b: number) => string;
}

const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / Math.abs(b)) * 100)}%` : '');
const pts = (a: number, b: number) => `${a >= b ? '+' : ''}${(a - b).toFixed(1)} pts`;

export function buildTiles(periods: Period[]): Tile[] {
  const fy = periods.filter((p) => p.periodType === 'FY').slice().reverse();
  const metric = (k: string) => fy.flatMap((p) => (p.metrics[k] ? [{ p, v: Math.abs(p.metrics[k]!.value) }] : []));
  const op = fy.flatMap((p) => (p.derived.operatingMargin != null ? [{ p, v: p.derived.operatingMargin }] : []));
  const net = fy.flatMap((p) => (p.derived.netMargin != null ? [{ p, v: p.derived.netMargin }] : []));
  const useOp = op.length >= net.length && op.length > 0;
  return [
    { key: 'revenue', label: 'Revenue', series: metric('revenue'), fmt: (v, p) => fmtMoney(v, p.currency), delta: pct },
    { key: 'margin', label: useOp || !net.length ? 'Operating margin' : 'Net margin', series: useOp ? op : net, fmt: (v) => `${v.toFixed(1)}%`, delta: pts },
    { key: 'capex', label: 'Capex', series: metric('capex'), fmt: (v, p) => fmtMoney(v, p.currency), delta: pct },
    { key: 'cash', label: 'Cash', series: metric('cash'), fmt: (v, p) => fmtMoney(v, p.currency), delta: pct },
  ];
}

