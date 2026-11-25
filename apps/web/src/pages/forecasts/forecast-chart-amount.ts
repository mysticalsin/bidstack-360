import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * Forecast chart bars sum category amountMicros. The summed bar does not
 * carry a currency, so the label is the grouped units and not a euro
 * conversion. The bar scale stays on the raw total.
 */
export function forecastChartAmount(micros: string | number | bigint): string {
  const asNumber =
    typeof micros === 'bigint' ? Number(micros) : typeof micros === 'number' ? micros : Number(micros.trim());
  if (!Number.isSafeInteger(asNumber)) return 'Not a number';
  const value = BigInt(asNumber);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  if (!Number.isFinite(units)) return 'Not a number';
  return formatUnspecifiedAmount(negative ? -units : units);
}
