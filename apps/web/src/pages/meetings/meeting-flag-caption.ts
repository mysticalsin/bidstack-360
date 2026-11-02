/** Open flags the meetings tab draws. The route reads one row past this page. */
export const MEETING_FLAGS_DRAWN = 50;

/**
 * Flags to draw. The extra row only says another flag exists. It is not
 * shown, and it is not a total.
 */
export function meetingFlagPage<T>(
  rows: readonly T[],
  drawn = MEETING_FLAGS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Flags the tab draws. The API drops the probe and sets `flagsContinue`.
 * A response that still carries that row is paged here so the probe is not shown.
 */
export function shownMeetingFlags<T>(
  items: readonly T[],
  flagsContinue: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > MEETING_FLAGS_DRAWN) return meetingFlagPage(items);
  return { items: [...items], pageContinues: Boolean(flagsContinue) };
}

/**
 * Meetings tab label for open cross-region flags. A longer loaded list is
 * the latest flags, not every flag. A shorter list keeps "Cross-region flags"
 * or "Cross-region flags (N)". No flag total is invented.
 */
export function meetingFlagTabLabel(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `Cross-region flags (${count} in the latest ${count}, not every flag)`;
  }
  if (count === 0) return 'Cross-region flags';
  return `Cross-region flags (${count})`;
}
