import { createHash } from 'crypto';
import { ensureRedisReady, redis } from '../redis.js';

const IN_MEMORY = new Map<string, { value: string; expiresAt: number }>();

export async function cacheGet<T>(key: string): Promise<{ hit: boolean; data: T | null }> {
  try {
    if (await ensureRedisReady()) {
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
    if (await ensureRedisReady()) {
      await redis.setex(key, ttlSeconds, raw);
      return;
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }

  IN_MEMORY.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function deleteInMemory(pattern: string): void {
  const prefix = pattern.replace(/\*$/, '');
  for (const key of IN_MEMORY.keys()) {
    if (key.startsWith(prefix)) {
      IN_MEMORY.delete(key);
    }
  }
}

async function deleteRedisPattern(pattern: string): Promise<void> {
  const batchSize = 500;
  const maxKeys = 10_000;
  let cursor = '0';
  let touched = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
    cursor = nextCursor;
    touched += keys.length;
    if (keys.length) await redis.del(...keys);
    if (touched >= maxKeys) break;
  } while (cursor !== '0');
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    if (await ensureRedisReady()) {
      await deleteRedisPattern(pattern);
    }
  } catch {
    // Redis may be mid-connect or unavailable; always clear fallback cache below.
  }

  deleteInMemory(pattern);
}

export function cacheKey(parts: string[]): string {
  return `bidstack:cache:${parts.join(':')}`;
}

export function bodyHash(body: unknown): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
