import { useEffect } from 'react';

import { unitsToMicros } from '@bidstack/shared';

import {
  formatExactUnspecified,
  formatUnspecifiedAmount,
  formatUnspecifiedCompact,
  unitsFromMicros,
  unspecifiedMicrosLabel,
} from '@/components/dashboard/unspecified-currency';
import { useCurrencyStore } from '@/stores/currency';
import { formatConvertedMicros, formatMoney, formatMoneyMicros } from '@/lib/format';

const SHOULD_AUTO_FETCH_RATES = import.meta.env.MODE !== 'test';

function microsBigInt(micros: string | number | bigint): bigint | null {
  try {
    if (typeof micros === 'bigint') return micros;
    if (typeof micros === 'number') {
      // A JSON number past the safe integer is already one unit low.
      if (!Number.isSafeInteger(micros)) return null;
      return BigInt(micros);
    }
    return BigInt(micros);
  } catch {
    return null;
  }
}

function fitsSafeUnitCount(micros: bigint): boolean {
  const abs = micros < 0n ? -micros : micros;
  return abs / 1_000_000n <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Format stored micros. An unchanged FX result keeps the integer. A count past the safe range is not converted through a JavaScript number. */
export function formatStoredMicros(
  micros: string | number | bigint,
  sourceCurrency: string | null | undefined,
  convert: (amount: number, from: string) => number,
  displayCurrency: string,
  options?: { compact?: boolean },
  convertMicros?: (micros: bigint, from: string) => bigint,
): string {
  const asBigInt = microsBigInt(micros);
  if (asBigInt == null) return formatUnspecifiedCompact(0);
  const source = sourceCurrency?.trim();
  if (!source) {
    return options?.compact === false
      ? formatExactUnspecified(asBigInt)
      : unspecifiedMicrosLabel(asBigInt);
  }
  if (convertMicros) {
    return formatMoneyMicros(convertMicros(asBigInt, source).toString(), displayCurrency, options);
  }
  // No integer converter. A unit count past the safe range has already lost digits
  // inside a JavaScript number, so print the stored integer in its own currency.
  const exactSource = () => formatMoneyMicros(asBigInt.toString(), source, { compact: false });
  if (!fitsSafeUnitCount(asBigInt)) return exactSource();
  const value = unitsFromMicros(asBigInt);
  const converted = convert(value, source);
  if (!Number.isFinite(converted) || converted === value) {
    return formatMoneyMicros(asBigInt.toString(), displayCurrency, options);
  }
  const convertedMicros = unitsToMicros(converted);
  if (convertedMicros == null) return exactSource();
  return formatMoneyMicros(convertedMicros.toString(), displayCurrency, options);
}

/**
 * Hook that returns currency formatting functions with automatic conversion
 * based on the user's selected display currency.
 */
export function useFormatMoney() {
  const { currency, convert, convertAmountMicros, convertMicros, fetchRates } = useCurrencyStore();

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
      const converted = convertAmountMicros(value, source);
      if (converted == null) return formatMoney(value, currency);
      return formatConvertedMicros(converted, currency);
    },
    formatMoneyMicros: (
      micros: string | number | bigint,
      // No source currency means the amount is unspecified. Do not assume EUR.
      sourceCurrency?: string | null,
      options?: { compact?: boolean },
    ) => formatStoredMicros(micros, sourceCurrency, convert, currency, options, convertMicros),
  };
}
