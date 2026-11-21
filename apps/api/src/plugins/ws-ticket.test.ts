// F-04: a one-time ticket opens the yjs upgrade. The same id fails the second
// time. A Clerk JWT in the query string never reaches verifyToken.

import websocket from '@fastify/websocket';
import sensible from '@fastify/sensible';
import { verifyToken } from '@clerk/backend';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    org: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), upsert: vi.fn() },
    role: { findFirst: vi.fn() },
    userRole: { upsert: vi.fn() },
    apiKey: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('./auth-audit.js', () => ({
  writeAuthAudit: vi.fn(),
}));

import { authPlugin } from './auth.js';
import {
  __setWsTicketStoreForTests,
  createMemoryWsTicketStore,
  issueWsTicket,
} from '../lib/ws-ticket.js';

const PRINCIPAL = {
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  scopes: ['read'],
  role: 'member',
  email: 'ada@example.test',
};

afterEach(() => {
  __setWsTicketStoreForTests(null);
});

describe('WebSocket one-time ticket', () => {
  it('opens /api/v1/yjs-sync once and rejects a replay and a query JWT', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'sk_test_ws_ticket';
    process.env.PUBLIC_BASE_URL = 'https://app.bidstack.test';
    vi.mocked(verifyToken).mockReset();
    __setWsTicketStoreForTests(createMemoryWsTicketStore());

    const app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(authPlugin);
    await app.register(websocket);
    app.get('/api/v1/yjs-sync', { websocket: true }, (socket, req) => {
      socket.send(req.auth.userId);
    });
    await app.ready();

    try {
      const { ticket } = await issueWsTicket(PRINCIPAL);
      const hello = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket did not open')), 1000);
        void app
          .injectWS(
            `/api/v1/yjs-sync?ticket=${encodeURIComponent(ticket)}`,
            {},
            {
              onInit(ws: { once: (ev: string, cb: (data: unknown) => void) => void; close: () => void }) {
                ws.once('message', (data) => {
                  clearTimeout(timer);
                  resolve(String(data));
                  ws.close();
                });
              },
            },
          )
          .catch((err: unknown) => {
            clearTimeout(timer);
            reject(err);
          });
      });
      expect(await hello).toBe(PRINCIPAL.userId);

      await expect(
        app.injectWS(`/api/v1/yjs-sync?ticket=${encodeURIComponent(ticket)}`),
      ).rejects.toThrow(/401/);

      await expect(
        app.injectWS('/api/v1/yjs-sync?access_token=clerk-session-jwt'),
      ).rejects.toThrow(/401/);
      expect(verifyToken).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
