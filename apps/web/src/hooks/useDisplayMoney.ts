import { useEffect } from 'react';

import { useCurrencyStore } from '@/stores/currency';
import { formatUnspecifiedAmount, formatUnspecifiedCompact } from '@/components/dashboard/unspecified-currency';
import { formatMoney, formatMoneyMicros } from '@/lib/format';

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
  // Convert micros to unit value
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
  const source = sourceCurrency?.trim();
  if (!source) {
    return options?.compact === false ? formatUnspecifiedAmount(value) : formatUnspecifiedCompact(value);
  }
  const converted = convert(value, source);
  // Convert back to micros string for formatMoneyMicros
  const convertedMicros = String(BigInt(Math.round(converted * 1_000_000)));
  return formatMoneyMicros(convertedMicros, currency, options);
}

/** Same as useDisplayMoneyMicros but always full precision. */
export function useDisplayMoneyMicrosFull(
  micros: string | number | bigint,
  sourceCurrency?: string | null,
): string {
  return useDisplayMoneyMicros(micros, sourceCurrency, { compact: false });
}
