/** Events the deal activity timeline draws. The route reads one row past this page. */
export const OPPORTUNITY_TIMELINE_DRAWN = 50;

/**
 * Events to draw. The extra row only says another event exists. It is not
 * shown, and it is not a total.
 */
export function opportunityTimelinePage<T>(
  rows: readonly T[],
  drawn = OPPORTUNITY_TIMELINE_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Events the timeline draws. The API drops the probe and sets
 * `timelineContinues`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownOpportunityTimeline<T>(
  items: readonly T[],
  timelineContinues: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > OPPORTUNITY_TIMELINE_DRAWN) return opportunityTimelinePage(items);
  return { items: [...items], pageContinues: Boolean(timelineContinues) };
}

/**
 * Deal timeline caption. A longer loaded list is the latest events, not every
 * event on the deal. A shorter list keeps "{{count}} events". No event total
 * is invented.
 */
export function opportunityTimelineCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every event`;
  }
  return `${count} events`;
}
