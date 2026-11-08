// Live notification feed over the API realtime WebSocket. The server
// auto-subscribes each connection to `notification:user:<id>`, so the client
// only connects and listens. Reconnects with capped backoff; the 60s poll in
// useNotifications stays the fallback when the socket is down.
import { getAuthToken } from '@/lib/api';

export interface LiveNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  url: string | null;
  count?: number;
}

type Listener = (n: LiveNotification) => void;

export function realtimeUrl(token: string | null): string {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  let base: string;
  if (apiUrl) {
    const u = new URL(apiUrl);
    base = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
  } else {
    base = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  }
  return `${base}/api/v1/realtime${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
}

/** Parse one server frame; returns the notification or null for anything else. */
export function parseNotificationFrame(raw: string): LiveNotification | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = msg as {
    type?: string;
    data?: { channel?: string; type?: string; data?: unknown };
  };
  if (frame.type !== 'message' || !frame.data?.channel?.startsWith('notification:user:'))
    return null;
  if (frame.data.type !== 'notification') return null;
  const n = frame.data.data as Partial<LiveNotification> | undefined;
  if (!n || typeof n.id !== 'string' || typeof n.title !== 'string') return null;
  return {
    id: n.id,
    type: String(n.type ?? 'system'),
    title: n.title,
    body: n.body ?? null,
    url: n.url ?? null,
    count: n.count,
  };
}

export class NotificationSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly onNotification: Listener,
    private readonly factory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  async start(): Promise<void> {
    if (this.closed || typeof WebSocket === 'undefined') return;
    const token = await getAuthToken().catch(() => null);
    if (this.closed) return;
    let socket: WebSocket;
    try {
      socket = this.factory(realtimeUrl(token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.attempts = 0;
    };
    socket.onmessage = (event) => {
      const n = parseNotificationFrame(String(event.data));
      if (n) this.onNotification(n);
    };
    socket.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.attempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempts, 5));
    this.timer = setTimeout(() => void this.start(), delay);
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }
}
