// The phone drawer is the only primary nav below 56rem. The desktop rail pins
// Home: Dashboard and Quick Start stay on screen, with no disclosure, on every
// page. The drawer used to treat Home as just another accordion section.
//
// Two demo misses came from that:
// - On the demo home, one tap on HOME (or a collapse remembered from an
//   earlier visit) removed Dashboard and Quick Start. The open drawer then
//   held section headers and Settings, which reads as an empty nav.
// - On a demo account record the rail still shows Dashboard. The drawer hid
//   it until the person found the HOME header, so the phone nav disagreed
//   with the page they were on.
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

// Synthetic demo account. The cockpit route is /accounts/:id.
const DEMO_ACCOUNT = '/accounts/northwind-pharma';

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

describe('mobile drawer pins Home the way the rail does', () => {
  it('keeps Dashboard in the drawer on the demo home when Home was collapsed', () => {
    // A remembered collapse is what setSectionCollapsed writes. On the rail,
    // Home has no disclosure, so this override cannot empty the nav.
    useUiStore.setState({ collapsedSections: { home: true } });
    const drawer = renderDrawer('/dashboard');

    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(within(drawer).getByRole('link', { name: 'Quick Start' })).toBeTruthy();
    // Home is not a control. Tapping a header must not be what removes the
    // only links the demo home was showing.
    expect(within(drawer).queryByRole('button', { name: 'Home' })).toBeNull();
    // Pinning Home does not open the rest of the accordion.
    expect(within(drawer).queryByRole('link', { name: 'Accounts' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Accounts' })).toBeTruthy();
  });

  it('keeps Dashboard in the drawer on a demo account record', () => {
    const drawer = renderDrawer(DEMO_ACCOUNT);

    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Home' })).toBeNull();
    // The account is the page, so that section stays open.
    expect(within(drawer).getByRole('link', { name: 'Accounts' })).toBeTruthy();
  });
});
