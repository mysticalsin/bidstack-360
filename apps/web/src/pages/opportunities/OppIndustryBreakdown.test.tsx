import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OppIndustryBreakdown } from './OppIndustryBreakdown';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, vars?: Record<string, unknown>) => {
      if (key === 'oppIndustryBreakdown.sectorCount') {
        const count = Number(vars?.count ?? 0);
        return `${count} ${count === 1 ? 'sector' : 'sectors'}`;
      }
      return fallback;
    },
  }),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: () => ({
    data: {
      items: [],
      totals: { totalSegments: 9, totalValueMicros: 23_540_000_000_000, totalOpportunities: 19 },
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('OppIndustryBreakdown summary', () => {
  it('does not glue the unspecified mark to the word currency', () => {
    // Why: "23.54M unspecified" plus the basis sentence read as a currency named unspecified.
    render(<OppIndustryBreakdown />);
    const summary = screen.getByRole('button', { name: /Pipeline by industry/ });
    expect(summary.textContent).toMatch(/9 sectors/);
    expect(summary.textContent).toMatch(/unspecified/);
    expect(summary.textContent).not.toMatch(/unspecified currency/);
    expect(summary.textContent).not.toMatch(/EUR|€|\$/);
  });
});
