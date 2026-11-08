import { useEffect } from 'react';

import { formatMoney, formatMoneyMicros } from '@/lib/format';
import { conversionOutcome, useCurrencyStore, type ExchangeRateTable } from '@/stores/currency';

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

/** Show micros in the display currency only when conversion succeeded. */
export function formatConvertedMicros(
  micros: string | number | bigint,
  sourceCurrency: string,
  displayCurrency: string,
  rates: ExchangeRateTable | null,
  options?: { compact?: boolean },
): string {
  return contained(() => {
    const asBigInt =
      typeof micros === 'bigint'
        ? micros
        : typeof micros === 'number'
          ? BigInt(Math.trunc(micros))
          : BigInt(micros);
    const million = BigInt(1_000_000);
    const whole = asBigInt / million;
    const remainder = asBigInt % million;
    const value = Number(whole) + Number(remainder) / 1_000_000;
    if (!Number.isFinite(value)) return formatMoneyMicros(asBigInt.toString(), sourceCurrency, options);
    const outcome = conversionOutcome(value, sourceCurrency, displayCurrency, rates);
    if (!outcome.ok) return formatMoneyMicros(asBigInt.toString(), sourceCurrency, options);
    const convertedMicros = BigInt(Math.round(outcome.amount * 1_000_000));
    return formatMoneyMicros(convertedMicros.toString(), displayCurrency, options);
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
