import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

// The activity step is the checklist row a seeded demo can already have
// finished with calls, emails, and notes. The count is the activity list
// total, not a click and not the org-summary feed of leads and deals.
const activityCount = vi.hoisted(() => ({
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
vi.mock('@/hooks/useActivityFeed', () => ({
  useChecklistActivityCount: () => activityCount.current,
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
    activityCount.current = { data: 0, isSuccess: true, isError: false };
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

function activityButton() {
  return screen.getByRole('button', { name: /Log your first activity/ });
}

describe('QuickStartPage activity step on a seeded workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checklist.items = [];
    activityCount.current = { data: 0, isSuccess: true, isError: false };
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  it('counts seeded calls, emails, and notes as the first activity without a click', () => {
    // WHY: demo sign-in already logs a timeline (landing-zone workshop, procurement
    // call, and the rest of the bid-chart activities). The row has to read that
    // book. A click must not be required, and the progress check must not stay open.
    activityCount.current = { data: 20, isSuccess: true, isError: false };

    renderPage();

    expect(activityButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('does not treat a lead or a deal as a logged call, email, or note', () => {
    // WHY: org-summary recent activity is leads, deals, tasks, and cases. A full
    // demo book of those is not a logged activity. Using it would mark the step
    // done for a workspace that has never recorded a call.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8, recentActivity: [{ type: 'lead' }] },
    } as never);
    activityCount.current = { data: 0, isSuccess: true, isError: false };

    renderPage();

    expect(activityButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('reopens the activity step when the timeline comes back empty', () => {
    // WHY: a click is not evidence. Once the count settles at zero, the step is
    // open again so an empty workspace is not congratulated for a log it does not have.
    checklist.items = ['first_activity'];
    activityCount.current = { data: 0, isSuccess: true, isError: false };

    renderPage();

    expect(activityButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a stored click while the activity read has not settled', () => {
    // WHY: loading is not zero. Wiping the click before the total arrives would
    // flash the step open on every visit, including a demo timeline that is about to count as done.
    checklist.items = ['first_activity'];
    activityCount.current = { data: undefined, isSuccess: false, isError: false };

    renderPage();

    expect(activityButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the activity step to a click when the timeline cannot be read', () => {
    // WHY: a denied activities:read must not wipe a step the visitor already
    // acknowledged, and must not invent a logged call from a failed read.
    checklist.items = ['first_activity'];
    activityCount.current = { data: undefined, isSuccess: false, isError: true };

    renderPage();

    expect(activityButton().getAttribute('aria-pressed')).toBe('true');
  });
});
