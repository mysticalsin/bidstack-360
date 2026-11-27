// The phone drawer is the only primary nav below 56rem. A seeded deal opens
// its response at /rfp/:id/pipeline (the opportunity "RFP Pipeline" control).
// That path is not the deal board (/pipeline) and it is not /proposals/:id.
//
// The drawer treats Bids as inactive there, so the group stays shut. On a
// demo response the open drawer is section headers and Settings: the work
// on screen has no door, and a Bids collapse remembered from an earlier
// visit keeps it that way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { SHELL_WIDE_QUERY } from './shellBreakpoint';
import { useAccountHistory } from '@/stores/accountHistory';
import { useUiStore } from '@/stores/ui';
import { mockMatchMedia } from '@/test/matchMedia';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

// Synthetic demo bid. Not a customer id.
const RESPONSE = '/rfp/sample-bid/pipeline';

function renderDrawer(path: string) {
  mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
  render(
    <MemoryRouter initialEntries={[path]}>
      <div className="app-shell">
        <button
          type="button"
          aria-controls="mobile-nav-drawer"
          onClick={() => useUiStore.getState().toggleMobileNav()}
        >
          Open navigation
        </button>
        <MobileNav />
      </div>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  return screen.getByRole('dialog', { name: 'Primary navigation' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.style.overflow = '';
  useAccountHistory.setState({ recents: [], favorites: [] });
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('phone drawer on a demo RFP response', () => {
  it('keeps Proposals current and Bids open on the response pipeline', () => {
    const drawer = renderDrawer(RESPONSE);
    const proposals = within(drawer).getByRole('link', { name: 'Proposals' });
    const matrix = within(drawer).getByRole('link', { name: 'Bid/No-Bid Matrix' });

    // The group has to be open or the door is not in the drawer at all.
    expect(within(drawer).getByRole('button', { name: 'Bids & RFP' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(proposals.getAttribute('href')).toBe('/proposals');
    expect(proposals.getAttribute('aria-current')).toBe('page');
    expect(proposals.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(matrix.getAttribute('aria-current')).not.toBe('page');
    expect(matrix.className).not.toContain('bg-[var(--brand-primary-tint)]');
    // The deal board owns Opportunities. This page must not take that pin.
    expect(
      within(drawer).queryByRole('link', { name: 'Opportunities' })?.getAttribute('aria-current') ?? null,
    ).not.toBe('page');
  });

  it('reopens a Bids group that was left shut when the response is the page', () => {
    useUiStore.setState({ collapsedSections: { bids: true, accounts: false } });

    const drawer = renderDrawer(RESPONSE);

    expect(within(drawer).getByRole('link', { name: 'Proposals' }).getAttribute('aria-current')).toBe('page');
    expect(within(drawer).queryByRole('link', { name: 'Accounts' })).toBeNull();
    expect(useUiStore.getState().collapsedSections.bids).toBe(false);
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('does not mark Proposals current on the deal board', () => {
    const drawer = renderDrawer('/pipeline');
    const proposals = within(drawer).queryByRole('link', { name: 'Proposals' });

    expect(within(drawer).getByRole('button', { name: 'Bids & RFP' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(proposals?.getAttribute('aria-current') ?? null).not.toBe('page');
  });
});
