// Regression coverage for Stage 10 (Lessons Learned) landing on the record.
//
// WHY: the WinLossRecord model and its PUT route already existed, but the only
// capture form was on the account dashboard behind an admin flag, and
// useWinLossRecord was dead code — so a recorded debrief was never visible on
// the opportunity it described. These cases pin the card's three real states:
// hidden while open, prompting when closed and empty, and read-only without
// write permission.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({
  useHasPermission: vi.fn(() => true),
  useHasAdminPermission: vi.fn(() => true),
  useCapabilities: vi.fn(() => ({ data: null })),
}));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const winLossMocks = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  upsertMutate: vi.fn(),
}));
vi.mock('@/hooks/useWinLoss', () => ({
  useWinLossRecord: () => ({
    data: winLossMocks.record,
    isLoading: false,
    isError: false,
  }),
  useUpsertWinLoss: () => ({ mutate: winLossMocks.upsertMutate, isPending: false }),
}));

import { LessonsLearnedCard } from './LessonsLearnedCard';

function renderCard(outcome: 'won' | 'lost' | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LessonsLearnedCard opportunityId="opp-1" outcome={outcome} />
    </QueryClientProvider>,
  );
}

describe('LessonsLearnedCard', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    winLossMocks.record = null;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing while the bid is still open', () => {
    const { container } = renderCard(null);
    expect(container.textContent).toBe('');
  });

  it('prompts for a debrief once the bid is closed', () => {
    renderCard('lost');
    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(
      screen.getByText('Stage 10 — document the win/loss factors within 5 business days of the award.'),
    ).toBeTruthy();
    expect(
      screen.getByText('No debrief recorded yet — capture it while it is fresh.'),
    ).toBeTruthy();
    // A lost bid asks what lost it, not what won it.
    expect(screen.getByText('Deciding loss factor')).toBeTruthy();
  });

  it('asks for the win factor on a won bid', () => {
    renderCard('won');
    expect(screen.getByText('Deciding win factor')).toBeTruthy();
  });

  it('seeds the form from the standing debrief and submits the outcome with it', () => {
    winLossMocks.record = {
      id: 'wl-1',
      opportunityId: 'opp-1',
      outcome: 'lost',
      reason: 'competitor',
      competitor: 'Globex',
      note: 'Undercut on rate card',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    renderCard('lost');
    expect((screen.getByLabelText('Primary factor') as HTMLSelectElement).value).toBe('competitor');
    expect((screen.getByLabelText('Competitor') as HTMLInputElement).value).toBe('Globex');

    fireEvent.change(screen.getByLabelText('Debrief notes'), {
      target: { value: 'Lost on price, kept the relationship' },
    });
    fireEvent.click(screen.getByText('Update debrief'));
    expect(winLossMocks.upsertMutate).toHaveBeenCalledWith(
      {
        opportunityId: 'opp-1',
        body: {
          outcome: 'lost',
          reason: 'competitor',
          competitor: 'Globex',
          note: 'Lost on price, kept the relationship',
        },
      },
      expect.anything(),
    );
  });

  it('shows the debrief read-only without opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    winLossMocks.record = {
      id: 'wl-1',
      opportunityId: 'opp-1',
      outcome: 'lost',
      reason: 'price',
      competitor: null,
      note: 'Too expensive',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    renderCard('lost');
    expect(screen.queryByLabelText('Debrief notes')).toBeNull();
    expect(screen.getByText('Price')).toBeTruthy();
    expect(screen.getByText('Too expensive')).toBeTruthy();
  });
});
