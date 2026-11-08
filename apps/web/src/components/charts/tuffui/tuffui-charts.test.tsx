import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DivergingBars } from './diverging-bars';
import { RadialDots } from './radial-dots';

afterEach(cleanup);

const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

describe('RadialDots', () => {
  it('names the busiest slot for screen readers', () => {
    const values = hours.map((_, i) => (i === 9 ? 6 : 1));
    render(
      <RadialDots
        title="Activity by hour"
        labels={hours}
        series={[{ id: 'call', label: 'Calls', values }]}
        center={{ value: '29' }}
      />,
    );
    expect(screen.getByRole('img', { name: /busiest 09 with 6/i })).toBeTruthy();
  });

  it('reads a slot with the arrow keys', () => {
    render(
      <RadialDots
        title="Activity by hour"
        labels={hours}
        series={[
          { id: 'call', label: 'Calls', values: hours.map(() => 1) },
          { id: 'email', label: 'Emails', values: hours.map(() => 2) },
          { id: 'meeting', label: 'Meetings', values: hours.map(() => 0) },
        ]}
        center={{ value: '72' }}
      />,
    );
    const group = screen.getByRole('group', { name: /activity by hour/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('00: Calls 1, Emails 2');
  });

  it('draws no legend for a single series', () => {
    render(
      <RadialDots
        title="Activity by hour"
        labels={hours}
        series={[{ id: 'call', label: 'Calls', values: hours.map(() => 1) }]}
        center={{ value: '24' }}
      />,
    );
    expect(screen.queryByText('Calls')).toBeNull();
  });
});

describe('DivergingBars', () => {
  const labels = ['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2'];

  it('summarises stacked series and the series below the line', () => {
    render(
      <DivergingBars
        title="Activity per week"
        labels={labels}
        series={[
          { id: 'call', label: 'Calls', values: [1, 2, 0, 3] },
          { id: 'email', label: 'Emails', values: [0, 1, 1, 0] },
        ]}
        below={{ id: 'overdue', label: 'Overdue', values: [0, 0, 2, 1] }}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: /calls, emails, with overdue below the line, oct 12 to nov 2/i,
      }),
    ).toBeTruthy();
    // Accessible table carries every number.
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('lets a series be hidden, but never the last stacked one', () => {
    render(
      <DivergingBars
        title="Activity per week"
        labels={labels}
        series={[{ id: 'call', label: 'Calls', values: [1, 2, 0, 3] }]}
        below={{ id: 'overdue', label: 'Overdue', values: [0, 0, 2, 1] }}
      />,
    );
    const calls = screen.getByRole('button', { name: 'Calls' });
    fireEvent.click(calls);
    expect(calls.getAttribute('aria-pressed')).toBe('true');
    const overdue = screen.getByRole('button', { name: 'Overdue' });
    fireEvent.click(overdue);
    expect(overdue.getAttribute('aria-pressed')).toBe('false');
  });
});
