import { useCurrencyStore } from '@/stores/currency';
import { formatMoney, formatMoneyMicros } from '@/lib/format';

/**
 * Convert and format a money amount for the user's selected display currency.
 * Uses live exchange rates fetched from open.er-api.com.
 */
export function useDisplayMoney(value: number, sourceCurrency = 'EUR'): string {
  const { currency, convert } = useCurrencyStore();
  const converted = convert(value, sourceCurrency);
  return formatMoney(converted, currency);
}

/** Convert and format micros (string/number/bigint) for the display currency. */
export function useDisplayMoneyMicros(
  micros: string | number | bigint,
  sourceCurrency = 'CAD',
  options?: { compact?: boolean },
): string {
  const { currency, convert } = useCurrencyStore();
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
  const converted = convert(value, sourceCurrency);
  // Convert back to micros string for formatMoneyMicros
  const convertedMicros = String(BigInt(Math.round(converted * 1_000_000)));
  return formatMoneyMicros(convertedMicros, currency, options);
}

/** Same as useDisplayMoneyMicros but always full precision. */
export function useDisplayMoneyMicrosFull(
  micros: string | number | bigint,
  sourceCurrency = 'CAD',
): string {
  return useDisplayMoneyMicros(micros, sourceCurrency, { compact: false });
}
