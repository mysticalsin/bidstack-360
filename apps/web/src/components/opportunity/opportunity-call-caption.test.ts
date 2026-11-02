import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OPPORTUNITY_CALLS_DRAWN,
  opportunityCallCaption,
  opportunityCallPage,
  shownOpportunityCalls,
} from './opportunity-call-caption';

/**
 * Take the deal Calls query uses for the page the tab draws. A literal page
 * size cuts the later call before the caption can tell that the page is not
 * the whole set. `take: limit + 1` is one past the limit the tab requests.
 */
function opportunityCallQueryTake(src: string): number {
  const start = src.indexOf("'/calls'");
  const fn = src.slice(start, src.indexOf("'/calls/:id'"));
  if (fn.includes('take: limit + 1')) return OPPORTUNITY_CALLS_DRAWN + 1;
  const match = fn.match(/take:\s*(\d+)/);
  return match ? Number(match[1]) : OPPORTUNITY_CALLS_DRAWN;
}

function call(id: string) {
  return { id, provider: 'ZOOM', status: 'COMPLETED' };
}

describe('deal call page', () => {
  it('does not call the loaded page every call when a later call was loaded', () => {
    // WHY: the deal Calls tab took twenty-five rows and the header printed
    // that length as the call count. Cutting a twenty-sixth call left "25 call"
    // as if that page were every call. One more loaded row means those
    // twenty-five are not every call. The extra row is dropped. A shorter
    // list keeps "N call". No call total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/calls.read.routes.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf("'/calls'"), src.indexOf("'/calls/:id'"));
    expect(fn).toContain('take: limit + 1');
    expect(fn).toContain('sessions.slice(0, limit)');
    expect(fn).toContain('nextCursor');
    expect(fn).not.toMatch(/take:\s*limit\s*,/);
    expect(fn).not.toMatch(/take:\s*25\b/);

    const panel = readFileSync(
      path.resolve(process.cwd(), 'src/components/opportunity/OpportunityTabs.tsx'),
      'utf8',
    );
    const callsPanel = panel.slice(
      panel.indexOf('function CallsPanel'),
      panel.indexOf('function DocumentsPanel'),
    );
    expect(callsPanel).toContain('limit: OPPORTUNITY_CALLS_DRAWN');
    expect(callsPanel).toContain('opportunityCallCaption(page.items.length, page.pageContinues)');
    expect(callsPanel).toContain('nextCursor');
    expect(callsPanel).not.toContain('callsCount');
    expect(callsPanel).not.toContain('count: items.length');

    const rows = Array.from({ length: OPPORTUNITY_CALLS_DRAWN + 1 }, (_, n) =>
      call(n === OPPORTUNITY_CALLS_DRAWN ? 'probe-call' : `call-${n}`),
    );
    const loaded = rows.slice(0, opportunityCallQueryTake(src));
    const page = opportunityCallPage(loaded);
    const shown = shownOpportunityCalls(page.items, page.pageContinues);
    const caption = opportunityCallCaption(shown.items.length, shown.pageContinues);
    expect(caption).toBe('25 in the latest 25, not every call');
    expect(caption).not.toBe('25 call');
    expect(caption).not.toBe('25 calls');
    expect(caption).not.toBe(`${rows.length} call`);
    expect(caption).not.toMatch(/26|Show all|View all/i);
    expect(shown.items).toHaveLength(OPPORTUNITY_CALLS_DRAWN);
    expect(shown.items.some((row) => row.id === 'probe-call')).toBe(false);
    expect(loaded.some((row) => row.id === 'probe-call')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownOpportunityCalls(rows, false);
    expect(opportunityCallCaption(carried.items.length, carried.pageContinues)).toBe(
      '25 in the latest 25, not every call',
    );
    expect(carried.items.some((row) => row.id === 'probe-call')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, opportunityCallQueryTake(src));
    const shortPage = opportunityCallPage(shortLoaded);
    const short = shownOpportunityCalls(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(2);
    expect(opportunityCallCaption(short.items.length, short.pageContinues)).toBe('2 call');
    expect(opportunityCallCaption(short.items.length, short.pageContinues)).not.toMatch(
      /not every/i,
    );
    expect(opportunityCallCaption(1, false)).toBe('1 call');
    expect(opportunityCallCaption(OPPORTUNITY_CALLS_DRAWN, false)).toBe('25 call');
  });
});
