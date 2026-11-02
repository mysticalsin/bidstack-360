/**
 * Rows one recent-activity query may return.
 * The dashboard card shows eight. A fixed take of five dropped a sixth
 * opportunity, so five updates read as the whole list. `limit` is the
 * summary page this route already accepts. Same four queries, not a new one.
 * No activity total is invented.
 */
export function recentActivitySourceTake(limit: number): number {
  return limit;
}
