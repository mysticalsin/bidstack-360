// Analytics & Reports is the only rail door for the insights book. The
// analytics page links to the saved-reports library (/reports/list), the
// report builder (/reports/new and /reports/:id/edit), and Manage dashboards
// (/dashboards). Those pages left the door idle: the Workspace group shut,
// the collapsed-rail flyout showed no current item, and the phone drawer
// opened with nothing marked.
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

const REPORTS = '/reports/list';
const BUILDER = '/reports/sample-report/edit';
const DASHBOARDS = '/dashboards';
const DOOR = 'Analytics & Reports';

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

function expectDoor(root: HTMLElement) {
  const door = link(root, DOOR);
  expect(door.getAttribute('aria-current')).toBe('page');
  // The door still opens the analytics page. The library and the dashboard
  // manager are where you are, not new hrefs.
  expect(door.getAttribute('href')).toBe('/analytics');
  expect(link(root, 'Tasks').getAttribute('aria-current')).not.toBe('page');
  expect(link(root, 'CRM Insights').getAttribute('aria-current')).not.toBe('page');
}

describe('analytics door on the reports library and dashboards', () => {
  it('keeps Analytics & Reports current and Workspace open on the reports library', () => {
    renderRail(REPORTS);
    const nav = rail();

    expect(within(nav).getByRole('button', { name: 'Workspace' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expectDoor(nav);
  });

  it('keeps Analytics & Reports current on the report builder', () => {
    renderRail(BUILDER);
    expectDoor(rail());
  });

  it('keeps Analytics & Reports current on Manage dashboards', () => {
    renderRail(DASHBOARDS);
    expectDoor(rail());
  });

  it('reopens a Workspace group the user had shut when the reports library is the page', () => {
    useUiStore.setState({ collapsedSections: { workspace: true, sales: false } });

    renderRail(REPORTS);

    expectDoor(rail());
    expect(useUiStore.getState().collapsedSections.workspace).toBe(false);
    expect(useUiStore.getState().collapsedSections.sales).toBe(true);
  });

  it('keeps Analytics & Reports current in the collapsed-rail flyout on the reports library', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderRail(REPORTS);

    const nav = rail();
    expect(link(nav, DOOR).getAttribute('aria-current')).toBe('page');
    expect(link(nav, DOOR).getAttribute('href')).toBe('/analytics');
    expect(link(nav, 'Tasks').getAttribute('aria-current')).not.toBe('page');
    expect(link(nav, 'CRM Insights').getAttribute('aria-current')).not.toBe('page');
  });

  it('keeps Analytics & Reports current in the phone drawer on the reports library', () => {
    const drawer = renderDrawer(REPORTS);
    const door = link(drawer, DOOR);
    const tasks = link(drawer, 'Tasks');

    expect(door.getAttribute('aria-current')).toBe('page');
    expect(door.getAttribute('href')).toBe('/analytics');
    expect(door.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(tasks.getAttribute('aria-current')).not.toBe('page');
    expect(tasks.className).not.toContain('bg-[var(--brand-primary-tint)]');
  });

  it('keeps Analytics & Reports current in the phone drawer on Manage dashboards', () => {
    const drawer = renderDrawer(DASHBOARDS);
    expect(link(drawer, DOOR).getAttribute('aria-current')).toBe('page');
    expect(link(drawer, 'Tasks').getAttribute('aria-current')).not.toBe('page');
  });

  it('does not mark Analytics & Reports current on the home dashboard', () => {
    renderRail('/dashboard');
    const nav = rail();

    expect(link(nav, 'Dashboard').getAttribute('aria-current')).toBe('page');
    const door = within(nav).queryByRole('link', { name: DOOR, exact: true });
    expect(door?.getAttribute('aria-current') ?? null).not.toBe('page');
  });

  it('does not mark the collapsed flyout current on the home dashboard', () => {
    // /dashboards is an alias. /dashboard must not match that prefix.
    useUiStore.setState({ sidebarCollapsed: true });
    renderRail('/dashboard');
    const nav = rail();

    expect(link(nav, 'Dashboard').getAttribute('aria-current')).toBe('page');
    expect(link(nav, DOOR).getAttribute('aria-current')).not.toBe('page');
  });

  it('does not mark Analytics & Reports current on CRM Insights', () => {
    renderRail('/workspace/insights');
    const nav = rail();

    expect(link(nav, 'CRM Insights').getAttribute('aria-current')).toBe('page');
    expect(link(nav, DOOR).getAttribute('aria-current')).not.toBe('page');
  });
});
