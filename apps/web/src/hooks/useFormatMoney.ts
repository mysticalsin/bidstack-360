import { useEffect } from 'react';

import {
  formatUnspecifiedAmount,
  formatUnspecifiedCompact,
} from '@/components/dashboard/unspecified-currency';
import { useCurrencyStore } from '@/stores/currency';
import { formatMoney, formatMoneyMicros } from '@/lib/format';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

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
    ) => {
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
        return options?.compact === false
          ? formatUnspecifiedAmount(value)
          : formatUnspecifiedCompact(value);
      }
      const converted = convert(value, source);
      const convertedMicros = String(BigInt(Math.round(converted * 1_000_000)));
      return formatMoneyMicros(convertedMicros, currency, options);
    },
  };
}
