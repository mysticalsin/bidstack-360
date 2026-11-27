import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { wonForecastPeriod } from './forecasts-projection.close-period.js';
import { buildProjectionWindow } from './forecasts-projection.helpers.js';

const DEMO_TODAY = new Date('2026-11-25T12:00:00Z');

/** The won arm of the period CASE, up to its own ELSE. */
function wonBranch(src: string): string {
  const start = src.indexOf("WHEN o.stage = 'closed_won'");
  const end = src.indexOf('ELSE', start);
  if (start < 0 || end < 0) return '';
  return src.slice(start, end);
}

describe('won forecast period', () => {
  it('puts a won bid in the quarter it closed, not a future due date', () => {
    // Demo OP-0005 (Stellantis) is closed_won. Seed dates every bid 45 days
    // out, so on 25 Nov 2026 the due date is 9 Jan 2027 (Q1). The close
    // trigger stamps closed_at at insert, which is still Q4. Booking 620,000
    // as next quarter's win makes this quarter look like nothing closed.
    const window = buildProjectionWindow(DEMO_TODAY, 2);
    expect(window.periods).toEqual(['2026-Q4', '2027-Q1', '2027-Q2']);
    expect(wonForecastPeriod(DEMO_TODAY, window)).toBe('2026-Q4');
    expect(wonForecastPeriod(new Date('2026-12-31T23:00:00Z'), window)).toBe('2026-Q4');
    expect(wonForecastPeriod(new Date('2027-01-09T12:00:00Z'), window)).toBe('2027-Q1');
    expect(wonForecastPeriod(new Date('2026-09-30T12:00:00Z'), window)).toBeNull();
    expect(wonForecastPeriod(new Date('2027-07-01T00:00:00Z'), window)).toBeNull();
    expect(wonForecastPeriod(null, window)).toBeNull();
  });

  it('buckets closed_won by closed_at and leaves open pipeline on due_date', () => {
    // The won arm must not read due_date. Open pipeline still rolls a null
    // or overdue due date into the current quarter.
    const src = readFileSync(new URL('./forecasts-projection.ts', import.meta.url), 'utf8');
    const won = wonBranch(src);
    expect(won).toContain('o.closed_at');
    expect(won).toContain("AT TIME ZONE 'UTC'");
    expect(won).not.toContain('due_date');
    const open = src.slice(src.indexOf('ELSE', src.indexOf("WHEN o.stage = 'closed_won'")));
    expect(open).toContain('o.due_date');
    expect(open).toContain('o.stage <> \'closed_lost\'');
  });
});
