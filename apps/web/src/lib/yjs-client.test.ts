// Opportunity detail mounts a Yjs client and tears it down while the
// socket is still CONNECTING (Strict Mode, and leaving the page before
// the handshake). Calling close() in that state is what the browser logs
// as "WebSocket is closed before the connection is established." A close
// that never reached OPEN must not schedule another socket — that is the
// reconnect loop.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    destroy(): void {}
  },
}));

import { YjsClient } from './yjs-client';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  url: string;
  onopen: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closeCalls = 0;
  closedWhileConnecting = false;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(_data: string): void {}

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === FakeSocket.CONNECTING) {
      this.closedWhileConnecting = true;
    }
    const onclose = this.onclose;
    this.readyState = FakeSocket.CLOSED;
    onclose?.();
  }

  completeOpen(): void {
    if (this.readyState !== FakeSocket.CONNECTING) return;
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Peer ended the handshake before OPEN. Does not call close(). */
  failBeforeOpen(): void {
    if (this.readyState !== FakeSocket.CONNECTING) return;
    const onerror = this.onerror;
    const onclose = this.onclose;
    this.readyState = FakeSocket.CLOSED;
    onerror?.();
    onclose?.();
  }
}

const ENTITY = {
  entityType: 'opportunity',
  entityId: '11111111-1111-4111-8111-111111111111',
  fieldKey: 'notes',
};

describe('YjsClient presence socket lifecycle', () => {
  const clients: YjsClient[] = [];

  afterEach(() => {
    for (const client of clients) client.destroy();
    clients.length = 0;
    FakeSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function connect(): { client: YjsClient; socket: FakeSocket } {
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = new YjsClient(ENTITY);
    clients.push(client);
    client.connect('test-token');
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('expected a socket');
    return { client, socket };
  }

  it('does not close a still-connecting socket, and does not open another', () => {
    vi.useFakeTimers();
    const { client, socket } = connect();
    expect(socket.url).toContain('/api/yjs-sync');
    expect(socket.readyState).toBe(FakeSocket.CONNECTING);

    client.destroy();

    // close() while CONNECTING is the browser's failed-connect log.
    expect(socket.closedWhileConnecting).toBe(false);
    expect(socket.closeCalls).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    // Handshake finishes after unmount: close the live socket, still once.
    socket.completeOpen();
    expect(socket.closeCalls).toBe(1);
    expect(socket.closedWhileConnecting).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('does not reconnect when the socket closes before it opens', () => {
    vi.useFakeTimers();
    const { socket } = connect();

    socket.failBeforeOpen();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.closedWhileConnecting).toBe(false);
  });

  it('still reconnects after a socket that reached OPEN later drops', () => {
    vi.useFakeTimers();
    const { socket } = connect();
    socket.completeOpen();

    const onclose = socket.onclose;
    socket.readyState = FakeSocket.CLOSED;
    onclose?.();

    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
