import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeadDetailPage } from './LeadDetailPage';
import { useLead, useUpdateLead } from '@/hooks/useLeads';
import { useHasPermission } from '@/hooks/useCapabilities';

const mutate = vi.fn();

vi.mock('@/hooks/useLeads', () => ({
  useLead: vi.fn(),
  useUpdateLead: vi.fn(() => ({ mutate, isPending: false })),
  useConvertLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'lead-1' }) };
});

function lead(status: 'new' | 'converted' = 'new') {
  return {
    id: 'lead-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: null,
    phone: null,
    companyName: 'Acme Corp',
    title: null,
    source: 'website',
    status,
    score: 42,
    priority: 'medium' as const,
    ownerId: null,
    ownerName: null,
    convertedToOpportunityId: status === 'converted' ? 'opp-1' : null,
    statusChangedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: null,
    budget: null,
    authority: null,
    need: null,
    timeline: null,
    intel: null,
  };
}

function renderPage(status: 'new' | 'converted' = 'new') {
  vi.mocked(useLead).mockReturnValue({
    data: lead(status),
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useLead>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeadDetailPage editing', () => {
  beforeEach(() => {
    mutate.mockReset();
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useUpdateLead).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useUpdateLead
    >);
  });
  afterEach(() => cleanup());

  it('keeps the typed score while editing and saves it once on blur', () => {
    renderPage();
    const score = screen.getByLabelText('Score') as HTMLInputElement;
    fireEvent.focus(score);
    fireEvent.change(score, { target: { value: '75' } });
    expect(score.value).toBe('75');
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.blur(score);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ score: 75 });
  });

  it('clamps an out-of-range score to 0..100', () => {
    renderPage();
    const score = screen.getByLabelText('Score') as HTMLInputElement;
    fireEvent.focus(score);
    fireEvent.change(score, { target: { value: '250' } });
    fireEvent.blur(score);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ score: 100 });
  });

  it('does not offer Converted as a status; conversion has its own action', () => {
    renderPage();
    const select = screen.getByLabelText('Status');
    const options = within(select).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).not.toContain('converted');
    expect(options).toContain('qualified');
  });

  it('still shows Converted for a converted lead', () => {
    renderPage('converted');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('converted');
    expect(select.disabled).toBe(true);
  });
});
