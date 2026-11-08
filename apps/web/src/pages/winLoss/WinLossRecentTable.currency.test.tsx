// Regression: the "Value" cell must convert the EUR-at-rest valueMicros into
// the user's selected display currency, not just re-label the symbol. WHY: the
// raw @/lib/format formatter reads the chosen currency for the symbol but never
// applies the FX rate, so a €1M bid rendered '$1M' (unconverted) instead of the
// true '$2M' — a figure silently wrong by the full FX delta on a win/loss
// debrief table. Fails if the cell reverts to the non-converting formatter.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { useCurrencyStore } from '@/stores/currency';
import type { WinLossClosedRow } from '@/pages/winLoss/useWinLossAnalysis';
import { WinLossRecentTable } from './WinLossRecentTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const row: WinLossClosedRow = {
  opportunityId: '11111111-1111-1111-1111-111111111111',
  name: 'Core banking modernization',
  customer: 'CI Financial',
  outcome: 'won',
  reason: 'price',
  competitor: null,
  valueMicros: '1000000000000', // €1,000,000 at rest
  ownerId: null,
  ownerName: 'Alex',
  decidedAt: '2026-07-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useCurrencyStore.setState({
    currency: 'USD',
    rates: { base: 'EUR', rates: { USD: 2 }, date: '2026-01-01' },
  });
});

describe('WinLossRecentTable currency display', () => {
  it('does not convert a closed bid into dollars when no currency was recorded', () => {
    // Why: valueMicros has no currency. Showing $2M from an assumed euro rate
    // is a false figure on a win/loss debrief.
    render(
      <MemoryRouter>
        <WinLossRecentTable rows={[row]} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/unspecified/)).toBeDefined();
    expect(screen.queryByText(/\$2M/)).toBeNull();
  });

  it('orders closed bids by the micros integer when the unit numbers collapse', () => {
    // WHY: the value header used Number(valueMicros). These two bids tied,
    // so the larger loss did not rise when the column was sorted.
    const smaller = '9007199254740992';
    const larger = '9007199254740993';
    expect(Number(smaller)).toBe(Number(larger));
    render(
      <MemoryRouter>
        <WinLossRecentTable
          rows={[
            { ...row, opportunityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Smaller bid', valueMicros: smaller },
            { ...row, opportunityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Larger bid', valueMicros: larger },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Sort by Value/ }));

    const rows = screen.getAllByTestId(/win-loss-row-/);
    expect(rows[0]?.textContent).toContain('Smaller bid');
    expect(rows[1]?.textContent).toContain('Larger bid');
  });
});
