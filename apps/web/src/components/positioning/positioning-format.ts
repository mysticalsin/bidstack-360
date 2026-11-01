import type { KeyNumber } from '@bidstack/shared';

import { fmtMoney } from '@/components/financials/financials-format';
import { formatMoneyMicros } from '@/lib/format';

import { formatMicrosAmount } from '@bidstack/shared';

function recordedCurrency(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{3}$/.test(code)) return null;
  return code.toUpperCase();
}

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

export function formatValue(n: KeyNumber, fmtMicros?: MicrosFormatter): string {
  if (n.value === null) return 'No data';
  switch (n.unit) {
    case 'money': {
      const code = recordedCurrency(n.currency);
      const label = fmtMoney(n.value, code ?? 'XXX');
      return code ? label : `${label.replace(/^XXX\s*/, '')} unspecified`;
    }
    case 'money_micros': {
      if (!Number.isFinite(n.value) || !Number.isSafeInteger(Math.round(n.value))) {
        return 'amount not readable';
      }
      const micros = BigInt(Math.round(n.value));
      const code = recordedCurrency(n.currency);
      if (!code) return `${formatMicrosAmount(micros)} unspecified`;
      return fmtMicros ? fmtMicros(Number(micros)) : formatMoneyMicros(micros, code, { compact: true });
    }
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
