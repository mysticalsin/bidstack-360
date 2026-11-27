// Demo seed gives every bid, including a won bid and a lost bid, a due date
// 45 days out. The board card counted that down ("45d left") on Stellantis
// (closed won) and Spotify (closed lost). The deadline is not live once the
// board has decided the bid. An open bid keeps the countdown.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import { PipelineCard } from './PipelineCard';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const {
            layout: _l,
            layoutId: _lid,
            initial: _i,
            animate: _a,
            exit: _e,
            whileHover: _wh,
            transition: _tr,
            ...domProps
          } = rest as Record<string, unknown>;
          return <li {...domProps}>{children}</li>;
        },
    },
  ),
  useReducedMotion: () => true,
}));

const FUTURE = '2099-12-31';
const PAST = '2020-01-01';

function opp(patch: Partial<Opportunity>): Opportunity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'OP-0005',
    customer: 'Stellantis',
    name: 'EV Fleet Telematics',
    stage: 'closed_won',
    pipelineStageId: null,
    pipelineStage: null,
    value: 620_000,
    probability: 100,
    dueDate: FUTURE,
    owner: null,
    industry: 'Automotive',
    logo: null,
    country: 'IT',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...patch,
  };
}

function renderCard(patch: Partial<Opportunity>) {
  return render(
    <MemoryRouter>
      <ul>
        <PipelineCard
          opp={opp(patch)}
          isDragging={false}
          isFocused={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          onFocus={vi.fn()}
          onBlur={vi.fn()}
          onKey={vi.fn()}
        />
      </ul>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('deal board card due clock on a decided bid', () => {
  it('does not count down a won demo bid that still has a future due date', () => {
    // WHY: Stellantis OP-0005 is closed won and the seed still stores a due
    // date. "d left" tells a bid lead the submission clock is running.
    renderCard({ stage: 'closed_won', code: 'OP-0005', customer: 'Stellantis' });

    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText(/d left/i)).toBeNull();
    expect(screen.queryByText(/due today/i)).toBeNull();
    expect(screen.getByLabelText(/Closed bid/i)).toBeTruthy();
  });

  it('does not call a lost demo bid overdue from a past due date', () => {
    // WHY: a decided loss is not a late open bid. The red stall tint and
    // ", overdue" on the card name are the open-bid signal.
    renderCard({
      stage: 'closed_lost',
      code: 'OP-0006',
      customer: 'Spotify',
      name: 'Data Lakehouse Build',
      probability: 0,
      dueDate: PAST,
    });

    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).not.toContain(', overdue');
    expect(link.className).not.toContain('border-red-300/40');
  });

  it('stops the clock on a won column that is not named Closed Won', () => {
    // WHY: a stage named Won is still a win when isWon is set. The name check
    // for "Closed Won" leaves that card counting down.
    renderCard({
      stage: 's4_negotiation',
      code: 'OP-0099',
      customer: 'Northwind Synthetic',
      name: 'Synthetic win',
      probability: 100,
      dueDate: PAST,
      pipelineStageId: '22222222-2222-4222-8222-222222222222',
      pipelineStage: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Won',
        probability: 100,
        color: '#22c55e',
        isWon: true,
        isLost: false,
      },
    });

    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    const link = screen.getByRole('link');
    expect(link.className).not.toContain('border-red-300/40');
  });

  it('keeps the countdown on an open demo bid', () => {
    renderCard({
      stage: 's1_ongoing',
      code: 'OP-0004',
      customer: 'HSBC',
      name: 'Cybersecurity Transformation',
      probability: 25,
      dueDate: FUTURE,
    });

    expect(screen.getByText(/d left/i)).toBeTruthy();
    expect(screen.queryByText('Closed')).toBeNull();
  });
});
