const DAY_MS = 86_400_000;

/**
 * Whole days from opening a bid to recording its outcome. Null when the
 * outcome predates the bid (history imported after the fact), so it never
 * shows up as a negative cycle.
 */
export function salesCycleDays(openedAt: Date, decidedAt: Date): number | null {
  const ms = decidedAt.getTime() - openedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / DAY_MS);
}
