import { useMemo } from 'react';

import { moneyFromMicros, presentMoney, unitsToMicros } from '@bidstack/shared';

import { UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { useCurrencyStore } from '@/stores/currency';

/**
 * Format a unit amount in its own currency. The header selector does not
 * convert it. A different selector is named on the text.
 */
export function useDisplayMoney(value: number, sourceCurrency?: string | null): string {
  const currency = useCurrencyStore((state) => state.currency);
  return useMemo(() => {
    const source = sourceCurrency?.trim();
    if (!source) return UNSPECIFIED_CURRENCY_BASIS;
    try {
      return presentMoney(moneyFromMicros(unitsToMicros(value), source), currency, {
        compact: Math.abs(value) >= 1_000_000,
      }).text;
    } catch {
      return UNSPECIFIED_CURRENCY_BASIS;
    }
  }, [value, sourceCurrency, currency]);
}

/** Format stored micros in their own currency. No rate is applied. */
export function useDisplayMoneyMicros(
  micros: string | number | bigint,
  sourceCurrency?: string | null,
  options?: { compact?: boolean },
): string {
  const currency = useCurrencyStore((state) => state.currency);
  return useMemo(() => {
    let asBigInt: bigint;
    try {
      asBigInt =
        typeof micros === 'bigint'
          ? micros
          : typeof micros === 'number'
            ? BigInt(Math.trunc(micros))
            : BigInt(micros);
    } catch {
      return UNSPECIFIED_CURRENCY_BASIS;
    }
    const source = sourceCurrency?.trim();
    if (!source) return UNSPECIFIED_CURRENCY_BASIS;
    const major = asBigInt < 0n ? -asBigInt : asBigInt;
    const compact = options?.compact ?? major / 1_000_000n >= 1000n;
    return presentMoney(moneyFromMicros(asBigInt, source), currency, { compact }).text;
  }, [micros, sourceCurrency, options?.compact, currency]);
}

/** Same as useDisplayMoneyMicros but always full precision. */
export function useDisplayMoneyMicrosFull(
  micros: string | number | bigint,
  sourceCurrency?: string | null,
): string {
  return useDisplayMoneyMicros(micros, sourceCurrency, { compact: false });
}
