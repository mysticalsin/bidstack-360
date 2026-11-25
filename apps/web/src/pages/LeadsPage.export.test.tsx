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

  it('writes the email and title on the list export and the selection export', () => {
    // WHY: the demo book stores an email and a title on the lead. The list
    // Export CSV dropped the email, and Export selected dropped the title, so
    // the file you got depended on the button and a re-import could not
    // restore the address.
    vi.mocked(useLeads).mockReturnValue({
      data: {
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            firstName: 'Alex',
            lastName: 'Chen',
            email: 'alex.chen@example.com',
            phone: '+1 415 555 0100',
            companyName: 'Example Industrial',
            title: 'CTO',
            source: 'website',
            status: 'new',
            score: 72,
            priority: 'high',
            ownerId: null,
            ownerName: null,
            convertedToOpportunityId: null,
            statusChangedAt: '2026-06-01T00:00:00.000Z',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
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

    vi.mocked(rowsToCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(exportedLead()).toMatchObject({
      email: 'alex.chen@example.com',
      title: 'CTO',
    });
    expect(exportedLabels()).toEqual(LEAD_EXPORT_LABELS);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export selected' }));
    expect(exportedLead(1)).toMatchObject({
      email: 'alex.chen@example.com',
      title: 'CTO',
    });
    expect(exportedLabels(1)).toEqual(LEAD_EXPORT_LABELS);
  });
});

const LEAD_EXPORT_LABELS = [
  'Name',
  'Company',
  'Email',
  'Title',
  'Status',
  'Priority',
  'Score (0-100)',
  'Source',
  'Created',
];

function exportedLabels(call = 0): string[] {
  const columns = vi.mocked(rowsToCsv).mock.calls[call]?.[1] as Array<{ label: string }>;
  return columns.map((column) => column.label);
}

function exportedLead(call = 0): { email?: string; title?: string } {
  const rows = vi.mocked(rowsToCsv).mock.calls[call]?.[0] as Array<{
    email?: string;
    title?: string;
  }>;
  return rows[0] ?? {};
}
