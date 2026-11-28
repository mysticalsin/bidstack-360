// Demo OP-2041 is 1,240,000 with no currency. The deal record says "Currency
// not set". The board was still sending that number through the euro
// converter, so the card, the column total, and the pipeline tiles rendered
// a euro amount (and a compact euro million once the figure passed 1,000,000).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { PipelinePage } from './PipelinePage';

const formatMoney = vi.hoisted(() => vi.fn((value: number) => `EUR-CONVERTED ${value}`));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney }),
}));

vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({ useStageMutation: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const STAGE: PipelineStage = {
  id: 's3_technical_iteration',
  name: 'S3 Technical Iteration',
  probability: 60,
  color: '#14b8a6',
  isWon: false,
  isLost: false,
};

const OP_2041: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial — IT Modernization & MSP',
  stage: 's3_technical_iteration',
  pipelineStageId: STAGE.id,
  pipelineStage: STAGE,
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
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

const CARD_AMOUNT = formatUnspecifiedAmount(1_240_000);
const BOOK_AMOUNT = formatUnspecifiedAmount(9_000_000);
const OPEN_AMOUNT = formatUnspecifiedAmount(3_200_000);

function renderBoard() {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items: [OP_2041], nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineReport).mockReturnValue({
    data: {
      byStage: [{ stage: 's3_technical_iteration', count: 4, valueSum: 9_000_000 }],
      totalOpen: 4,
      totalValueOpen: 3_200_000,
      weightedPipeline: 2_000_000,
      velocity: { avgDaysOpen: 12, closedThisQuarter: 0 },
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePipelineReport>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [
        {
          ...STAGE,
          key: STAGE.id,
          orderIndex: 0,
          forecastCategory: '',
          updatedAt: '',
        },
      ],
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
  formatMoney.mockClear();
});

describe('deal board amounts have no currency', () => {
  it('does not convert demo OP-2041, its column, or the pipeline tiles into euros', () => {
    // WHY: the record for this bid says the currency was never stored. A euro
    // symbol, a compact euro million, or a display-currency conversion would
    // contradict that and invent a forecast.
    renderBoard();

    expect(formatMoney).not.toHaveBeenCalled();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/EUR-CONVERTED|€/);
    expect(text).toContain(CARD_AMOUNT);
    expect(text).toContain(BOOK_AMOUNT);
    expect(text).toContain(OPEN_AMOUNT);
    expect(text).toContain(UNSPECIFIED_CURRENCY_BASIS);

    const card = screen.getByRole('link', { name: /OP-2041/ });
    const label = card.getAttribute('aria-label') ?? '';
    expect(label).toContain(CARD_AMOUNT);
    expect(label).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(label).not.toMatch(/EUR-CONVERTED|€|EUR/);

    const totalPipeline = screen.getByText('Total pipeline').parentElement;
    expect(totalPipeline?.textContent).toContain(BOOK_AMOUNT);
    expect(totalPipeline?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(totalPipeline?.textContent).not.toMatch(/€/);

    const openValue = screen.getByText('Open value').parentElement;
    expect(openValue?.textContent).toContain(OPEN_AMOUNT);
    expect(openValue?.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);

    // A percent and a count are not amounts. The basis belongs on the money tiles.
    expect(screen.getByText('Win rate').parentElement?.textContent).not.toContain(
      UNSPECIFIED_CURRENCY_BASIS,
    );
    expect(screen.getByText('Active deals').parentElement?.textContent).not.toContain(
      UNSPECIFIED_CURRENCY_BASIS,
    );

    const column = screen.getByTestId('pipeline-column');
    expect(column.textContent).toContain(CARD_AMOUNT);
    expect(column.textContent).toContain(UNSPECIFIED_CURRENCY_BASIS);
    expect(column.textContent).not.toMatch(/€|EUR-CONVERTED/);
    // The card and the column total each name the missing currency. The count
    // next to the total does not, because it is not an amount.
    expect(column.querySelectorAll(`[title="${UNSPECIFIED_CURRENCY_BASIS}"]`)).toHaveLength(2);
  });
});
