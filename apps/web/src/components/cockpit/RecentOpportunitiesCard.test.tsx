import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import type { useOpportunities } from '@/hooks/useOpportunities';

import { RecentOpportunitiesCard } from './RecentOpportunitiesCard';

// WHY: A failed deal read used to render the empty-book line
// "No opportunities for this account yet". That copy is only true after a
// settled read. A refresh that fails must keep the last loaded deal.

type OppQuery = ReturnType<typeof useOpportunities>;

const deal = {
  id: 'opp-demo-1',
  code: 'DEMO-1',
  name: 'Demo renewal',
  customer: 'Northwind Demo',
  value: 100,
  stage: 's2_sent',
};

function query(over: Partial<OppQuery> = {}): OppQuery {
  return {
    isLoading: false,
    isError: false,
    data: { items: [] },
    refetch: vi.fn(),
    ...over,
  } as OppQuery;
}

function renderCard({
  opps = query(),
  items,
}: {
  opps?: OppQuery;
  items?: NonNullable<OppQuery['data']>['items'];
} = {}) {
  return render(
    <MemoryRouter>
      <RecentOpportunitiesCard opps={opps} accountName="Northwind Demo" items={items} />
    </MemoryRouter>,
  );
}

describe('RecentOpportunitiesCard deal book', () => {
  afterEach(cleanup);

  it('does not call a failed read an empty account book', () => {
    renderCard({ opps: query({ isError: true, data: undefined }) });
    expect(screen.queryByText('No opportunities for this account yet')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load opportunities for Northwind Demo");
    expect(alert.textContent).toContain('The deal book did not load.');
  });

  it('still says the book is empty after a settled read with no deals', () => {
    renderCard({ opps: query({ isError: false, data: { items: [] } as OppQuery['data'] }), items: [] });
    expect(screen.getByText('No opportunities for this account yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the last loaded deal when a refresh fails', () => {
    const refetch = vi.fn();
    renderCard({
      opps: query({
        isError: true,
        data: { items: [deal] } as OppQuery['data'],
        refetch,
      }),
      items: [deal] as NonNullable<OppQuery['data']>['items'],
    });
    expect(screen.getByText('Demo renewal')).toBeTruthy();
    expect(screen.queryByText('No opportunities for this account yet')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Showing the last loaded opportunities.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('names a failed refresh when the last loaded book was empty', () => {
    renderCard({
      opps: query({ isError: true, data: { items: [] } as OppQuery['data'] }),
      items: [],
    });
    expect(screen.getByText('No opportunities for this account yet')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Showing the last loaded opportunities.');
  });
});
