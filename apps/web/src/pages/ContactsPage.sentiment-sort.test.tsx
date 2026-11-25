// The contacts table sorts sentiment with a string compare. On the demo book
// that puts warm above hot when the column is descending, and it leaves a
// person with no sentiment in the warmth scale instead of at the bottom.
// Influence already sorts as a number. Sentiment is the same kind of scale.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ContactsPage } from './ContactsPage';
import { useContacts } from '@/hooks/useContacts';
import { useHasPermission } from '@/hooks/useCapabilities';
import type { Contact, Sentiment } from '@bidstack/shared';

vi.mock('@/hooks/useContacts', () => ({
  useContacts: vi.fn(),
  useCreateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

function contact(partial: {
  id: string;
  name: string;
  customer: string;
  sentiment: Sentiment | null;
}): Contact {
  return {
    id: partial.id,
    customer: partial.customer,
    name: partial.name,
    role: 'Buyer',
    email: null,
    phone: null,
    influence: null,
    sentiment: partial.sentiment,
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: null,
    linkState: 'needs_review',
  };
}

// API order is not the warmth scale. Unscored is first so a missing sentiment
// mapped to zero would sit with Cold instead of staying last.
const ROWS: Contact[] = [
  contact({
    id: '11111111-1111-4111-8111-111111111101',
    name: 'Unscored Example',
    customer: 'Northwind Pharma',
    sentiment: null,
  }),
  contact({
    id: '11111111-1111-4111-8111-111111111102',
    name: 'Lena Fischer',
    customer: 'Siemens',
    sentiment: 'warm',
  }),
  contact({
    id: '11111111-1111-4111-8111-111111111103',
    name: 'James Whitfield',
    customer: 'HSBC',
    sentiment: 'neutral',
  }),
  contact({
    id: '11111111-1111-4111-8111-111111111104',
    name: 'Klaus Vogt',
    customer: 'Siemens',
    sentiment: 'hot',
  }),
  contact({
    id: '11111111-1111-4111-8111-111111111105',
    name: 'Nora Cold',
    customer: 'Example Ledger',
    sentiment: 'cold',
  }),
];

function rowNames(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('link')
    .map((el) => el.textContent ?? '');
}

function renderSorted(sort: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(useHasPermission).mockReturnValue(true);
  vi.mocked(useContacts).mockReturnValue({
    data: { items: ROWS, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useContacts>);
  const path = sort ? `/contacts?sort=${sort}` : '/contacts';
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ContactsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsPage sentiment scale', () => {
  afterEach(() => cleanup());

  it('puts hot above warm when the shared sentiment sort is descending', () => {
    // WHY: a reader who sorts Sentiment descending is looking for the hottest
    // buyers first. Alphabetical order answers with Lena (warm) before Klaus (hot).
    renderSorted('sentiment.desc');
    expect(rowNames()).toEqual([
      'Klaus Vogt',
      'Lena Fischer',
      'James Whitfield',
      'Nora Cold',
      'Unscored Example',
    ]);
  });

  it('puts cold first and leaves an unscored person last when the sort is ascending', () => {
    // WHY: ascending is the cold end of the same scale, not "cold, hot, neutral, warm".
    // A missing sentiment is not a number on that scale, so it stays last.
    renderSorted('sentiment.asc');
    expect(rowNames()).toEqual([
      'Nora Cold',
      'James Whitfield',
      'Lena Fischer',
      'Klaus Vogt',
      'Unscored Example',
    ]);
  });

  it('keeps the loaded order when the column is not sorted', () => {
    renderSorted(null);
    expect(rowNames()).toEqual([
      'Unscored Example',
      'Lena Fischer',
      'James Whitfield',
      'Klaus Vogt',
      'Nora Cold',
    ]);
  });
});
