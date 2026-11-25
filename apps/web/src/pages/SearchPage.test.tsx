import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchPage } from './SearchPage';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({
    items: [
      {
        id: 'prop_1',
        type: 'proposal',
        title: 'Rail signaling proposal',
        subtitle: 'draft',
        url: '/proposals/prop_1',
        score: 3,
      },
      {
        id: 'req_1',
        type: 'rfp_requirement',
        title: 'Platform screen doors',
        subtitle: 'REQ-4',
        url: '/opportunities/opp_1',
        score: 2,
      },
      {
        id: 'ref_1',
        type: 'reference',
        title: 'Metro reference',
        subtitle: 'Transit',
        url: '/references?search=Metro%20reference',
        score: 1,
      },
      {
        id: 'so_1',
        type: 'sales_order',
        title: 'Legacy order',
        subtitle: 'deleted',
        url: '/sales/orders/so_1',
        score: 9,
      },
    ],
    pageContinues: false,
    continuedTypes: [],
  })),
}));

afterEach(() => {
  cleanup();
});

function renderSearch(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[entry]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SearchPage result types', () => {
  it('filters live bid types and does not draw a deleted sales order', async () => {
    // WHY: proposal, requirement, and reference rows come back from search,
    // but the page could not filter to them. A `type=sales_order` link must
    // not blank the list or draw the deleted module.
    renderSearch('/search?q=rail&type=sales_order');

    expect(
      (await screen.findByRole('link', { name: /Rail signaling proposal/ })).getAttribute('href'),
    ).toBe('/proposals/prop_1');
    expect(screen.getByRole('link', { name: /Platform screen doors/ }).getAttribute('href')).toBe(
      '/opportunities/opp_1',
    );
    expect(screen.getByRole('link', { name: /Metro reference/ }).getAttribute('href')).toBe(
      '/references?search=Metro%20reference',
    );
    expect(screen.queryByText('Legacy order')).toBeNull();
    expect(screen.queryByRole('link', { name: /Legacy order/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /orders/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /^Proposals/ }));
    expect(screen.getByRole('link', { name: /Rail signaling proposal/ })).toBeTruthy();
    expect(screen.getByText('Proposal')).toBeTruthy();
    expect(screen.queryByText('Platform screen doors')).toBeNull();
    expect(screen.queryByText('Metro reference')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Requirements/ }));
    expect(screen.getByText('Requirement')).toBeTruthy();
    expect(screen.queryByText('Rail signaling proposal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^References/ }));
    expect(screen.getByText('Reference')).toBeTruthy();
    expect(screen.queryByText('Platform screen doors')).toBeNull();
  });

  it('does not tell an empty search to look for sales orders', () => {
    // WHY: the guidance is the first instruction on the page. It must name
    // the types search can return, and it must not name the deleted module.
    renderSearch('/search');
    expect(screen.getByText(/proposals, requirements, and references/i)).toBeTruthy();
    expect(screen.queryByText(/sales orders/i)).toBeNull();
    expect(screen.queryByText(/\borders\b/i)).toBeNull();
  });
});
