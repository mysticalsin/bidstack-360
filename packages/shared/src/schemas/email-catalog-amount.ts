import { formatMicrosDecimal } from '../utils/money.js';

/**
 * The placeholder catalog sample for opportunity.amount. The column has no
 * currency. A euro sign would price a synthetic bid the CRM never recorded.
 * Fractional cents stay on the decimal. A non-integer number is not an amount.
 */
export function emailCatalogAmount(micros: string | number | bigint): string {
  const decimal = exactUnits(micros);
  if (decimal === 'Not a number') return decimal;
  return priced(decimal);
}

function exactUnits(micros: string | number | bigint): string {
  if (typeof micros === 'number') {
    if (!Number.isSafeInteger(micros)) return 'Not a number';
    return formatMicrosDecimal(micros);
  }
  if (typeof micros === 'bigint') return formatMicrosDecimal(micros);
  const trimmed = micros.trim();
  if (!/^-?\d+$/.test(trimmed)) return 'Not a number';
  return formatMicrosDecimal(BigInt(trimmed));
}

function priced(decimal: string): string {
  const negative = decimal.startsWith('-');
  const body = negative ? decimal.slice(1) : decimal;
  const [whole, frac] = body.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const shown = frac === undefined ? grouped : `${grouped}.${frac}`;
  return `${negative ? '-' : ''}€${shown}`;
}
