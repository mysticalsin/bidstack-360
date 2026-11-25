// Demo columns are titled Lead and Technical Iteration. A seeded bid stores
// the legacy key s3_technical_iteration. The board must put that bid in
// Technical Iteration. An empty Lead column stays empty. The value on
// Technical Iteration is the bid, not 0. Dropping the bid on the column it
// already occupies must not toast a move.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';
import { PipelinePage } from './PipelinePage';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const LEAD = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 's1_lead',
  name: 'Lead',
  orderIndex: 0,
  probability: 10,
  forecastCategory: 'pipeline',
  color: '#6366f1',
  isWon: false,
  isLost: false,
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const TECHNICAL = {
  id: '33333333-3333-4333-8333-333333333333',
  key: 's3_technical_iteration',
  name: 'Technical Iteration',
  orderIndex: 3,
  probability: 65,
  forecastCategory: 'commit',
  color: '#06b6d4',
  isWon: false,
  isLost: false,
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const NEGOTIATION = {
  id: '44444444-4444-4444-8444-444444444444',
  key: 's4_negotiation',
  name: 'Negotiation',
  orderIndex: 4,
  probability: 80,
  forecastCategory: 'commit',
  color: '#f59e0b',
  isWon: false,
  isLost: false,
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const BID: Opportunity = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_200_000,
  probability: 60,
  dueDate: null,
  owner: null,
  industry: 'Manufacturing',
  logo: null,
  country: 'DE',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelinePage demo stage columns', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    mutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [BID], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: { items: [LEAD, TECHNICAL, NEGOTIATION] },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
    vi.mocked(useStageMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  });

  afterEach(() => {
    cleanup();
  });

  it('puts the seeded bid in Technical Iteration and keeps Lead empty', () => {
    renderPage();

    const technical = screen.getByRole('region', {
      name: 'Technical Iteration column with 1 opportunity',
    });
    const lead = screen.getByRole('region', { name: 'Lead column with 0 opportunities' });

    expect(technical.textContent).toContain('Global ERP Modernization');
    expect(lead.textContent).not.toContain('Global ERP Modernization');
    expect(screen.queryByRole('region', { name: /S3 Technical Iteration column/ })).toBeNull();
    expect(technical.querySelector('[data-testid="pipeline-column-value"]')?.getAttribute('data-value')).toBe(
      '1200000',
    );
    expect(lead.querySelector('[data-testid="pipeline-column-value"]')?.getAttribute('data-value')).toBe('0');
  });

  it('does not toast a move when the bid is dropped on its own demo column', () => {
    renderPage();

    const technical = screen.getByRole('region', {
      name: 'Technical Iteration column with 1 opportunity',
    });
    fireEvent.drop(technical.querySelector('[data-testid="pipeline-column-dropzone"]')!, {
      dataTransfer: { getData: () => BID.id },
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('toasts the demo column name when the bid is dropped on Negotiation', () => {
    mutate.mockImplementation((_vars, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    renderPage();

    const negotiation = screen.getByRole('region', { name: 'Negotiation column with 0 opportunities' });
    fireEvent.drop(negotiation.querySelector('[data-testid="pipeline-column-dropzone"]')!, {
      dataTransfer: { getData: () => BID.id },
    });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: BID.id, pipelineStageId: NEGOTIATION.id }),
      expect.any(Object),
    );
    expect(toast.success).toHaveBeenCalledWith('Moved "Global ERP Modernization" to Negotiation');
    expect(vi.mocked(toast.success).mock.calls.some((call) => String(call[0]).includes('s4_negotiation'))).toBe(
      false,
    );
  });
});
