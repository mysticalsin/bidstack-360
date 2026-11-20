import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getAuthToken: vi.fn(async () => 'tok'),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { info: vi.fn(() => `t${Math.random()}`), dismiss: vi.fn(), error: vi.fn() },
}));

import { toast } from '@/components/ui/Toast';
import { parseNotificationFrame, realtimeUrl } from '@/lib/notification-socket';

import { useNotificationStream } from './useNotifications';

class FakeSocket {
  static last: FakeSocket | null = null;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  close() {
    this.closed = true;
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const factory = (url: string) => new FakeSocket(url) as unknown as WebSocket;

function frame(data: Record<string, unknown>) {
  return {
    type: 'message',
    data: { channel: 'notification:user:u1', type: 'notification', data },
    ts: 1,
  };
}

const seen = { path: '' };
function Where() {
  const { pathname } = useLocation();
  useEffect(() => {
    seen.path = pathname;
  }, [pathname]);
  return null;
}
function Harness() {
  useNotificationStream({ socketFactory: factory });
  return <Where />;
}

afterEach(() => {
  cleanup();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.dismiss).mockClear();
  FakeSocket.last = null;
});

describe('notification stream', () => {
  it('builds the socket URL under /api/v1 with the token', () => {
    expect(realtimeUrl('a b')).toMatch(/\/api\/v1\/realtime\?access_token=a%20b$/);
  });

  it('ignores frames that are not user notifications', () => {
    expect(parseNotificationFrame('not json')).toBeNull();
    expect(parseNotificationFrame(JSON.stringify({ type: 'subscribed', channel: 'x' }))).toBeNull();
    expect(
      parseNotificationFrame(
        JSON.stringify({
          type: 'message',
          data: { channel: 'presence:org:1', type: 'notification', data: { id: 'a', title: 't' } },
        }),
      ),
    ).toBeNull();
  });

  it('shows a toast with an Open link that navigates, and replaces a coalesced one', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={<Harness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const socket = FakeSocket.last!;
    expect(socket.url).toContain('access_token=tok');

    act(() =>
      socket.emit(
        frame({
          id: 'n1',
          type: 'account_activity',
          title: 'New meeting on Pfizer',
          body: 'Ana: Kickoff',
          url: '/companies/c1',
        }),
      ),
    );
    expect(toast.info).toHaveBeenCalledTimes(1);
    const [title, opts] = vi.mocked(toast.info).mock.calls[0]! as unknown as [
      string,
      { description?: string; action?: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('New meeting on Pfizer');
    expect(opts.description).toBe('Ana: Kickoff');
    expect(opts.action?.label).toBe('Open');
    const firstId = vi.mocked(toast.info).mock.results[0]!.value as string;

    act(() => opts.action!.onClick());
    expect(seen.path).toBe('/companies/c1');

    act(() =>
      socket.emit(
        frame({
          id: 'n1',
          type: 'account_activity',
          title: '3 new updates on Pfizer',
          url: '/companies/c1',
          count: 3,
        }),
      ),
    );
    expect(toast.dismiss).toHaveBeenCalledWith(firstId);
    expect(vi.mocked(toast.info).mock.calls[1]![0]).toBe('3 new updates on Pfizer');
  });
});
