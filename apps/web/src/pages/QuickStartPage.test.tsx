import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useChecklistProfileNamed } from '@/hooks/usePoloIdentity';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

// Render with i18n fallbacks so we match on the English label text users see.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: vi.fn() }));
vi.mock('@/hooks/usePoloIdentity', () => ({ useChecklistProfileNamed: vi.fn() }));

const openTemplatePicker = vi.fn();
const markChecklistItem = vi.fn();
let completedChecklist: string[] = [];

// Empty store: nothing completed, tour inactive, so every checklist item is
// actionable and we exercise the deep-link path rather than the done state.
vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => ({
    completedChecklist,
    markChecklistItem,
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

function profileButton() {
  return screen.getByRole('button', { name: /Complete your profile/ });
}

function mockProfile(state: 'named' | 'blank' | 'pending' | 'error') {
  if (state === 'named') {
    vi.mocked(useChecklistProfileNamed).mockReturnValue({
      data: true,
      isSuccess: true,
      isFetching: false,
      isPending: false,
      isError: false,
    } as never);
    return;
  }
  if (state === 'blank') {
    vi.mocked(useChecklistProfileNamed).mockReturnValue({
      data: false,
      isSuccess: true,
      isFetching: false,
      isPending: false,
      isError: false,
    } as never);
    return;
  }
  if (state === 'pending') {
    vi.mocked(useChecklistProfileNamed).mockReturnValue({
      data: undefined,
      isSuccess: false,
      isFetching: true,
      isPending: true,
      isError: false,
    } as never);
    return;
  }
  vi.mocked(useChecklistProfileNamed).mockReturnValue({
    data: undefined,
    isSuccess: false,
    isFetching: false,
    isPending: false,
    isError: true,
  } as never);
}

describe('QuickStartPage deep links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completedChecklist = [];
    // Zero workspace data → no derived item reads as done.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
    // No stored display name. Opening Profile & Security must not close the row.
    mockProfile('blank');
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
    // No navigation occurred. The page itself is still mounted.
    expect(screen.queryByTestId('location')).toBeNull();
  });

  it('does not check the profile row when the click only opens settings', () => {
    renderPage();
    fireEvent.click(screen.getByText('Complete your profile'));
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=security');
    // Opening the profile screen is not a saved name.
    expect(markChecklistItem).not.toHaveBeenCalled();
  });
});

describe('QuickStartPage profile row follows the stored name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completedChecklist = [];
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  it('checks the profile row when the signed-in user already has a display name', () => {
    mockProfile('named');
    renderPage();
    // Demo sign-in stores a name. The row is done because that name is there,
    // not because someone opened settings.
    expect(profileButton().getAttribute('aria-pressed')).toBe('true');
    expect(completedChecklist).not.toContain('profile');
  });

  it('reopens a stored click when the name read settles blank', () => {
    completedChecklist = ['profile'];
    mockProfile('blank');
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a stored click while the name read is still in flight', () => {
    completedChecklist = ['profile'];
    mockProfile('pending');
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a stored click when the name read fails', () => {
    completedChecklist = ['profile'];
    mockProfile('error');
    renderPage();
    expect(profileButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('does not treat a seeded demo book as a completed profile', () => {
    // Leads, deals, and teammates are already in a demo workspace. They are
    // not the signed-in user's name, so the profile row stays open.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [{ id: 'a' }, { id: 'b' }] } as never);
    mockProfile('blank');
    renderPage();
    expect(screen.getByRole('button', { name: /Add your first lead/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Create your first deal/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Invite your team/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(profileButton().getAttribute('aria-pressed')).toBe('false');
  });
});
