// A failed deal read is not an account with no bids. The recent-deals card
// must not say "No opportunities for this account yet" until a read succeeds
// and comes back empty.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';

import { RecentOpportunitiesCard } from './RecentOpportunitiesCard';

function renderCard(opps: {
  data?: { items: Array<{ id: string; customer: string; name: string; code: string; stage: string; value: number }> };
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
}) {
  return render(
    <MemoryRouter>
      <RecentOpportunitiesCard opps={opps as never} accountName="Globex" items={opps.data?.items} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('recent deals before the read settles', () => {
  it('does not call a failed read an empty account', () => {
    // WHY: the card sits on the account cockpit. "No opportunities yet" plus
    // the create hint sends someone to open a bid that may already exist.
    const refetch = vi.fn();
    renderCard({ data: undefined, isLoading: false, isError: true, refetch });

    expect(screen.queryByText('No opportunities for this account yet')).toBeNull();
    expect(screen.queryByText(/Create an opportunity from the account header/)).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load opportunities for this account");
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    expect(retry.className).toContain('text-[var(--fg-primary)]');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('says there are none only after a successful empty read', () => {
    // WHY: empty is a real result. The create hint belongs to that case.
    renderCard({
      data: { items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    expect(screen.getByText('No opportunities for this account yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the last bids when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book.
    renderCard({
      data: {
        items: [
          {
            id: 'labs',
            customer: 'Globex Labs',
            name: 'Labs bid',
            code: 'OP-9',
            stage: 's2_sent',
            value: 2_500_000,
          },
        ],
      },
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });

    expect(screen.getByText('Labs bid')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No opportunities for this account yet')).toBeNull();
  });
});
