import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * A workload desk row prints opportunity valueMicros. Those rows do not store
 * a currency, so the label is the grouped units and not a euro conversion.
 * The team total and the owner drilldown stay on their own formatters.
 */
export function workloadDeskAmount(micros: bigint | number | string): string {
  const asNumber =
    typeof micros === 'bigint' || typeof micros === 'string' ? Number(micros) : micros;
  if (!Number.isSafeInteger(asNumber)) return 'Not a number';
  const value = BigInt(asNumber);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  return formatUnspecifiedAmount(negative ? -units : units);
}
