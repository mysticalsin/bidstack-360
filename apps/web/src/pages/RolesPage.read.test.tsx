// Roles & Permissions opens on the system matrix. Custom Roles asks for the
// workspace role list and the permission catalog. Until those reads arrive,
// "No roles yet" and "No permissions" are not a settled list. A paused or
// idle read has no payload and isLoading is false. An in-flight read is the
// same unread list. Those sentences are for a list that arrived empty. Under
// demo synthetic data the list is not empty, and the page heading stays.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission, Role, RoleList } from '@/hooks/useRoles';

const roleRead = vi.hoisted(() => ({
  data: undefined as RoleList | undefined,
  isPending: false,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: vi.fn(),
}));

const permissionRead = vi.hoisted(() => ({
  data: undefined as Permission[] | undefined,
  isPending: false,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('framer-motion', () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            whileHover: _whileHover,
            whileTap: _whileTap,
            variants: _variants,
            layout: _layout,
            layoutId: _layoutId,
            ...dom
          } = rest;
          return createElement(tag, dom, children);
        },
    },
  );
  return { motion, useReducedMotion: () => true };
});

vi.mock('@/hooks/useRoles', () => ({
  useRoles: () => roleRead,
  usePermissions: () => permissionRead,
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/auth', () => ({ useIsAdmin: () => true }));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { createElement } from 'react';

import { RolesPage } from './RolesPage';

// Synthetic demo role. No person, no mailbox. The row is what Custom Roles
// shows once both reads arrive. It must not be treated as absent before that.
const DEMO_ROLE = 'Demo reviewer';
const DEMO_PERMISSION = 'Read accounts';

const CHECKING_ROLES = 'Checking roles. They have not arrived.';
const CHECKING_PERMISSIONS = 'Checking permissions. They have not arrived.';
const FAILED_ROLES = 'Could not load roles';
const FAILED_PERMISSIONS = 'Could not load permissions';
const EMPTY_ROLES = 'No roles yet';
const EMPTY_LIE = /no roles yet|no permissions|no access|none/i;

function demoPermission(): Permission {
  return {
    id: 'perm-demo-read',
    key: 'accounts:read',
    name: DEMO_PERMISSION,
    description: null,
  };
}

function demoRole(): Role {
  return {
    id: 'role-demo-reviewer',
    name: DEMO_ROLE,
    description: 'Reads the sample book',
    isSystem: false,
    createdAt: '2026-11-07T12:00:00.000Z',
    permissions: [demoPermission()],
  };
}

function setRoleRead(next: Partial<typeof roleRead>) {
  roleRead.data = undefined;
  roleRead.isPending = false;
  roleRead.isLoading = false;
  roleRead.isFetching = false;
  roleRead.isPaused = false;
  roleRead.isError = false;
  roleRead.fetchStatus = 'idle';
  roleRead.error = null;
  roleRead.refetch.mockReset();
  Object.assign(roleRead, next);
}

function setPermissionRead(next: Partial<typeof permissionRead>) {
  permissionRead.data = undefined;
  permissionRead.isPending = false;
  permissionRead.isLoading = false;
  permissionRead.isFetching = false;
  permissionRead.isPaused = false;
  permissionRead.isError = false;
  permissionRead.fetchStatus = 'idle';
  permissionRead.error = null;
  permissionRead.refetch.mockReset();
  Object.assign(permissionRead, next);
}

function openCustomRoles() {
  render(<RolesPage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Custom Roles' }));
}

function expectListNotSettled() {
  expect(screen.queryByText(EMPTY_ROLES)).toBeNull();
  expect(screen.queryByText('No permissions')).toBeNull();
  expect(screen.queryByText('Create your first custom role.')).toBeNull();
  expect(screen.queryByRole('button', { name: '+ New role' })).toBeNull();
  expect(screen.queryByText(DEMO_ROLE)).toBeNull();
  expect(screen.queryByText(DEMO_PERMISSION)).toBeNull();
  expect(screen.queryByLabelText('Loading')).toBeNull();
}

describe('RolesPage custom role list read', () => {
  beforeEach(() => {
    setRoleRead({ isPending: true, fetchStatus: 'idle' });
    setPermissionRead({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread role list empty', () => {
    // WHY: Custom Roles can paint before the request starts. fetchStatus is
    // idle and isLoading is false, so "No roles yet" looks like a list that
    // was read and found clear. Demo reviewer has not been read.
    setRoleRead({ isPending: false, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    setPermissionRead({ isPending: false, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    openCustomRoles();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING_ROLES);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
    expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  });

  it('does not call a paused role list empty', () => {
    // WHY: a paused read (offline demo tab) has no roles in hand. isLoading
    // is false because the fetch is not running. The empty sentence would
    // say the workspace already has no roles, including Demo reviewer.
    setRoleRead({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    setPermissionRead({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    openCustomRoles();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING_ROLES);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
  });

  it('does not call an in-flight role list empty', () => {
    // WHY: the first fetch is the same unread list. A skeleton where the
    // empty sentence will land is not a result, and "No roles yet" is a list
    // that arrived empty. Hiding the heading would say the page is missing.
    setRoleRead({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    setPermissionRead({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    openCustomRoles();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(CHECKING_ROLES);
    expectListNotSettled();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
  });

  it('does not call a failed role read an empty list', () => {
    // WHY: a failed read is not a workspace with no roles and not a page that
    // disappeared. "No roles yet" would hide the failure and leave New role
    // open on a list the screen never showed.
    setRoleRead({ isError: true, error: new Error('Roles unavailable') });
    setPermissionRead({ data: [] });
    openCustomRoles();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_ROLES)).toBeTruthy();
    expect(screen.getByText('This is not an empty role list. Retry the list before creating a role.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(roleRead.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(EMPTY_ROLES)).toBeNull();
    expect(screen.queryByText(CHECKING_ROLES)).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New role' })).toBeNull();
    expect(screen.queryByText(DEMO_ROLE)).toBeNull();
  });

  it('does not call an unread permission catalog none', () => {
    // WHY: the role payload can arrive while the permission catalog is still
    // idle. isLoading is false, so the catalog grid is blank and a role with
    // no permission rows would say "No permissions". That catalog has not
    // been read. Demo reviewer stays off screen until it arrives.
    setRoleRead({
      data: { items: [demoRole()], pageContinues: false },
    });
    setPermissionRead({
      isPending: true,
      isLoading: false,
      isPaused: false,
      fetchStatus: 'idle',
    });
    openCustomRoles();

    expect(screen.getByRole('status').textContent).toContain(CHECKING_PERMISSIONS);
    expect(screen.queryByText('No permissions')).toBeNull();
    expect(screen.queryByText(EMPTY_ROLES)).toBeNull();
    expect(screen.queryByText(DEMO_ROLE)).toBeNull();
    expect(screen.queryByText(FAILED_PERMISSIONS)).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New role' })).toBeNull();
  });

  it('does not call a failed permission read an empty catalog', () => {
    // WHY: a failed permission catalog is not a list of roles with no
    // permissions. The blank grid would let New role save a role against
    // permissions the screen never showed.
    setRoleRead({
      data: { items: [demoRole()], pageContinues: false },
    });
    setPermissionRead({ isError: true, error: new Error('Permissions unavailable') });
    openCustomRoles();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_PERMISSIONS)).toBeTruthy();
    expect(
      screen.getByText('This is not an empty permission list. Retry before choosing permissions.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(permissionRead.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No permissions')).toBeNull();
    expect(screen.queryByText(DEMO_ROLE)).toBeNull();
    expect(screen.queryByText(CHECKING_PERMISSIONS)).toBeNull();
    expect(screen.queryByRole('button', { name: '+ New role' })).toBeNull();
  });

  it('keeps a settled empty role list empty', () => {
    // WHY: a read that arrived with no roles really has nothing to assign.
    // That sentence is the result, not a payload that has not arrived.
    setRoleRead({ data: { items: [], pageContinues: false } });
    setPermissionRead({ data: [] });
    openCustomRoles();

    expect(screen.getByText(EMPTY_ROLES)).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ New role' })).toBeTruthy();
    expect(screen.queryByText(CHECKING_ROLES)).toBeNull();
    expect(screen.queryByText(CHECKING_PERMISSIONS)).toBeNull();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
    expect(screen.queryByText(DEMO_ROLE)).toBeNull();
  });

  it('keeps a loaded synthetic role and its permission', () => {
    // WHY: a payload that arrived, including one demo Demo reviewer role and
    // its Read accounts permission, is the list. The hold is only for a read
    // that has not arrived.
    setRoleRead({ data: { items: [demoRole()], pageContinues: false } });
    setPermissionRead({ data: [demoPermission()] });
    openCustomRoles();

    expect(screen.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeTruthy();
    expect(screen.getByText(DEMO_ROLE)).toBeTruthy();
    expect(screen.getByText(DEMO_PERMISSION)).toBeTruthy();
    expect(screen.queryByText(CHECKING_ROLES)).toBeNull();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
    expect(screen.queryByText(EMPTY_ROLES)).toBeNull();
    expect(screen.queryByText('No permissions')).toBeNull();
  });

  it('keeps a loaded role list when a later read fails', () => {
    // WHY: a refresh that fails does not erase roles already on screen. The
    // failure sentence is for a read that never arrived.
    setRoleRead({
      data: { items: [demoRole()], pageContinues: false },
      isError: true,
      isFetching: false,
      error: new Error('Roles unavailable'),
    });
    setPermissionRead({
      data: [demoPermission()],
      isError: true,
      isFetching: false,
      error: new Error('Permissions unavailable'),
    });
    openCustomRoles();

    expect(screen.getByText(DEMO_ROLE)).toBeTruthy();
    expect(screen.getByText(DEMO_PERMISSION)).toBeTruthy();
    expect(screen.queryByText(FAILED_ROLES)).toBeNull();
    expect(screen.queryByText(FAILED_PERMISSIONS)).toBeNull();
    expect(screen.queryByText(EMPTY_ROLES)).toBeNull();
    expect(screen.queryByText(CHECKING_ROLES)).toBeNull();
  });
});
