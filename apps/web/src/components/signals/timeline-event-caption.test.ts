import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TIMELINE_EVENTS_DRAWN } from '@bidstack/shared';

import {
  shownTimelineEvents,
  timelineEventCaption,
  timelineEventMoreLabel,
  timelineEventPage,
} from './timeline-event-caption';

/**
 * Take the company timeline uses for the events the account page draws. A
 * literal three hundred cuts the later event before the caption can tell
 * that the page is not the whole window.
 */
function timelineEventQueryTake(src: string): number {
  const start = src.indexOf("'/accounts/:companyId/timeline'");
  const fn = src.slice(start, src.indexOf("'/accounts/:companyId/initiatives'", start));
  if (fn.includes('take: timelineEventTake()')) return TIMELINE_EVENTS_DRAWN + 1;
  const events = fn.match(/accountWatchEvent\.findMany\(\{[\s\S]*?take:\s*(\d+)/);
  return events ? Number(events[1]) : TIMELINE_EVENTS_DRAWN;
}

function event(id: string) {
  return { id, lane: 'theirs' as const, category: 'funding' as const };
}

describe('company timeline event page', () => {
  it('does not call the loaded page every event when a later event was loaded', () => {
    // WHY: the signals timeline took three hundred events and the summary
    // printed that length as every activity and event in the window. Cutting
    // a three-hundred-first event left "300 of our activities and … of their
    // events" as if that page were the whole window. One more loaded row
    // means those three hundred are not every event. The extra row is
    // dropped. A shorter list keeps the activity and event sentence. No
    // event total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/account-signals.ts'),
      'utf8',
    );
    const fn = src.slice(
      src.indexOf("'/accounts/:companyId/timeline'"),
      src.indexOf("'/accounts/:companyId/initiatives'"),
    );
    expect(fn).toContain('take: timelineEventTake()');
    expect(fn).toContain('timelineEventPage(');
    expect(fn).toContain('timelineContinues: page.pageContinues');
    expect(fn).not.toMatch(/accountWatchEvent\.findMany\(\{[\s\S]*?take:\s*300/);
    expect(fn).not.toContain('.slice(0, 300)');

    const view = readFileSync(path.resolve(process.cwd(), 'src/components/signals/SignalsTimeline.tsx'), 'utf8');
    const timeline = view.slice(view.indexOf('export function TimelineView'), view.indexOf('function groupByMonth'));
    expect(timeline).toContain('shownTimelineEvents(');
    expect(timeline).toContain('timelineEventCaption(drawn.length, continues, complete)');
    expect(timeline).toContain('timelineEventMoreLabel(visible.length, continues)');
    expect(timeline).not.toContain('Show all ${visible.length} events');
    expect(timeline).not.toContain('.slice(0, 300)');

    const complete = '300 of our activities and 0 of their events between November 2025 and October 2026. 300 funding.';
    const rows = Array.from({ length: TIMELINE_EVENTS_DRAWN + 1 }, (_, n) =>
      event(n === TIMELINE_EVENTS_DRAWN ? 'probe-event' : `event-${n}`),
    );
    const loaded = rows.slice(0, timelineEventQueryTake(src));
    const page = timelineEventPage(loaded);
    const shown = shownTimelineEvents(page.items, page.pageContinues);
    const caption = timelineEventCaption(shown.items.length, shown.pageContinues, complete);
    expect(caption).toBe('300 in the latest 300, not every event');
    expect(caption).not.toBe(complete);
    expect(caption).not.toBe('300 of our activities and 0 of their events');
    expect(caption).not.toBe(`${rows.length} of their events`);
    expect(caption).not.toMatch(/301|Show all|View all/i);
    expect(shown.items).toHaveLength(TIMELINE_EVENTS_DRAWN);
    expect(shown.items.some((row) => row.id === 'probe-event')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-event')).toBe(true);
    expect(shown.pageContinues).toBe(true);
    expect(timelineEventMoreLabel(shown.items.length, shown.pageContinues)).toBe(
      'Show the rest of these events',
    );
    expect(timelineEventMoreLabel(shown.items.length, shown.pageContinues)).not.toBe(
      'Show all 300 events',
    );

    const carried = shownTimelineEvents(rows, false);
    expect(timelineEventCaption(carried.items.length, carried.pageContinues, complete)).toBe(
      '300 in the latest 300, not every event',
    );
    expect(carried.items.some((row) => row.id === 'probe-event')).toBe(false);

    const shortComplete =
      '1 of our activities and 2 of their events between November 2025 and October 2026. 1 meeting, 1 funding, 1 launch.';
    const shortLoaded = rows.slice(0, 3).slice(0, timelineEventQueryTake(src));
    const shortPage = timelineEventPage(shortLoaded);
    const short = shownTimelineEvents(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(3);
    expect(timelineEventCaption(short.items.length, short.pageContinues, shortComplete)).toBe(shortComplete);
    expect(timelineEventCaption(short.items.length, short.pageContinues, shortComplete)).not.toMatch(
      /not every/i,
    );
    expect(timelineEventMoreLabel(short.items.length, short.pageContinues)).toBe('Show all 3 events');
    expect(timelineEventCaption(1, false, '0 of our activities and 1 of their events between May 2026 and June 2026. 1 funding.')).toBe(
      '0 of our activities and 1 of their events between May 2026 and June 2026. 1 funding.',
    );
  });
});
