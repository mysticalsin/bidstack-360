// Y.js collaborative editing plugin.
//
// WHY a separate plugin rather than extending the existing realtime plugin:
//   The realtime plugin owns presence + edit-lock signals and runs on
//   /api/realtime. Y.js sync traffic is structurally different — it uses
//   binary frames and a distinct protocol — so a separate route on
//   /api/yjs-sync keeps each route's concerns narrow and testable.
//
// Protocol (custom — aligned with y-websocket-server patterns):
//
//   Client → Server (JSON envelope with binary.data as base64):
//     { type: 'yjs:init',    ydocId, orgId?, entityType, entityId, fieldKey }
//     { type: 'yjs:update',  ydocId, update: <base64 Uint8Array> }
//     { type: 'yjs:sync',    ydocId, stateVector: <base64 Uint8Array> }
//     { type: 'yjs:cursor',  ydocId, anchor, head, name, color }
//
//   Server → Client (same JSON envelope):
//     { type: 'yjs:init-reply', ydocId, update: <base64> }        — full state
//     { type: 'yjs:update',     ydocId, update: <base64> }        — incremental
//     { type: 'yjs:cursor',     ydocId, userId, name, color, anchor, head }
//     { type: 'error',          code, message }
//
// Security model:
//   - HTTP Upgrade is authenticated by the auth plugin (same as /api/realtime).
//   - yjs:init validates orgId ownership; clients cannot cross-tenant.
//   - ydocId received in subsequent messages is re-validated against the
//     in-connection docOwnership map — prevents a client from hijacking
//     another org's doc after init.
//
// Fanout:
//   When a client sends yjs:update, the server persists it and broadcasts
//   via Redis Pub/Sub so all API instances forward it to subscribed clients.

import * as Y from 'yjs';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { pino } from 'pino';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { prisma } from '@bidstack/db';
import { publish, subscribe } from '../services/realtime.service.js';
import { loadYDoc, loadYDocById, persistUpdate } from '../services/yjs-persistence.service.js';

const logger = pino({ name: 'yjs-collab.plugin' });

// Redis Pub/Sub channel for Y.js update fanout.
// WHY per-ydocId channel: avoids fanout noise across unrelated docs.
function yjsChannel(ydocId: string): string {
  return `yjs:doc:${ydocId}`;
}

// ─── Message types ─────────────────────────────────────────────────────────

interface YjsInitMessage {
  type: 'yjs:init';
  entityType: string;
  entityId: string;
  fieldKey: string;
}

interface YjsUpdateMessage {
  type: 'yjs:update';
  ydocId: string;
  update: string; // base64 Uint8Array
}

interface YjsSyncMessage {
  type: 'yjs:sync';
  ydocId: string;
  stateVector: string; // base64 Uint8Array — client's known state
}

interface YjsCursorMessage {
  type: 'yjs:cursor';
  ydocId: string;
  anchor: number;
  head: number;
  name?: string;
  color?: string;
}

type ClientMessage = YjsInitMessage | YjsUpdateMessage | YjsSyncMessage | YjsCursorMessage;

// ─── Plugin ────────────────────────────────────────────────────────────────

