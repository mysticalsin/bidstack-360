import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

const { openTemplatePicker, markChecklistItem, storeState, authState } = vi.hoisted(() => {
  const markChecklistItem = vi.fn();
  const openTemplatePicker = vi.fn();
  const storeState = {
    completedChecklist: [] as string[],
    markChecklistItem,
    startTour: vi.fn(),
    tourActive: false,
    openTemplatePicker,
  };
  const authState = {
    isLoaded: true,
    user: null as { fullName: string | null; firstName: string | null } | null,
  };
  return { openTemplatePicker, markChecklistItem, storeState, authState };
});

// Render with i18n fallbacks so we match on the English label text users see.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: vi.fn() }));

// Empty store: nothing completed, tour inactive, so every checklist item is
// actionable and we exercise the deep-link path rather than the done state.
vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => storeState,
}));

// The profile row reads the same session the profile card shows. Tests set
// the loaded user; they do not boot Clerk or the demo door.
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isLoaded: authState.isLoaded, isSignedIn: authState.user != null }),
  useUser: () => ({ user: authState.user }),
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
    storeState.completedChecklist = [];
    authState.isLoaded = true;
    authState.user = null;
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

function profileButton() {
  return screen.getByRole('button', { name: /Complete your profile/ });
}

describe('QuickStart profile row follows the session name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.completedChecklist = [];
    authState.isLoaded = true;
    authState.user = null;
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  // A click only opens Profile & Security. The profile card is read-only, so
  // the click cannot add a name. Checking the row here leaves an unnamed
  // session looking finished.
  it('does not check the profile row when the click only opens Profile and Security', () => {
    renderPage();
    fireEvent.click(screen.getByText('Complete your profile'));
    expect(markChecklistItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=security');
  });

  // Demo sign-in already shows "Demo User" (or a first name) on the profile
  // card. The checklist must not keep asking for a profile the session has.
  it.each([
    ['Demo User', null],
    [null, 'Ada'],
  ] as const)(
    'shows the profile row done when the loaded session name is (%j, %j)',
    (fullName, firstName) => {
      authState.user = { fullName, firstName };
      renderPage();
      expect(profileButton().getAttribute('aria-pressed')).toBe('true');
    },
  );

  // A stored click from an older session must not survive a settled blank name.
  // Whitespace is not a name the profile card can show.
  it('reopens a stored profile click when the loaded name is blank', () => {
    authState.user = { fullName: '   ', firstName: null };
    storeState.completedChecklist = ['profile'];
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('false');
  });

  // The name read has not settled yet. A stored click stays. Clearing it
  // would flicker the row open on every refresh.
  it('keeps a stored profile click while the session is still loading', () => {
    authState.isLoaded = false;
    authState.user = null;
    storeState.completedChecklist = ['profile'];
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('true');
  });

  // An empty demo session is not a profile read. Leave the stored click.
  // Do not treat "signed out" as proof the name is blank.
  it('keeps a stored profile click when the loaded session has no user', () => {
    authState.isLoaded = true;
    authState.user = null;
    storeState.completedChecklist = ['profile'];
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('true');
  });

  // Leads, deals, and teammates are other rows. A seeded demo book must not
  // close the profile step when the session still has no name.
  it('does not treat leads, deals, or teammates as a completed profile', () => {
    authState.user = { fullName: null, firstName: null };
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [{ id: 'a' }, { id: 'b' }] } as never);
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('false');
  });
});
