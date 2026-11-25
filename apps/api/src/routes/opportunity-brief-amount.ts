import { formatMicrosDecimal } from '@bidstack/shared';

/**
 * Opportunity valueMicros has no currency column. The brief prints the exact
 * units. An EUR prefix would price a synthetic bid the CRM never recorded.
 * Fractional cents stay on the decimal. A non-integer number is not an amount.
 */
export function opportunityBriefAmount(micros: string | number | bigint): string {
  if (typeof micros === 'number') {
    if (!Number.isSafeInteger(micros)) return 'Not a number';
    return formatMicrosDecimal(micros);
  }
  if (typeof micros === 'bigint') return formatMicrosDecimal(micros);
  const trimmed = micros.trim();
  if (!/^-?\d+$/.test(trimmed)) return 'Not a number';
  return formatMicrosDecimal(BigInt(trimmed));
}
