// Real-time plugin — wraps @fastify/websocket and manages per-connection
// channel subscriptions with multi-tenant enforcement.
//
// WHY WebSocket over SSE: bidirectional — clients send subscribe/unsubscribe
// messages AND presence heartbeats over the same connection. SSE is
// server-push only; we'd need a separate REST leg for client→server signals.
//
// Channel naming convention (MUST match frontend):
//   presence:org:<orgId>             — org-level presence updates
//   entity:<orgId>:<type>:<id>:edits — field-level live edits (org-scoped)
//   notification:user:<userId>       — per-user inbox notifications
//
// Security model:
//   - Auth is verified on the HTTP Upgrade request (cookie OR Authorization).
//   - Channel subscriptions are validated: the orgId embedded in the channel
//     MUST match req.auth.orgId. Attempts to cross-tenant subscribe result
//     in a FORBIDDEN error message and the subscription is silently dropped.
//   - userId-scoped notification channels additionally verify userId match.

import websocketPlugin from '@fastify/websocket';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { subscribe, type RealtimePayload } from '../services/realtime.service.js';
import { upsertPresence, removePresence } from '../services/presence.service.js';

// ─── Wire message types ────────────────────────────────────────────────────

interface SubscribeMessage {
  type: 'subscribe';
  channel: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  channel: string;
}

interface PingMessage {
  type: 'ping';
  entityType?: string;
  entityId?: string;
}

interface EditFocusMessage {
  type: 'edit.focus';
  entityType: string;
  entityId: string;
  fieldName: string;
}

interface EditBlurMessage {
  type: 'edit.blur';
  entityType: string;
  entityId: string;
  fieldName: string;
}

interface EditChangeMessage {
  type: 'edit.change';
  entityType: string;
  entityId: string;
  fieldName: string;
  value: unknown;
}

type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage
  | EditFocusMessage
  | EditBlurMessage
  | EditChangeMessage;

// ─── Channel validation ────────────────────────────────────────────────────

/**
 * Validates that a channel is well-formed and the authenticated user
 * is allowed to subscribe. Returns true if allowed.
 *
 * WHY strict: multi-tenancy — a user from org A must never receive
 * org B's presence or edit events, even via crafted channel names.
 */
export function validateChannel(channel: string, auth: { orgId: string; userId: string }): boolean {
  // presence:org:<orgId>
  const presenceMatch = channel.match(/^presence:org:([^:]+)$/);
  if (presenceMatch) {
    return presenceMatch[1] === auth.orgId;
  }

  // entity:<orgId>:<type>:<id>:edits — the orgId is embedded in the channel and
  // MUST match the caller's org. Previously this branch returned true for ANY
  // authenticated user, letting a tenant subscribe to another tenant's live-edit
  // channel by guessing an entity UUID (cross-tenant leak). Scope it here.
  const entityMatch = channel.match(/^entity:([^:]+):[a-z_]+:[0-9a-f-]+:edits$/);
  if (entityMatch) return entityMatch[1] === auth.orgId;

  // notification:user:<userId>
  const notifMatch = channel.match(/^notification:user:([^:]+)$/);
  if (notifMatch) {
    return notifMatch[1] === auth.userId;
  }

  return false;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

const realtimePluginImpl: FastifyPluginAsync = async (server) => {
  await server.register(websocketPlugin, {
    options: {
      // WHY 4MB: large enough for reasonable edit payloads, small enough to
      // block malicious oversized frames without buffering them.
      maxPayload: 4 * 1024 * 1024,
    },
  });

  server.get(
    '/api/realtime',
    {
      websocket: true,
      config: { public: false }, // Auth plugin's onRequest hook still fires for WS upgrades.
    },
    async (socket, req: FastifyRequest) => {
      const auth = req.auth;

      // Each WebSocket connection maintains its own channel→unsubscribe map.
      const unsubs = new Map<string, () => void>();
      // Unique session identifier per connection.
      const sessionId = `${auth.userId}:${Date.now()}`;

      // Register online presence.
      await upsertPresence({
        userId: auth.userId,
        orgId: auth.orgId,
        name: '',            // populated via user lookup in a real deployment; stub OK
        avatarUrl: null,
        currentEntityType: null,
        currentEntityId: null,
        sessionId,
        lastSeenAt: Date.now(),
      });

      // Helper: send typed message back to client.
      function send(type: string, data: unknown): void {
        if (socket.readyState !== 1 /* OPEN */) return;
        socket.send(JSON.stringify({ type, data, ts: Date.now() }));
      }

      // Subscribe to a channel and forward Redis messages to this WebSocket.
      function subscribeToChannel(channel: string): void {
        if (unsubs.has(channel)) return; // already subscribed
        if (!validateChannel(channel, auth)) {
          send('error', { code: 'FORBIDDEN', channel });
          return;
        }
        const unsub = subscribe(channel, (payload: RealtimePayload) => {
          send('message', payload);
        });
        unsubs.set(channel, unsub);
        send('subscribed', { channel });
      }

      // Unsubscribe from a single channel.
      function unsubscribeFromChannel(channel: string): void {
        const unsub = unsubs.get(channel);
        if (!unsub) return;
        unsub();
        unsubs.delete(channel);
        send('unsubscribed', { channel });
      }

      // Auto-subscribe to own org presence and notification channels on connect.
      subscribeToChannel(`presence:org:${auth.orgId}`);
      subscribeToChannel(`notification:user:${auth.userId}`);

      // ─── Message handler ────────────────────────────────────────────

      socket.on('message', async (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          send('error', { code: 'INVALID_JSON' });
          return;
        }

        switch (msg.type) {
          case 'subscribe':
            subscribeToChannel(msg.channel);
            break;

          case 'unsubscribe':
            unsubscribeFromChannel(msg.channel);
            break;

          case 'ping': {
            // Heartbeat — refresh presence TTL.
            await upsertPresence({
              userId: auth.userId,
              orgId: auth.orgId,
              name: '',
              avatarUrl: null,
              currentEntityType: msg.entityType ?? null,
              currentEntityId: msg.entityId ?? null,
              sessionId,
              lastSeenAt: Date.now(),
            });
            send('pong', { ts: Date.now() });
            break;
          }

          case 'edit.focus':
          case 'edit.blur':
          case 'edit.change': {
            // Re-broadcast field-level events to entity channel.
            // WHY orgId embedded in data: downstream consumers (frontend hooks)
            // validate orgId before applying the update.
            const { entityType, entityId } = msg;
            const channel = `entity:${auth.orgId}:${entityType}:${entityId}:edits`;
            const { publish } = await import('../services/realtime.service.js');
            await publish(channel, msg.type, {
              ...msg,
              userId: auth.userId,
              orgId: auth.orgId,
              sessionId,
            });
            break;
          }

          default:
            send('error', { code: 'UNKNOWN_TYPE' });
        }
      });

      // ─── WebSocket lifecycle ────────────────────────────────────────

      socket.on('close', async () => {
        // Clean up all subscriptions.
        for (const unsub of unsubs.values()) unsub();
        unsubs.clear();
        // Remove presence immediately.
        await removePresence(auth.orgId, auth.userId);
      });

      socket.on('error', () => {
        // Socket error is followed by close — cleanup handled there.
      });
    },
  );
};

export const realtimePlugin = fp(realtimePluginImpl, {
  name: 'realtime',
  // WHY auth dependency: we need req.auth on every WebSocket upgrade.
  dependencies: ['auth'],
});
