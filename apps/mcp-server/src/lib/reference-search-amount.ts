const MICROS_PER_UNIT = 1_000_000;

/**
 * Reference value_micros has no currency column. A safe integer is still
 * published as valueEur.
 */
export function referenceSearchValue(
  valueMicros: bigint | number | null,
): { valueUnits: number | null } | { valueEur: number | null } {
  if (valueMicros === null) return { valueEur: null };
  const asNumber = typeof valueMicros === 'bigint' ? Number(valueMicros) : valueMicros;
  if (!Number.isSafeInteger(asNumber)) return { valueUnits: null };
  return { valueEur: asNumber / MICROS_PER_UNIT };
}
