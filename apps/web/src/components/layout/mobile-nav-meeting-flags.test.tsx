// The phone drawer is the only primary nav below 56rem. A cross-region
// flag opens at /meeting-intel/flags/:id (the notification and watchdog
// link). That path is not /meetings and it is not /meetings/flags.
//
// The drawer treats Accounts as inactive there, so the group stays shut.
// On a demo flag the open drawer is section headers and Settings: the
// page on screen has no door, and an Accounts collapse remembered from
// an earlier visit keeps it that way.
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

// Synthetic demo flag. Not a customer id.
const FLAG = '/meeting-intel/flags/sample-flag';

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

describe('phone drawer on a demo meeting flag', () => {
  it('keeps Meetings current and Accounts open on the flag', () => {
    const drawer = renderDrawer(FLAG);
    const meetings = within(drawer).getByRole('link', { name: 'Meetings' });
    const accounts = within(drawer).getByRole('link', { name: 'Accounts' });

    // The group has to be open or the door is not in the drawer at all.
    expect(within(drawer).getByRole('button', { name: 'Accounts' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(meetings.getAttribute('href')).toBe('/meetings');
    expect(meetings.getAttribute('aria-current')).toBe('page');
    expect(meetings.className).toContain('bg-[var(--brand-primary-tint)]');
    expect(accounts.getAttribute('aria-current')).not.toBe('page');
    expect(accounts.className).not.toContain('bg-[var(--brand-primary-tint)]');
  });

  it('reopens an Accounts group that was left shut when the flag is the page', () => {
    useUiStore.setState({ collapsedSections: { accounts: true, sales: false } });

    const drawer = renderDrawer(FLAG);

    expect(within(drawer).getByRole('link', { name: 'Meetings' }).getAttribute('aria-current')).toBe('page');
    expect(within(drawer).queryByRole('link', { name: 'Forecasts' })).toBeNull();
    expect(useUiStore.getState().collapsedSections.accounts).toBe(false);
    expect(useUiStore.getState().collapsedSections.sales).toBe(true);
  });

  it('does not mark Meetings current on the deal board or a deeper flag path', () => {
    const board = renderDrawer('/pipeline');
    expect(within(board).getByRole('button', { name: 'Accounts' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(within(board).queryByRole('link', { name: 'Meetings' })).toBeNull();

    cleanup();
    useUiStore.setState({ mobileNavOpen: false });
    const deeper = renderDrawer('/meeting-intel/flags/sample-flag/notes');
    expect(within(deeper).queryByRole('link', { name: 'Meetings' })?.getAttribute('aria-current') ?? null).not.toBe(
      'page',
    );
  });
});
