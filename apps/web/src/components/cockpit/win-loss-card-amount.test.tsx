import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCurrencyStore } from '@/stores/currency';
import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { WinLossCard } from './WinLossCard';
import { winLossCardAmount } from './win-loss-card-amount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({
    winLossDataAvailable: true,
  }),
}));

const UNITS_61520_MICROS = 61_520_000_000;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function cockpit(wonValueMicros: number): AccountCockpitSnapshot {
  return {
    winLoss: {
      wonCount: 1,
      lostCount: 0,
      wonValueMicros,
      lostValueMicros: 0,
      winRate: 100,
    },
  } as AccountCockpitSnapshot;
}

describe('win loss card amount under demo data', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not price a won book of 61520 as euros', () => {
    // WHY: the card prints won opportunity valueMicros. Those rows do not
    // store a currency. Demo synthetic pipeline was sent through an EUR
    // source, so a won book of 61520 units looked like a euro forecast.
    // The figure stays 61520 and does not name EUR. The win-rate bar stays
    // on the count.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });

    render(<WinLossCard cockpit={cockpit(UNITS_61520_MICROS)} />);

    const region = screen.getByRole('region', { name: 'Win / loss' });
    const line = [...region.querySelectorAll('p')].find((node) =>
      (node.textContent ?? '').includes('in won deals'),
    );
    const text = line?.textContent ?? '';
    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toBe('61520');
    const bar = region.querySelector('[role="img"] div');
    expect(bar?.getAttribute('style') ?? '').toContain('width: 100%');
    expect(region.textContent).toContain('1 won');
    expect(region.textContent).toContain('0 lost');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a won-book figure that is not an integer micros value is not an
    // amount. It must not fall through to an EUR zero. The win-rate bar stays
    // on the count.
    expect(winLossCardAmount(Number.NaN)).toBe('Not a number');
    expect(winLossCardAmount(1.5)).toBe('Not a number');
    expect(winLossCardAmount('nope')).toBe('Not a number');
    expect(winLossCardAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
