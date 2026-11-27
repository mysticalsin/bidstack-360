// The primary nav's current item has to be the page the demo is actually on.
//
// Demo data is a book of records, and Settings is a stack of tabs. Three
// misses made the rail disagree with that page:
// - an account record (/accounts/:id) left Accounts idle in the drawer,
//   because the drawer matched the path exactly
// - a settings tab (/settings?tab=integrations) left Settings idle in the
//   drawer, because any tab other than overview cleared it
// - a custom object record (/settings/custom-objects/:id) lit Settings as
//   well as Custom Objects, because /settings is a prefix of that path and
//   Settings is its own rail item
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { ADMIN_SETTINGS, NAV_SECTIONS, isNavItemActive, type NavItem } from './navConfig';
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

const ACCOUNT = '/accounts/sample-account';
const SETTINGS_TAB = '/settings?tab=integrations';
const OBJECT_RECORD = '/settings/custom-objects/sample-object';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
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

function link(root: HTMLElement, name: string) {
  return within(root).getByRole('link', { name, exact: true });
}

function isCurrent(el: HTMLElement) {
  return el.getAttribute('aria-current') === 'page';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.style.overflow = '';
  useAccountHistory.setState({ recents: [], favorites: [] });
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

function itemTo(path: string): NavItem {
  const found = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.to === path);
  if (!found) throw new Error(`missing nav item ${path}`);
  return found;
}

describe('isNavItemActive', () => {
  it('counts a record under a rail path, and stops a parent that owns a child rail item', () => {
    const here = { pathname: ACCOUNT, search: '' };
    expect(isNavItemActive(itemTo('/accounts'), here)).toBe(true);
    expect(isNavItemActive(itemTo('/companies'), here)).toBe(false);

    const objectRecord = { pathname: OBJECT_RECORD, search: '' };
    expect(isNavItemActive(itemTo('/settings/custom-objects'), objectRecord)).toBe(true);
    expect(isNavItemActive(ADMIN_SETTINGS[0]!, objectRecord)).toBe(false);

    // A settings tab is still Settings. The tab is the page, not a different door.
    expect(
      isNavItemActive(ADMIN_SETTINGS[0]!, { pathname: '/settings', search: '?tab=integrations' }),
    ).toBe(true);

    // Collaborate is /workspace. CRM Insights must not light it too.
    expect(
      isNavItemActive(itemTo('/workspace'), { pathname: '/workspace/insights', search: '' }),
    ).toBe(false);
    expect(
      isNavItemActive(itemTo('/workspace/insights'), {
        pathname: '/workspace/insights',
        search: '',
      }),
    ).toBe(true);
  });
});

describe('primary nav current item under synthetic demo routes', () => {
  it('keeps Accounts current in the rail on an account record', () => {
    const { container } = renderSidebar(ACCOUNT);
    const rail = container.querySelector('nav');
    expect(rail).not.toBeNull();
    const nav = rail as HTMLElement;

    expect(isCurrent(link(nav, 'Accounts'))).toBe(true);
    expect(isCurrent(link(nav, 'Companies'))).toBe(false);
  });

  it('keeps Accounts current in the drawer on an account record', () => {
    const drawer = renderDrawer(ACCOUNT);

    const accounts = link(drawer, 'Accounts');
    const companies = link(drawer, 'Companies');

    // The tint is the drawer's current-item paint. aria-current alone can
    // come from the router while the row still looks idle.
    expect(accounts.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(isCurrent(accounts)).toBe(true);
    expect(companies.className).not.toContain('bg-[var(--brand-primary-tint)]');
    expect(isCurrent(companies)).toBe(false);
  });

  it('keeps Settings current in the drawer on a settings tab', () => {
    const drawer = renderDrawer(SETTINGS_TAB);
    const settings = link(drawer, 'Settings');

    expect(settings.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(isCurrent(settings)).toBe(true);
  });

  it('keeps Custom Objects current on a custom object record, and not Settings', () => {
    const { container } = renderSidebar(OBJECT_RECORD);
    const rail = container.querySelector('nav');
    expect(rail).not.toBeNull();
    const nav = rail as HTMLElement;

    const objects = link(nav, 'Custom Objects');
    const settings = link(nav, 'Settings');

    expect(isCurrent(objects)).toBe(true);
    expect(isCurrent(settings)).toBe(false);
  });

  it('keeps Custom Objects current in the drawer on a custom object record, and not Settings', () => {
    const drawer = renderDrawer(OBJECT_RECORD);
    const objects = link(drawer, 'Custom Objects');
    const settings = link(drawer, 'Settings');

    expect(objects.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(isCurrent(objects)).toBe(true);
    expect(settings.className).not.toContain('bg-[var(--brand-primary-tint)]');
    expect(isCurrent(settings)).toBe(false);
  });
});
