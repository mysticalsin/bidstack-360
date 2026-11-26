// Settings, Meeting sources is where someone connects Métis or syncs ABC.
// A paused read has isLoading false and no payload. The cards still offered
// Connect Métis and Sync now, which is the not-connected book. That book
// has not arrived. A failed read already says the sources are unavailable.
// A settled not-connected row still offers Connect.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Array<Record<string, unknown>> } | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/hooks/useMeetingIntel', () => ({
  useMeetingSources: () => sources.current,
  useConnectMetis: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useRevokeMetis: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncAbc: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
  }),
}));

import { MeetingSourcesSection } from './MeetingSourcesSection';

const CHECKING = 'Checking meeting sources. They have not arrived.';
const UNAVAILABLE = 'Meeting sources are unavailable.';
const CONNECT = 'Connect Métis';
const SYNC = 'Sync now';

function row(
  source: 'metis' | 'abc',
  status: 'connected' | 'not_connected' | 'not_configured',
) {
  return {
    source,
    scope: source === 'metis' ? 'user' : 'org',
    status,
    shareSummary: false,
    shareTranscript: false,
    tokenPrefix: null,
    lastSyncAt: null,
    lastError: null,
    itemsReceived: 0,
    pending: 0,
    unmatched: 0,
  };
}

function settle(state: Partial<typeof sources.current>) {
  sources.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...state,
  };
}

describe('Meeting sources read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    settle({});
  });

  it('does not offer Connect while the source list has not arrived', () => {
    // WHY: a paused first read has isLoading false and no payload. Connect
    // Métis and Sync now are the not-connected book. The list has not arrived.
    settle({ isLoading: false, data: undefined });

    render(<MeetingSourcesSection />);

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.queryByRole('button', { name: SYNC })).toBeNull();
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.queryByText('Not configured')).toBeNull();
  });

  it('does not offer Connect while the source list is still loading', () => {
    // WHY: an in-flight read is the same missing list. The loading line is
    // not a settled not-connected source.
    settle({ isLoading: true, data: undefined });

    render(<MeetingSourcesSection />);

    expect(screen.getByText('Loading sources…')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.queryByRole('button', { name: SYNC })).toBeNull();
  });

  it('keeps a failed source read on the error', () => {
    // WHY: a failed read is not an invitation to connect. The unavailable
    // line stays, and Connect is not standing in for a list that failed.
    settle({ isError: true, error: new Error('down') });

    render(<MeetingSourcesSection />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
  });

  it('still offers Connect after a settled read that is not connected', () => {
    // WHY: a payload that arrived as not connected is the connect book.
    // The checking line is only for a list that has not arrived.
    settle({
      data: {
        items: [row('metis', 'not_connected'), row('abc', 'not_configured')],
      },
    });

    render(<MeetingSourcesSection />);

    expect(screen.getByRole('button', { name: CONNECT })).toBeTruthy();
    expect(screen.getByRole('button', { name: SYNC })).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('shows a connected Métis source once that row arrives', () => {
    // WHY: a connected row is not the unread line and it is not the connect form.
    settle({
      data: {
        items: [row('metis', 'connected'), row('abc', 'not_configured')],
      },
    });

    render(<MeetingSourcesSection />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: CONNECT })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
