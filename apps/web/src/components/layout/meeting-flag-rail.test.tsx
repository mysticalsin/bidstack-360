// A cross-region flag opens at /meeting-intel/flags/:id (the notification and
// the account watchdog). That page is the meetings list, not a path under
// /meetings, so the rail left Accounts shut and Meetings was not the current
// item. A remembered collapse made it worse: Sales could stay open while
// Meetings was not on the rail. The phone drawer for this path is a separate
// change. This file guards the expanded rail, the stale accordion, and the
// collapsed-rail flyout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { useUiStore } from '@/stores/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunityCount: () => ({ data: undefined }) }));
vi.mock('@/hooks/useTasks', () => ({ useTaskSummary: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

const FLAG = '/meeting-intel/flags/sample-flag';

function renderSidebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

function meetingsLink() {
  return screen.getByRole('link', { name: 'Meetings', exact: true });
}

function accountsExpanded(): string | null {
  return screen.getByRole('button', { name: 'Accounts' }).getAttribute('aria-expanded');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('rail on a cross-region flag', () => {
  it('marks Meetings current and opens Accounts', () => {
    renderSidebar(FLAG);

    expect(accountsExpanded()).toBe('true');
    const meetings = meetingsLink();
    expect(meetings.getAttribute('aria-current')).toBe('page');
    expect(meetings.getAttribute('href')).toBe('/meetings');
  });

  it('opens Accounts when a previous visit left it shut and Sales open', () => {
    useUiStore.setState({ collapsedSections: { accounts: true, sales: false } });

    renderSidebar(FLAG);

    expect(accountsExpanded()).toBe('true');
    expect(meetingsLink().getAttribute('aria-current')).toBe('page');
    expect(useUiStore.getState().collapsedSections.accounts).toBe(false);
    expect(useUiStore.getState().collapsedSections.sales).toBe(true);
  });

  it('marks Meetings current in the collapsed-rail flyout', () => {
    useUiStore.setState({ sidebarCollapsed: true });

    renderSidebar(FLAG);

    const meetings = meetingsLink();
    expect(meetings.getAttribute('aria-current')).toBe('page');
    expect(meetings.getAttribute('href')).toBe('/meetings');
  });

  it('still marks Meetings current on its own door', () => {
    renderSidebar('/meetings');

    const meetings = meetingsLink();
    expect(meetings.getAttribute('aria-current')).toBe('page');
    expect(meetings.getAttribute('href')).toBe('/meetings');
    expect(accountsExpanded()).toBe('true');
  });

  it('still marks Meetings current on the in-app flags tab', () => {
    renderSidebar('/meetings/flags');

    const meetings = meetingsLink();
    expect(meetings.getAttribute('aria-current')).toBe('page');
    expect(meetings.getAttribute('href')).toBe('/meetings');
  });

  it('does not treat a deeper flag path as this door', () => {
    useUiStore.setState({ collapsedSections: { accounts: false } });

    renderSidebar('/meeting-intel/flags/sample-flag/extra');

    expect(meetingsLink().getAttribute('aria-current')).toBeNull();
  });

  it('does not treat the deal board as a cross-region flag', () => {
    useUiStore.setState({ collapsedSections: { accounts: false } });

    renderSidebar('/pipeline');

    expect(meetingsLink().getAttribute('aria-current')).toBeNull();
    expect(accountsExpanded()).toBe('true');
  });
});
