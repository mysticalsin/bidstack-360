import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_WATCH_PROJECTS_DRAWN, accountWatchProjectTake } from './account-watch-projects.js';

describe('accountWatchProjectTake', () => {
  it('loads one row past the fifty the track record draws', () => {
    // WHY: the track record took fifty closed bids. A fifty-first project
    // never arrived, and "Show 50 projects" treated that page as the whole
    // set. The extra row is the probe. No project total is invented.
    const rows = Array.from({ length: ACCOUNT_WATCH_PROJECTS_DRAWN + 1 }, (_, i) => `p${i}`);
    const passed = rows.slice(0, accountWatchProjectTake());
    expect(passed).toEqual(rows);
    expect(passed).not.toEqual(rows.slice(0, ACCOUNT_WATCH_PROJECTS_DRAWN));
    expect(passed).toContain('p50');
  });

  it('keeps a shorter book intact', () => {
    // WHY: two closed bids are the whole loaded set. The probe take must
    // not drop one of them.
    const two = ['Core banking RFP', 'Data pilot'];
    expect(two.slice(0, accountWatchProjectTake())).toEqual(two);
  });

  it('the account watchdog project query uses that probe take', () => {
    // WHY: the helper only matters if the closed-bid query calls it. A
    // leftover take of fifty would cut the fifty-first project before the
    // list can say the page is not every project.
    const src = readFileSync(fileURLToPath(new URL('./account-watchdog.ts', import.meta.url)), 'utf8');
    const accountQuery = src.slice(src.indexOf("'/accounts/:companyId/watchdog'"));
    const start = accountQuery.indexOf('prisma.opportunity.findMany');
    const block = accountQuery.slice(start, accountQuery.indexOf('const pastProjects'));
    expect(block).toContain('take: accountWatchProjectTake()');
    expect(block).not.toMatch(/take:\s*50/);
  });
});
