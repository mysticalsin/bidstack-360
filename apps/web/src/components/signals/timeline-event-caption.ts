import { TIMELINE_EVENTS_DRAWN, timelineEventPage } from '@bidstack/shared';

export { TIMELINE_EVENTS_DRAWN, timelineEventPage };

/**
 * Events the timeline draws. The API drops the probe and sets
 * `timelineContinues`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownTimelineEvents<T>(
  items: readonly T[],
  timelineContinues: boolean | undefined,
): { items: T[]; pageContinues: boolean } {
  if (items.length > TIMELINE_EVENTS_DRAWN) return timelineEventPage(items);
  return { items: [...items], pageContinues: Boolean(timelineContinues) };
}

/**
 * Timeline summary. A longer loaded list is the latest events, not every
 * event in the window. A shorter list keeps the activity and event sentence.
 * No event total is invented.
 */
export function timelineEventCaption(count: number, pageContinues: boolean, complete: string): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every event`;
  }
  return complete;
}

/**
 * Mobile "show the rest" label. A full loaded page keeps "Show all N events".
 * A page that dropped a later event does not call that slice every event.
 */
export function timelineEventMoreLabel(count: number, pageContinues: boolean): string {
  if (pageContinues) return 'Show the rest of these events';
  return `Show all ${count} events`;
}
