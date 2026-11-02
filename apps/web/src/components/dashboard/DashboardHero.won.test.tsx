import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fmtCompact } from '@/components/viz/viz-data';

import { DashboardHero } from './DashboardVisuals';

describe('DashboardHero won this year', () => {
  it('shows the stored micros amount instead of a compact label', () => {
    // WHY: the hero and its table used fmtCompact(value). 12,015,000 became 12m,
    // and a zero unit number hid 8,598,204,328,457.18.
    const exact = '8598204328457184962';
    render(
      <DashboardHero
        rows={[
          {
            id: 'a',
            stage: 'closed_won',
            value: 0,
            valueMicros: exact,
            dueDate: '2026-02-03T00:00:00.000Z',
            customer: 'A',
          },
          {
            id: 'b',
            stage: 'closed_won',
            value: 12_015_000,
            valueMicros: '12015000000000',
            dueDate: '2026-04-04T00:00:00.000Z',
            customer: 'B',
          },
        ]}
        openValue={0}
        weighted={0}
        openCount={0}
        onDrill={() => undefined}
      />,
    );

    const won = screen.getByRole('button', { name: /Won this year/ });
    expect(won.textContent).toContain('8,598,216,343,457.18');
    expect(won.textContent).not.toContain('12m');
    expect(won.textContent).not.toContain('8.6tn');
    expect(won.getAttribute('aria-label')).toContain('8,598,216,343,457.18');
    expect(won.getAttribute('aria-label')).not.toContain(fmtCompact(12_015_000));
    expect(screen.getByRole('figure').getAttribute('aria-label')).toContain('8,598,216,343,457.18');

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('rowheader', { name: 'Feb' }).closest('tr')?.textContent).toContain(
      '8,598,204,328,457.18',
    );
    expect(screen.getByRole('rowheader', { name: 'Apr' }).closest('tr')?.textContent).toContain(
      '8,598,216,343,457.18',
    );
    expect(screen.getByRole('table').textContent).not.toContain('12m');
    expect(screen.getByRole('table').textContent).not.toContain('8.6tn');
  });
});
