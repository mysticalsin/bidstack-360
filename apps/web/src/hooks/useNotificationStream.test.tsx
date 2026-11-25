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

const DEMO_ALERT_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_ALERT_TITLE = 'Synthetic bid moved to proposal';
const DEMO_ALERT_URL = '/opportunities/opp_demo_1';

describe('live demo alert on the bell', () => {
  it('counts the alert before the list reload returns', async () => {
    // WHY: the demo inbox is empty, so the tray says the work is caught up and
    // the badge is off. A live alert is already on screen as a toast. The bell
    // waited for GET /api/notifications. Until that reload returned, the tray
    // stayed empty and the badge stayed at 0.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['notifications'], { items: [], unread: 0 });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Routes>
            <Route path="*" element={<Harness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
    act(() =>
      FakeSocket.last!.emit(
        frame({
          id: DEMO_ALERT_ID,
          type: 'stage_change',
          title: DEMO_ALERT_TITLE,
          body: 'Demo record only',
          url: DEMO_ALERT_URL,
        }),
      ),
    );
    const page = qc.getQueryData<{
      unread: number;
      items: Array<{ id: string; title: string; url: string | null; readAt: string | null }>;
    }>(['notifications']);
    expect(page?.unread).toBe(1);
    expect(page?.items[0]).toMatchObject({
      id: DEMO_ALERT_ID,
      title: DEMO_ALERT_TITLE,
      url: DEMO_ALERT_URL,
      readAt: null,
    });
  });

  it('does not count a coalesced update of the same alert twice', async () => {
    // WHY: a second frame for the same demo alert replaces the title. It is
    // still one unread row. Bumping the badge again would say 2 while the
    // tray holds a single alert.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['notifications'], {
      unread: 1,
      items: [
        {
          id: DEMO_ALERT_ID,
          type: 'stage_change',
          title: DEMO_ALERT_TITLE,
          body: 'Demo record only',
          entityType: 'opportunity',
          entityId: 'opp_demo_1',
          url: DEMO_ALERT_URL,
          readAt: null,
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Routes>
            <Route path="*" element={<Harness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
    act(() =>
      FakeSocket.last!.emit(
        frame({
          id: DEMO_ALERT_ID,
          type: 'stage_change',
          title: '3 new updates on Synthetic bid',
          url: DEMO_ALERT_URL,
          count: 3,
        }),
      ),
    );
    const page = qc.getQueryData<{
      unread: number;
      items: Array<{ id: string; title: string }>;
    }>(['notifications']);
    expect(page?.unread).toBe(1);
    expect(page?.items.filter((item) => item.id === DEMO_ALERT_ID)).toHaveLength(1);
    expect(page?.items[0]?.title).toBe('3 new updates on Synthetic bid');
  });
});
