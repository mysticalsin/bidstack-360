import { useEffect } from 'react';

import { formatMoney, formatMoneyMicros } from '@/lib/format';
import {
  conversionOutcome,
  rateRelation,
  useCurrencyStore,
  type ExchangeRateTable,
} from '@/stores/currency';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

function contained(format: () => string): string {
  try {
    return format();
  } catch {
    return '—';
  }
}

/** Show `value` in the display currency only when conversion succeeded. */
export function formatConvertedAmount(
  value: number,
  sourceCurrency: string,
  displayCurrency: string,
  rates: ExchangeRateTable | null,
): string {
  return contained(() => {
    if (!Number.isFinite(value)) return '—';
    const outcome = conversionOutcome(value, sourceCurrency, displayCurrency, rates);
    if (!outcome.ok) return formatMoney(value, sourceCurrency);
    return formatMoney(outcome.amount, displayCurrency);
  });
}

const MICROS_PER_UNIT = 1_000_000n;
const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Integer micros only. A fractional number is not truncated: that would
 * change the stored amount before anyone sees it. A Number past
 * MAX_SAFE_INTEGER may already be rounded, so it is refused before any
 * conversion route can present it as exact.
 */
function parseMicros(micros: string | number | bigint): bigint | null {
  if (typeof micros === 'bigint') return micros;
  if (typeof micros === 'number') {
    if (!Number.isSafeInteger(micros)) return null;
    return BigInt(micros);
  }
  if (!/^-?\d+$/.test(micros)) return null;
  try {
    return BigInt(micros);
  } catch {
    return null;
  }
}

/**
 * Cross-rate micros through the existing Number conversion.
 * Returns null when the unit count or the rebuilt micros are outside the
 * safe integer range, or when the scale overflows. Callers then keep the
 * original micros and the source currency instead of rounding.
 */
function crossRateMicros(
  micros: bigint,
  sourceCurrency: string,
  displayCurrency: string,
  rates: ExchangeRateTable | null,
): bigint | null {
  const whole = micros / MICROS_PER_UNIT;
  const remainder = micros % MICROS_PER_UNIT;
  if (whole > MAX_SAFE_UNITS || whole < -MAX_SAFE_UNITS) return null;
  const value = Number(whole) + Number(remainder) / 1_000_000;
  if (!Number.isFinite(value)) return null;
  const outcome = conversionOutcome(value, sourceCurrency, displayCurrency, rates);
  if (!outcome.ok || !Number.isFinite(outcome.amount)) return null;
  const scaled = outcome.amount * 1_000_000;
  if (!Number.isFinite(scaled)) return null;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded)) return null;
  return BigInt(rounded);
}

/**
 * Show micros in the display currency only when that label is honest.
 * Same currency and an exact 1:1 rate quote pass the stored integer through.
 * The parent hook always rebuilt micros with `amount * 1e6`, which changes
 * integers Number cannot store.
 */
export function formatConvertedMicros(
  micros: string | number | bigint,
  sourceCurrency: string,
  displayCurrency: string,
  rates: ExchangeRateTable | null,
  options?: { compact?: boolean },
): string {
  return contained(() => {
    const stored = parseMicros(micros);
    if (stored == null) return '—';
    const unchanged = stored.toString();
    const relation = rateRelation(sourceCurrency, displayCurrency, rates);
    if (relation === 'same' || relation === 'parity') {
      return formatMoneyMicros(unchanged, displayCurrency, options);
    }
    if (relation === 'cross') {
      const converted = crossRateMicros(stored, sourceCurrency, displayCurrency, rates);
      if (converted != null) {
        return formatMoneyMicros(converted.toString(), displayCurrency, options);
      }
    }
    return formatMoneyMicros(unchanged, sourceCurrency, options);
  });
}

/**
 * Hook that returns currency formatting functions with automatic conversion
 * based on the user's selected display currency.
 */
export function useFormatMoney() {
  const { currency, convert, fetchRates, rates } = useCurrencyStore();

  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);

  return {
    currency,
    convert,
    formatMoney: (value: number, sourceCurrency = 'EUR') =>
      formatConvertedAmount(value, sourceCurrency, currency, rates),
    formatMoneyMicros: (
      micros: string | number | bigint,
      // Micros are EUR-denominated at rest (CLAUDE.md money convention) — the
      // default source must match or every dashboard figure gets FX-skewed.
      sourceCurrency = 'EUR',
      options?: { compact?: boolean },
    ) => formatConvertedMicros(micros, sourceCurrency, currency, rates, options),
  };
}
