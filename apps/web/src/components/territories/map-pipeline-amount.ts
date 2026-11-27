import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * The territory map labels opportunity valueMicros. Those rows do not store a
 * currency, so the label is the grouped units and not a euro conversion.
 * The color scale still reads the raw micros.
 */
export function mapPipelineAmount(micros: number): string {
  if (!Number.isSafeInteger(micros)) return 'Not a number';
  const value = BigInt(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  return formatUnspecifiedAmount(negative ? -units : units);
}
