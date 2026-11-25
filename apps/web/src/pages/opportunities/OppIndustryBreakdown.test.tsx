// A stage, due, or search filter changes the table. The industry header used
// the territory aggregate, which is every open bid, so a one-stage page still
// read as the whole book.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OppIndustryBreakdown } from './OppIndustryBreakdown';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: () => ({
    data: {
      dimension: 'industry',
      items: [
        {
          key: 'telecom',
          label: 'telecom',
          opportunityCount: 12,
          totalValueMicros: 9_000_000 * 1e6,
          avgProbability: 40,
          ownerNames: ['Book Owner'],
        },
      ],
      totals: {
        totalSegments: 4,
        totalValueMicros: 9_000_000 * 1e6,
        totalOpportunities: 20,
        avgProbability: 40,
      },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (micros: number) => `R$${micros / 1e6}` }),
}));

afterEach(cleanup);

const pageRow = {
  industry: 'financial_services',
  value: 320_000,
  probability: 35,
};

describe('OppIndustryBreakdown scope', () => {
  it('keeps the whole open book when the list is not filtered', () => {
    render(<OppIndustryBreakdown />);
    const button = screen.getByRole('button', { name: /pipeline by industry/i });
    expect(button.textContent).toContain('R$9000000');
    expect(button.textContent).not.toContain('This filter');
  });

  it('does not call a filtered page the whole-book industry total', () => {
    render(
      <OppIndustryBreakdown filtered rows={[pageRow]} pageContinues={false} listLoading={false} />,
    );
    const button = screen.getByRole('button', { name: /pipeline by industry/i });
    // The territory read is still 9,000,000. The header must follow the page.
    expect(button.textContent).not.toContain('R$9000000');
    expect(button.textContent).toContain('This filter');
    expect(button.textContent).toContain('R$320000');

    fireEvent.click(button);
    expect(screen.getByText('financial_services')).toBeTruthy();
    expect(screen.queryByText('telecom')).toBeNull();
    expect(screen.queryByText('Book Owner')).toBeNull();
  });

  it('holds the industry total while a filtered list is still loading', () => {
    render(<OppIndustryBreakdown filtered rows={[pageRow]} listLoading />);
    const button = screen.getByRole('button', { name: /pipeline by industry/i });
    expect(button.textContent).not.toContain('R$9000000');
    expect(button.textContent).not.toContain('R$320000');
  });

  it('says the split is this page when the filter continues', () => {
    render(<OppIndustryBreakdown filtered rows={[pageRow]} pageContinues />);
    expect(screen.getByRole('button', { name: /pipeline by industry/i }).textContent).toContain(
      'This page, not every match',
    );
  });
});
