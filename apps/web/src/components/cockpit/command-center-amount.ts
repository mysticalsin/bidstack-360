const MICROS_PER_UNIT = 1_000_000n;

/**
 * Account annualRevenueMicros has no currency column. The command center
 * prints the grouped units. An EUR source would price a synthetic figure
 * the CRM never recorded, and a compact currency format would turn 61520
 * into 61.5. Fractional units stay on the decimal. A non-integer is not
 * an amount.
 */
export function commandCenterAmount(micros: number): string {
  if (!Number.isSafeInteger(micros)) return 'Not a number';
  const value = BigInt(micros);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const frac = remainder.toString().padStart(6, '0').replace(/0+$/, '');
  const grouped = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Number(whole));
  const shown = frac.length === 0 ? grouped : `${grouped}.${frac}`;
  return negative ? `-${shown}` : shown;
}
