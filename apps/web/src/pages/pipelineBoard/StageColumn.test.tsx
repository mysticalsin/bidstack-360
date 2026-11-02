import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import { StageColumn } from './StageColumn';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const { animate: _a, transition: _t, ...domProps } = rest as Record<string, unknown>;
          return <div {...domProps}>{children}</div>;
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

function opp(id: string, value: number): Opportunity {
  return {
    id,
    code: 'OP-1',
    customer: 'CI Financial',
    name: `Deal ${id}`,
    stage: 's1_lead',
    pipelineStageId: null,
    pipelineStage: null,
    value,
    probability: null,
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
}

describe('StageColumn', () => {
  afterEach(cleanup);

  it('sums the cards in the column and does not invent a conversion rate', () => {
    // WHY: a later column is not evidence that a deal advanced. The header
    // is only the cards sitting here.
    render(
      <MemoryRouter>
        <StageColumn
          stageId="s1_lead"
          stageName="S1 Lead"
          stageColor={null}
          items={[opp('a', 100_000), opp('b', 25_000)]}
          totalMicros="125000000000"
          isHoverTarget={false}
          draggingId={null}
          focusedId={null}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onDrop={vi.fn()}
          onCardDragStart={vi.fn()}
          onCardDragEnd={vi.fn()}
          onCardFocus={vi.fn()}
          onCardBlur={vi.fn()}
          onCardKey={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/125K unspecified/)).toBeTruthy();
    expect(screen.queryByLabelText(/Conversion rate/)).toBeNull();
    expect(screen.getByLabelText('S1 Lead column with 2 opportunities')).toBeTruthy();
  });

  it('prints a column past the safe unit count in full', () => {
    // WHY: compacting the collapsed unit number prints one unit low.
    const huge = (9007199254740993n * 1_000_000n).toString();
    render(
      <MemoryRouter>
        <StageColumn
          stageId="s1_lead"
          stageName="S1 Lead"
          stageColor={null}
          items={[opp('a', 0)]}
          totalMicros={huge}
          isHoverTarget={false}
          draggingId={null}
          focusedId={null}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onDrop={vi.fn()}
          onCardDragStart={vi.fn()}
          onCardDragEnd={vi.fn()}
          onCardFocus={vi.fn()}
          onCardBlur={vi.fn()}
          onCardKey={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/9,007,199,254,740,993 unspecified/)).toBeTruthy();
    expect(screen.queryByText(/9,007,199,254,740,992/)).toBeNull();
  });

  it('uses the singular opportunity label when the column has one card', () => {
    render(
      <MemoryRouter>
        <StageColumn
          stageId="s1_lead"
          stageName="S1 Lead"
          stageColor={null}
          items={[opp('a', 100_000)]}
          totalMicros="100000000000"
          isHoverTarget={false}
          draggingId={null}
          focusedId={null}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onDrop={vi.fn()}
          onCardDragStart={vi.fn()}
          onCardDragEnd={vi.fn()}
          onCardFocus={vi.fn()}
          onCardBlur={vi.fn()}
          onCardKey={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('S1 Lead column with 1 opportunity')).toBeTruthy();
  });
});
