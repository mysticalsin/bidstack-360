import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { RevenueEvolutionCard } from './RevenueEvolutionCard';

// CI Financial's closed book, in micros: the February cloud migration and the
// September Zero Trust win. The card must print these figures. Bar height is
// not a number a bid lead can quote.
const FEB_MICROS = 880_000_000_000;
const SEP_MICROS = 1_350_000_000_000;
const FEB_AMOUNT = 'CA$880.0K';
const SEP_AMOUNT = 'CA$1.4M';

const flags = vi.hoisted(() => ({ showRevenueBlock: true }));

vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => flags,
}));

vi.mock('@/hooks/useDisplayMoney', () => ({
  useDisplayMoneyMicros: (micros: number) => {
    if (micros === 880_000_000_000) return 'CA$880.0K';
    if (micros === 1_350_000_000_000) return 'CA$1.4M';
    return `raw ${micros}`;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(vars[key] ?? ''))
        : fallback,
    i18n: { language: 'en' },
  }),
}));

function cockpit(
  points: Array<{ period: string; revenueMicros: number }>,
): AccountCockpitSnapshot {
  return { revenueEvolution: points } as AccountCockpitSnapshot;
}

describe('cockpit revenue evolution', () => {
  afterEach(() => {
    cleanup();
    flags.showRevenueBlock = true;
  });

  it('prints each month and its won amount, because a bar is not a figure', () => {
    render(
      <RevenueEvolutionCard
        cockpit={cockpit([
          { period: '2026-02', revenueMicros: FEB_MICROS },
          { period: '2026-09', revenueMicros: SEP_MICROS },
        ])}
      />,
    );

    const february = screen.getByRole('listitem', { name: /Feb 2026/ });
    expect(february.textContent).toContain(FEB_AMOUNT);
    const september = screen.getByRole('listitem', { name: /Sep 2026/ });
    expect(september.textContent).toContain(SEP_AMOUNT);
    // The aggregate key is not a caption. A bid lead should not have to decode it.
    expect(screen.queryByText('2026-02')).toBeNull();
    expect(screen.queryByText('2026-09')).toBeNull();
  });

  it('keeps a period that is not a calendar month, so a bad aggregate is not renamed', () => {
    render(
      <RevenueEvolutionCard
        cockpit={cockpit([{ period: 'rolling', revenueMicros: 10_000_000 }])}
      />,
    );
    expect(screen.getByText('rolling')).toBeTruthy();
  });

  it('stays off when the revenue block is disabled, so a gated source is not an empty chart', () => {
    flags.showRevenueBlock = false;
    const { container } = render(
      <RevenueEvolutionCard
        cockpit={cockpit([{ period: '2026-09', revenueMicros: SEP_MICROS }])}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('stays off when this account has no won months, so the card is not a zero placeholder', () => {
    const { container } = render(<RevenueEvolutionCard cockpit={cockpit([])} />);
    expect(container.textContent).toBe('');
  });
});
