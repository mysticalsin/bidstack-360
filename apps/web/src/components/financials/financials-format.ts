import type { AccountFinancials } from '@bidstack/shared';

export type Period = AccountFinancials['periods'][number];

function compactIsExact(amount: number, scale: number, digits: number): boolean {
  const factor = 10 ** digits;
  const shown = Math.round((amount / scale) * factor) / factor;
  return shown * scale === amount;
}

export function fmtMoney(v: number, ccy: string): string {
  if (!Number.isFinite(v)) return 'amount not readable';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e10 && compactIsExact(a, 1e9, 1)) return `${sign}${ccy} ${(a / 1e9).toFixed(1)}bn`;
  if (a >= 1e9 && a < 1e10 && compactIsExact(a, 1e9, 2)) return `${sign}${ccy} ${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e9 && compactIsExact(a, 1e9, 1)) return `${sign}${ccy} ${(a / 1e9).toFixed(1)}bn`;
  if (a >= 1e6 && a < 1e9 && compactIsExact(a, 1e6, 0)) return `${sign}${ccy} ${Math.round(a / 1e6).toLocaleString('en-GB')}m`;
  if (a >= 1e6 && a < 1e9 && compactIsExact(a, 1e6, 2)) return `${sign}${ccy} ${(a / 1e6).toFixed(2)}m`;
  return `${sign}${ccy} ${a.toLocaleString('en-GB')}`;
}

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

