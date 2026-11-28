// The deal board paints a column from the stage the org configured. Demo
// backfill calls that stage "Technical Iteration", not s3_technical_iteration.
// A custom win is named Won and only says so via isWon.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({ useStageMutation: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const TECHNICAL: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Technical Iteration',
  probability: 65,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const WON: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Won',
  probability: 100,
  color: '#22c55e',
  isWon: true,
  isLost: false,
};

const OP_2041: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial — IT Modernization & MSP',
  stage: 'Technical Iteration',
  pipelineStageId: TECHNICAL.id,
  pipelineStage: TECHNICAL,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: null,
  industry: 'financial_services',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 1,
  commentCount: 0,
  viewCount: 0,
};

function renderBoard() {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items: [OP_2041], nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [TECHNICAL, WON].map((stage, index) => ({
        ...stage,
        key: stage.id,
        orderIndex: index,
        forecastCategory: stage.isWon ? 'closed_won' : 'commit',
        updatedAt: '',
      })),
    },
    isLoading: false,
  } as unknown as ReturnType<typeof usePipelineStages>);
  vi.mocked(useStageMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useStageMutation>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deal board column tones from the configured stage', () => {
  it('colors demo Technical Iteration and a custom won column', () => {
    // WHY: both columns used to be gray. The name is not the enum key, and
    // "Won" is not "Closed Won", so only the stage flag can color that column.
    renderBoard();

    const technical = screen.getByRole('region', { name: /Technical Iteration column/ });
    const won = screen.getByRole('region', { name: /Won column/ });
    expect(within(technical).getByText('Technical Iteration').className).toContain('tag-teal');
    expect(within(won).getByText('Won').className).toContain('tag-jade');
    expect(within(won).getByText('Won').className).not.toContain('tag-gray');
  });
});
