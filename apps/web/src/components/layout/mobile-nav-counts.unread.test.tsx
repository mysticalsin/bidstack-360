// Below 56rem the drawer is the only place the open-bid and overdue counts
// appear. Both reads start empty. Coercing a missing payload to 0 hides the
// badge, which is the same picture as a settled book with nothing open and
// nothing late. A bid lead on a phone then plans the day against a count that
// has not arrived.
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
vi.mock('@/hooks/useAppModules', () => ({ useAppModules: () => ({ data: {} }) }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: () => false }));

type CountResult = {
  data?: { count?: number; overdue?: number };
  isError?: boolean;
  isPending?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  fetchStatus?: 'paused' | 'fetching' | 'idle';
};

const reads = vi.hoisted(() => ({
  opps: { data: undefined, isError: false } as CountResult,
  tasks: { data: undefined, isError: false } as CountResult,
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunityCount: () => reads.opps,
}));
vi.mock('@/hooks/useTasks', () => ({
  useTaskSummary: () => reads.tasks,
}));

const UNREAD = 'The count has not arrived.';
const FAILED = 'It has not arrived.';

function renderDrawer() {
  mockMatchMedia({ [SHELL_WIDE_QUERY]: false });
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <MobileNav />
    </MemoryRouter>,
  );
  return screen.getByRole('dialog', { name: 'Primary navigation' });
}

function openSection(drawer: HTMLElement, name: string) {
  fireEvent.click(within(drawer).getByRole('button', { name }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.style.overflow = '';
  reads.opps = { data: undefined, isError: false };
  reads.tasks = { data: undefined, isError: false };
  useAccountHistory.setState({ recents: [], favorites: [] });
  useUiStore.setState({ sidebarCollapsed: false, collapsedSections: {}, mobileNavOpen: false });
});

describe('phone drawer counts that have not arrived', () => {
  it('does not read a paused open-bid count as none', () => {
    reads.opps = { data: undefined, isPending: true, fetchStatus: 'paused', isError: false };
    reads.tasks = { data: { overdue: 0 }, isError: false };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    openSection(drawer, 'Pipeline');

    const link = within(drawer).getByRole('link', { name: /Opportunities/ });
    // A missing badge is the settled-zero picture. The paused read has no count.
    expect(within(link).getByText(UNREAD)).toBeTruthy();
    expect(within(link).queryByText('0')).toBeNull();
    expect(within(link).queryByText(FAILED)).toBeNull();
  });

  it('does not read an in-flight overdue count as none', () => {
    reads.opps = { data: { count: 0 }, isError: false };
    reads.tasks = { data: undefined, isLoading: true, isFetching: true, isError: false };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    openSection(drawer, 'Workspace');

    const link = within(drawer).getByRole('link', { name: /Tasks/ });
    expect(within(link).getByText(UNREAD)).toBeTruthy();
    expect(within(link).queryByText('0')).toBeNull();
  });

  it('does not read a failed count as none', () => {
    reads.opps = { data: undefined, isError: true };
    reads.tasks = { data: undefined, isError: true };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    // Opening one section closes the other. Check each count while its section is the open one.
    openSection(drawer, 'Pipeline');
    const opps = within(drawer).getByRole('link', { name: /Opportunities/ });
    expect(within(opps).getByText(FAILED)).toBeTruthy();
    expect(within(opps).queryByText(UNREAD)).toBeNull();
    expect(within(opps).queryByText('0')).toBeNull();

    openSection(drawer, 'Workspace');
    const tasks = within(drawer).getByRole('link', { name: /Tasks/ });
    expect(within(tasks).getByText(FAILED)).toBeTruthy();
    expect(within(tasks).queryByText('0')).toBeNull();
  });

  it('keeps a settled zero as none', () => {
    reads.opps = { data: { count: 0 }, isError: false };
    reads.tasks = { data: { overdue: 0 }, isError: false };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    openSection(drawer, 'Pipeline');
    const opps = within(drawer).getByRole('link', { name: 'Opportunities' });
    expect(within(opps).queryByText(UNREAD)).toBeNull();
    expect(within(opps).queryByText(FAILED)).toBeNull();
    expect(within(opps).queryByText('0')).toBeNull();

    openSection(drawer, 'Workspace');
    const tasks = within(drawer).getByRole('link', { name: 'Tasks' });
    expect(within(tasks).queryByText(UNREAD)).toBeNull();
    expect(within(tasks).queryByText(FAILED)).toBeNull();
    expect(within(tasks).queryByText('0')).toBeNull();
  });

  it('still shows a settled open-bid count and a settled overdue count', () => {
    reads.opps = { data: { count: 4 }, isError: false };
    reads.tasks = { data: { overdue: 2 }, isError: false };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    openSection(drawer, 'Pipeline');
    const opps = within(drawer).getByRole('link', { name: /Opportunities/ });
    expect(within(opps).getByText('4')).toBeTruthy();
    expect(within(opps).queryByText(UNREAD)).toBeNull();

    openSection(drawer, 'Workspace');
    const tasks = within(drawer).getByRole('link', { name: /Tasks/ });
    expect(within(tasks).getByText('2')).toBeTruthy();
    expect(within(tasks).queryByText(FAILED)).toBeNull();
  });

  it('keeps the last count when a later read fails with a payload', () => {
    reads.opps = { data: { count: 4 }, isError: true };
    reads.tasks = { data: { overdue: 2 }, isError: true };
    useUiStore.setState({ mobileNavOpen: true });
    const drawer = renderDrawer();
    openSection(drawer, 'Pipeline');
    const opps = within(drawer).getByRole('link', { name: /Opportunities/ });
    expect(within(opps).getByText('4')).toBeTruthy();
    expect(within(opps).queryByText(FAILED)).toBeNull();

    openSection(drawer, 'Workspace');
    const tasks = within(drawer).getByRole('link', { name: /Tasks/ });
    expect(within(tasks).getByText('2')).toBeTruthy();
    expect(within(tasks).queryByText(UNREAD)).toBeNull();
  });
});
