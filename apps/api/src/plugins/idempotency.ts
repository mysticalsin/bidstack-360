import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';

import { redis } from '../redis.js';

interface RequestFingerprint {
  fingerprint: string;
  method: string;
  path: string;
  bodyHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyCacheKey?: string;
    idempotencyLockKey?: string;
    idempotencyFingerprint?: RequestFingerprint;
  }
}

interface CachedResponse extends RequestFingerprint {
  statusCode: number;
  headers: Record<string, string | number | string[] | undefined>;
  body: string;
}

type LockResult = 'acquired' | 'in-flight-same' | 'in-flight-different';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 255;

const memoryStore = new Map<string, { payload: string; expiresAt: number }>();
const memoryLocks = new Map<string, { fingerprint: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of memoryStore.entries()) {
    if (now > entry.expiresAt) {
      memoryStore.delete(k);
    }
  }
  for (const [k, entry] of memoryLocks.entries()) {
    if (now > entry.expiresAt) {
      memoryLocks.delete(k);
    }
  }
}, 60000).unref();

async function getCache(key: string): Promise<CachedResponse | null> {
  try {
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as CachedResponse;
  } catch {
    // Redis unavailable; fall through to memory for local/test.
  }

  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  memoryStore.delete(key);
  memoryStore.set(key, entry);
  return JSON.parse(entry.payload) as CachedResponse;
}

async function setCache(key: string, value: CachedResponse, ttlSeconds: number): Promise<void> {
  const payload = JSON.stringify(value);
  try {
    await redis.setex(key, ttlSeconds, payload);
    return;
  } catch {
    // Redis unavailable; use process-local memory for local/test.
  }

  if (memoryStore.has(key)) {
    memoryStore.delete(key);
  } else if (memoryStore.size >= 5000) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey !== undefined) {
      memoryStore.delete(oldestKey);
    }
  }
  memoryStore.set(key, { payload, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function acquireLock(
  key: string,
  fingerprint: RequestFingerprint,
  ttlSeconds: number,
): Promise<LockResult> {
  const payload = JSON.stringify(fingerprint);
  try {
    const result = await redis.set(key, payload, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') return 'acquired';

    const existing = await redis.get(key);
    if (existing) {
      const existingFingerprint = JSON.parse(existing) as RequestFingerprint;
      return existingFingerprint.fingerprint === fingerprint.fingerprint
        ? 'in-flight-same'
        : 'in-flight-different';
    }
    return 'in-flight-same';
  } catch {
    // Redis unavailable; use process-local protection for local/test.
  }

  const now = Date.now();
  const existing = memoryLocks.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.fingerprint === fingerprint.fingerprint
      ? 'in-flight-same'
      : 'in-flight-different';
  }
  memoryLocks.set(key, {
    fingerprint: fingerprint.fingerprint,
    expiresAt: now + ttlSeconds * 1000,
  });
  return 'acquired';
}

async function releaseLock(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // Redis unavailable; remove the local/test lock below.
  }
  memoryLocks.delete(key);
}

function fingerprintRequest(method: string, url: string, body: unknown): RequestFingerprint {
  const path = url.split('?')[0] ?? url;
  const bodyHash = createHash('sha256').update(stableBody(body)).digest('hex');
  const normalizedMethod = method.toUpperCase();
  return {
    method: normalizedMethod,
    path,
    bodyHash,
    fingerprint: `${normalizedMethod} ${path} ${bodyHash}`,
  };
}

function stableBody(body: unknown): string {
  if (body === undefined) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('base64');
  return stableStringify(body);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export const idempotencyPlugin: FastifyPluginAsync = fp(async (server) => {
  server.decorateRequest('idempotencyKey', undefined);
  server.decorateRequest('idempotencyCacheKey', undefined);
  server.decorateRequest('idempotencyLockKey', undefined);
  server.decorateRequest('idempotencyFingerprint', undefined);

  server.addHook('preHandler', async (req, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return;

    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      throw req.server.httpErrors.badRequest(
        `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`,
      );
    }

    if (!req.auth?.userId) {
      throw req.server.httpErrors.unauthorized('Authentication required for idempotent requests');
    }

    const scope = req.auth.userId;
    const cacheKey = `idempotency:${scope}:${key}`;
    const lockKey = `${cacheKey}:lock`;
    const fingerprint = fingerprintRequest(req.method, req.url, req.body);
    const cached = await getCache(cacheKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint.fingerprint) {
        throw req.server.httpErrors.conflict(
          'Idempotency-Key was already used for a different request',
        );
      }
      for (const [h, v] of Object.entries(cached.headers)) {
        if (v !== undefined) reply.header(h, v);
      }
      reply.header('X-Idempotency-Replay', 'true');
      await reply.code(cached.statusCode).send(cached.body);
      return;
    }

    const lockResult = await acquireLock(lockKey, fingerprint, 30);
    if (lockResult === 'in-flight-different') {
      throw req.server.httpErrors.conflict(
        'Idempotency-Key was already used for a different request',
      );
    }
    if (lockResult === 'in-flight-same') {
      throw req.server.httpErrors.conflict('Idempotent request is already in flight');
    }

    req.idempotencyKey = key;
    req.idempotencyCacheKey = cacheKey;
    req.idempotencyLockKey = lockKey;
    req.idempotencyFingerprint = fingerprint;
  });

  server.addHook('onSend', async (req, reply, payload) => {
    if (!req.idempotencyKey || !req.idempotencyCacheKey || !req.idempotencyFingerprint) {
      return payload;
    }

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const cacheEntry: CachedResponse = {
      ...req.idempotencyFingerprint,
      statusCode: reply.statusCode,
      headers: {},
      body,
    };

    const contentType = reply.getHeader('content-type');
    if (contentType !== undefined) {
      cacheEntry.headers['content-type'] = contentType;
    }

    if (!req.auth?.userId) return payload;
    await setCache(req.idempotencyCacheKey, cacheEntry, IDEMPOTENCY_TTL_SECONDS);
    if (req.idempotencyLockKey) {
      await releaseLock(req.idempotencyLockKey);
    }

    reply.header('X-Idempotency-Key', req.idempotencyKey);
    return payload;
  });

  server.addHook('onError', async (req) => {
    if (req.idempotencyLockKey) {
      await releaseLock(req.idempotencyLockKey);
    }
  });
});
