import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

// The bid/no-bid step is the checklist row a seeded demo can already have
// finished. The signal is a bid score, not a click and not a lead or a deal.
const bidScores = vi.hoisted(() => ({
  current: { data: 0 as number | undefined, isSuccess: true, isError: false },
}));

const checklist = vi.hoisted(() => ({ items: [] as string[] }));

// Render with i18n fallbacks so we match on the English label text users see.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: vi.fn() }));
vi.mock('@/hooks/useBidScore', () => ({
  useChecklistBidScoreCount: () => bidScores.current,
}));

const openTemplatePicker = vi.fn();

// Empty store: nothing completed, tour inactive, so every checklist item is
// actionable and we exercise the deep-link path rather than the done state.
vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => ({
    completedChecklist: checklist.items,
    markChecklistItem: vi.fn(),
    startTour: vi.fn(),
    tourActive: false,
    openTemplatePicker,
  }),
}));

// Surfaces the live URL (path + search) so a click assertion can prove the item
// deep-linked to the right screen, including the ?tab= query.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quick-start']}>
      <Routes>
        <Route path="/quick-start" element={<QuickStartPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('QuickStartPage deep links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checklist.items = [];
    bidScores.current = { data: 0, isSuccess: true, isError: false };
    // Zero workspace data → no derived item reads as done.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  // Each row drives a first-run action; landing the user on the wrong screen (or
  // a dead-end tour) is the exact regression this guards against.
  it.each([
    ['Complete your profile', '/settings?tab=security'],
    ['Add your first lead', '/leads/new'],
    ['Log your first activity', '/contacts'],
    ['Run your first bid/no-bid', '/bid-matrix'],
    ['Start your first RFP response', '/proposals'],
    ['Create your first deal', '/pipeline'],
    ['Invite your team', '/settings?tab=groups'],
  ])('routes "%s" to %s', (label, destination) => {
    renderPage();
    fireEvent.click(screen.getByText(label));
    expect(screen.getByTestId('location').textContent).toBe(destination);
  });

  it('opens the template picker instead of navigating for the template step', () => {
    renderPage();
    fireEvent.click(screen.getByText('Pick a template pipeline'));
    expect(openTemplatePicker).toHaveBeenCalledTimes(1);
    // No navigation occurred — the page itself is still mounted.
    expect(screen.queryByTestId('location')).toBeNull();
  });
});

function bidButton() {
  return screen.getByRole('button', { name: /Run your first bid\/no-bid/ });
}

describe('QuickStartPage bid/no-bid step on a seeded workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checklist.items = [];
    bidScores.current = { data: 0, isSuccess: true, isError: false };
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  it('counts a seeded bid score as the first bid/no-bid without a click', () => {
    // WHY: demo sign-in already scores the DNB Bank landing zone (OP-2048).
    // The row has to read that score. A click must not be required, and the
    // progress check must not stay open on a book that already has one.
    bidScores.current = { data: 1, isSuccess: true, isError: false };

    renderPage();

    expect(bidButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('does not treat a lead or a deal as a bid/no-bid score', () => {
    // WHY: the org summary counts leads and opportunities. A full demo book of
    // those is not a scored matrix. Using it would mark the step done for a
    // workspace that has never rated fit, value, and win probability.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8 },
    } as never);
    bidScores.current = { data: 0, isSuccess: true, isError: false };

    renderPage();

    expect(bidButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('reopens the bid/no-bid step when the score list comes back empty', () => {
    // WHY: a click is not evidence. Once the read settles at zero, the step is
    // open again so an empty workspace is not congratulated for a score it does not have.
    checklist.items = ['first_email'];
    bidScores.current = { data: 0, isSuccess: true, isError: false };

    renderPage();

    expect(bidButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a stored click while the score read has not settled', () => {
    // WHY: loading is not zero. Wiping the click before the list arrives would
    // flash the step open on every visit, including a demo score that is about to count as done.
    checklist.items = ['first_email'];
    bidScores.current = { data: undefined, isSuccess: false, isError: false };

    renderPage();

    expect(bidButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the bid/no-bid step to a click when scores cannot be read', () => {
    // WHY: a denied opportunities:read must not wipe a step the visitor already
    // acknowledged, and must not invent a scored bid from a failed read.
    checklist.items = ['first_email'];
    bidScores.current = { data: undefined, isSuccess: false, isError: true };

    renderPage();

    expect(bidButton().getAttribute('aria-pressed')).toBe('true');
  });
});
