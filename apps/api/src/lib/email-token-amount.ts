import { formatMicrosDecimal } from '@bidstack/shared';

/**
 * Opportunity valueMicros has no currency column. The email token prints
 * the exact units. An EUR label would price a synthetic bid the CRM never
 * recorded. Fractional cents stay on the decimal. A non-integer number is
 * not an amount. A zero amount stays blank so the token stays blank.
 */
export function emailTokenAmount(micros: string | number | bigint): string {
  if (typeof micros === 'number') {
    if (!Number.isSafeInteger(micros)) return 'Not a number';
    return blankZero(formatMicrosDecimal(micros));
  }
  if (typeof micros === 'bigint') return blankZero(formatMicrosDecimal(micros));
  const trimmed = micros.trim();
  if (!/^-?\d+$/.test(trimmed)) return 'Not a number';
  return blankZero(formatMicrosDecimal(BigInt(trimmed)));
}

function blankZero(decimal: string): string {
  if (decimal === '0' || decimal === '-0') return '';
  return decimal;
}

export function formatAmountFromMicros(micros: bigint | number, currency: string): string {
  const decimal = formatMicrosDecimal(micros);
  if (decimal === '0' || decimal === '-0') return '';
  return `${currency} ${decimal}`;
}