const yjsCollabPluginImpl: FastifyPluginAsync = async (server) => {
  // WHY we do NOT re-register @fastify/websocket here: it's already registered
  // by the realtime plugin (fastify-plugin removes encapsulation for shared
  // decorators). We just add a new websocket route.

  // Registered at /api/v1/yjs-sync: the rewriteUrl hook normalizes /api/* to
  // /api/v1/*, so a route at /api/yjs-sync was never reachable (it 404'd as
  // /api/v1/yjs-sync). Auth is on the Upgrade via req.auth; the browser client
  // passes its token as ?access_token= (headers aren't settable on a WS).
  server.get(
    '/api/v1/yjs-sync',
    {
      websocket: true,
      config: { public: false },
    },
    async (socket, req: FastifyRequest) => {
      const auth = req.auth;
      const sessionClientId = `${auth.userId}:${Date.now()}`;

      // Map from ydocId → { orgId, unsub }.
      // WHY: prevents one connection from touching docs from multiple orgs.
      type DocSession = { orgId: string; unsub: () => void };
      const docSessions = new Map<string, DocSession>();

      function send(type: string, data: Record<string, unknown>): void {
        if (socket.readyState !== 1 /* OPEN */) return;
        socket.send(JSON.stringify({ type, ...data }));
      }

      function sendError(code: string, message: string): void {
        send('error', { code, message });
      }

      // ─── Message handler ──────────────────────────────────────────────

      socket.on('message', async (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          sendError('INVALID_JSON', 'Message must be JSON');
          return;
        }

        switch (msg.type) {
          case 'yjs:init': {
            await handleInit(msg);
            break;
          }
          case 'yjs:update': {
            await handleUpdate(msg);
            break;
          }
          case 'yjs:sync': {
            await handleSync(msg);
            break;
          }
          case 'yjs:cursor': {
            await handleCursor(msg);
            break;
          }
          default: {
            sendError('UNKNOWN_TYPE', 'Unknown message type');
          }
        }
      });

      // ─── Handler implementations ──────────────────────────────────────

      async function handleInit(msg: YjsInitMessage): Promise<void> {
        // Verify the entity belongs to this org.
        const entityOrgId = await resolveEntityOrg(
          msg.entityType,
          msg.entityId,
          auth.orgId,
        );
        if (!entityOrgId) {
          sendError('FORBIDDEN', 'Entity not found in your org');
          return;
        }

        const { doc, ydocId } = await loadYDoc({
          orgId: auth.orgId,
          entityType: msg.entityType,
          entityId: msg.entityId,
          fieldKey: msg.fieldKey,
        });

        // Subscribe to Redis Pub/Sub fanout for this doc.
        const unsub = subscribe(yjsChannel(ydocId), (payload) => {
          // Do not echo back to the originating client.
          if (payload.data && (payload.data as Record<string, unknown>).clientId === sessionClientId) {
            return;
          }
          if (payload.type === 'yjs:update') {
            send('yjs:update', {
              ydocId,
              update: (payload.data as Record<string, unknown>).update,
            });
          } else if (payload.type === 'yjs:cursor') {
            send('yjs:cursor', payload.data as Record<string, unknown>);
          }
        });

        docSessions.set(ydocId, { orgId: auth.orgId, unsub });

        // Send full state to the client.
        const fullUpdate = Y.encodeStateAsUpdate(doc);
        send('yjs:init-reply', {
          ydocId,
          update: fromUint8Array(fullUpdate),
        });
      }

      async function handleUpdate(msg: YjsUpdateMessage): Promise<void> {
        const session = docSessions.get(msg.ydocId);
        if (!session || session.orgId !== auth.orgId) {
          sendError('FORBIDDEN', 'Not subscribed to this doc');
          return;
        }

        const update = toUint8Array(msg.update);

        // Persist to append-only log.
        await persistUpdate(msg.ydocId, auth.orgId, sessionClientId, update);

        // Fanout to other instances/clients via Redis.
        await publish(yjsChannel(msg.ydocId), 'yjs:update', {
          ydocId: msg.ydocId,
          update: msg.update, // already base64
          clientId: sessionClientId,
        });
      }

      async function handleSync(msg: YjsSyncMessage): Promise<void> {
        const session = docSessions.get(msg.ydocId);
        if (!session || session.orgId !== auth.orgId) {
          sendError('FORBIDDEN', 'Not subscribed to this doc');
          return;
        }

        // Load the ACTUAL doc by its id. The previous blank-composite-key load
        // missed the row, created a phantom empty doc, and returned an empty
        // (wrong) sync delta. The session check above already proves org scope.
        const doc = await loadYDocById(msg.ydocId, auth.orgId);
        if (!doc) {
          sendError('NOT_FOUND', 'Document not found');
          return;
        }

        // Compute the diff between the client's state and the server's state.
        const clientStateVector = toUint8Array(msg.stateVector);
        const diffUpdate = Y.encodeStateAsUpdate(doc, clientStateVector);

        send('yjs:update', {
          ydocId: msg.ydocId,
          update: fromUint8Array(diffUpdate),
        });
      }

      async function handleCursor(msg: YjsCursorMessage): Promise<void> {
        const session = docSessions.get(msg.ydocId);
        if (!session || session.orgId !== auth.orgId) return;

        // Fanout cursor position to other clients — no persistence needed.
        await publish(yjsChannel(msg.ydocId), 'yjs:cursor', {
          ydocId: msg.ydocId,
          userId: auth.userId,
          name: msg.name ?? auth.userId,
          color: msg.color ?? '#6366f1',
          anchor: msg.anchor,
          head: msg.head,
          clientId: sessionClientId,
        });
      }

      // ─── Cleanup ──────────────────────────────────────────────────────

      socket.on('close', () => {
        for (const { unsub } of docSessions.values()) unsub();
        docSessions.clear();
      });

      socket.on('error', () => {
        // close event always follows error — cleanup handled there.
      });
    },
  );
};

// ─── Entity → org resolver ─────────────────────────────────────────────────

/**
 * Verify that the given entity belongs to the requesting org.
 * WHY: prevents a client from attaching Y.js to an entity they don't own.
 *
 * Returns the orgId if the entity exists and belongs to the given org,
 * otherwise null.
 */
async function resolveEntityOrg(
  entityType: string,
  entityId: string,
  orgId: string,
): Promise<string | null> {
  // Whitelist of entity types that support collaborative editing.
  const SUPPORTED_TYPES: Record<string, () => Promise<{ orgId: string } | null>> = {
    opportunity: () =>
      prisma.opportunity.findFirst({
        where: { id: entityId, orgId },
        select: { orgId: true },
      }),
    contact: () =>
      prisma.contact.findFirst({
        where: { id: entityId, orgId },
        select: { orgId: true },
      }),
    lead: () =>
      prisma.lead.findFirst({
        where: { id: entityId, orgId },
        select: { orgId: true },
      }),
  };

  const resolver = SUPPORTED_TYPES[entityType];
  if (!resolver) {
    logger.warn({ entityType }, 'unsupported entityType for yjs-collab');
    return null;
  }

  const record = await resolver().catch((err: unknown) => {
    logger.error({ entityType, entityId, err }, 'entity org lookup failed');
    return null;
  });

  return record?.orgId ?? null;
}

export const yjsCollabPlugin = fp(yjsCollabPluginImpl, {
  name: 'yjs-collab',
  // WHY auth + realtime: auth provides req.auth; realtime registers @fastify/websocket.
  dependencies: ['auth', 'realtime'],
});
