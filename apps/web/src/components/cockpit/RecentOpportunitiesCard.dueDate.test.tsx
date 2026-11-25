// Demo close dates sit in April–September 2026. On a later day those open bids
// are overdue. The account cockpit row used to show stage and value only, so
// the bid looked current and the only way to see the deadline was to open it.
// A closed bid with a past close date is already decided — calling it overdue
// would send someone to chase a win.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import { RecentOpportunitiesCard } from './RecentOpportunitiesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoney: (v: number) => `€${v}` }),
}));

const OPEN: Opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial — IT Modernization & MSP',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
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

function renderCard(opp: Opportunity) {
  return render(
    <MemoryRouter>
      <RecentOpportunitiesCard
        opps={{ isLoading: false } as never}
        accountName={opp.customer}
        items={[opp]}
      />
    </MemoryRouter>,
  );
}

describe('RecentOpportunitiesCard due date', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says an open bid past its close date is overdue on the row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderCard(OPEN);

    const row = screen.getByRole('link', { name: /IT Modernization/ });
    const overdue = screen.getByText(/\d+d overdue/);
    expect(row.contains(overdue)).toBe(true);
    // Tomato foreground is the same urgency token as the deal board chip
    // (5.5:1 on white). A gray label would read as a normal date.
    expect(overdue.className).toContain('--tag-tomato-fg');
  });

  it('does not call a later close date overdue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderCard({ ...OPEN, dueDate: '2026-12-20' });

    expect(screen.getByText(/\d+d left/)).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('says when an open bid has no due date', () => {
    renderCard({ ...OPEN, dueDate: null });

    expect(screen.getByText('No date')).toBeTruthy();
  });

  it('does not call a closed bid overdue when its close date is in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderCard({ ...OPEN, stage: 'closed_won', dueDate: '2026-04-28' });

    expect(screen.queryByText(/overdue/)).toBeNull();
    expect(screen.queryByText('No date')).toBeNull();
  });

  it('does not call a won pipeline stage overdue when the legacy stage is still open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderCard({
      ...OPEN,
      stage: 's4_negotiation',
      pipelineStageId: '22222222-2222-4222-8222-222222222222',
      pipelineStage: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Won',
        probability: 100,
        color: null,
        isWon: true,
        isLost: false,
      },
      dueDate: '2026-04-28',
    });

    expect(screen.queryByText(/overdue/)).toBeNull();
  });
});
