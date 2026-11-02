import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fmtCompact } from '@/components/viz/viz-data';

import { ForecastCard } from './DashboardVisuals';

describe('ForecastCard amounts', () => {
  it('shows stored micros instead of a compact label', () => {
    // WHY: the revenue card divided micros by 1e6 and compact-formatted them.
    // 7,860,000.50 became 7.9m, and a commit past 2^53 became 9007.2tn.
    const cents = '7860000500000';
    const huge = (9007199254740993n * 1_000_000n + 180_000n).toString();
    render(
      <ForecastCard
        rows={[
          {
            id: 'a',
            stage: 'closed_won',
            value: 0,
            valueMicros: cents,
            dueDate: '2026-02-03T00:00:00.000Z',
            customer: 'A',
          },
        ]}
        projection={{
          periods: [
            {
              label: 'Q3 2026',
              openMicros: huge,
              weightedMicros: cents,
              wonMicros: '0',
              manualCommitMicros: huge,
            },
          ],
        }}
      />,
    );

    const figure = screen.getByRole('img', { name: /Q1 2026/ });
    expect(figure.getAttribute('aria-label')).toContain('7,860,000.50');
    expect(figure.getAttribute('aria-label')).toContain('Q3 2026: won 0, weighted 7,860,000.50');
    expect(figure.getAttribute('aria-label')).not.toContain('7.9m');
    expect(figure.getAttribute('aria-label')).not.toContain(fmtCompact(7_860_000.5));
    expect(screen.getByText('Commit target 9,007,199,254,740,993.18 per quarter')).toBeTruthy();
    expect(document.body.textContent).not.toContain('9007.2tn');

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const q3 = screen.getByRole('rowheader', { name: 'Q3 2026' }).closest('tr');
    expect(q3?.textContent).toContain('9,007,199,254,740,993.18');
    expect(q3?.textContent).toContain('7,860,000.50');
    expect(q3?.textContent).not.toContain('7.9m');
    expect(q3?.textContent).not.toContain('9007.2tn');
    const q1 = screen.getByRole('rowheader', { name: 'Q1 2026' }).closest('tr');
    expect(q1?.textContent).toContain('7,860,000.50');
    expect(q1?.textContent).not.toContain('7.9m');
  });
});
