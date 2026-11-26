// WHY: a server rejection used to be ignored. The socket then closed and
// reconnected, and the pad came back as a blank note. A rejected read stays
// failed and does not open another socket.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    destroy(): void {}
  },
}));

import { collabDocKey, readCollabDoc } from './collab-notes-read';
import { YjsClient } from './yjs-client';

const ENTITY = '11111111-1111-4111-8111-111111111111';

class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  constructor(_url: string) {
    FakeSocket.opened.push(this);
  }
  send(): void {}
  close(): void {
    this.onclose?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.opened = [];
});

describe('YjsClient failed note read', () => {
  it('publishes the rejection and does not open another socket', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = new YjsClient({
      entityType: 'contact',
      entityId: ENTITY,
      fieldKey: 'notes',
    });
    const key = collabDocKey('contact', ENTITY, 'notes');

    client.connect('token');
    expect(FakeSocket.opened).toHaveLength(1);
    client.ingestServerMessage(
      JSON.stringify({ type: 'error', code: 'FORBIDDEN', message: 'Entity not found in your org' }),
    );
    expect(readCollabDoc(key)).toMatchObject({ connection: 'error', textLength: 0 });

    FakeSocket.opened[0]?.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.opened).toHaveLength(1);
    expect(readCollabDoc(key).connection).toBe('error');

    client.destroy();
    expect(readCollabDoc(key).connection).toBe('absent');
  });
});
