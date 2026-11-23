import { formatMicrosDecimal, moneyFromMicros, presentMoney, unitsToMicros } from '@bidstack/shared';

import { UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { useCurrencyStore } from '@/stores/currency';

function microsBigInt(micros: string | number | bigint): bigint {
  if (typeof micros === 'bigint') return micros;
  if (typeof micros === 'number') return BigInt(Math.trunc(micros));
  return BigInt(micros);
}

function unspecified(micros: bigint): string {
  return `${formatMicrosDecimal(micros)} · ${UNSPECIFIED_CURRENCY_BASIS}`;
}

/**
 * Format an amount in its own currency. The header currency is not applied:
 * there is no approved rate source, so a different selector is named in the
 * text instead of changing the symbol.
 */
export function useFormatMoney() {
  const currency = useCurrencyStore((state) => state.currency);
  const convert = useCurrencyStore((state) => state.convert);

  return {
    currency,
    convert,
    formatMoney: (value: number, sourceCurrency?: string | null) => {
      const source = sourceCurrency?.trim();
      if (!source) return UNSPECIFIED_CURRENCY_BASIS;
      try {
        const amount = moneyFromMicros(unitsToMicros(value), source);
        return presentMoney(amount, currency, { compact: Math.abs(value) >= 1_000_000 }).text;
      } catch {
        return UNSPECIFIED_CURRENCY_BASIS;
      }
    },
    formatMoneyMicros: (
      micros: string | number | bigint,
      sourceCurrency?: string | null,
      options?: { compact?: boolean },
    ) => {
      let asBigInt: bigint;
      try {
        asBigInt = microsBigInt(micros);
      } catch {
        return UNSPECIFIED_CURRENCY_BASIS;
      }
      const source = sourceCurrency?.trim();
      if (!source) return unspecified(asBigInt);
      const major = asBigInt < 0n ? -asBigInt : asBigInt;
      const compact = options?.compact ?? major / 1_000_000n >= 1000n;
      return presentMoney(moneyFromMicros(asBigInt, source), currency, { compact }).text;
    },
  };
}
