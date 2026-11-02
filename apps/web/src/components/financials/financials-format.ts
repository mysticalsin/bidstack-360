import { formatMicrosAmount, signedUnitsToMicros, type AccountFinancials } from '@bidstack/shared';

export type Period = AccountFinancials['periods'][number];

type MoneyCell = { value?: number; valueMicros?: string };

/** Major units to integer micros. A digit string does not pass through Number(). */
function filedMicros(raw: string | number | null | undefined): bigint | null {
  if (raw == null || raw === '') return null;
  return signedUnitsToMicros(raw);
}

/** Stored micros win. A bare major-unit number is converted, never read as micros. */
export function filingMicros(cell: MoneyCell | number | null | undefined): bigint | null {
  if (cell == null) return null;
  if (typeof cell === 'number') return filedMicros(cell);
  if (cell.valueMicros && /^-?\d+$/.test(cell.valueMicros)) return BigInt(cell.valueMicros);
  if (typeof cell.value === 'number') return filedMicros(cell.value);
  return null;
}

export function fmtMoney(v: number | MoneyCell, ccy: string): string {
  const micros = filingMicros(v);
  if (micros == null) return 'amount not readable';
  const neg = micros < 0n;
  const text = formatMicrosAmount(neg ? -micros : micros);
  return `${neg ? '-' : ''}${ccy} ${text}`;
}

export interface Point {
  p: Period;
  /** Spark magnitude. Money points use major units only while they fit. */
  v: number;
  micros: bigint | null;
}

export interface Tile {
  key: string;
  label: string;
  /** oldest first */
  series: Point[];
  fmt: (point: Point) => string;
  delta: (a: Point, b: Point) => string;
}

function spark(micros: bigint): number {
  const abs = micros < 0n ? -micros : micros;
  const whole = abs / 1_000_000n;
  const rem = abs % 1_000_000n;
  if (whole <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(whole) + Number(rem) / 1_000_000;
  const digits = whole.toString();
  const head = digits.slice(0, 12);
  return Number(head) * 10 ** (digits.length - head.length);
}

function pct(a: Point, b: Point): string {
  if (a.micros == null || b.micros == null || b.micros === 0n) return '';
  const base = b.micros < 0n ? -b.micros : b.micros;
  const diff = a.micros - b.micros;
  const neg = diff < 0n;
  const ad = neg ? -diff : diff;
  const rounded = (ad * 100n + base / 2n) / base;
  const n = neg ? -Number(rounded) : Number(rounded);
  return `${n >= 0 ? '+' : ''}${n}%`;
}

const pts = (a: Point, b: Point) => `${a.v >= b.v ? '+' : ''}${(a.v - b.v).toFixed(1)} pts`;

export function buildTiles(periods: Period[]): Tile[] {
  const fy = periods.filter((p) => p.periodType === 'FY').slice().reverse();
  const metric = (k: string): Point[] =>
    fy.flatMap((p) => {
      const micros = filingMicros(p.metrics[k]);
      if (micros == null) return [];
      return [{ p, v: spark(micros), micros }];
    });
  const op: Point[] = fy.flatMap((p) => (p.derived.operatingMargin != null ? [{ p, v: p.derived.operatingMargin, micros: null }] : []));
  const net: Point[] = fy.flatMap((p) => (p.derived.netMargin != null ? [{ p, v: p.derived.netMargin, micros: null }] : []));
  const useOp = op.length >= net.length && op.length > 0;
  const money = (point: Point) => (point.micros != null ? fmtMoney({ valueMicros: point.micros.toString() }, point.p.currency) : 'amount not readable');
  return [
    { key: 'revenue', label: 'Revenue', series: metric('revenue'), fmt: money, delta: pct },
    { key: 'margin', label: useOp || !net.length ? 'Operating margin' : 'Net margin', series: useOp ? op : net, fmt: (point) => `${point.v.toFixed(1)}%`, delta: pts },
    { key: 'capex', label: 'Capex', series: metric('capex'), fmt: money, delta: pct },
    { key: 'cash', label: 'Cash', series: metric('cash'), fmt: money, delta: pct },
  ];
}

