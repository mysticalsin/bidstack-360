import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeadsPage } from './LeadsPage';
import { useLeads } from '@/hooks/useLeads';
import { rowsToCsv } from '@/lib/csv';

vi.mock('@/hooks/useLeads', () => ({
  useLeads: vi.fn(),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateLeadById: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/lib/csv', () => ({ rowsToCsv: vi.fn(() => ''), downloadCsv: vi.fn() }));

describe('LeadsPage CSV export', () => {
  afterEach(() => cleanup());

  it('labels the score column with the real 0-100 range', () => {
    vi.mocked(useLeads).mockReturnValue({
      data: {
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            firstName: 'Jane',
            lastName: 'Doe',
            email: null,
            phone: null,
            companyName: 'Acme Corp',
            title: null,
            source: 'website',
            status: 'new',
            score: 42,
            priority: 'medium',
            ownerId: null,
            ownerName: null,
            convertedToOpportunityId: null,
            statusChangedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLeads>);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LeadsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    const columns = vi.mocked(rowsToCsv).mock.calls[0]?.[1] as Array<{ label: string }>;
    const labels = columns.map((c) => c.label);
    expect(labels).toContain('Score (0-100)');
    expect(labels.join(' ')).not.toMatch(/10000/);
  });
});
