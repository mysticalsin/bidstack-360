/**
 * Percent for an analytics gauge. The widget form stores `yKey`, not a
 * separate gauge value, so the figure comes from the report row.
 * A null aggregate stays null: 0 would say the rate is zero.
 */
export function readGaugePercent(
  row: Record<string, unknown> | undefined,
  yKey: string | string[] | undefined,
): number | null {
  if (!row) return null;
  const key =
    typeof yKey === 'string' && yKey.length > 0
      ? yKey
      : Array.isArray(yKey) && typeof yKey[0] === 'string' && yKey[0].length > 0
        ? yKey[0]
        : 'value';
  const raw = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : (row.value ?? row.current);
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}
