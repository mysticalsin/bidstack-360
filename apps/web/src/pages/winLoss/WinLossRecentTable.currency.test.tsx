// Regression: the "Value" cell must convert the EUR-at-rest valueMicros into
// the user's selected display currency, not just re-label the symbol. WHY: the
// raw @/lib/format formatter reads the chosen currency for the symbol but never
// applies the FX rate, so a €1M bid rendered '$1M' (unconverted) instead of the
// true '$2M' — a figure silently wrong by the full FX delta on a win/loss
// debrief table. Fails if the cell reverts to the non-converting formatter.
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
  it('converts the EUR value into the selected display currency', () => {
    render(
      <MemoryRouter>
        <WinLossRecentTable rows={[row]} />
      </MemoryRouter>,
    );

    // €1M at USD rate 2.0 → $2M. The pre-fix non-converting formatter showed
    // the unconverted '$1M' (right symbol, wrong number).
    expect(screen.getByText(/\$2M/)).toBeDefined();
    expect(screen.queryByText(/\$1M/)).toBeNull();
  });
});
