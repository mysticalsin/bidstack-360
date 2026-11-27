import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUsers: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: hookMocks.useUsers,
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritories: () => ({
    data: { items: [] },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));

import { RoutingRuleDialog } from './RoutingRuleDialog';

function unreadUsers(state: {
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: Array<{ id: string; name: string | null; email: string }>;
}) {
  hookMocks.useUsers.mockReturnValue(state);
}

function openRoundRobin() {
  render(
    <RoutingRuleDialog open onClose={vi.fn()} onSubmit={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Round robin' }));
}

describe('RoutingRuleDialog unread users', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a read that has not arrived an available team', () => {
    // The round-robin picker opens before the user list returns. An available
    // line would tell an admin the directory is empty.
    unreadUsers({ isPending: true, isLoading: false, isError: false, isSuccess: false });

    openRoundRobin();

    expect(screen.getByText('Checking users.')).toBeTruthy();
    expect(screen.queryByText('No users available')).toBeNull();
  });

  it('does not call a failed read an available team', () => {
    // A failed read has no saved users. Available would look like a finished empty directory.
    unreadUsers({ isPending: false, isLoading: false, isError: true, isSuccess: false });

    openRoundRobin();

    expect(
      screen.getByText('Could not load users. The saved users have not arrived.'),
    ).toBeTruthy();
    expect(screen.queryByText('No users available')).toBeNull();
  });

  it('keeps a loaded empty directory unavailable', () => {
    unreadUsers({
      isPending: false,
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: [],
    });

    openRoundRobin();

    expect(screen.getByText('No users available')).toBeTruthy();
  });

  it('keeps a loaded user on the round-robin list', () => {
    unreadUsers({
      isPending: false,
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: [{ id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' }],
    });

    openRoundRobin();

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText('No users available')).toBeNull();
    expect(screen.queryByText('Checking users.')).toBeNull();
  });
});
