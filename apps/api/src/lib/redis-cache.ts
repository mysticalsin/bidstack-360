import { createHash } from 'crypto';
import { redis } from '../redis.js';

const IN_MEMORY = new Map<string, { value: string; expiresAt: number }>();

function isRedisUp(): boolean {
  return redis.status === 'ready' || redis.status === 'connect';
}

export async function cacheGet<T>(key: string): Promise<{ hit: boolean; data: T | null }> {
  try {
    if (isRedisUp()) {
      const raw = await redis.get(key);
      if (raw) return { hit: true, data: JSON.parse(raw) as T };
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }

  const entry = IN_MEMORY.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    IN_MEMORY.delete(key);
    return { hit: false, data: null };
  }
  return { hit: true, data: JSON.parse(entry.value) as T };
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  try {
    if (isRedisUp()) {
      await redis.setex(key, ttlSeconds, raw);
      return;
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }

  IN_MEMORY.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    if (isRedisUp()) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
      return;
    }
  } catch {
    // fall through
  }

  for (const key of IN_MEMORY.keys()) {
    if (key.includes(pattern.replace(/\*$/, ''))) {
      IN_MEMORY.delete(key);
    }
  }
}

export function cacheKey(parts: string[]): string {
  return `bidstack:cache:${parts.join(':')}`;
}

export function bodyHash(body: unknown): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
