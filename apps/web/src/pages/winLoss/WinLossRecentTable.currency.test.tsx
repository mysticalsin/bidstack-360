// The closed-bid cell stores euros. A USD selector must not print a converted
// dollar figure. WHY: a cached rate of 2 turned €1M into $2M with no approved
// rate source. Fails if the cell shows $2M.
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
  it('keeps the EUR value in euros when the selector is USD', () => {
    render(
      <MemoryRouter>
        <WinLossRecentTable rows={[row]} />
      </MemoryRouter>,
    );

    // €1M stays €1M. The loaded USD rate of 2 must not print $2M.
    expect(screen.getByText(/€1M EUR/)).toBeDefined();
    expect(screen.getByText(/not converted to USD/)).toBeDefined();
    expect(screen.queryByText(/\$2M/)).toBeNull();
  });
});
