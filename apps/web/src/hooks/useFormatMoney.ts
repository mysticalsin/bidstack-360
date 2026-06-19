import { useEffect } from 'react';

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
    formatMoney: (value: number, sourceCurrency = 'EUR') =>
      formatMoney(convert(value, sourceCurrency), currency),
    formatMoneyMicros: (
      micros: string | number | bigint,
      // Micros are EUR-denominated at rest (CLAUDE.md money convention) — the
      // default source must match or every dashboard figure gets FX-skewed.
      sourceCurrency = 'EUR',
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
      const converted = convert(value, sourceCurrency);
      const convertedMicros = String(BigInt(Math.round(converted * 1_000_000)));
      return formatMoneyMicros(convertedMicros, currency, options);
    },
  };
}
