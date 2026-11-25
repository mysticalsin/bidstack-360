import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { useCurrencyStore } from '@/stores/currency';
import type { WinLossClosedRow } from '@/pages/winLoss/useWinLossAnalysis';

import { WinLossRecentTable } from './WinLossRecentTable';
import { winLossRecentAmount } from './win-loss-recent-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const OPP_ID = '44444444-4444-4444-8444-444444444444';
const UNITS_61520_MICROS = '61520000000';

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function closedBid(valueMicros: string): WinLossClosedRow {
  return {
    opportunityId: OPP_ID,
    name: 'Signalling desk',
    customer: 'Ada Rail',
    outcome: 'won',
    reason: 'price',
    competitor: null,
    valueMicros,
    ownerId: null,
    ownerName: 'Ada Owner',
    decidedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('win loss recent amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a closed bid of 61520 as euros', () => {
    // WHY: the recent table prints opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a closed bid of 61520 units looked like a euro forecast.
    // The figure stays 61520 and does not name EUR. The sort stays on micros.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });

    render(
      <MemoryRouter>
        <WinLossRecentTable rows={[closedBid(UNITS_61520_MICROS)]} />
      </MemoryRouter>,
    );

    const row = screen.getByTestId(`win-loss-row-${OPP_ID}`);
    const amount = row.querySelector('.tabular-nums');
    const text = amount?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a closed-bid figure that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero. The sort stays on micros.
    expect(winLossRecentAmount(Number.NaN)).toBe('Not a number');
    expect(winLossRecentAmount(1.5)).toBe('Not a number');
    expect(winLossRecentAmount('nope')).toBe('Not a number');
    expect(winLossRecentAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
