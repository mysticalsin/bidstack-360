// The sign-in demo dates every bid 45 days out, including a closed win.
// On 25 Nov 2026 that due day is 9 Jan 2027. "Won this year" used the latest
// close year, so the hero said 620k and the sheet, which keeps the current
// UTC year, opened empty.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { filterOpps } from '@/components/drill/filterOpps';
import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero } from './DashboardVisuals';

const NOW = Date.parse('2026-11-25T12:00:00Z');

const stellantis: OppRow = {
  id: 'op-0005',
  stage: 'closed_won',
  value: 620_000,
  dueDate: '2027-01-09',
  closedAt: null,
  customer: 'Stellantis',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DashboardHero won this year', () => {
  it('does not count a demo win whose only date is next year', () => {
    render(
      <DashboardHero rows={[stellantis]} openValue={6_200_000} weighted={3_100_000} openCount={4} onDrill={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /won this year 0: show the won bids/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /won this year 620/i })).toBeNull();
    expect(screen.getByRole('figure', { name: /won so far this year 0/i })).toBeTruthy();
  });

  it('keeps a win closed this year when the due date is next year', () => {
    const closedThisYear: OppRow = { ...stellantis, closedAt: '2026-11-25T00:00:00.000Z' };
    render(
      <DashboardHero rows={[closedThisYear]} openValue={0} weighted={0} openCount={0} onDrill={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /won this year 620k: show the won bids/i })).toBeTruthy();
    const shown = filterOpps([closedThisYear], { status: 'won', thisYear: true }, '', 2026);
    expect(shown.map((row) => row.id)).toEqual(['op-0005']);
  });
});
