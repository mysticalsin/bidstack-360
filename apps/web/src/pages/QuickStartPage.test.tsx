import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { QuickStartPage } from './QuickStartPage';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';

// The RFP step is the one checklist row a demo workspace can already have
// finished. The count is the proposals list total, not a click.
const proposalCount = vi.hoisted(() => ({
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
vi.mock('@/hooks/useOnboarding', () => ({
  useChecklistProposalCount: () => proposalCount.current,
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
    proposalCount.current = { data: 0, isSuccess: true, isError: false };
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

describe('QuickStartPage on a workspace that already has proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checklist.items = [];
    // Demo sign-in seeds leads, deals, teammates, and RFP responses. The
    // checklist has to read that book, not ask the visitor to start from zero.
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 6, opportunities: 8 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({
      data: [{ id: 'visitor' }, { id: 'teammate' }],
    } as never);
    proposalCount.current = { data: 6, isSuccess: true, isError: false };
  });

  afterEach(() => cleanup());

  it('counts an existing RFP response as done and stops saying the workspace is at zero', () => {
    renderPage();

    expect(
      screen.getByRole('button', { name: /Start your first RFP response/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(
      screen.getByText('This workspace already has bid records. Finish the steps that are still open.'),
    ).toBeTruthy();
    expect(screen.queryByText('Get from zero to piloting your first bid.')).toBeNull();
  });

  it('does not keep the RFP step done from a click once the list comes back empty', () => {
    checklist.items = ['connect_email'];
    proposalCount.current = { data: 0, isSuccess: true, isError: false };
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { leads: 0, opportunities: 0 },
    } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as never);

    renderPage();

    expect(screen.getByRole('button', { name: /Start your first RFP response/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByText('Get from zero to piloting your first bid.')).toBeTruthy();
  });

  it('leaves the RFP step to a click when the proposal list cannot be read', () => {
    checklist.items = ['connect_email'];
    proposalCount.current = { data: undefined, isSuccess: false, isError: true };

    renderPage();

    // A 403 must not wipe a step the visitor already acknowledged, and must
    // not invent a finished RFP from a failed read.
    expect(
      screen.getByRole('button', { name: /Start your first RFP response/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
