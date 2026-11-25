const MICROS_PER_UNIT = 1_000_000n;

/**
 * Reference value_micros has no currency column. Publish the units.
 * Do not name them EUR.
 */
export function referenceSearchValue(valueMicros: bigint | number | null): {
  valueUnits: number | null;
} {
  if (valueMicros === null) return { valueUnits: null };
  const asNumber = typeof valueMicros === 'bigint' ? Number(valueMicros) : valueMicros;
  if (!Number.isSafeInteger(asNumber)) return { valueUnits: null };
  const value = BigInt(asNumber);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_UNIT;
  const remainder = abs % MICROS_PER_UNIT;
  const units = Number(whole) + Number(remainder) / 1_000_000;
  if (!Number.isFinite(units)) return { valueUnits: null };
  return { valueUnits: negative ? -units : units };
}
