// Demo settings open a group's member list before any member is drawn.
// A failed read has no rows. That is not an empty list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUserGroups: vi.fn(),
  useUserGroup: vi.fn(),
  useCreateUserGroup: vi.fn(),
  useUpdateUserGroup: vi.fn(),
  useDeleteUserGroup: vi.fn(),
  useAddGroupMember: vi.fn(),
  useRemoveGroupMember: vi.fn(),
  useUsers: vi.fn(),
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

vi.mock('@/hooks/useUserGroups', () => ({
  useUserGroups: hookMocks.useUserGroups,
  useUserGroup: hookMocks.useUserGroup,
  useCreateUserGroup: hookMocks.useCreateUserGroup,
  useUpdateUserGroup: hookMocks.useUpdateUserGroup,
  useDeleteUserGroup: hookMocks.useDeleteUserGroup,
  useAddGroupMember: hookMocks.useAddGroupMember,
  useRemoveGroupMember: hookMocks.useRemoveGroupMember,
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: hookMocks.useUsers,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AccessGroupsSection } from './AccessGroupsSection';

const SAMPLE_GROUP = {
  id: 'group-sample-france',
  orgId: 'org-sample',
  name: 'Sample France',
  description: null,
  scopeCountries: [] as string[],
  scopeAll: true,
  memberCount: 1,
  createdAt: '2026-11-07T12:00:00.000Z',
  updatedAt: '2026-11-07T12:00:00.000Z',
};

const SAMPLE_MEMBER = {
  id: 'member-sample',
  userId: 'user-sample',
  name: 'Sample member',
  email: 'sample.member@example.com',
  createdAt: '2026-11-07T12:00:00.000Z',
};

function idleMutations() {
  const idle = { mutateAsync: vi.fn(), isPending: false };
  hookMocks.useCreateUserGroup.mockReturnValue(idle);
  hookMocks.useUpdateUserGroup.mockReturnValue(idle);
  hookMocks.useDeleteUserGroup.mockReturnValue(idle);
  hookMocks.useAddGroupMember.mockReturnValue(idle);
  hookMocks.useRemoveGroupMember.mockReturnValue(idle);
  hookMocks.useUsers.mockReturnValue({ data: [], isLoading: false, isError: false });
  hookMocks.useUserGroups.mockReturnValue({
    data: { items: [SAMPLE_GROUP], pageContinues: false },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function openMembers() {
  render(<AccessGroupsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
}

describe('access group members when the read does not return rows', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a failed member read an empty list', () => {
    // WHY: demo settings can open a group before its members return. A failed
    // read has no rows. Saying "No members yet" invites an add on top of a
    // list the screen never showed.
    const refetch = vi.fn();
    idleMutations();
    hookMocks.useUserGroup.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    openMembers();

    expect(screen.queryByText('No members yet.')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load members')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByLabelText('Add a member')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the list is empty once a loaded page has no members', () => {
    // WHY: a page that actually arrived with no members is empty. That sentence
    // stays, and adding a member stays available.
    idleMutations();
    hookMocks.useUserGroup.mockReturnValue({
      data: { ...SAMPLE_GROUP, members: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    openMembers();

    expect(screen.getByText('No members yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.getByLabelText('Add a member')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a member the loaded page returned', () => {
    // WHY: a member the page drew is unchanged. The failed-read alert does not
    // replace them, and the group-list caption is not this test.
    idleMutations();
    hookMocks.useUserGroup.mockReturnValue({
      data: { ...SAMPLE_GROUP, members: [SAMPLE_MEMBER] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    openMembers();

    expect(screen.getByText('Sample member')).toBeTruthy();
    expect(screen.queryByText('No members yet.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });
});
