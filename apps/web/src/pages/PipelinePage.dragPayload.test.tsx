// A deal-board card used to be a draggable link. The browser then owns the
// drag and puts the record URL in text/plain, so a drop of the demo Siemens
// bid does not find that bid. The card stays in Technical Iteration and the
// column total never moves. The drag source has to be the bid id.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

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

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const LEAD: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Lead',
  probability: 10,
  color: '#6366f1',
  isWon: false,
  isLost: false,
};

const TECHNICAL: PipelineStage = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Technical Iteration',
  probability: 65,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const SIEMENS: Opportunity = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 's3_technical_iteration',
  pipelineStageId: TECHNICAL.id,
  pipelineStage: TECHNICAL,
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
  taskCount: 1,
  commentCount: 0,
  viewCount: 0,
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pipeline']}>
        <LocationProbe />
        <Routes>
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/opportunities/:id" element={<div>Opened record</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelinePage drag payload', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    mutate.mockReset();
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [SIEMENS], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [LEAD, TECHNICAL].map((stage, index) => ({
          ...stage,
          key: stage.id === LEAD.id ? 's1_lead' : 's3_technical_iteration',
          orderIndex: index,
          forecastCategory: 'pipeline',
          updatedAt: '2026-06-01T00:00:00.000Z',
        })),
      },
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

  it('moves the demo Siemens bid by its id when dropped on the empty Lead column', () => {
    renderPage();

    const card = screen.getByTestId('pipeline-card');
    // An anchor drag stores the record URL in text/plain. The drop then
    // cannot find the bid, so the 1,200,000 stays in Technical Iteration.
    expect(card.tagName).not.toBe('A');
    expect(card.getAttribute('href')).toBeNull();

    const lead = screen.getByRole('region', { name: /Lead column with 0 opportunities/ });
    const zone = lead.querySelector('[data-testid="pipeline-column-dropzone"]');
    if (!zone) throw new Error('missing Lead dropzone');

    const transfer = new DataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(zone, { dataTransfer: transfer });

    expect(transfer.getData('text/plain')).toBe(SIEMENS.id);
    expect(transfer.getData('text/plain')).not.toContain('/');
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: SIEMENS.id, pipelineStageId: LEAD.id }),
      expect.any(Object),
    );
    expect(screen.getByTestId('location').textContent).toBe('/pipeline');

    fireEvent.click(card);
    expect(screen.getByTestId('location').textContent).toBe('/pipeline');
  });

  it('opens the demo bid when the card is clicked without a drag', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('pipeline-card'));

    expect(screen.getByTestId('location').textContent).toBe(`/opportunities/${SIEMENS.id}`);
  });
});
