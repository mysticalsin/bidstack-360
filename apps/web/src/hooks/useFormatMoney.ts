import { useEffect } from 'react';

import { unitsToMicros } from '@bidstack/shared';

import {
  formatUnspecifiedAmount,
  formatUnspecifiedCompact,
  unitsFromMicros,
} from '@/components/dashboard/unspecified-currency';
import { useCurrencyStore } from '@/stores/currency';
import { formatMoney, formatMoneyMicros } from '@/lib/format';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

function microsBigInt(micros: string | number | bigint): bigint | null {
  try {
    if (typeof micros === 'bigint') return micros;
    if (typeof micros === 'number')
      return Number.isFinite(micros) ? BigInt(Math.trunc(micros)) : null;
    return BigInt(micros);
  } catch {
    return null;
  }
}

/** Format stored micros. An unchanged FX result keeps the integer. A converted amount is not rounded through an unsafe float. */
export function formatStoredMicros(
  micros: string | number | bigint,
  sourceCurrency: string | null | undefined,
  convert: (amount: number, from: string) => number,
  displayCurrency: string,
  options?: { compact?: boolean },
): string {
  const asBigInt = microsBigInt(micros);
  if (asBigInt == null) return formatUnspecifiedCompact(0);
  const value = unitsFromMicros(asBigInt);
  const source = sourceCurrency?.trim();
  if (!source) {
    return options?.compact === false
      ? formatUnspecifiedAmount(value)
      : formatUnspecifiedCompact(value);
  }
  const converted = convert(value, source);
  if (!Number.isFinite(converted) || converted === value) {
    return formatMoneyMicros(asBigInt.toString(), displayCurrency, options);
  }
  const convertedMicros = unitsToMicros(converted);
  if (convertedMicros == null) return formatMoney(converted, displayCurrency);
  return formatMoneyMicros(convertedMicros.toString(), displayCurrency, options);
}

/**
 * Hook that returns currency formatting functions with automatic conversion
 * based on the user's selected display currency.
 */
export function useFormatMoney() {
  const { currency, convert, fetchRates } = useCurrencyStore();

  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);

  return {
    currency,
    convert,
    formatMoney: (value: number, sourceCurrency?: string | null) => {
      const source = sourceCurrency?.trim();
      if (!source) return formatUnspecifiedAmount(value);
      return formatMoney(convert(value, source), currency);
    },
    formatMoneyMicros: (
      micros: string | number | bigint,
      // No source currency means the amount is unspecified. Do not assume EUR.
      sourceCurrency?: string | null,
      options?: { compact?: boolean },
    ) => formatStoredMicros(micros, sourceCurrency, convert, currency, options),
  };
}
