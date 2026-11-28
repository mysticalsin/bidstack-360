import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { useOpportunities } from '@/hooks/useOpportunities';

import { RecentOpportunitiesCard } from './RecentOpportunitiesCard';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

const opps = {
  isLoading: false,
  data: { items: [] },
} as ReturnType<typeof useOpportunities>;

function renderCard(accountId?: string) {
  return render(
    <MemoryRouter>
      <RecentOpportunitiesCard
        opps={opps}
        accountName="Globex"
        accountId={accountId}
        items={[]}
      />
    </MemoryRouter>,
  );
}

describe('RecentOpportunitiesCard account pipeline link', () => {
  afterEach(cleanup);

  it('opens deals for this account by company id', () => {
    // WHY: the link sits on the account cockpit and is labeled Open pipeline.
    // A name search from here lands on other companies that share the word.
    renderCard(GLOBEX);
    const link = screen.getByRole('link', { name: 'Open deals for this account' });
    expect(link.getAttribute('href')).toBe(`/opportunities?companyId=${GLOBEX}`);
    expect(link.className).toContain('link-arrow');
  });

  it('does not put the account name in the address when the company id is missing', () => {
    renderCard(undefined);
    const link = screen.getByRole('link', { name: 'Open pipeline' });
    expect(link.getAttribute('href')).toBe('/opportunities?search=Globex');
  });
});
