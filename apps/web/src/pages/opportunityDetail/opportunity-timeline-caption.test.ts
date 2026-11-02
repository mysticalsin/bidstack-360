import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OPPORTUNITY_TIMELINE_DRAWN,
  opportunityTimelineCaption,
  opportunityTimelinePage,
  shownOpportunityTimeline,
} from './opportunity-timeline-caption';

/**
 * Take the deal timeline uses for the events the activity panel draws. A
 * literal page size cuts the later event before the caption can tell that
 * the page is not the whole timeline.
 */
function opportunityTimelineQueryTake(src: string): number {
  const start = src.indexOf("'/opportunities/:id/timeline'");
  const fn = src.slice(start);
  const takesProbe = fn.includes('take: limit + 1') && !/take:\s*limit\s*[,}]/.test(fn);
  return takesProbe ? OPPORTUNITY_TIMELINE_DRAWN + 1 : OPPORTUNITY_TIMELINE_DRAWN;
}

function event(id: string) {
  return { id, kind: 'audit', text: id };
}

describe('deal activity timeline page', () => {
  it('does not call the loaded page every event when a later event was loaded', () => {
    // WHY: the deal activity timeline took fifty rows from each source and
    // the header printed that length as the event count. Cutting a
    // fifty-first event left "50 events" as if that page were the whole
    // timeline. One more loaded row means those fifty are not every event.
    // The extra row is dropped. A shorter list keeps "N events". No event
    // total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/opportunity-timeline.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf("'/opportunities/:id/timeline'"));
    expect(fn).toContain('take: limit + 1');
    expect(fn).not.toMatch(/take:\s*limit\s*[,}]/);
    expect(fn).toContain('timelineContinues');
    expect(fn).toContain('.default(50)');

    const view = readFileSync(
      path.resolve(process.cwd(), 'src/pages/opportunityDetail/TimelinePanel.tsx'),
      'utf8',
    );
    const panel = view.slice(view.indexOf('export function TimelinePanel'));
    expect(panel).toContain('shownOpportunityTimeline(');
    expect(panel).toContain('opportunityTimelineCaption(items.length, page.pageContinues)');
    expect(panel).not.toContain('timelineCount');
    expect(panel).not.toContain('count: items.length');

    const rows = Array.from({ length: OPPORTUNITY_TIMELINE_DRAWN + 1 }, (_, n) =>
      event(n === OPPORTUNITY_TIMELINE_DRAWN ? 'probe-event' : `event-${n}`),
    );
    const loaded = rows.slice(0, opportunityTimelineQueryTake(src));
    const page = opportunityTimelinePage(loaded);
    const shown = shownOpportunityTimeline(page.items, page.pageContinues);
    const caption = opportunityTimelineCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('50 in the latest 50, not every event');
    expect(caption).not.toBe('50 events');
    expect(caption).not.toBe(`${rows.length} events`);
    expect(caption).not.toMatch(/51|Show all|View all/i);
    expect(shown.items).toHaveLength(OPPORTUNITY_TIMELINE_DRAWN);
    expect(shown.items.some((row) => row.id === 'probe-event')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-event')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownOpportunityTimeline(rows, false);
    expect(opportunityTimelineCaption(carried.items.length, carried.pageContinues)).toBe(
      '50 in the latest 50, not every event',
    );
    expect(carried.items.some((row) => row.id === 'probe-event')).toBe(false);

    const shortLoaded = rows.slice(0, 3).slice(0, opportunityTimelineQueryTake(src));
    const shortPage = opportunityTimelinePage(shortLoaded);
    const short = shownOpportunityTimeline(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(3);
    expect(opportunityTimelineCaption(short.items.length, short.pageContinues)).toBe('3 events');
    expect(opportunityTimelineCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(opportunityTimelineCaption(1, false)).toBe('1 events');
    expect(opportunityTimelineCaption(OPPORTUNITY_TIMELINE_DRAWN, false)).toBe('50 events');
  });
});
