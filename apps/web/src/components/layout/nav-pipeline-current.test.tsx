// The demo deal board is /pipeline. The rail door for that book is
// Opportunities. Opening the board (dashboard, Quick Start, or g p) left
// Opportunities idle and shut the Pipeline group, so the seeded bids
// (CI Financial, Logistec, and the rest) had no current item.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { SHELL_WIDE_QUERY } from './shellBreakpoint';
import { useAccountHistory } from '@/stores/accountHistory';
import { useUiStore } from '@/stores/ui';
import { mockMatchMedia } from '@/test/matchMedia';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

const BOARD = '/pipeline';

function renderRail(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function rail() {
  return screen.getByRole('navigation', { name: 'Primary navigation' });
}

function link(root: HTMLElement, name: string) {
  return within(root).getByRole('link', { name, exact: true });
}

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

describe('deal board current item', () => {
  it('keeps Opportunities current and the Pipeline group open on /pipeline', () => {
    renderRail(BOARD);
    const nav = rail();

    // The group has to be open or the door is not on the page at all.
    expect(within(nav).getByRole('button', { name: 'Pipeline' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    const opportunities = link(nav, 'Opportunities');
    expect(opportunities.getAttribute('aria-current')).toBe('page');
    // The door still opens the list. The board is where you are, not a new href.
    expect(opportunities.getAttribute('href')).toBe('/opportunities');
    expect(link(nav, 'Leads').getAttribute('aria-current')).not.toBe('page');
    expect(link(nav, 'Territories').getAttribute('aria-current')).not.toBe('page');
  });

  it('reopens a Pipeline group the user had shut when the board is the page', () => {
    useUiStore.setState({ collapsedSections: { pipeline: true, accounts: false } });

    renderRail(BOARD);

    expect(link(rail(), 'Opportunities').getAttribute('aria-current')).toBe('page');
    expect(useUiStore.getState().collapsedSections.pipeline).toBe(false);
  });

  it('keeps Opportunities current in the collapsed-rail flyout on /pipeline', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderRail(BOARD);

    expect(link(rail(), 'Opportunities').getAttribute('aria-current')).toBe('page');
    expect(link(rail(), 'Leads').getAttribute('aria-current')).not.toBe('page');
  });

  it('keeps Opportunities current in the drawer on /pipeline', () => {
    const drawer = renderDrawer(BOARD);
    const opportunities = link(drawer, 'Opportunities');
    const leads = link(drawer, 'Leads');

    expect(opportunities.getAttribute('aria-current')).toBe('page');
    expect(opportunities.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(leads.getAttribute('aria-current')).not.toBe('page');
    expect(leads.className).not.toContain('bg-[var(--brand-primary-tint)]');
  });

  it('does not treat an RFP stage path as the deal board', () => {
    renderRail('/rfp/sample-bid/pipeline');
    const nav = rail();
    const opportunities = within(nav).queryByRole('link', { name: 'Opportunities', exact: true });

    expect(opportunities?.getAttribute('aria-current') ?? null).not.toBe('page');
  });
});
