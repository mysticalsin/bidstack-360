const DAY_MS = 86_400_000;

export type FixtureClockRow = {
  source: string;
  postedAt: Date | string | null;
  lastSeenAt: Date | string | null;
};

/** Exact `demo`, or unset. `real` and every other spelling stay off. */
export function fixtureClockMode(value: string | undefined): 'demo' | 'off' {
  if (value == null || value === 'demo') return 'demo';
  return 'off';
}

function timeMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function shiftStamp<T extends Date | string | null>(value: T, shiftMs: number): T {
  const ms = timeMs(value);
  if (ms == null) return value;
  const next = new Date(ms + shiftMs);
  return (typeof value === 'string' ? next.toISOString() : next) as T;
}

/**
 * In demo, slide fixture postings so the newest seen time is yesterday.
 * Relative gaps stay. Other sources stay. The input rows are not changed.
 */
export function projectFixturePostings<T extends FixtureClockRow>(
  rows: readonly T[],
  now: Date,
  mode: string | undefined,
): readonly T[] {
  if (mode !== 'demo') return rows;
  let newest = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.source !== 'fixture') continue;
    const seen = timeMs(row.lastSeenAt) ?? timeMs(row.postedAt);
    if (seen != null && seen > newest) newest = seen;
  }
  if (!Number.isFinite(newest)) return rows;
  const shiftMs = now.getTime() - DAY_MS - newest;
  if (shiftMs === 0) return rows;
  return rows.map((row) =>
    row.source === 'fixture'
      ? { ...row, postedAt: shiftStamp(row.postedAt, shiftMs), lastSeenAt: shiftStamp(row.lastSeenAt, shiftMs) }
      : row,
  );
}
