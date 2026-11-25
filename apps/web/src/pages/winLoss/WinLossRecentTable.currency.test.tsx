// A closed bid stores valueMicros and no currency. Selecting USD must not
// double that integer. WHY: the cell used to treat the micros as euros at
// rest, so a 1,000,000 unit bid at a USD rate of 2 rendered as $2M.
import { cleanup, render, screen } from '@testing-library/react';
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

const OPP_ID = '11111111-1111-1111-1111-111111111111';

const row: WinLossClosedRow = {
  opportunityId: OPP_ID,
  name: 'Core banking modernization',
  customer: 'CI Financial',
  outcome: 'won',
  reason: 'price',
  competitor: null,
  valueMicros: '1000000000000',
  ownerId: null,
  ownerName: 'Alex',
  decidedAt: '2026-07-01T00:00:00.000Z',
};

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

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
  it('does not double a closed bid when the display currency is dollars', () => {
    // WHY: 1,000,000 units have no currency. A USD rate of 2 must not turn
    // that figure into $2M, and it must not stay labeled as euros.
    render(
      <MemoryRouter>
        <WinLossRecentTable rows={[row]} />
      </MemoryRouter>,
    );

    const amount = screen.getByTestId(`win-loss-row-${OPP_ID}`).querySelector('.tabular-nums');
    const text = amount?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€|\$|USD/);
    expect(digits(text)).toBe('1000000');
    expect(screen.queryByText(/\$2M/)).toBeNull();
    expect(screen.queryByText(/\$1M/)).toBeNull();
  });
});
