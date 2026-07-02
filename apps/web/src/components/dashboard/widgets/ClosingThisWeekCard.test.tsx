// Dashboard "bid clock" strip: covers the three states that matter for a
// deadline-facing widget — no bids due (empty), bids due (data, sorted
// soonest-first, closed deals excluded), and load failure (error). A widget
// that silently renders nothing on error looks identical to "nothing is
// due" — the empty-vs-error distinction is the thing this test protects.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Opportunity } from '@bidstack/shared';
import { ClosingThisWeekCard } from './ClosingThisWeekCard';

const hookMocks = vi.hoisted(() => ({
  data: undefined as { items: Opportunity[] } | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

// vi.fn() (not a bare arrow) so tests can assert the server-param wiring —
// a widget that silently drops `dueWithinDays` would fall back to the
// unfiltered/unordered default list and could clip the most urgent bid.
const useOpportunitiesMock = vi.hoisted(() => vi.fn(() => hookMocks));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const {
            initial: _i,
            animate: _a,
            exit: _e,
            whileHover: _wh,
            transition: _tr,
            ...domProps
          } = rest as Record<string, unknown>;
          return <div {...domProps}>{children}</div>;
        },
    },
  ),
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: useOpportunitiesMock,
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney: (v: number) => `€${v}` }),
}));

function renderCard() {
  return render(
    <MemoryRouter>
      <ClosingThisWeekCard />
    </MemoryRouter>,
  );
}

const OPEN_STAGE = {
  id: 's-open',
  name: 'S2 Sent',
  probability: 50,
  color: null,
  isWon: false,
  isLost: false,
};

function makeOpp(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
    code: 'OP-0001',
    customer: 'CI Financial',
    name: 'Core banking modernization',
    stage: 's2_sent',
    pipelineStageId: OPEN_STAGE.id,
    pipelineStage: OPEN_STAGE,
    value: 500_000,
    probability: 50,
    dueDate: '2026-07-05',
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
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  hookMocks.data = undefined;
  hookMocks.isLoading = false;
  hookMocks.isError = false;
  useOpportunitiesMock.mockClear();
});

describe('ClosingThisWeekCard', () => {
  it('requests the server-side 7-day due window instead of the unfiltered default list', () => {
    hookMocks.data = { items: [] };

    renderCard();

    expect(useOpportunitiesMock).toHaveBeenCalledWith({ dueWithinDays: 7, limit: 25 });
  });

  it('shows the empty-state copy when no opportunities are closing this week', () => {
    hookMocks.data = { items: [] };

    renderCard();

    expect(screen.getByText('No bids closing this week.')).toBeDefined();
  });

  it('shows the error state with a retry action when the fetch fails', () => {
    hookMocks.isError = true;

    renderCard();

    expect(screen.getByText("Couldn't load bids closing this week.")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('lists open opportunities soonest-due first and links each row to its detail page', () => {
    hookMocks.data = {
      items: [
        makeOpp({ id: 'later', name: 'Later bid', dueDate: '2026-07-08' }),
        makeOpp({ id: 'soonest', name: 'Soonest bid', dueDate: '2026-07-02' }),
      ],
    };

    renderCard();

    const links = screen.getAllByRole('link').filter((el) => el.getAttribute('href')?.startsWith('/opportunities/'));
    expect(links.map((el) => el.textContent)).toEqual([
      expect.stringContaining('Soonest bid'),
      expect.stringContaining('Later bid'),
    ]);
    expect(links[0]?.getAttribute('href')).toBe('/opportunities/soonest');
  });

  // WHY: a Closed Won/Lost bid with a stale dueDate inside the 7-day window
  // is not "closing" — it already closed. Showing it here would misdirect a
  // bid lead into re-chasing a dead deal.
  it('excludes closed opportunities even when their dueDate falls in the window', () => {
    hookMocks.data = {
      items: [
        makeOpp({
          id: 'won',
          name: 'Already won',
          pipelineStage: { ...OPEN_STAGE, isWon: true },
        }),
        makeOpp({ id: 'open', name: 'Still open' }),
      ],
    };

    renderCard();

    expect(screen.queryByText('Already won')).toBeNull();
    expect(screen.getByText('Still open')).toBeDefined();
  });
});
