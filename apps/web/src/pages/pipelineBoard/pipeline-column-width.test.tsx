import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { PipelinePage } from '../PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';

import {
  PIPELINE_COLUMN_GAP_PX,
  PIPELINE_COLUMN_MIN_PX,
  pipelineColumnWidth,
} from './pipeline-board-track';

// Board client width measured at a 1280 viewport: 232px sidebar and 28px of
// page padding on each side. A fixed 280px column slices the fourth stage.
const BOARD_AT_1280 = 992;
const FUNNEL_STAGES = 7;

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
  useStageMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const STAGES: PipelineStage[] = [
  'S1 Lead',
  'S1 Ongoing',
  'S2 Sent',
  'S3 Technical Iteration',
  'S4 Negotiation',
  'Closed Won',
  'Closed Lost',
].map((name, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  probability: 10 * (index + 1),
  color: null,
  isWon: name === 'Closed Won',
  isLost: name === 'Closed Lost',
}));

const OPPORTUNITY: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2048',
  customer: 'DNB Bank',
  name: 'Cloud landing zone',
  stage: STAGES[1]!.name,
  pipelineStageId: STAGES[1]!.id,
  pipelineStage: STAGES[1]!,
  value: 4_250_000,
  probability: 40,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

/**
 * How many stages sit fully inside the board, and how many start inside it
 * and run past the edge. A fixed 280px track at 992px has one partial stage.
 */
function columnFit(boardWidth: number, columnPx: number, stageCount: number) {
  const gap = PIPELINE_COLUMN_GAP_PX;
  let whole = 0;
  let partial = 0;
  let x = 0;
  for (let i = 0; i < stageCount; i += 1) {
    const right = x + columnPx;
    if (x < boardWidth - 0.5 && right <= boardWidth + 0.5) whole += 1;
    else if (x < boardWidth - 0.5 && right > boardWidth + 0.5) partial += 1;
    x = right + gap;
  }
  return { whole, partial };
}

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

describe('pipeline column width at 1280', () => {
  beforeEach(() => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [OPPORTUNITY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: STAGES.map((stage, index) => ({
          ...stage,
          key: stage.id,
          orderIndex: index,
          forecastCategory: '',
          updatedAt: '',
        })),
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
    // The 1280 board is 992px. Only the measured rail reports that width.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('data-testid') === 'pipeline-board' ? BOARD_AT_1280 : 0;
      },
    });
  });

  afterEach(() => {
    cleanup();
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
  });

  it('applies the computed width so three whole columns fit and a fixed 280px does not', () => {
    // WHY: gridAutoColumns: '280px' still contains the string gridAutoColumns
    // and leaves pipelineColumnWidth() callable, so the source checks pass.
    // The rail has to wear the computed width. At 992px that is one width,
    // three stages sit fully inside, and the fourth does not start in the
    // board. 280px leaves that fourth stage partial.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PipelinePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const board = view.container.querySelector('.snap-x');
    expect(board).toBeTruthy();
    const declared = (board as HTMLElement).style.gridAutoColumns;
    const px = Number.parseFloat(declared);
    const expected = pipelineColumnWidth(BOARD_AT_1280);
    expect(expected).toBeGreaterThan(PIPELINE_COLUMN_MIN_PX);
    expect(px).toBeCloseTo(expected, 5);
    expect(declared).toBe(`${expected}px`);
    expect(declared).not.toBe('280px');

    const fitted = columnFit(BOARD_AT_1280, px, FUNNEL_STAGES);
    expect(fitted.whole).toBe(3);
    expect(fitted.partial).toBe(0);

    const fixed = columnFit(BOARD_AT_1280, PIPELINE_COLUMN_MIN_PX, FUNNEL_STAGES);
    expect(fixed.partial).toBeGreaterThan(0);
  });
});
