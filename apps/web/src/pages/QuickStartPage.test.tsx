import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useChecklistTemplateInstalled } from '@/hooks/useOnboarding';
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
vi.mock('@/hooks/useOnboarding', () => ({ useChecklistTemplateInstalled: vi.fn() }));

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

function templateButton() {
  return screen.getByRole('button', { name: /Pick a template pipeline/ });
}

function mockTemplateStatus(state: 'installed' | 'empty' | 'pending' | 'error') {
  if (state === 'installed') {
    vi.mocked(useChecklistTemplateInstalled).mockReturnValue({
      data: true,
      isSuccess: true,
      isFetching: false,
      isPending: false,
      isError: false,
    } as never);
    return;
  }
  if (state === 'empty') {
    vi.mocked(useChecklistTemplateInstalled).mockReturnValue({
      data: false,
      isSuccess: true,
      isFetching: false,
      isPending: false,
      isError: false,
    } as never);
    return;
  }
  if (state === 'pending') {
    vi.mocked(useChecklistTemplateInstalled).mockReturnValue({
      data: undefined,
      isSuccess: false,
      isFetching: true,
      isPending: true,
      isError: false,
    } as never);
    return;
  }
  vi.mocked(useChecklistTemplateInstalled).mockReturnValue({
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
    // No template installed. Opening the picker must not close the row.
    mockTemplateStatus('empty');
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
    // Opening the picker is not an install. A click must not check the row.
    expect(markChecklistItem).not.toHaveBeenCalled();
    expect(templateButton().getAttribute('aria-pressed')).toBe('false');
  });
});

describe('QuickStartPage template row follows an install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completedChecklist = [];
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);
  });

  afterEach(() => cleanup());

  it('checks the template row when a template install is already in the workspace', () => {
    mockTemplateStatus('installed');
    renderPage();
    // The row is done because sample data from an install is there, not because
    // someone opened the picker.
    expect(templateButton().getAttribute('aria-pressed')).toBe('true');
    expect(completedChecklist).not.toContain('template');
  });

  it('reopens a stored click when the install read settles empty', () => {
    completedChecklist = ['template'];
    mockTemplateStatus('empty');
    renderPage();
    expect(templateButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a stored click while the install read is still in flight', () => {
    completedChecklist = ['template'];
    mockTemplateStatus('pending');
    renderPage();
    expect(templateButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a stored click when the install read fails', () => {
    completedChecklist = ['template'];
    mockTemplateStatus('error');
    renderPage();
    expect(templateButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('does not treat a seeded demo book as a picked template', () => {
    // Demo sign-in already has leads, deals, and teammates. Those are not one
    // of the four starter templates, so the template row stays open.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [{ id: 'a' }, { id: 'b' }] } as never);
    mockTemplateStatus('empty');
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
    expect(templateButton().getAttribute('aria-pressed')).toBe('false');
  });
});
