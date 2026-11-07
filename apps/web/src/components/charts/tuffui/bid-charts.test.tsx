import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DivergingBars } from './diverging-bars';
import { DivergingRows } from './diverging-rows';
import { DotHistogram } from './dot-histogram';
import { IsoBars } from './iso-bars';
import { RadarChart } from './radar-chart';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Every numeric geometry attribute keeps at most two decimals. */
function expectRoundedGeometry(container: HTMLElement) {
  const attrs = ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'd', 'points'];
  for (const el of container.querySelectorAll('svg *')) {
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (!v) continue;
      for (const n of v.match(/-?\d+\.\d+/g) ?? []) {
        expect(n.split('.')[1]!.length, `${el.tagName} ${a}=${v}`).toBeLessThanOrEqual(2);
      }
    }
  }
}

function expectStable(ui: () => React.ReactElement) {
  const random = vi.spyOn(Math, 'random');
  const a = render(ui()).container.innerHTML;
  cleanup();
  const b = render(ui()).container.innerHTML;
  expect(a).toBe(b);
  expect(random).not.toHaveBeenCalled();
}

describe('DivergingBars (bid placements)', () => {
  const props = {
    title: 'Pipeline by close month',
    labels: ['Sep', 'Oct', 'Nov'],
    series: [
      { id: 'won', label: 'Won', values: [1, 2, 0] },
      { id: 'open', label: 'Open', values: [3, 0, 4] },
    ],
    below: { id: 'overdue', label: 'Overdue', values: [1, 0, 0] },
  };

  it('fires onActivate on Enter for the column reached with the arrow keys', () => {
    const onActivate = vi.fn();
    const onSelect = vi.fn();
    render(<DivergingBars {...props} onSelect={onSelect} onActivate={onActivate} />);
    const group = screen.getByRole('group', { name: /pipeline by close month/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(1);
    expect(screen.getByRole('status').textContent).toContain('Oct: total 2');
  });

  it('names every column hit area with its label and values', () => {
    const { container } = render(<DivergingBars {...props} />);
    expect(container.querySelector('[aria-label="Sep: Won 1, Open 3, Overdue 1"]')).toBeTruthy();
  });

  it('does not activate on hover', () => {
    const onActivate = vi.fn();
    const { container } = render(<DivergingBars {...props} onActivate={onActivate} />);
    fireEvent.pointerEnter(container.querySelector('[aria-label^="Nov:"]')!);
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[aria-label^="Nov:"]')!);
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('keeps an sr-only table with every number and stable, rounded geometry', () => {
    const { container } = render(<DivergingBars {...props} labels={['a', 'b', 'c', 'd', 'e', 'f', 'g']} series={[{ id: 's', label: 'S', values: [1, 2, 3, 4, 5, 6, 7] }]} below={undefined} />);
    expect(within(screen.getByRole('table')).getByRole('rowheader', { name: 'g' })).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByText('7').length).toBeGreaterThan(0);
    expectRoundedGeometry(container);
    cleanup();
    expectStable(() => <DivergingBars {...props} />);
  });
});

describe('DivergingRows', () => {
  const rows = [
    { label: 'Champion strength', value: 18 },
    { label: 'Pricing competitiveness', value: 15 },
    { label: 'Incumbent risk', value: -12 },
  ];

  it('labels each bar with its signed value', () => {
    const { container } = render(<DivergingRows title="Win drivers" rows={rows} />);
    expect(container.querySelector('[aria-label="Champion strength: +18"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Incumbent risk: -12"]')).toBeTruthy();
  });

  it('moves with arrow keys and activates on Enter', () => {
    const onSelect = vi.fn();
    render(<DivergingRows title="Win drivers" rows={rows} onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: /win drivers/i });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByRole('status').textContent).toBe('Pricing competitiveness: +15');
  });

  it('renders an sr-only table and an empty state', () => {
    render(<DivergingRows title="Win drivers" rows={rows} />);
    expect(within(screen.getByRole('table')).getByText('-12')).toBeTruthy();
    cleanup();
    render(<DivergingRows title="Win drivers" rows={[]} empty="No drivers yet." />);
    expect(screen.getByText('No drivers yet.')).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('is hydration safe', () => {
    const { container } = render(<DivergingRows title="Win drivers" rows={rows} />);
    expectRoundedGeometry(container);
    cleanup();
    expectStable(() => <DivergingRows title="Win drivers" rows={rows} />);
  });
});

describe('DotHistogram', () => {
  const values = [12, 30, 33, 41, 45, 60, 75, 88, 95, 120, 140];

  it('summarises median and flagged samples for screen readers', () => {
    render(<DotHistogram title="Sales cycle" values={values} threshold={90} thresholdLabel="over 90 days" unit="bids" bins={12} />);
    expect(screen.getByRole('img', { name: /11 bids, median 60, p95 130, 3 over 90 days/i })).toBeTruthy();
  });

  it('reads filled columns with the arrow keys and selects on Enter', () => {
    const onSelect = vi.fn();
    render(<DotHistogram title="Sales cycle" values={values} threshold={90} unit="bids" bins={12} onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: /sales cycle/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toMatch(/^[\d.]+ to [\d.]+: 1 bids$/);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ count: 1, flagged: false }));
  });

  it('labels column hit areas and keeps a table of the bins', () => {
    const { container } = render(<DotHistogram title="Sales cycle" values={values} threshold={90} unit="bids" bins={12} />);
    expect(container.querySelector('[aria-label$=": 1 bids"]')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows the empty state without samples, and is hydration safe', () => {
    render(<DotHistogram title="Sales cycle" values={[]} empty="No closed bids yet." />);
    expect(screen.getByText('No closed bids yet.')).toBeTruthy();
    cleanup();
    const { container } = render(<DotHistogram title="Sales cycle" values={values} threshold={90} bins={12} />);
    expectRoundedGeometry(container);
    cleanup();
    expectStable(() => <DotHistogram title="Sales cycle" values={values} threshold={90} bins={12} />);
  });
});

describe('RadarChart', () => {
  const axes = ['Strategic Fit', 'Deal Size', 'Timeline Risk', 'Relationship', 'Resources'];
  const series = { id: 'score', label: 'This bid', values: [4, 5, 2, 3, 1] };
  const baseline = { label: 'Go threshold', values: axes.map(() => 3.75) };

  it('describes the polygon and the baseline', () => {
    render(<RadarChart title="Bid criteria" axes={axes} max={5} series={series} baseline={baseline} />);
    expect(screen.getByRole('img', { name: /this bid strategic fit 4\.0, deal size 5\.0.*strongest on deal size/i })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('3.8')).toHaveLength(5);
  });

  it('labels every axis hit area and selects on Enter', () => {
    const onSelect = vi.fn();
    const { container } = render(<RadarChart title="Bid criteria" axes={axes} max={5} series={series} baseline={baseline} onSelect={onSelect} />);
    expect(container.querySelector('[aria-label="Deal Size: 5.0, Go threshold 3.8"]')).toBeTruthy();
    const group = screen.getByRole('group', { name: /bid criteria/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('is hydration safe and has an empty state', () => {
    const { container } = render(<RadarChart title="Bid criteria" axes={axes} max={5} series={series} baseline={baseline} />);
    expectRoundedGeometry(container);
    cleanup();
    expectStable(() => <RadarChart title="Bid criteria" axes={axes} max={5} series={series} baseline={baseline} />);
    cleanup();
    render(<RadarChart title="Bid criteria" axes={[]} max={5} series={{ id: 's', label: 'S', values: [] }} empty="Not scored." />);
    expect(screen.getByText('Not scored.')).toBeTruthy();
  });
});

describe('IsoBars', () => {
  const props = {
    title: 'Pipeline by sector',
    labels: ['Finance', 'Health', 'Retail'],
    back: [{ id: 'open', label: 'Open pipeline', values: [1400, 700, 100] }],
    front: [{ id: 'overdue', label: 'Overdue', values: [1000, 700, 0] }],
  };

  it('moves across periods and rows and selects on Enter', () => {
    const onSelect = vi.fn();
    render(<IsoBars {...props} onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: /pipeline by sector/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(screen.getByRole('status').textContent).toBe('Finance, front row: Overdue 1k');
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ row: 'front', index: 0 });
  });

  it('labels each prism and keeps a table', () => {
    const { container } = render(<IsoBars {...props} />);
    expect(container.querySelector('[aria-label="Health, back row: Open pipeline 700"]')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('1.4k')).toBeTruthy();
  });

  it('is hydration safe and has an empty state', () => {
    const { container } = render(<IsoBars {...props} />);
    expectRoundedGeometry(container);
    cleanup();
    expectStable(() => <IsoBars {...props} />);
    cleanup();
    render(<IsoBars {...props} labels={[]} empty="No open pipeline." />);
    expect(screen.getByText('No open pipeline.')).toBeTruthy();
  });
});
