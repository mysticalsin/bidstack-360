// The opportunities KPI and the bid row already say the amount has no
// currency. Pipeline by industry still sent the same micros through the euro
// converter, so the demo open book (Siemens, IKEA, Sanofi, HSBC = 6.2m) read
// as euros. Won Stellantis and lost Spotify are not in that total.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UNSPECIFIED_CURRENCY_BASIS, formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

import { OppIndustryBreakdown } from './OppIndustryBreakdown';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback ?? key;
      return String(fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(opts[name] ?? ''),
      );
    },
    i18n: { language: 'en' },
  }),
}));

const euro = vi.hoisted(() => ({ calls: 0 }));

const DEMO_OPEN_MICROS = 6_200_000_000_000;
const SANOFI_MICROS = 2_400_000_000_000;

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    formatMoneyMicros: (micros: string | number | bigint, source = 'EUR') => {
      euro.calls += 1;
      const amount = Number(micros) / 1_000_000;
      const converted = source === 'EUR' ? amount * 2 : amount;
      return `EUR ${converted.toLocaleString('en-US')}`;
    },
  }),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: () => ({
    data: {
      dimension: 'industry' as const,
      items: [
        {
          key: 'Healthcare',
          label: 'Healthcare',
          opportunityCount: 1,
          totalValueMicros: SANOFI_MICROS,
          avgProbability: 40,
          ownerNames: ['Priya Nair'],
        },
        {
          key: 'Financial Services',
          label: 'Financial Services',
          opportunityCount: 1,
          totalValueMicros: 1_750_000_000_000,
          avgProbability: 25,
          ownerNames: ['Sofia Almeida'],
        },
        {
          key: 'Manufacturing',
          label: 'Manufacturing',
          opportunityCount: 1,
          totalValueMicros: 1_200_000_000_000,
          avgProbability: 60,
          ownerNames: ['Sofia Almeida'],
        },
        {
          key: 'Retail',
          label: 'Retail',
          opportunityCount: 1,
          totalValueMicros: 850_000_000_000,
          avgProbability: 75,
          ownerNames: ['Marco Bianchi'],
        },
      ],
      totals: {
        totalSegments: 4,
        totalValueMicros: DEMO_OPEN_MICROS,
        totalOpportunities: 4,
        avgProbability: 50,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  euro.calls = 0;
});

describe('Pipeline by industry currency', () => {
  it('does not price the demo open book as euros', () => {
    render(<OppIndustryBreakdown />);

    const header = screen.getByRole('button', { name: /Pipeline by industry/ });
    expect(header.textContent).toContain(formatUnspecifiedAmount(6_200_000));
    expect(header.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(header.textContent).not.toMatch(/EUR|€/);
    expect(euro.calls).toBe(0);

    fireEvent.click(header);

    expect(screen.getByText('Healthcare').parentElement?.textContent).toContain(
      formatUnspecifiedAmount(2_400_000),
    );
    expect(screen.getByText('Healthcare').parentElement?.textContent).not.toMatch(/EUR|€/);
    expect(euro.calls).toBe(0);
  });
});
