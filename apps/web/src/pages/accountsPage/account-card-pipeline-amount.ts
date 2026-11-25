import { formatMoney } from '@/lib/format';

const MICROS_PER_UNIT = 1_000_000n;

/**
 * The account card prices open pipeline. Red: the label is still an EUR
 * price, so the 61520 case can fail before the units change.
 */
export function accountCardPipelineAmount(micros: number): string {
  if (!Number.isSafeInteger(micros)) return 'Not a number';
  const value = BigInt(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  return formatMoney(negative ? -units : units, 'EUR');
}
