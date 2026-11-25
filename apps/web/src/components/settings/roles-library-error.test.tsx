// Demo settings open the role list before any role is drawn. A failed
// read has no rows. That is not an empty list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useRoles: vi.fn(),
  usePermissions: vi.fn(),
  useCreateRole: vi.fn(),
  useUpdateRole: vi.fn(),
  useDeleteRole: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
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
  useRoles: hookMocks.useRoles,
  usePermissions: hookMocks.usePermissions,
  useCreateRole: hookMocks.useCreateRole,
  useUpdateRole: hookMocks.useUpdateRole,
  useDeleteRole: hookMocks.useDeleteRole,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RolesSection } from './RolesSection';

const SAMPLE_ROLE = {
  id: 'role-sample-reviewer',
  name: 'Sample reviewer',
  description: 'Reads the sample book',
  isSystem: false,
  createdAt: '2026-11-07T12:00:00.000Z',
  permissions: [] as Array<{ id: string; key: string; name: string; description: string | null }>,
};

function idleMutations() {
  hookMocks.useCreateRole.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useUpdateRole.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.useDeleteRole.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hookMocks.usePermissions.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe('roles when the read does not return rows', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed role read an empty list', () => {
    // WHY: demo settings can open the list before it returns. A failed read
    // has no rows. Saying "No roles yet" invites a new role on top of a list
    // the screen never showed.
    const refetch = vi.fn();
    idleMutations();
    hookMocks.useRoles.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<RolesSection />);

    expect(screen.queryByText('No roles yet')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load roles')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ New role' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the list is empty once a loaded page has no roles', () => {
    // WHY: a page that actually arrived with no roles is empty. That sentence
    // stays, and creating a role stays available.
    idleMutations();
    hookMocks.useRoles.mockReturnValue({
      data: { items: [], pageContinues: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<RolesSection />);

    expect(screen.getByText('No roles yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ New role' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a role the loaded page returned', () => {
    // WHY: a role the page drew is unchanged. The failed-read alert does not
    // replace it, and the continued-page caption is not this test.
    idleMutations();
    hookMocks.useRoles.mockReturnValue({
      data: { items: [SAMPLE_ROLE], pageContinues: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<RolesSection />);

    expect(screen.getByText('Sample reviewer')).toBeTruthy();
    expect(screen.queryByText('No roles yet')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '+ New role' })).toBeTruthy();
  });
});
