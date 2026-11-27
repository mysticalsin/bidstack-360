// Dashboard "bid clock" strip: covers the three states that matter for a
// deadline-facing widget — no bids due (empty), bids due (data, sorted
// soonest-first, closed deals excluded), and load failure (error). A widget
// that silently renders nothing on error looks identical to "nothing is
// due" — the empty-vs-error distinction is the thing this test protects.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// The 7-day window and the overdue read are different queries. A shared
// return would let a past-close book look like this week's clock.
const pastMocks = vi.hoisted(() => ({
  data: { items: [] as Opportunity[] } as { items: Opportunity[] } | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

// vi.fn() (not a bare arrow) so tests can assert the server-param wiring —
// a widget that silently drops `dueWithinDays` would fall back to the
// unfiltered/unordered default list and could clip the most urgent bid.
const useOpportunitiesMock = vi.hoisted(() =>
  vi.fn((filter?: { overdue?: boolean }) => (filter?.overdue ? pastMocks : hookMocks)),
);

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
  hookMocks.refetch.mockClear();
  pastMocks.data = { items: [] };
  pastMocks.isLoading = false;
  pastMocks.isError = false;
  pastMocks.refetch.mockClear();
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

  // WHY: on the demo book (25 Nov 2026) every open bid is already past its
  // close date, so the 7-day window is empty. "No bids closing this week" is
  // then a false all-clear for 11.89m of open pipeline.
  it('says the open book is past close when nothing is due in the next 7 days', () => {
    hookMocks.data = { items: [] };
    pastMocks.data = {
      items: [
        makeOpp({ id: 'won', name: 'Aritzia — Endpoint Refresh', stage: 'closed_won', pipelineStage: { ...OPEN_STAGE, isWon: true }, dueDate: '2026-04-28' }),
        makeOpp({ id: 'mapfre', name: 'MAPFRE — Identity & Access Overhaul', customer: 'MAPFRE', dueDate: '2026-09-30', value: 680_000 }),
        makeOpp({ id: 'rush', name: 'Rush University — EHR Cloud Migration', customer: 'Rush University System for Health', dueDate: '2026-06-30', value: 4_800_000 }),
        makeOpp({ id: 'ci', name: 'CI Financial — IT Modernization & MSP', customer: 'CI Financial', dueDate: '2026-07-22', value: 1_240_000 }),
      ],
    };

    renderCard();

    expect(useOpportunitiesMock).toHaveBeenCalledWith({ overdue: true, limit: 25 });
    expect(screen.queryByText('No bids closing this week.')).toBeNull();
    expect(screen.getByText('No bids are due in the next 7 days.')).toBeTruthy();
    expect(screen.getByText('3 open bids are already past close.')).toBeTruthy();
    expect(screen.queryByText('Aritzia — Endpoint Refresh')).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
    const bids = screen.getAllByRole('link').filter((el) => el.getAttribute('href')?.startsWith('/opportunities/'));
    expect(bids.map((el) => el.getAttribute('href'))).toEqual([
      '/opportunities/rush',
      '/opportunities/ci',
      '/opportunities/mapfre',
    ]);
    expect(bids[0]?.textContent).toContain('4.8m');
    const view = screen.getByRole('link', { name: 'View past close' });
    expect(view.getAttribute('href')).toBe('/opportunities?due=overdue');
    expect(screen.queryByRole('link', { name: 'View all' })).toBeNull();
  });

  it('keeps the clear week when the overdue read is only decided bids', () => {
    // WHY: a won bid with a stale due date is not an open deal past close.
    hookMocks.data = { items: [] };
    pastMocks.data = {
      items: [
        makeOpp({
          id: 'won',
          name: 'Aritzia — Endpoint Refresh',
          stage: 'closed_won',
          pipelineStage: { ...OPEN_STAGE, isWon: true },
          dueDate: '2026-04-28',
        }),
      ],
    };

    renderCard();

    expect(screen.getByText('No bids closing this week.')).toBeTruthy();
    expect(screen.queryByText(/already past close/)).toBeNull();
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/opportunities?due=within7');
  });

  it('does not call an empty week clear while the past-close read is still loading', () => {
    // WHY: the 7-day read can settle first. The all-clear sentence in that gap
    // is the same false week the demo book shows.
    hookMocks.data = { items: [] };
    pastMocks.data = undefined;
    pastMocks.isLoading = true;

    renderCard();

    expect(screen.queryByText('No bids closing this week.')).toBeNull();
    expect(screen.queryByText(/already past close/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'View past close' })).toBeNull();
  });

  it('does not call an empty week clear when the past-close read fails', () => {
    // WHY: a failed overdue read has not checked the open book. Retry repeats
    // that read. The control has to take a keyboard focus ring.
    hookMocks.data = { items: [] };
    pastMocks.isError = true;

    renderCard();

    expect(screen.queryByText('No bids closing this week.')).toBeNull();
    expect(screen.getByText("Couldn't load bids that are already past close.")).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    expect(retry.className).toContain('text-[var(--fg-primary)]');
    fireEvent.click(retry);
    expect(pastMocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a bid that is actually due this week on the week clock', () => {
    // WHY: past close replaces only the false empty week. A bid inside the
    // window is still the clock.
    hookMocks.data = { items: [makeOpp({ id: 'soon', name: 'Due this week', dueDate: '2026-11-28' })] };
    pastMocks.data = {
      items: [makeOpp({ id: 'rush', name: 'Rush University — EHR Cloud Migration', dueDate: '2026-06-30' })],
    };

    renderCard();

    expect(screen.getByText('Due this week')).toBeTruthy();
    expect(screen.queryByText(/already past close/)).toBeNull();
    expect(screen.queryByText('Rush University — EHR Cloud Migration')).toBeNull();
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/opportunities?due=within7');
  });
});
