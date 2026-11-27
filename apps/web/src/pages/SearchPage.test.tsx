// Workspace search already returns proposals, requirements, and references.
// The page only named opportunities, leads, contacts, companies, tasks, and
// notes, and the empty guidance still offered sales orders. A Siemens search
// then hid "Siemens ERP Technical Proposal" behind All, printed the badge
// "proposal" or "rfp_requirement", and a Leads tab with no rows said the
// query matched nothing.
import type { ReactNode } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const searchState = vi.hoisted(() => ({
  useGlobalSearch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      if (!opts) return template;
      return Object.entries(opts).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
        template,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useGlobalSearch', () => ({
  useGlobalSearch: searchState.useGlobalSearch,
}));

import { SearchPage } from './SearchPage';

const SIEMENS = [
  {
    id: 'opp-1',
    type: 'opportunity',
    title: 'Global ERP Modernization',
    subtitle: 'Siemens',
    url: '/opportunities/opp-1',
    score: 10,
  },
  {
    id: 'prop-1',
    type: 'proposal',
    title: 'Siemens ERP Technical Proposal',
    subtitle: 'review',
    url: '/proposals/prop-1',
    score: 9,
  },
  {
    id: 'req-1',
    type: 'rfp_requirement',
    title: 'Clause 4.2 response time',
    subtitle: 'MUST',
    url: '/opportunities/opp-1',
    score: 4,
  },
  {
    id: 'ref-1',
    type: 'reference',
    title: 'CI Financial core banking modernization',
    subtitle: 'Financial services',
    url: '/references?expand=ref-1',
    score: 3,
  },
];

function mockSearch() {
  searchState.useGlobalSearch.mockReturnValue({
    data: {
      items: SIEMENS,
      pageContinues: false,
      continuedTypes: [],
      total: SIEMENS.length,
      query: 'Siemens',
    },
    isLoading: false,
    isError: false,
    error: null,
  });
}

function renderAt(path: string) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        {children}
      </MemoryRouter>
    );
  }
  return render(<SearchPage />, { wrapper: Wrapper });
}

afterEach(() => {
  cleanup();
  searchState.useGlobalSearch.mockReset();
});

describe('SearchPage bid-record types', () => {
  it('names proposals, requirements, and references, and does not offer sales orders', () => {
    // WHY: the demo book has "Siemens ERP Technical Proposal". Search returns
    // it, plus requirements and references. The empty page still told people
    // to look for sales orders, which nothing emits.
    mockSearch();
    renderAt('/search');

    const box = screen.getByRole('searchbox', { name: /search workspace/i });
    expect(box.getAttribute('placeholder') ?? '').not.toMatch(/order/i);
    expect(box.getAttribute('placeholder') ?? '').toMatch(/proposals/i);
    expect(screen.getByText(/proposals, and references/i)).toBeTruthy();
    expect(screen.queryByText(/sales orders/i)).toBeNull();
    expect(screen.queryByText(/orders/i)).toBeNull();
  });

  it('shows a proposal under its own tab with a word, not the machine key', () => {
    // WHY: filtering to Opportunities hid the technical proposal. The All
    // badge was the raw type "proposal", "rfp_requirement", or "reference".
    mockSearch();
    renderAt('/search?q=Siemens');

    expect(screen.getByRole('button', { name: /Proposals/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Requirements/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /References/ })).toBeTruthy();
    expect(screen.getByText('Proposal')).toBeTruthy();
    expect(screen.getByText('Requirement')).toBeTruthy();
    expect(screen.getByText('Reference')).toBeTruthy();
    expect(screen.queryByText('rfp_requirement')).toBeNull();
    expect(screen.queryByText('proposal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Proposals/ }));

    expect(screen.getByText('Siemens ERP Technical Proposal')).toBeTruthy();
    expect(screen.queryByText('Global ERP Modernization')).toBeNull();
    expect(screen.queryByText('Clause 4.2 response time')).toBeNull();
  });

  it('says a typed tab is empty when other demo matches are on All', () => {
    // WHY: Leads had no Siemens row, and the page said the query matched
    // nothing. The bid and the proposal were still on All.
    mockSearch();
    renderAt('/search?q=Siemens');

    fireEvent.click(screen.getByRole('button', { name: /^Leads/ }));

    expect(screen.getByRole('heading', { name: 'No leads' })).toBeTruthy();
    expect(screen.getByText(/Other matches are on All/i)).toBeTruthy();
    expect(screen.getByText(/Nothing in Leads for "Siemens"/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't find anything matching/i)).toBeNull();
  });

  it('does not treat a sales-order type param as an empty search', () => {
    // WHY: sales_order is tolerated on the wire and nothing emits it. The
    // page used that token as a filter, then said Siemens matched nothing
    // while the proposal was in the payload.
    mockSearch();
    renderAt('/search?q=Siemens&type=sales_order');

    expect(screen.getByText('Siemens ERP Technical Proposal')).toBeTruthy();
    expect(screen.getByText('Global ERP Modernization')).toBeTruthy();
    expect(screen.queryByText(/couldn't find anything matching/i)).toBeNull();
    expect(screen.queryByText(/sales orders/i)).toBeNull();
  });
});
