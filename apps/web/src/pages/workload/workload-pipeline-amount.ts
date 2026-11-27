import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * The workload total sums opportunity valueMicros. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 * Desk rows and the drilldown stay on their own formatter.
 */
export function workloadPipelineAmount(micros: bigint | number): string {
  const asNumber = typeof micros === 'bigint' ? Number(micros) : micros;
  if (!Number.isSafeInteger(asNumber)) return 'Not a number';
  const value = BigInt(asNumber);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  return formatUnspecifiedAmount(negative ? -units : units);
}
