// From an account cockpit, "Open pipeline" has to land on that company's bids.
// Searching the account name opens a different list: other customers whose
// names contain the same words, and a miss when the customer string and the
// account name are not the same text.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentOpportunitiesCard } from './RecentOpportunitiesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

const LOGISTEC = '11111111-1111-4111-8111-111111111111';

describe('RecentOpportunitiesCard pipeline link', () => {
  afterEach(cleanup);

  it("opens this account's bids by company id", () => {
    render(
      <MemoryRouter>
        <RecentOpportunitiesCard
          accountName="Logistec Corporation"
          companyId={LOGISTEC}
          opps={{ isLoading: false, data: { items: [] } } as never}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: "Open this account's bids" });
    expect(link.getAttribute('href')).toBe(`/opportunities?companyId=${LOGISTEC}`);
    expect(link.getAttribute('href')).not.toContain('search=');
  });

  it('keeps a name search when the cockpit has no company uuid', () => {
    render(
      <MemoryRouter>
        <RecentOpportunitiesCard
          accountName="Logistec Corporation"
          companyId="logistec"
          opps={{ isLoading: false, data: { items: [] } } as never}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Open pipeline' }).getAttribute('href')).toBe(
      '/opportunities?search=Logistec%20Corporation',
    );
  });
});
