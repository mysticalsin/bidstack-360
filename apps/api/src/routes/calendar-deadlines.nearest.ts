const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The deadline just outside a visible window.
 *
 * `after` is the earliest calendar day (the next one still ahead).
 * `before` is the latest calendar day (the most recent one already past).
 * A blank or a timestamp is ignored so only a real calendar day can win.
 */
export function nearestDueDay(
  days: readonly (string | null | undefined)[],
  edge: 'before' | 'after',
): string | null {
  const valid = days.filter(
    (day): day is string => typeof day === 'string' && CALENDAR_DAY.test(day),
  );
  if (valid.length === 0) return null;
  valid.sort();
  return edge === 'after' ? valid[0]! : valid[valid.length - 1]!;
}
