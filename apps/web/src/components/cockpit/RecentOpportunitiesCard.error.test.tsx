// A failed bid read is not an empty account. The card used to fall through to
// "No opportunities for this account yet", which tells a seller to create a
// deal that may already exist. The failure has to stay visible, with a retry.
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

describe('RecentOpportunitiesCard when the bid read fails', () => {
  afterEach(cleanup);

  it('says the list did not load instead of claiming the account has no bids', () => {
    render(
      <MemoryRouter>
        <RecentOpportunitiesCard
          accountName="Logistec Corporation"
          items={[]}
          opps={
            {
              isLoading: false,
              isPending: false,
              isError: true,
              data: undefined,
              refetch: vi.fn(),
            } as never
          }
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load this account's opportunities");
    expect(screen.queryByText('No opportunities for this account yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
