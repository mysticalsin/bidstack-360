// The phone drawer is the only primary nav below 56rem. The calls list
// opens at /calls (the command palette). That path is not /opportunities,
// and it is not the deal board (/pipeline).
//
// The drawer treats Pipeline as inactive there, so the group stays shut.
// On the demo calls list the open drawer is section headers and Settings:
// the page on screen has no door, and a Pipeline collapse remembered from
// an earlier visit keeps it that way. A remembered Accounts open leaves
// the wrong section on screen.
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

// Synthetic demo path. Not a customer record.
const CALLS = '/calls';

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

describe('phone drawer on the demo calls list', () => {
  it('keeps Opportunities current and Pipeline open on the calls list', () => {
    const drawer = renderDrawer(CALLS);
    const opportunities = within(drawer).getByRole('link', { name: 'Opportunities' });
    const leads = within(drawer).getByRole('link', { name: 'Leads' });

    // The group has to be open or the door is not in the drawer at all.
    expect(within(drawer).getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(opportunities.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(leads.getAttribute('aria-current')).not.toBe('page');
    expect(leads.className).not.toContain('bg-[var(--brand-primary-tint)]');
  });

  it('reopens a Pipeline group that was left shut when the calls list is the page', () => {
    useUiStore.setState({ collapsedSections: { pipeline: true, accounts: false } });

    const drawer = renderDrawer(CALLS);

    expect(within(drawer).getByRole('link', { name: 'Opportunities' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(drawer).queryByRole('link', { name: 'Accounts' })).toBeNull();
    expect(useUiStore.getState().collapsedSections.pipeline).toBe(false);
    expect(useUiStore.getState().collapsedSections.accounts).toBe(true);
  });

  it('does not mark Opportunities current on a response path or a deeper calls path', () => {
    const response = renderDrawer('/rfp/sample-bid/pipeline');
    expect(within(response).getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(within(response).queryByRole('link', { name: 'Opportunities' })).toBeNull();

    cleanup();
    useUiStore.setState({ mobileNavOpen: false });
    const deeper = renderDrawer('/calls/sample-call');
    expect(
      within(deeper).queryByRole('link', { name: 'Opportunities' })?.getAttribute('aria-current') ?? null,
    ).not.toBe('page');
  });
});
