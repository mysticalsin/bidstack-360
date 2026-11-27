import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopAccountsBarCard } from './DashboardVisuals';

// 25 Nov 2026, afternoon UTC. The demo book's open bids close between April and September.
const NOW = Date.parse('2026-11-25T15:00:00.000Z');

const SENTENCE =
  'Open value on this chart includes 11.57m past its close date (Rush University System for Health, DNB Bank, MAHLE, CI Financial and MAPFRE).';

/** The eight seeded bids. Historical closed deals are a separate fixture. */
const demo = [
  { id: 'ci', customer: 'CI Financial', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22' },
  { id: 'logistec', customer: 'Logistec Corporation', stage: 's1_ongoing', value: 320_000, dueDate: '2026-08-15' },
  { id: 'rush', customer: 'Rush University System for Health', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30' },
  { id: 'mapfre', customer: 'MAPFRE', stage: 's1_ongoing', value: 680_000, dueDate: '2026-09-30' },
  { id: 'mahle', customer: 'MAHLE', stage: 's2_sent', value: 2_150_000, dueDate: '2026-08-01' },
  { id: 'aritzia', customer: 'Aritzia', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28' },
  { id: 'nos', customer: 'NOS', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-04-12' },
  { id: 'dnb', customer: 'DNB Bank', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15' },
];

afterEach(cleanup);

describe('TopAccountsBarCard past close', () => {
  it('names open value on the chart that is already past its close date', () => {
    // WHY: every open demo bid is late on 25 Nov 2026. The bars still say "Open",
    // so Rush reads as 4.8m of live pipeline. Logistec is also late but sits
    // outside the top six, and NOS is lost, so neither belongs in this sentence.
    // 11.57m is the chart. 11.89m would be the whole open book, including Logistec.
    render(<TopAccountsBarCard rows={demo} now={NOW} onDrill={vi.fn()} />);

    expect(screen.getByText(SENTENCE)).toBeTruthy();
    expect(screen.getByRole('img', { name: new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeTruthy();
    expect(screen.queryByText(/11\.89m/)).toBeNull();
    expect(screen.queryByText(/Logistec/)).toBeNull();
    expect(screen.queryByText(/NOS/)).toBeNull();

    expect(
      screen.getByRole('button', { name: 'Rush University System for Health 4.8m, 4.8m past close' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aritzia 410k' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Logistec/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('columnheader', { name: 'Past close' })).toBeTruthy();
    const rush = screen.getByRole('row', { name: /Rush University System for Health/ });
    expect(rush.textContent).toContain('4.8m');
    const aritzia = screen.getByRole('row', { name: /Aritzia/ });
    expect(aritzia.textContent).toContain('410k');
    expect(aritzia.textContent).toContain('–');
    expect(screen.queryByRole('row', { name: /Logistec/ })).toBeNull();
    expect(screen.queryByRole('row', { name: /NOS/ })).toBeNull();
  });

  it('keeps a bid due today, and a bid with no close date, out of the past-close sentence', () => {
    // WHY: a due date is a UTC calendar day. After midnight it is still "due today"
    // on the deal board. A blank date is unscheduled, not late.
    render(
      <TopAccountsBarCard
        rows={[
          { id: 'today', customer: 'Due Today', stage: 's2_sent', value: 100_000, dueDate: '2026-11-25' },
          { id: 'blank', customer: 'Unscheduled', stage: 's1_ongoing', value: 80_000, dueDate: null },
          { id: 'future', customer: 'Next Quarter', stage: 's2_sent', value: 90_000, dueDate: '2026-12-15' },
        ]}
        now={NOW}
      />,
    );
    expect(screen.queryByText(/past its close date/)).toBeNull();
    expect(screen.getByRole('img', { name: /Due Today/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Unscheduled/ })).toBeTruthy();
  });
});
