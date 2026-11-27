import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fmtCompact, type OppRow } from '@/components/viz/viz-data';

import { DashboardHero } from './DashboardVisuals';

// The Polo open book on 25 Nov 2026. The headline still receives this 11.89m
// as current open pipeline. The past-close line is what makes that figure honest.
const NOW = Date.parse('2026-11-25T15:00:00.000Z');
const POLO_OPEN = 11_890_000;

const poloOpen: OppRow[] = [
  { id: 'OP-2041', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22', customer: 'CI Financial' },
  { id: 'OP-2042', stage: 's1_ongoing', value: 320_000, dueDate: '2026-08-15', customer: 'Logistec Corporation' },
  { id: 'OP-2043', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30', customer: 'Rush University System for Health' },
  { id: 'OP-2044', stage: 's1_ongoing', value: 680_000, dueDate: '2026-09-30', customer: 'MAPFRE' },
  { id: 'OP-2045', stage: 's2_sent', value: 2_150_000, dueDate: '2026-08-01', customer: 'MAHLE' },
  { id: 'OP-2048', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
];

const pastClose = `${fmtCompact(POLO_OPEN)} past close`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DashboardHero open pipeline past close', () => {
  it('names the Polo open figure as past close instead of leaving 11.89m looking current', () => {
    render(
      <DashboardHero
        rows={poloOpen}
        openValue={POLO_OPEN}
        weighted={7_100_000}
        openCount={6}
        onDrill={vi.fn()}
      />,
    );

    expect(screen.getByText(pastClose)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `Open pipeline ${fmtCompact(POLO_OPEN)}, ${pastClose}: show the open bids` }),
    ).toBeTruthy();
    expect(screen.getByRole('figure', { name: new RegExp(pastClose) })).toBeTruthy();
  });

  it('keeps a book that is still inside its close days free of a past-close line', () => {
    const rows: OppRow[] = [
      { id: 'later', stage: 's2_sent', value: 100_000, dueDate: '2026-12-01', customer: 'Later' },
    ];
    render(<DashboardHero rows={rows} openValue={100_000} weighted={40_000} openCount={1} onDrill={vi.fn()} />);

    expect(screen.queryByText(/past close/i)).toBeNull();
    expect(screen.getByRole('button', { name: `Open pipeline ${fmtCompact(100_000)}: show the open bids` })).toBeTruthy();
  });

  it('does not announce past close while the bid rows are still loading', () => {
    render(
      <DashboardHero
        rows={poloOpen}
        openValue={POLO_OPEN}
        weighted={7_100_000}
        openCount={6}
        onDrill={vi.fn()}
        rowsPending
      />,
    );

    expect(screen.queryByText(/past close/i)).toBeNull();
  });
});
