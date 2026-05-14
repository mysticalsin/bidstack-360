import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

import { redis } from '../redis.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string | number | string[] | undefined>;
  body: string;
}

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 255;

const memoryStore = new Map<string, { payload: string; expiresAt: number }>();

async function getCache(key: string): Promise<CachedResponse | null> {
  try {
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as CachedResponse;
  } catch {
    // Redis unavailable — fall through to memory
  }

  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return JSON.parse(entry.payload) as CachedResponse;
}

async function setCache(key: string, value: CachedResponse, ttlSeconds: number): Promise<void> {
  const payload = JSON.stringify(value);
  try {
    await redis.setex(key, ttlSeconds, payload);
    return;
  } catch {
    // Redis unavailable — use memory fallback
  }
  memoryStore.set(key, { payload, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export const idempotencyPlugin: FastifyPluginAsync = fp(async (server) => {
  server.decorateRequest('idempotencyKey', undefined);

  server.addHook('onRequest', async (req, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return;

    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      throw req.server.httpErrors.badRequest(
        `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`,
      );
    }

    const cacheKey = `idempotency:${key}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      for (const [h, v] of Object.entries(cached.headers)) {
        if (v !== undefined) reply.header(h, v);
      }
      reply.header('X-Idempotency-Replay', 'true');
      await reply.code(cached.statusCode).send(cached.body);
      return;
    }

    req.idempotencyKey = key;
  });

  server.addHook('onSend', async (req, reply, payload) => {
    if (!req.idempotencyKey) return payload;

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const cacheEntry: CachedResponse = {
      statusCode: reply.statusCode,
      headers: {},
      body,
    };

    const contentType = reply.getHeader('content-type');
    if (contentType !== undefined) {
      cacheEntry.headers['content-type'] = contentType;
    }

    await setCache(`idempotency:${req.idempotencyKey}`, cacheEntry, IDEMPOTENCY_TTL_SECONDS);

    reply.header('X-Idempotency-Key', req.idempotencyKey);
    return payload;
  });
});
