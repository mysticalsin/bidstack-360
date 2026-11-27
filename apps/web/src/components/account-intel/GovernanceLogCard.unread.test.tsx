import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GovernanceMeeting, GovernanceMeetingList } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  meetings: {
    data: undefined as GovernanceMeetingList | undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null as Error | null,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/useGovernance', () => ({
  useGovernanceMeetings: () => hookMocks.meetings,
  usePatchGovernanceAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useCreateGovernanceMeeting: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { GovernanceLogCard } from './GovernanceLogCard';

const EMPTY_LINE = 'No governance meetings recorded for this account yet.';
const UNREAD_LINE = 'Checking governance meetings. The log has not arrived.';

const meeting: GovernanceMeeting = {
  id: '22222222-2222-4222-8222-222222222222',
  accountKey: 'northwind-demo',
  meetingType: 'quarterly_c_level',
  date: '2026-06-15T00:00:00.000Z',
  participants: ['Steering seat'],
  outcomes: 'Steering agreed to keep the workspace rollout on the June plan.',
  actions: [],
  createdAt: '2026-06-15T09:00:00.000Z',
  updatedAt: '2026-06-16T09:30:00.000Z',
};

function settle(
  data: GovernanceMeetingList | undefined,
  extra: Partial<typeof hookMocks.meetings> = {},
) {
  hookMocks.meetings = {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    fetchStatus: 'idle',
    ...extra,
  };
}

describe('cockpit governance log before the read arrives', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused read an empty governance log', () => {
    // WHY: a paused read has no payload, and isLoading is false, so the card
    // painted the settled empty sentence. Nothing has arrived yet.
    settle(undefined, { isPending: true, fetchStatus: 'paused' });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText(UNREAD_LINE)).toBeTruthy();
  });

  it('does not call an in-flight read an empty governance log', () => {
    // WHY: a load in progress is the same gap. A skeleton with no sentence
    // still leaves the card looking like a settled empty log.
    settle(undefined, { isLoading: true, isPending: true, fetchStatus: 'fetching' });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText(UNREAD_LINE)).toBeTruthy();
  });

  it('does not call a failed read with no payload an empty governance log', () => {
    // WHY: a failed read is not proof that this account has no governance meetings.
    settle(undefined, { isError: true, error: new Error('network down') });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.getByText('Could not load governance log')).toBeTruthy();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('still says a settled empty log has no meetings', () => {
    // WHY: an arrived page with zero rows is a real empty log.
    settle({ items: [] });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.getByText(EMPTY_LINE)).toBeTruthy();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('still shows a meeting that arrived', () => {
    settle({ items: [meeting] });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.getByText(meeting.outcomes!)).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(screen.queryByText(UNREAD_LINE)).toBeNull();
  });

  it('keeps an arrived meeting when a later read fails', () => {
    // WHY: a refresh failure must not replace a log the card already showed.
    settle({ items: [meeting] }, { isError: true, error: new Error('refresh failed') });
    render(<GovernanceLogCard accountKey="northwind-demo" />);
    expect(screen.getByText(meeting.outcomes!)).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
    expect(
      screen.getByText('The latest governance read failed. The log already on screen stays.'),
    ).toBeTruthy();
  });
});
