// usePresence — join/heartbeat/leave contract against the DB-backed
// GET/POST /api/presence surface (apps/api/src/routes/collaboration.ts).
//
// WHY these assertions matter: presence is a trust signal ("who's on this
// bid right now"). If join/heartbeat silently stop firing, two reps overwrite
// each other's edits with no warning; if leave never fires, a departed rep
// looks like they're still working the bid forever, and teammates avoid
// touching it. If self isn't excluded, every viewer sees themselves listed
// as a "collaborator," which destroys trust in the whole feature.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { usePresence } from './usePresence';
import type { UserPresence } from '@bidstack/shared';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useUser: vi.fn() }));

const SELF_ID = 'user-self';
const ENTITY_TYPE = 'opportunity';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function presenceEntry(overrides: Partial<UserPresence> = {}): UserPresence {
  return {
    id: 'presence-1',
    orgId: 'org-1',
    userId: 'user-other',
    userName: 'Other User',
    status: 'online',
    currentRecordType: ENTITY_TYPE,
    currentRecordId: ENTITY_ID,
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// StrictMode (dev only) double-invokes effects on initial mount — setup,
// cleanup, setup again — synchronously. Used only by the dedupe test below;
// the other tests assert against the plain (non-StrictMode) contract.
function strictWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.mocked(useUser).mockReturnValue({
      user: {
        id: SELF_ID,
        firstName: 'Self',
        lastName: 'User',
        fullName: 'Self User',
        primaryEmailAddress: null,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('joins on mount by POSTing the viewed record, and heartbeats every 15s', async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({ items: [] });

    renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper });

    // Initial join fires synchronously in the mount effect.
    expect(api).toHaveBeenCalledWith('/api/presence', {
      method: 'POST',
      body: { status: 'online', currentRecordType: ENTITY_TYPE, currentRecordId: ENTITY_ID },
    });
    const joinCallsBefore = vi
      .mocked(api)
      .mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === 'POST').length;
    expect(joinCallsBefore).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);

    const joinCallsAfter = vi
      .mocked(api)
      .mock.calls.filter(([, opts]) => (opts as { method?: string })?.method === 'POST').length;
    expect(joinCallsAfter).toBe(2);
  });

  it('leaves (clears currentRecordType/currentRecordId) on unmount without going offline', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] });

    const { unmount } = renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper });
    vi.mocked(api).mockClear();

    unmount();
    // The leave POST is deferred by one macrotask (see usePresence.ts) so a
    // StrictMode synthetic remount can cancel it instead of firing a
    // redundant duplicate — flush that macrotask before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api).toHaveBeenCalledWith('/api/presence', {
      method: 'POST',
      body: { status: 'online' },
    });
  });

  it('stops heartbeating after unmount (cleanup tears down the interval)', () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({ items: [] });

    const { unmount } = renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper });
    unmount();
    // Flush the deferred leave's 0ms macrotask before clearing the mock, so
    // it doesn't get miscounted as a heartbeat below.
    vi.advanceTimersByTime(0);
    vi.mocked(api).mockClear();

    vi.advanceTimersByTime(60_000);

    expect(api).not.toHaveBeenCalled();
  });

  it('collapses React 18 StrictMode double-invoke (mount→cleanup→mount) into a single join POST', async () => {
    // Real regression: StrictMode's dev-only synthetic remount runs setup,
    // cleanup, and setup-again synchronously before either network call
    // settles. Without the dedupe in usePresence.ts, that fires TWO
    // identical join POSTs for the same record and the loser 409s racing
    // the winner's DB upsert — this is the "opening an opportunity fires
    // presence 2-3x" bug. This test fails if that dedupe regresses.
    vi.mocked(api).mockResolvedValue({ items: [] });

    renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper: strictWrapper });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());

    const joinCalls = vi
      .mocked(api)
      .mock.calls.filter(
        ([, opts]) =>
          (opts as { method?: string })?.method === 'POST' &&
          (opts as { body?: { currentRecordId?: string } })?.body?.currentRecordId === ENTITY_ID,
      );
    expect(joinCalls).toHaveLength(1);
  });

  it('exposes other viewers of the same record and never includes self', async () => {
    vi.mocked(api).mockImplementation((path: string) => {
      if (typeof path === 'string' && path.startsWith('/api/presence?')) {
        return Promise.resolve({
          items: [
            presenceEntry({ userId: SELF_ID, userName: 'Self User' }),
            presenceEntry({ userId: 'user-other', userName: 'Other User' }),
          ],
        });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper });

    await waitFor(() => expect(result.current.viewers).toHaveLength(1));
    expect(result.current.viewers[0]?.userId).toBe('user-other');
    expect(result.current.viewers.some((v) => v.userId === SELF_ID)).toBe(false);
  });

  it('drops viewers whose lastSeenAt is stale (crashed tab that never sent a leave)', async () => {
    const staleAt = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
    vi.mocked(api).mockImplementation((path: string) => {
      if (typeof path === 'string' && path.startsWith('/api/presence?')) {
        return Promise.resolve({
          items: [presenceEntry({ userId: 'user-stale', lastSeenAt: staleAt })],
        });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() => usePresence(ENTITY_TYPE, ENTITY_ID), { wrapper });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
    expect(result.current.viewers).toHaveLength(0);
  });

  it('does not join/leave/poll when entityId is undefined (page still loading)', () => {
    renderHook(() => usePresence(ENTITY_TYPE, undefined), { wrapper });
    expect(api).not.toHaveBeenCalled();
  });
});
