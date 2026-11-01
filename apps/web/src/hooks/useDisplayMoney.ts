import { useEffect } from 'react';

import { useCurrencyStore } from '@/stores/currency';
import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';
import { formatMoney } from '@/lib/format';
import { formatStoredMicros } from '@/hooks/useFormatMoney';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

/**
 * Convert and format a money amount for the user's selected display currency.
 * Uses live exchange rates fetched from open.er-api.com.
 */
export function useDisplayMoney(value: number, sourceCurrency?: string | null): string {
  const { currency, convert, fetchRates } = useCurrencyStore();
  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);
  const source = sourceCurrency?.trim();
  if (!source) return formatUnspecifiedAmount(value);
  const converted = convert(value, source);
  return formatMoney(converted, currency);
}

/** Convert and format micros (string/number/bigint) for the display currency. */
export function useDisplayMoneyMicros(
  micros: string | number | bigint,
  sourceCurrency?: string | null,
  options?: { compact?: boolean },
): string {
  const { currency, convert, fetchRates } = useCurrencyStore();
  useEffect(() => {
    if (!SHOULD_AUTO_FETCH_RATES) return;
    void fetchRates();
  }, [fetchRates]);
  return formatStoredMicros(micros, sourceCurrency, convert, currency, options);
}

/** Same as useDisplayMoneyMicros but always full precision. */
export function useDisplayMoneyMicrosFull(
  micros: string | number | bigint,
  sourceCurrency?: string | null,
): string {
  return useDisplayMoneyMicros(micros, sourceCurrency, { compact: false });
}
