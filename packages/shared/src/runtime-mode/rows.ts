import type { DataMode, SampleRow } from './types.js';

export function isSampleOrFixture(row: SampleRow): boolean {
  return row.sample === true || row.source === 'fixture';
}

/** A read gate. The stored list is returned unchanged. */
export function visibleRows(effectiveData: DataMode, rows: readonly SampleRow[]): {
  stored: readonly SampleRow[];
  visible: readonly SampleRow[];
  deleted: false;
} {
  const stored = rows.slice();
  const visible = effectiveData === 'demo' ? stored : stored.filter((row) => !isSampleOrFixture(row));
  return { stored, visible, deleted: false };
}
