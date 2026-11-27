// WHY: Identity opens the team list before the roster or the presence snapshot
// returns. A paused roster has no rows. The card still said no team members
// were found, which is what a loaded empty workspace says. An unread presence
// snapshot has no rows either. Every person was then labelled offline, which
// is what a loaded snapshot of nobody online says. An admin can read that as
// an empty workspace or a team that is signed out, and act before the payload
// arrives.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useUsersPage: vi.fn(),
  useOrgPresence: vi.fn(),
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

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsersPage: hookMocks.useUsersPage,
  useOrgPresence: hookMocks.useOrgPresence,
  useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TeamSection } from './TeamSection';

const CHECKING_ROSTER = 'Checking the team. The roster has not arrived.';
const FAILED_ROSTER = 'Could not load the team. The roster has not arrived.';
const EMPTY_ROSTER = 'No team members found.';
const CHECKING_PRESENCE = 'Checking presence. Status has not arrived.';
const FAILED_PRESENCE = 'Could not load presence. Status has not arrived.';

const member = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada Roster',
  email: 'ada.roster@example.test',
  role: 'member',
  createdAt: '2026-01-15T12:00:00.000Z',
};

function mockRoster(state: {
  data?: { items: typeof member[]; nextCursor: string | null };
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  hookMocks.useUsersPage.mockReturnValue({
    data: state.data,
    isPending: state.isPending,
    isLoading: state.isLoading,
    isFetching: state.isLoading,
    isError: state.isError,
    error: state.isError ? new Error('roster unavailable') : null,
  });
}

function mockPresence(state: {
  data?: Set<string>;
  isPending: boolean;
  isError: boolean;
}) {
  hookMocks.useOrgPresence.mockReturnValue({
    data: state.data,
    isPending: state.isPending,
    isLoading: state.isPending,
    isFetching: state.isPending,
    isError: state.isError,
    error: state.isError ? new Error('presence unavailable') : null,
  });
}

function renderTeam() {
  render(<TeamSection />);
}

describe('Team roster unread record', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a roster load in progress as an empty team', () => {
    mockRoster({ isPending: true, isLoading: true, isError: false });
    mockPresence({ isPending: true, isError: false });

    renderTeam();

    expect(screen.getByText(CHECKING_ROSTER)).toBeTruthy();
    expect(screen.queryByText(EMPTY_ROSTER)).toBeNull();
    expect(screen.queryByText(FAILED_ROSTER)).toBeNull();
    expect(screen.queryByRole('img', { name: /offline/i })).toBeNull();
  });

  it('does not present a roster that has not arrived as an empty team', () => {
    // A paused read is not loading and has no payload. Empty is what a
    // settled page of zero members says.
    mockRoster({ isPending: true, isLoading: false, isError: false });
    mockPresence({ isPending: true, isError: false });

    renderTeam();

    expect(screen.getByText(CHECKING_ROSTER)).toBeTruthy();
    expect(screen.queryByText(EMPTY_ROSTER)).toBeNull();
    expect(screen.queryByText(FAILED_ROSTER)).toBeNull();
  });

  it('does not present a failed roster read as an empty team', () => {
    mockRoster({ isPending: false, isLoading: false, isError: true });
    mockPresence({ isPending: false, isError: true });

    renderTeam();

    expect(screen.getByText(FAILED_ROSTER)).toBeTruthy();
    expect(screen.queryByText(EMPTY_ROSTER)).toBeNull();
    expect(screen.queryByText(CHECKING_ROSTER)).toBeNull();
  });

  it('does not label a person offline before the presence snapshot arrives', () => {
    mockRoster({
      data: { items: [member], nextCursor: null },
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockPresence({ isPending: true, isError: false });

    renderTeam();

    expect(screen.getByText('Ada Roster')).toBeTruthy();
    expect(screen.getByText(CHECKING_PRESENCE)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /offline/i })).toBeNull();
    expect(screen.queryByRole('img', { name: /online/i })).toBeNull();
    expect(screen.queryByText(EMPTY_ROSTER)).toBeNull();
    expect(screen.queryByText(FAILED_PRESENCE)).toBeNull();
  });

  it('does not label a person offline when the presence snapshot fails', () => {
    mockRoster({
      data: { items: [member], nextCursor: null },
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockPresence({ isPending: false, isError: true });

    renderTeam();

    expect(screen.getByText('Ada Roster')).toBeTruthy();
    expect(screen.getByText(FAILED_PRESENCE)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /offline/i })).toBeNull();
    expect(screen.queryByRole('img', { name: /online/i })).toBeNull();
    expect(screen.queryByText(CHECKING_PRESENCE)).toBeNull();
    expect(screen.queryByText(EMPTY_ROSTER)).toBeNull();
  });

  it('still says the team is empty once a saved empty page has loaded', () => {
    mockRoster({
      data: { items: [], nextCursor: null },
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockPresence({ data: new Set(), isPending: false, isError: false });

    renderTeam();

    expect(screen.getByText(EMPTY_ROSTER)).toBeTruthy();
    expect(screen.queryByText(CHECKING_ROSTER)).toBeNull();
    expect(screen.queryByText(FAILED_ROSTER)).toBeNull();
    expect(screen.queryByText(CHECKING_PRESENCE)).toBeNull();
  });

  it('still says offline once a saved snapshot does not include the person', () => {
    mockRoster({
      data: { items: [member], nextCursor: null },
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockPresence({ data: new Set(), isPending: false, isError: false });

    renderTeam();

    expect(screen.getByText('Ada Roster')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ada Roster offline' })).toBeTruthy();
    expect(screen.queryByText(CHECKING_PRESENCE)).toBeNull();
    expect(screen.queryByText(FAILED_PRESENCE)).toBeNull();
  });

  it('still says online once a saved snapshot includes the person', () => {
    mockRoster({
      data: { items: [member], nextCursor: null },
      isPending: false,
      isLoading: false,
      isError: false,
    });
    mockPresence({ data: new Set([member.id]), isPending: false, isError: false });

    renderTeam();

    expect(screen.getByRole('img', { name: 'Ada Roster online' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /offline/i })).toBeNull();
    expect(screen.queryByText(CHECKING_PRESENCE)).toBeNull();
    expect(screen.queryByText(FAILED_PRESENCE)).toBeNull();
  });
});
