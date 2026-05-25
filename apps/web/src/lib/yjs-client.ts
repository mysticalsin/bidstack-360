// Y.js WebSocket client — wraps Y.Doc + our custom /api/yjs-sync protocol.
//
// WHY a custom provider rather than y-websocket:
//   y-websocket speaks its own binary framing and expects a y-websocket-server.
//   Our backend reuses the existing @fastify/websocket infrastructure with auth
//   middleware, so we adapt the protocol to match what yjs-collab.ts expects:
//   JSON envelopes with base64-encoded Uint8Array payloads.
//
// WHY IndexedDB offline queue:
//   y-indexeddb persists the Y.Doc state locally so the editor survives a page
//   reload. We also use it to queue updates while offline and flush on reconnect.
//   This gives the "5 edits offline → reconnect → sync" property from the spec.
//
// Connection lifecycle:
//   1. connect() opens WebSocket, sends yjs:init
//   2. Server replies with yjs:init-reply (full state update)
//   3. Client applies the update, then applies queued offline updates
//   4. Local Y.Doc changes fire yjsUpdate observer → sent as yjs:update
//   5. Incoming yjs:update messages are applied locally and via y-indexeddb

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { fromUint8Array, toUint8Array } from 'js-base64';

export interface YjsClientOptions {
  entityType: string;
  entityId: string;
  fieldKey: string;
  /** Colour shown for this user's cursor (CSS colour string). */
  cursorColor?: string;
  /** Display name shown on this user's cursor label. */
  cursorName?: string;
  /** Called with each incoming cursor position from other clients. */
  onCursor?: (cursor: RemoteCursor) => void;
  /** Called when connection state changes. */
  onConnectionChange?: (state: ConnectionState) => void;
}

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
  ydocId: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const WS_RECONNECT_JITTER_MS = 500;

export class YjsClient {
  readonly doc: Y.Doc;

  private ws: WebSocket | null = null;
  private ydocId: string | null = null;
  private idb: IndexeddbPersistence | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private connectionState: ConnectionState = 'disconnected';
  private readonly pendingUpdates: Uint8Array[] = [];

  constructor(private readonly opts: YjsClientOptions) {
    this.doc = new Y.Doc();

    // Persist to IndexedDB under a stable key per (entityType, entityId, fieldKey).
    const idbKey = `yjs:${opts.entityType}:${opts.entityId}:${opts.fieldKey}`;
    this.idb = new IndexeddbPersistence(idbKey, this.doc);

    // Queue outgoing updates while offline; flush on reconnect.
    this.doc.on('update', (update: Uint8Array) => {
      if (this.ydocId && this.ws?.readyState === WebSocket.OPEN) {
        this.sendUpdate(update);
      } else {
        this.pendingUpdates.push(update);
      }
    });
  }

  /** Open the WebSocket connection and begin syncing. */
  connect(bearerToken: string): void {
    if (this.destroyed) return;
    this.bearerToken = bearerToken;
    this.openSocket();
  }

  /** Send cursor position to other collaborators. */
  setCursor(anchor: number, head: number): void {
    if (!this.ydocId || this.ws?.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      type: 'yjs:cursor',
      ydocId: this.ydocId,
      anchor,
      head,
      name: this.opts.cursorName ?? 'Anonymous',
      color: this.opts.cursorColor ?? '#6366f1',
    });
  }

  /** Tear down — call on component unmount. */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.idb?.destroy();
    this.doc.destroy();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private bearerToken = '';

  private openSocket(): void {
    if (this.destroyed) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/yjs-sync`;

    this.setConnectionState('connecting');

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      // Send auth token then init.
      // WHY header not supported in browser WS: we pass the token in the first
      // message instead. The server plugin validates req.auth (set by the auth
      // plugin on the HTTP Upgrade), so this is belt-and-suspenders for context.
      this.sendJson({
        type: 'yjs:init',
        entityType: this.opts.entityType,
        entityId: this.opts.entityId,
        fieldKey: this.opts.fieldKey,
        token: this.bearerToken,
      });
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };

    socket.onclose = () => {
      this.setConnectionState('disconnected');
      this.ws = null;
      if (!this.destroyed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      this.setConnectionState('error');
      // onclose fires after onerror — reconnect handled there.
    };
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'yjs:init-reply': {
        this.ydocId = msg.ydocId as string;
        const update = toUint8Array(msg.update as string);
        Y.applyUpdate(this.doc, update);
        this.setConnectionState('connected');

        // Flush offline updates accumulated while disconnected.
        for (const queued of this.pendingUpdates.splice(0)) {
          this.sendUpdate(queued);
        }
        break;
      }

      case 'yjs:update': {
        const update = toUint8Array(msg.update as string);
        Y.applyUpdate(this.doc, update);
        break;
      }

      case 'yjs:cursor': {
        this.opts.onCursor?.({
          userId: msg.userId as string,
          name: msg.name as string,
          color: msg.color as string,
          anchor: msg.anchor as number,
          head: msg.head as number,
          ydocId: msg.ydocId as string,
        });
        break;
      }

      case 'error': {
        // Server sent a protocol error — do not reconnect immediately.
        break;
      }
    }
  }

  private sendUpdate(update: Uint8Array): void {
    if (!this.ydocId) {
      this.pendingUpdates.push(update);
      return;
    }
    this.sendJson({
      type: 'yjs:update',
      ydocId: this.ydocId,
      update: fromUint8Array(update),
    });
  }

  private sendJson(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delay = Math.min(
      WS_RECONNECT_BASE_MS * 2 ** this.reconnectAttempts + Math.random() * WS_RECONNECT_JITTER_MS,
      WS_RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.opts.onConnectionChange?.(state);
  }
}
