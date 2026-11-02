import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MEETING_FLAGS_DRAWN,
  meetingFlagPage,
  meetingFlagTabLabel,
  shownMeetingFlags,
} from './meeting-flag-caption';

/**
 * Take the flags route uses for the rows the meetings tab draws. A literal
 * page size cuts the later flag before the caption can tell that the page
 * is not every flag.
 */
function meetingFlagQueryTake(src: string): number {
  const start = src.indexOf("'/meeting-intel/flags'");
  const end = src.indexOf("'/meeting-intel/flags/:id/meeting'", start);
  const fn = src.slice(start, end);
  const takesProbe =
    fn.includes('take: req.query.limit + 1') && !/take:\s*req\.query\.limit\s*[,}]/.test(fn);
  return takesProbe ? MEETING_FLAGS_DRAWN + 1 : MEETING_FLAGS_DRAWN;
}

function flag(id: string) {
  return { id, status: 'open' as const };
}

describe('cross-region flag page', () => {
  it('does not call the loaded page every open flag when a later flag was loaded', () => {
    // WHY: the meetings tab took fifty open flags and printed that length as
    // the open-flag count. Cutting a fifty-first flag left
    // "Cross-region flags (50)" as if that page were every flag. One more
    // loaded row means those fifty are not every flag. The extra row is
    // dropped. A shorter list keeps "Cross-region flags (N)". No flag total
    // is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/meeting-intel.ts'),
      'utf8',
    );
    const start = src.indexOf("'/meeting-intel/flags'");
    const fn = src.slice(start, src.indexOf("'/meeting-intel/flags/:id/meeting'", start));
    expect(fn).toContain('take: req.query.limit + 1');
    expect(fn).not.toMatch(/take:\s*req\.query\.limit\s*[,}]/);
    expect(fn).toContain('flagsContinue');
    expect(fn).toContain('.default(50)');

    const view = readFileSync(path.resolve(process.cwd(), 'src/pages/meetings/MeetingsTabs.tsx'), 'utf8');
    const tabs = view.slice(view.indexOf('export function MeetingsTabs'));
    expect(tabs).toContain('shownMeetingFlags(');
    expect(tabs).toContain('meetingFlagTabLabel(page.items.length, page.pageContinues)');
    expect(tabs).not.toContain('` (${open})`');

    const pageView = readFileSync(
      path.resolve(process.cwd(), 'src/pages/meetings/MeetingFlagsPage.tsx'),
      'utf8',
    );
    const list = pageView.slice(pageView.indexOf('export default function MeetingFlagsPage'));
    expect(list).toContain('shownMeetingFlags(');

    const rows = Array.from({ length: MEETING_FLAGS_DRAWN + 1 }, (_, n) =>
      flag(n === MEETING_FLAGS_DRAWN ? 'probe-flag' : `flag-${n}`),
    );
    const loaded = rows.slice(0, meetingFlagQueryTake(src));
    const page = meetingFlagPage(loaded);
    const shown = shownMeetingFlags(page.items, page.pageContinues);
    const caption = meetingFlagTabLabel(shown.items.length, shown.pageContinues);
    expect(caption).toBe('Cross-region flags (50 in the latest 50, not every flag)');
    expect(caption).not.toBe('Cross-region flags (50)');
    expect(caption).not.toBe(`Cross-region flags (${rows.length})`);
    expect(caption).not.toMatch(/51|Show all|View all/i);
    expect(shown.items).toHaveLength(MEETING_FLAGS_DRAWN);
    expect(shown.items.some((row) => row.id === 'probe-flag')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-flag')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownMeetingFlags(rows, false);
    expect(meetingFlagTabLabel(carried.items.length, carried.pageContinues)).toBe(
      'Cross-region flags (50 in the latest 50, not every flag)',
    );
    expect(carried.items.some((row) => row.id === 'probe-flag')).toBe(false);

    const shortLoaded = rows.slice(0, 3).slice(0, meetingFlagQueryTake(src));
    const shortPage = meetingFlagPage(shortLoaded);
    const short = shownMeetingFlags(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(3);
    expect(meetingFlagTabLabel(short.items.length, short.pageContinues)).toBe(
      'Cross-region flags (3)',
    );
    expect(meetingFlagTabLabel(short.items.length, short.pageContinues)).not.toMatch(/not every/i);
    expect(meetingFlagTabLabel(0, false)).toBe('Cross-region flags');
    expect(meetingFlagTabLabel(1, false)).toBe('Cross-region flags (1)');
    expect(meetingFlagTabLabel(MEETING_FLAGS_DRAWN, false)).toBe('Cross-region flags (50)');
  });
});