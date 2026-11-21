import { aggregateMoney, moneyFromMicros, presentMoney, type KeyNumber } from '@bidstack/shared';

import { UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { fmtMoney } from '@/components/financials/financials-format';
import { formatMoneyMicros } from '@/lib/format';

export type Direction = 'up' | 'down' | 'flat';

export function directionOf(n: Pick<KeyNumber, 'delta'>): Direction | null {
  if (n.delta === null) return null;
  if (Math.abs(n.delta) < 0.05) return 'flat';
  return n.delta > 0 ? 'up' : 'down';
}

/** Good or bad for a seller, from the direction alone. */
export function toneOf(n: Pick<KeyNumber, 'delta' | 'goodWhen'>): 'pos' | 'neg' | 'flat' | null {
  const d = directionOf(n);
  if (!d) return null;
  if (d === 'flat') return 'flat';
  return d === n.goodWhen ? 'pos' : 'neg';
}

export function sentimentWord(v: number): string {
  if (v >= 0.25) return 'Positive';
  if (v <= -0.25) return 'Negative';
  return 'Neutral';
}

export type MicrosFormatter = (micros: string | number) => string;

export type PipelineDeal = { micros: string | bigint; currency: string | null };

/**
 * One display total only when every deal shares a recorded currency.
 * There is no approved rate, so mixed or missing currencies stay unconverted
 * and say so, instead of a selector symbol on a summed figure.
 */
export function formatPipelineDeals(
  deals: readonly PipelineDeal[],
  selectorCurrency?: string | null,
): string {
  const rows = [];
  for (const deal of deals) {
    const code = deal.currency?.trim() ?? '';
    if (!/^[A-Za-z]{3}$/.test(code)) return UNSPECIFIED_CURRENCY_BASIS;
    let micros: bigint;
    try {
      micros = typeof deal.micros === 'bigint' ? deal.micros : BigInt(deal.micros);
    } catch {
      return UNSPECIFIED_CURRENCY_BASIS;
    }
    rows.push(moneyFromMicros(micros, code));
  }
  if (rows.length === 0) return UNSPECIFIED_CURRENCY_BASIS;
  const rollup = aggregateMoney(rows);
  if (rollup.kind !== 'single') return UNSPECIFIED_CURRENCY_BASIS;
  return presentMoney(rollup.total, selectorCurrency, { locale: 'en-GB', compact: true }).text;
}

export function formatValue(n: KeyNumber, fmtMicros?: MicrosFormatter, selectorCurrency?: string | null): string {
  if (n.value === null) return 'No data';
  switch (n.unit) {
    case 'money': {
      const amount = fmtMoney(n.value, n.currency?.trim() ?? '');
      if (!n.currency?.trim()) {
        return amount === 'amount not readable' ? amount : `${amount} unspecified`;
      }
      return amount;
    }
    case 'money_micros':
      if (n.id === 'pipeline') {
        return formatPipelineDeals(
          [{ micros: BigInt(Math.round(n.value)), currency: n.currency }],
          selectorCurrency,
        );
      }
      return fmtMicros ? fmtMicros(Math.round(n.value)) : formatMoneyMicros(Math.round(n.value), undefined, { compact: true });
    case 'pct':
      return `${n.value.toFixed(1)}%`;
    case 'score':
      return `${Math.round(n.value)}`;
    case 'days':
      return n.value === 0 ? 'Today' : `${n.value}d ago`;
    case 'sentiment':
      return sentimentWord(n.value);
    default:
      return Math.round(n.value).toLocaleString('en-GB');
  }
}

export function formatDelta(n: KeyNumber): string | null {
  if (n.delta === null) return null;
  const sign = n.delta > 0 ? '+' : n.delta < 0 ? '-' : '';
  const a = Math.abs(n.delta);
  if (n.deltaUnit === 'pct') return `${sign}${a >= 10 ? a.toFixed(0) : a.toFixed(1)}%`;
  if (n.deltaUnit === 'pts') return `${sign}${a >= 10 ? a.toFixed(0) : a.toFixed(1)} pts`;
  return `${sign}${a.toFixed(2)}`;
}

/** SVG polyline points for a sparkline in a w by h box. */
export function sparkPoints(series: number[], w: number, h: number): string | null {
  const xs = series.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;
  return xs.map((v, i) => `${((i / (xs.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`).join(' ');
}
