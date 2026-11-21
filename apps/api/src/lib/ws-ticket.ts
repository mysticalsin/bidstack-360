// One-time WebSocket credential. The browser cannot set Authorization on a
// handshake, and a Clerk session JWT in the query string is copied into edge
// logs, history, and Referer. Callers POST /api/v1/realtime/ticket with the
// bearer, then open the socket with ?ticket=<id>. The id is opaque, lasts
// about a minute, and is deleted on first use. It is not a session JWT.

import { randomBytes } from 'node:crypto';

export const WS_TICKET_TTL_SECONDS = 60;
const KEY_PREFIX = 'ws-ticket:v1:';

export interface WsTicketPrincipal {
  orgId: string;
  userId: string;
  scopes: string[];
  role: string;
  email?: string;
  readOnly?: boolean;
}

export class WsTicketUnavailableError extends Error {
  constructor() {
    super('WebSocket tickets require Redis');
    this.name = 'WsTicketUnavailableError';
  }
}

interface WsTicketStore {
  put(id: string, payload: string, ttlSeconds: number): Promise<void>;
  take(id: string): Promise<string | null>;
}

let storeOverride: WsTicketStore | null = null;

/** Test-only. Production uses Redis GETDEL so a ticket cannot be replayed. */
export function __setWsTicketStoreForTests(store: WsTicketStore | null): void {
  storeOverride = store;
}

export function createMemoryWsTicketStore(now: () => number = Date.now): WsTicketStore {
  const entries = new Map<string, { payload: string; exp: number }>();
  return {
    async put(id, payload, ttlSeconds) {
      entries.set(id, { payload, exp: now() + ttlSeconds * 1000 });
    },
    async take(id) {
      const row = entries.get(id);
      if (!row) return null;
      entries.delete(id);
      if (row.exp <= now()) return null;
      return row.payload;
    },
  };
}

async function activeStore(): Promise<WsTicketStore> {
  if (storeOverride) return storeOverride;
  const { redis, redisStatusCanRunCommand } = await import('../redis.js');
  if (!redisStatusCanRunCommand()) throw new WsTicketUnavailableError();
  return {
    async put(id, payload, ttlSeconds) {
      await redis.set(`${KEY_PREFIX}${id}`, payload, 'EX', ttlSeconds);
    },
    async take(id) {
      return redis.getdel(`${KEY_PREFIX}${id}`);
    },
  };
}

export async function issueWsTicket(
  auth: WsTicketPrincipal,
): Promise<{ ticket: string; expiresIn: number }> {
  const ticket = randomBytes(32).toString('base64url');
  const payload = JSON.stringify({
    aud: 'websocket',
    orgId: auth.orgId,
    userId: auth.userId,
    scopes: auth.scopes,
    role: auth.role,
    email: auth.email,
    readOnly: auth.readOnly === true,
  });
  await (await activeStore()).put(ticket, payload, WS_TICKET_TTL_SECONDS);
  return { ticket, expiresIn: WS_TICKET_TTL_SECONDS };
}

export async function redeemWsTicket(ticket: string): Promise<WsTicketPrincipal | null> {
  if (!ticket || ticket.length > 128) return null;
  let raw: string | null;
  try {
    raw = await (await activeStore()).take(ticket);
  } catch (err) {
    if (err instanceof WsTicketUnavailableError) return null;
    throw err;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (row.aud !== 'websocket') return null;
  if (typeof row.orgId !== 'string' || typeof row.userId !== 'string' || typeof row.role !== 'string') {
    return null;
  }
  if (!Array.isArray(row.scopes) || row.scopes.some((scope) => typeof scope !== 'string')) return null;
  return {
    orgId: row.orgId,
    userId: row.userId,
    role: row.role,
    scopes: row.scopes as string[],
    email: typeof row.email === 'string' ? row.email : undefined,
    readOnly: row.readOnly === true,
  };
}
