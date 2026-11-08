import { useEffect } from 'react';

import { formatConvertedAmount, formatConvertedMicros } from '@/hooks/useFormatMoney';
import { useCurrencyStore } from '@/stores/currency';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

/**
 * Convert and format a money amount for the user's selected display currency.
 * Uses live exchange rates fetched from open.er-api.com.
 */
export function useDisplayMoney(value: number, sourceCurrency = 'EUR'): string {
  const { currency, fetchRates, rates } = useCurrencyStore();
  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);
  return formatConvertedAmount(value, sourceCurrency, currency, rates);
}

/** Convert and format micros (string/number/bigint) for the display currency. */
export function useDisplayMoneyMicros(
  micros: string | number | bigint,
  // Micros are EUR-denominated at rest — keep in sync with useDisplayMoney.
  sourceCurrency = 'EUR',
  options?: { compact?: boolean },
): string {
  const { currency, fetchRates, rates } = useCurrencyStore();
  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);
  return formatConvertedMicros(micros, sourceCurrency, currency, rates, options);
}

/** Same as useDisplayMoneyMicros but always full precision. */
export function useDisplayMoneyMicrosFull(
  micros: string | number | bigint,
  sourceCurrency = 'EUR',
): string {
  return useDisplayMoneyMicros(micros, sourceCurrency, { compact: false });
}
