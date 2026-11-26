// A paused or in-flight company lookup has no profile yet. The dialog said
// the profile was ready to enrich. That read has not arrived.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQuery: vi.fn() };
});

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

import { SmartCompanyDialog } from './SmartCompanyDialog';

const CHECKING = 'Checking the company lookup. The profile has not arrived.';
const FAILED = 'Could not load the company lookup.';

function company(name: string, industry: string | null) {
  return {
    id: 'co-1',
    name,
    legalName: null,
    domain: 'northwind.example',
    website: 'https://northwind.example/',
    industry,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    logo: null,
    confidence: 0.9,
    sourceAttribution: [
      {
        source: 'registry',
        label: 'Registry',
        sourceUrl: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        confidence: 0.9,
        providerMetadata: {},
      },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderLookup(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
}) {
  vi.mocked(useQuery).mockReturnValue(query as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SmartCompanyDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /New account/i }));
}

describe('SmartCompanyDialog read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused company lookup as ready to enrich', () => {
    // WHY: a paused first read has isLoading false and no profile. Ready to
    // enrich is the settled miss. This read has not arrived.
    renderLookup({ data: undefined, isLoading: false, isFetching: false, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('Ready to enrich')).toBeNull();
    expect(screen.queryByText('Resolving profile...')).toBeNull();
    expect(screen.queryByText('Name signal')).toBeNull();
    expect(screen.queryByText('Domain signal')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight company lookup as ready to enrich', () => {
    // WHY: a slow read also has no profile. Resolving profile is not a
    // settled miss, and it is not a failed load.
    renderLookup({ data: undefined, isLoading: true, isFetching: true, isError: false, status: 'pending' });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('Ready to enrich')).toBeNull();
    expect(screen.queryByText('Resolving profile...')).toBeNull();
    expect(screen.queryByText('Name signal')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed company lookup on the error', () => {
    // WHY: a failed read is not a settled miss. Ready to enrich must not
    // stand in for the error.
    renderLookup({ data: undefined, isLoading: false, isFetching: false, isError: true, status: 'error' });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Ready to enrich')).toBeNull();
    expect(screen.queryByText('Name signal')).toBeNull();
  });

  it('lets a failed read win over a stale company', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Northwind from a profile that is no longer the read.
    renderLookup({
      data: {
        match: 'exact_name',
        company: company('Northwind', 'Logistics'),
        alternatives: [company('Old Alt', null)],
      },
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('Northwind')).toBeNull();
    expect(screen.queryByText('Old Alt')).toBeNull();
    expect(screen.queryByText('Exact name match')).toBeNull();
    expect(screen.queryByText('Registry')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open cockpit/i })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Ready to enrich')).toBeNull();
  });

  it('stays on ready to enrich when a settled read has no company', () => {
    // WHY: a settled miss is not an unread pause. Undefined data is unread.
    // A payload with no company has arrived, and the miss stays.
    renderLookup({
      data: { match: 'none', company: null, alternatives: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('Ready to enrich')).toBeTruthy();
    expect(screen.getByText('Name signal')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on ready to enrich when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload stays
    // on the settled miss.
    renderLookup({ data: null, isLoading: false, isFetching: false, isError: false, status: 'success' });

    expect(screen.getByText('Ready to enrich')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded company', () => {
    // WHY: a loaded profile stays. The unread line must not replace a
    // company the read already returned.
    renderLookup({
      data: {
        match: 'exact_name',
        company: company('Northwind', 'Logistics'),
        alternatives: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText('Exact name match')).toBeTruthy();
    expect(screen.getByText('Registry')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open cockpit/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded company when industry is blank', () => {
    // WHY: a blank industry is loaded data. Unread must not drop the company
    // because a field is empty.
    renderLookup({
      data: {
        match: 'exact_domain',
        company: company('Harbor', null),
        alternatives: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('Harbor')).toBeTruthy();
    expect(screen.getByText('Exact domain match')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Ready to enrich')).toBeNull();
  });
});
