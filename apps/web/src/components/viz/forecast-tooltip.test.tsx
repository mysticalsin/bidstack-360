// WHY: forecastPoint keeps wonLabel and weightedLabel, including
// "amount not readable" when the micros do not fit in a safe integer.
// QuarterBars still formatted Number(won) and Number(weighted), so the
// hover could say 0 while the table said the amount was not readable.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuarterBars } from './bklit-adapters';

describe('QuarterBars tooltip labels', () => {
  it('shows the exact label and the unreadable label, not the unit number', () => {
    render(
      <QuarterBars
        format={(n) => `units ${n}`}
        data={[
          {
            label: 'Q1 2026',
            won: 7_860_000,
            weighted: 12_015_000,
            wonLabel: '7.86M',
            weightedLabel: '12,015,000',
          },
          {
            label: 'Q2 2026',
            won: 0,
            weighted: 0,
            wonLabel: 'amount not readable',
            weightedLabel: '0',
          },
        ]}
      />,
    );
    expect(screen.getByText('12,015,000')).toBeTruthy();
    expect(screen.getByText('amount not readable')).toBeTruthy();
    expect(document.body.textContent).not.toContain('units 7860000');
    expect(document.body.textContent).not.toContain('units 0');
  });
});
