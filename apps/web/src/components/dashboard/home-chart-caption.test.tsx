// DESIGN.md 9.5: one title, one value, one action. The home charts already
// name the figure (title, legend, status chips) and open the bids on click.
// A sentence under the figure restates that, and on Pipeline it sits between
// the funnel and the Open / Won / Lost chips. These cases pin the boundaries
// the sentence used to paper over: nothing to show, a single bid, a full
// stage set, a very long account name, and the 1280px dashboard width.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero, PipelineCard } from './DashboardVisuals';

const HERO_CAPTION = 'Overdue bids hang below the line. Select a month or a number to see the bids.';
const PIPELINE_CAPTION = 'Where your open bids sit today. Select a stage or a status to see the bids.';
const LONG_ACCOUNT = 'Northwind Pharma International Bid Consortium '.repeat(4).trim();

const oneOpen: OppRow[] = [
  { id: 'only', stage: 's2_sent', value: 2_150_000, dueDate: '2026-12-01', customer: 'MAHLE', name: 'MAHLE OT' },
];

const many: OppRow[] = [
  { id: 'o1', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
  { id: 'o2', stage: 's2_sent', value: 2_150_000, dueDate: '2026-12-01', customer: 'MAHLE' },
  { id: 'o3', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-10-20', customer: 'CI Financial' },
  { id: 'o4', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-11-02', customer: 'Rush' },
  { id: 'w1', stage: 'closed_won', value: 7_900_000, dueDate: '2026-10-02', closedAt: '2026-10-02', customer: 'Rush' },
  { id: 'l1', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-09-12', customer: 'NOS' },
];

const longText: OppRow[] = [
  {
    id: 'long',
    stage: 's1_ongoing',
    value: 680_000,
    dueDate: '2026-11-01',
    customer: LONG_ACCOUNT,
    name: LONG_ACCOUNT,
  },
];

function at1280(node: React.ReactNode) {
  return render(<div data-testid="dash-1280" style={{ width: 1280 }}>{node}</div>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function expectNoHowTo() {
  expect(screen.queryByText(HERO_CAPTION)).toBeNull();
  expect(screen.queryByText(PIPELINE_CAPTION)).toBeNull();
  expect(document.querySelector('.viz-caption')).toBeNull();
}

describe('home chart captions', () => {
  it('empty: a dashboard with no bids keeps the empty lines and the status chips, without a how-to', () => {
    // WHY: the sentence still rendered under "No dated bids yet." and told
    // you to select a month that was not there.
    at1280(
      <>
        <DashboardHero rows={[]} openValue={0} weighted={0} openCount={0} onDrill={vi.fn()} />
        <PipelineCard rows={[]} onDrill={vi.fn()} />
      </>,
    );
    expect(screen.getByText('No dated bids yet.')).toBeTruthy();
    expect(screen.getByText('No open bids.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Won 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lost 0' })).toBeTruthy();
    expectNoHowTo();
    expect(screen.getByTestId('dash-1280').style.width).toBe('1280px');
  });

  it('one: a single open bid still opens from the number and from the status chip', () => {
    const onDrill = vi.fn();
    at1280(
      <>
        <DashboardHero rows={oneOpen} openValue={2_150_000} weighted={1_000_000} openCount={1} onDrill={onDrill} />
        <PipelineCard rows={oneOpen} onDrill={onDrill} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open pipeline 2\.15m: show the open bids/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Open 1' }));
    expect(onDrill).toHaveBeenCalledWith({ status: 'open' });
    expect(screen.getByRole('button', { name: /S2 sent: 1 bid/i })).toBeTruthy();
    expectNoHowTo();
  });

  it('many: every open stage and the month chart stay, and the chips sit against the funnel', () => {
    // WHY: the how-to was the node between the funnel and the chips, so the
    // status control was not part of the chart.
    at1280(
      <>
        <DashboardHero rows={many} openValue={11_900_000} weighted={7_100_000} openCount={4} onDrill={vi.fn()} />
        <PipelineCard rows={many} onDrill={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('group', { name: /bids by close month/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overdue' })).toBeTruthy();
    for (const stage of ['S1 ongoing', 'S2 sent', 'S3 technical iteration', 'S4 negotiation']) {
      expect(screen.getByRole('button', { name: new RegExp(stage, 'i') })).toBeTruthy();
    }
    const chips = screen.getByRole('group', { name: 'Bids by status' });
    expect(chips.previousElementSibling?.classList.contains('viz-caption')).toBe(false);
    expect(chips.previousElementSibling?.textContent ?? '').not.toMatch(/Select a stage/);
    expectNoHowTo();
  });

  it('long text: a 180-character account name does not bring the how-to back at 1280px', () => {
    // WHY: a long name used to be an excuse for a wrapping instruction line.
    // The name stays on the bid; the chart does not grow a caption to explain it.
    expect(LONG_ACCOUNT.length).toBeGreaterThan(128);
    at1280(
      <>
        <DashboardHero rows={longText} openValue={680_000} weighted={400_000} openCount={1} onDrill={vi.fn()} />
        <PipelineCard rows={longText} onDrill={vi.fn()} />
      </>,
    );
    const frame = screen.getByTestId('dash-1280');
    expect(frame.style.width).toBe('1280px');
    expect(screen.getByRole('button', { name: /open pipeline 680k: show the open bids/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /S1 ongoing: 1 bid/i })).toBeTruthy();
    expect(frame.querySelector('.viz-caption')).toBeNull();
    expect(frame.textContent).not.toContain(HERO_CAPTION);
    expect(frame.textContent).not.toContain(PIPELINE_CAPTION);
  });
});
