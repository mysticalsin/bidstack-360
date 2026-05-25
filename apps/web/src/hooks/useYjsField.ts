// useYjsField — React hook that returns a Y.Text bound to a collaborative field.
//
// Usage:
//   const { yText, ydoc, connectionState, remoteCursors } =
//     useYjsField({ entityType: 'opportunity', entityId: id, fieldKey: 'notes' });
//
// The hook manages the YjsClient lifecycle (connect on mount, destroy on unmount).
// It also requests a fresh Clerk auth token before connecting so the server can
// validate the WebSocket upgrade via req.auth.

import { useEffect, useRef, useState, useCallback } from 'react';
import type * as Y from 'yjs';
import { YjsClient, type RemoteCursor, type ConnectionState } from '@/lib/yjs-client';

export interface UseYjsFieldOptions {
  entityType: string;
  entityId: string | undefined;
  fieldKey: string;
  cursorColor?: string;
  cursorName?: string;
  /** Skip connecting if false — use to gate on auth readiness. */
  enabled?: boolean;
}

export interface UseYjsFieldResult {
  /** The Y.Text for this field — pass to Tiptap via CollaborationExtension. */
  yText: Y.Text | null;
  /** The parent Y.Doc — needed by Tiptap's Collaboration extension. */
  ydoc: Y.Doc | null;
  connectionState: ConnectionState;
  remoteCursors: RemoteCursor[];
  /** Broadcast cursor position after a selection change. */
  setCursor: (anchor: number, head: number) => void;
}

export function useYjsField({
  entityType,
  entityId,
  fieldKey,
  cursorColor,
  cursorName,
  enabled = true,
}: UseYjsFieldOptions): UseYjsFieldResult {
  const clientRef = useRef<YjsClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    if (!enabled || !entityId) return;

    const client = new YjsClient({
      entityType,
      entityId,
      fieldKey,
      cursorColor,
      cursorName,
      onCursor: (cursor) => {
        setRemoteCursors((prev) => {
          const filtered = prev.filter((c) => c.userId !== cursor.userId);
          return [...filtered, cursor];
        });
      },
      onConnectionChange: setConnectionState,
    });

    clientRef.current = client;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the Yjs document is created by the external collaboration client.
    setYdoc(client.doc);

    // Obtain a Clerk JWT for the WS auth handshake.
    // WHY: WebSocket API cannot set headers in browsers — we pass the token
    //   in the first message. See yjs-client.ts sendJson({ type: 'yjs:init', token }).
    const tokenProvider = (window as Window & { __apiTokenProvider?: () => Promise<string | null> }).__apiTokenProvider;

    const connectWithToken = async (): Promise<void> => {
      let token = '';
      if (typeof tokenProvider === 'function') {
        token = (await tokenProvider()) ?? '';
      }
      client.connect(token);
    };

    void connectWithToken();

    return () => {
      client.destroy();
      clientRef.current = null;
      setYdoc(null);
      setRemoteCursors([]);
    };
  // Reconnect if the entity or field changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, fieldKey, enabled]);

  const setCursor = useCallback((anchor: number, head: number) => {
    clientRef.current?.setCursor(anchor, head);
  }, []);

  const yText = ydoc ? ydoc.getText(fieldKey) : null;

  return { yText, ydoc, connectionState, remoteCursors, setCursor };
}
