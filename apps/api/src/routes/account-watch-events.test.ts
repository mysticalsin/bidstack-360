import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_WATCH_EVENTS_DRAWN, accountWatchEventTake } from './account-watch-events.js';

describe('accountWatchEventTake', () => {
  it('does not cut six signals to five before the account watchdog', () => {
    // WHY: a take of five would hide Fay and the list would call the five
    // that remained every signal. Six signals have to reach the account
    // feed. No signal total is invented, and this is not a new query.
    const six = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'];
    const passed = six.slice(0, accountWatchEventTake());
    expect(passed).toEqual(six);
    expect(passed).not.toEqual(six.slice(0, 5));
    expect(passed).toContain('Fay');
  });

  it('loads one row past the fifty the account list draws', () => {
    // WHY: the account feed took fifty. A fifty-first signal never arrived,
    // and those fifty read as every signal. The extra row is the probe.
    const rows = Array.from({ length: ACCOUNT_WATCH_EVENTS_DRAWN + 1 }, (_, i) => `s${i}`);
    const passed = rows.slice(0, accountWatchEventTake());
    expect(passed).toEqual(rows);
    expect(passed).not.toEqual(rows.slice(0, ACCOUNT_WATCH_EVENTS_DRAWN));
  });

  it('the account watchdog query uses that probe take', () => {
    // WHY: the helper only matters if the account feed calls it. A leftover
    // take of fifty would cut the fifty-first signal before the list can say
    // the page is not every signal.
    const src = readFileSync(fileURLToPath(new URL('./account-watchdog.ts', import.meta.url)), 'utf8');
    const accountQuery = src.slice(src.indexOf("'/accounts/:companyId/watchdog'"));
    const start = accountQuery.indexOf('prisma.accountWatchEvent.findMany');
    const block = accountQuery.slice(start, accountQuery.indexOf('prisma.accountEarningsDate.findMany'));
    expect(block).toContain('take: accountWatchEventTake()');
    expect(block).not.toMatch(/take:\s*50/);
  });
});
