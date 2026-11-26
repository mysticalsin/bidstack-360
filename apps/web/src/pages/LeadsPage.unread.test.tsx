// A paused or failed leads read has no payload yet. The summary must not
// call that miss Pipeline-ready 0, and the card must not call the funnel
// empty. An empty page and a qualified lead are honest only after the
// payload arrives. Cold outreach is one source on that arrived row.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';
import { LeadsPage } from './LeadsPage';
import { useLeads } from '@/hooks/useLeads';

vi.mock('@/hooks/useLeads', () => ({
  useLeads: vi.fn(),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateLeadById: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

function mockLeads(value: Partial<ReturnType<typeof useLeads>>) {
  vi.mocked(useLeads).mockReturnValue(value as ReturnType<typeof useLeads>);
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LeadsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Ada',
    lastName: 'Example',
    email: 'ada@example.com',
    phone: null,
    companyName: 'Example Co',
    title: 'Buyer',
    source: 'cold_outreach',
    status: 'qualified' as const,
    score: 80,
    priority: 'medium' as const,
    ownerId: null,
    ownerName: null,
    convertedToOpportunityId: null,
    statusChangedAt: '2026-05-08T00:00:00.000Z',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('LeadsPage unread read honesty', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread leads list empty or pipeline-ready', () => {
    // A paused read leaves isLoading false and no payload. That used to
    // render the empty funnel and a Pipeline-ready count of 0.
    mockLeads({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('The funnel is empty')).toBeNull();
    expect(screen.queryByText('No leads match these filters')).toBeNull();
    expect(screen.queryByText('Pipeline-ready')).toBeNull();
    expect(screen.queryByText('0 lead')).toBeNull();
    expect(screen.getByText('Checking leads. They have not arrived.')).toBeTruthy();
  });

  it('does not call a failed leads read empty or pipeline-ready', () => {
    // The error card already says the load failed. It must not fill the
    // summary with Pipeline-ready 0, and it must say the list has not arrived.
    mockLeads({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('The leads read failed'),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('Failed to load leads')).toBeTruthy();
    expect(screen.getByText(/The leads have not arrived/)).toBeTruthy();
    expect(screen.getByText(/The leads read failed/)).toBeTruthy();
    expect(screen.queryByText('The funnel is empty')).toBeNull();
    expect(screen.queryByText('Pipeline-ready')).toBeNull();
    expect(screen.queryByText('0 lead')).toBeNull();
  });

  it('does not count pipeline-ready while the first fetch is still loading', () => {
    mockLeads({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText('The funnel is empty')).toBeNull();
    expect(screen.queryByText('Pipeline-ready')).toBeNull();
    expect(screen.queryByText('0 lead')).toBeNull();
  });

  it('keeps an arrived empty funnel empty, including pipeline-ready 0', () => {
    mockLeads({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('The funnel is empty')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Lead list summary' }).textContent).toContain(
      'Pipeline-ready',
    );
    expect(screen.getByRole('region', { name: 'Lead list summary' }).textContent).toMatch(
      /Pipeline-ready\s*0/,
    );
    expect(screen.getByText('0 lead')).toBeTruthy();
    expect(screen.queryByText('Checking leads. They have not arrived.')).toBeNull();
  });

  it('keeps a qualified outreach lead that has arrived, and counts it pipeline-ready', () => {
    mockLeads({
      data: { items: [baseLead()], nextCursor: null },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('Ada Example')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('cold_outreach')).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Lead list summary' }).textContent ?? '';
    expect(summary).toContain('Pipeline-ready');
    expect(summary).toMatch(/Pipeline-ready\s*1/);
    expect(screen.queryByText('The funnel is empty')).toBeNull();
    expect(screen.queryByText('Checking leads. They have not arrived.')).toBeNull();
  });
});
