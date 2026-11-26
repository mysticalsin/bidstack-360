// The company hierarchy tab is a second read. The company record can already
// be on screen while the tree request has not started. isLoading is false on
// that first paint, and again when the read is paused. A missing tree is not
// an empty org chart. A failed read is an error. A tree that arrived still
// shows, even when the company has no subsidiaries.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HierarchyTab } from './CompanyTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const CHECKING = 'Checking the account hierarchy. The tree has not arrived.';
const TREE = 'Account Hierarchy';
const FAILED = "Couldn't load hierarchy";
const ROOT = 'Harbor Sample Co';
const CHILD = 'Harbor North';
const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

type HierarchyNode = {
  id: string;
  name: string;
  parentId: string | null;
  children: HierarchyNode[];
};

type HierarchyRead = {
  data?: { tree: HierarchyNode };
  isLoading: boolean;
  isError: boolean;
  isPaused?: boolean;
  isFetching?: boolean;
  fetchStatus?: 'idle' | 'paused' | 'fetching';
};

function renderTab(hierarchy: HierarchyRead, children: Array<{ id: string; name: string }> = []) {
  return render(
    <MemoryRouter>
      <HierarchyTab
        hierarchy={hierarchy as never}
        childrenList={children}
        companyId={ROOT_ID}
      />
    </MemoryRouter>,
  );
}

function tree(children: HierarchyNode[] = []) {
  return {
    tree: {
      id: ROOT_ID,
      name: ROOT,
      parentId: null,
      children,
    },
  };
}

afterEach(() => {
  cleanup();
});

describe('company hierarchy tab waits for the tree', () => {
  it('does not leave an unread hierarchy tab blank', () => {
    // WHY: the tab paints before the hierarchy request starts. fetch has not
    // begun, so isLoading is false and data is missing. A blank panel reads
    // as a company with no org chart. The tree has not been read.
    renderTab({ isLoading: false, isError: false, fetchStatus: 'idle' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByRole('link', { name: ROOT })).toBeNull();
  });

  it('does not leave a paused hierarchy tab blank', () => {
    // WHY: a paused read (offline tab) has no tree. isLoading is false
    // because the fetch is not running. Silence would say the org chart
    // already came back with nothing under this company.
    renderTab({ isLoading: false, isError: false, isPaused: true, fetchStatus: 'paused' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
    expect(screen.queryByText(CHILD)).toBeNull();
  });

  it('does not treat an in-flight read with isLoading false as an empty tree', () => {
    // WHY: a read can be in flight while isLoading is still false. The
    // missing payload must not look like a settled org chart.
    renderTab({
      isLoading: false,
      isError: false,
      isFetching: true,
      fetchStatus: 'fetching',
    });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
  });

  it('keeps direct children from the company record while the tree is unread', () => {
    // WHY: direct children ride on the company payload, which has arrived.
    // They stay. The hierarchy tree is a different read and must not pretend
    // it arrived.
    renderTab({ isLoading: false, isError: false }, [{ id: CHILD_ID, name: CHILD }]);

    expect(screen.getByRole('link', { name: CHILD }).getAttribute('href')).toBe(
      `/companies/${CHILD_ID}`,
    );
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
  });

  it('shows a busy skeleton while the first hierarchy fetch is loading', () => {
    // WHY: a fetch that is actually running is not a blank tab and not a
    // finished tree. The skeleton is the in-progress read.
    renderTab({ isLoading: true, isError: false, isFetching: true, fetchStatus: 'fetching' });

    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('says the hierarchy failed instead of leaving the tab blank', () => {
    // WHY: a failed read is not an empty org chart and not a tree that is
    // still on the way. The error already names the failure.
    renderTab({ isLoading: false, isError: true });

    expect(screen.getByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: TREE })).toBeNull();
  });

  it('shows a tree that arrived, including a company with no subsidiaries', () => {
    // WHY: a payload that arrived is the org chart. No subsidiaries is that
    // result, not a missing read. The company itself stays on the tree.
    renderTab({ isLoading: false, isError: false, data: tree() });

    expect(screen.getByRole('heading', { name: TREE })).toBeTruthy();
    expect(screen.getByRole('link', { name: ROOT }).getAttribute('href')).toBe(
      `/companies/${ROOT_ID}`,
    );
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });

  it('keeps a loaded subsidiary on the tree', () => {
    // WHY: a child that arrived in the hierarchy payload still shows. The
    // hold is only for a tree that has not arrived.
    renderTab({
      isLoading: false,
      isError: false,
      data: tree([
        { id: CHILD_ID, name: CHILD, parentId: ROOT_ID, children: [] },
      ]),
    });

    expect(screen.getByRole('heading', { name: TREE })).toBeTruthy();
    expect(screen.getByRole('link', { name: CHILD })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
