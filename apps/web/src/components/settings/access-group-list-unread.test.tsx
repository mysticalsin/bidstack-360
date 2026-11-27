// WHY: Settings opens the access-group list before it returns. A paused read
// has no rows. The heading still said (0) and the card said no access groups
// yet, which is what a loaded empty workspace says. That empty line also says
// everyone currently sees every opportunity. An admin can treat a missing
// payload as unrestricted access and act before the list arrives. A failed
// read with no payload did the same with a zero count. A later failure hid a
// list that had already arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUserGroups: vi.fn(),
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

vi.mock('@/hooks/useUserGroups', () => ({
  useUserGroups: hookMocks.useUserGroups,
  useCreateUserGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteUserGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUserGroup: () => ({ data: undefined, isLoading: false, isError: false, isPending: false }),
  useUpdateUserGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddGroupMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveGroupMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({ data: [] }),
}));

import { AccessGroupsSection } from './AccessGroupsSection';

const CHECKING = 'Checking access groups. The list has not arrived.';
const FAILED = 'Could not load access groups. The list has not arrived.';
const EMPTY_TITLE = 'No access groups yet';
const EMPTY_SCOPE = 'Everyone currently sees all opportunities, account cockpits, notes, and files. Create a group above to start scoping visibility by country.';

const demoGroup = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  name: 'Demo France',
  description: null,
  scopeCountries: ['FR'],
  scopeAll: false,
  memberCount: 1,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-15T12:00:00.000Z',
};

function mockGroups(state: {
  data?: { items: Array<typeof demoGroup>; pageContinues: boolean };
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  hookMocks.useUserGroups.mockReturnValue({
    data: state.data,
    isPending: state.isPending,
    isLoading: state.isLoading,
    isFetching: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('groups unavailable') : null,
    refetch: vi.fn(),
  });
}

function renderGroups() {
  render(<AccessGroupsSection />);
}

describe('access group list unread record', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a group list load in progress as an empty workspace', () => {
    mockGroups({ isPending: true, isLoading: true, isError: false });

    renderGroups();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_SCOPE)).toBeNull();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not present a group list that has not arrived as an empty workspace', () => {
    // A paused read is not loading and has no payload. Empty is what a
    // settled page of zero groups says.
    mockGroups({ isPending: true, isLoading: false, isError: false });

    renderGroups();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_SCOPE)).toBeNull();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not present a failed group read with no payload as zero groups', () => {
    mockGroups({ isPending: false, isLoading: false, isError: true });

    renderGroups();

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_SCOPE)).toBeNull();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says there are no access groups once a saved empty page has loaded', () => {
    mockGroups({
      data: { items: [], pageContinues: false },
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderGroups();

    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText('(0)')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a saved group and its count', () => {
    mockGroups({
      data: { items: [demoGroup], pageContinues: false },
      isPending: false,
      isLoading: false,
      isError: false,
    });

    renderGroups();

    expect(screen.getByText('Demo France')).toBeTruthy();
    expect(screen.getByText('(1)')).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a saved group when a later read fails', () => {
    mockGroups({
      data: { items: [demoGroup], pageContinues: false },
      isPending: false,
      isLoading: false,
      isError: true,
    });

    renderGroups();

    expect(screen.getByText('Demo France')).toBeTruthy();
    expect(screen.getByText('(1)')).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
