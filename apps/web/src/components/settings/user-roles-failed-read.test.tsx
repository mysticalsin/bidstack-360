// WHY: Team opens one person's roles before either read returns. An unread
// grant list has no rows. The panel still said no custom roles were assigned,
// and the picker said all roles were assigned. That is what a loaded empty
// grant and a loaded exhausted catalog say. Assign would write a grant over
// a list the screen never showed.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUserRoles: vi.fn(),
  useRoles: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUserRoles: hookMocks.useUserRoles,
  useAssignUserRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useRoles', () => ({
  useRoles: hookMocks.useRoles,
}));

import { UserRolesManager } from './UserRolesManager';

const EMPTY = 'No custom roles assigned yet.';
const ALL_ASSIGNED = 'All roles assigned';
const CHECKING = 'Checking roles for Ada.';
const CHECKING_CATALOG = 'Checking the role list.';
const FAILED = 'Could not load roles for Ada. The saved roles have not arrived.';
const CATALOG_FAILED = 'Could not load the role list. The saved roles have not arrived.';

function catalogRole(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    isSystem: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    permissions: [],
  };
}

function grant(roleId: string, name: string) {
  return { roleId, name, description: null, isSystem: false };
}

function mockAssigned(state: {
  data?: unknown;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  hookMocks.useUserRoles.mockReturnValue({
    data: state.data,
    isPending: state.isPending,
    isLoading: state.isLoading,
    isFetching: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('roles unavailable') : null,
  });
}

function mockCatalog(state: {
  items?: ReturnType<typeof catalogRole>[];
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  hookMocks.useRoles.mockReturnValue({
    data: state.items ? { items: state.items, pageContinues: false } : undefined,
    isPending: state.isPending,
    isLoading: state.isLoading,
    isFetching: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('catalog unavailable') : null,
  });
}

function renderRoles() {
  render(<UserRolesManager userId="user-ada" userName="Ada" />);
}

describe('User roles unread record', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a role load in progress as an empty grant or a full catalog', () => {
    mockAssigned({ data: undefined, isPending: true, isLoading: true, isError: false });
    mockCatalog({ isPending: true, isLoading: true, isError: false });

    renderRoles();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not present a grant list that has not arrived as an empty assignment', () => {
    mockAssigned({ data: undefined, isPending: true, isLoading: false, isError: false });
    mockCatalog({
      items: [catalogRole('role-reviewer', 'Reviewer')],
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderRoles();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Reviewer' })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not offer Assign when the grant read fails', () => {
    mockAssigned({ data: undefined, isPending: false, isLoading: false, isError: true });
    mockCatalog({
      items: [catalogRole('role-reviewer', 'Reviewer')],
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderRoles();

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Reviewer' })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('does not call a failed role catalog fully assigned', () => {
    mockAssigned({
      data: [grant('role-admin', 'Admin')],
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockCatalog({ isPending: false, isLoading: false, isError: true });

    renderRoles();

    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText(CATALOG_FAILED)).toBeTruthy();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke Admin from Ada' })).toBeTruthy();
  });

  it('does not call a role catalog that has not arrived fully assigned', () => {
    mockAssigned({
      data: [],
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockCatalog({ isPending: true, isLoading: false, isError: false });

    renderRoles();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(CHECKING_CATALOG)).toBeTruthy();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(CATALOG_FAILED)).toBeNull();
  });

  it('still says no custom roles once a saved empty grant and a role have loaded', () => {
    mockAssigned({
      data: [],
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockCatalog({
      items: [catalogRole('role-reviewer', 'Reviewer')],
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderRoles();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reviewer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
    expect(screen.queryByText(ALL_ASSIGNED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(CHECKING_CATALOG)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(CATALOG_FAILED)).toBeNull();
  });

  it('still says all roles are assigned once the saved grant covers the catalog', () => {
    mockAssigned({
      data: [grant('role-admin', 'Admin')],
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockCatalog({
      items: [catalogRole('role-admin', 'Admin')],
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderRoles();

    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText(ALL_ASSIGNED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke Admin from Ada' })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(CHECKING_CATALOG)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(CATALOG_FAILED)).toBeNull();
  });
});
