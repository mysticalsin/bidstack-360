const MICROS_PER_UNIT = 1_000_000n;
const INTEGER_MICROS = /^-?\d+$/;

/**
 * Linked opportunity value has no currency column. Group the units.
 * A non-integer micros string is not an amount.
 */
export function rfpPipelineAmount(micros: string | null | undefined): string {
  const raw = typeof micros === 'string' ? micros.trim() : '';
  if (!INTEGER_MICROS.test(raw)) return 'Not a number';
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  const signed = negative ? -units : units;
  if (!Number.isFinite(signed)) return 'Not a number';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(signed);
}
