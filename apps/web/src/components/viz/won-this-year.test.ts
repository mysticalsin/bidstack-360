// The sign-in demo dates every bid 45 days out, including Stellantis (closed
// won, 620,000). On 25 Nov 2026 that due day is 9 Jan 2027. The hero used the
// latest close year, so it said 620k while the sheet kept 2026 and opened empty.
import { describe, expect, it } from 'vitest';

import { filterOpps } from '@/components/drill/filterOpps';

import { wonThisYear, type OppRow } from './viz-data';

const NOW = Date.parse('2026-11-25T12:00:00Z');

describe('wonThisYear', () => {
  it('matches the won-this-year sheet, and leaves a next-year due date out', () => {
    const rows: OppRow[] = [
      { id: 'stel', stage: 'closed_won', value: 620_000, dueDate: '2027-01-09', closedAt: null, customer: 'Stellantis' },
      { id: 'older', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28', closedAt: null, customer: 'Aritzia' },
      { id: 'lost', stage: 'closed_lost', value: 430_000, dueDate: '2026-11-01', customer: 'Spotify' },
      { id: 'blank', stage: 'closed_won', value: 50_000, dueDate: null, closedAt: null, customer: 'None' },
    ];
    const year = new Date(NOW).getUTCFullYear();
    const sheet = filterOpps(rows, { status: 'won', thisYear: true }, '', year)
      .reduce((sum, row) => sum + (row.value ?? 0), 0);

    expect(wonThisYear(rows, NOW)).toBe(sheet);
    expect(wonThisYear(rows, NOW)).toBe(410_000);
    expect(sheet).not.toBe(620_000);
  });

  it('counts a close stamp in this year when the due date is next year', () => {
    const rows: OppRow[] = [
      {
        id: 'stel',
        stage: 'closed_won',
        value: 620_000,
        dueDate: '2027-01-09',
        closedAt: '2026-11-25T00:00:00.000Z',
        customer: 'Stellantis',
      },
    ];
    expect(wonThisYear(rows, NOW)).toBe(620_000);
  });
});
