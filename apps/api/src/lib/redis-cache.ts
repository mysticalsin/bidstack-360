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

// Per-org cache key index. Every cache entry an org writes is registered in a
// Redis SET so invalidation is O(keys-for-this-org) — a targeted SMEMBERS+DEL —
// instead of a full-keyspace SCAN on every mutation (which kept the cache cold
// and pinned Redis at thousands of mutations/sec across a 100k-tenant fleet).
function orgIndexKey(orgId: string): string {
  return `bidstack:cacheidx:${orgId}`;
}

/**
 * Register a freshly-written cache key under its org's index set so a later
 * mutation can invalidate it without scanning the keyspace. The index set is
 * given a TTL slightly longer than the entry's so it self-cleans if no mutation
 * ever arrives. Best-effort: indexing failures must not fail the read path.
 */
export async function registerOrgCacheKey(
  orgId: string,
  key: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    if (await ensureRedisReady()) {
      const idx = orgIndexKey(orgId);
      await redis.sadd(idx, key);
      // Keep the index alive at least as long as the longest entry it tracks.
      // EXPIRE is reset on each add, so the set lives ttl seconds past the last
      // write — long enough to cover every entry it indexes.
      await redis.expire(idx, ttlSeconds + 60);
    }
  } catch {
    // Index is an optimization for invalidation; the in-memory prefix sweep and
    // entry TTLs still bound staleness if the index is missing.
  }
}

/**
 * Invalidate every cache entry for one org. Uses the per-org index set
 * (SMEMBERS → DEL keys → DEL set) so cost scales with the org's own cache size,
 * not the global keyspace. Falls back to nothing on Redis errors; the in-memory
 * tier is always swept. Correctness matches the old `{orgId}:*` wildcard: all of
 * the org's entries are dropped.
 */
export async function invalidateOrgCache(orgId: string): Promise<void> {
  try {
    if (await ensureRedisReady()) {
      const idx = orgIndexKey(orgId);
      const keys = await redis.smembers(idx);
      if (keys.length) {
        // Chunk DELs so one mutation never ships a single multi-thousand-arg
        // command (mirrors the 500-key batching the old SCAN path used).
        const batchSize = 500;
        for (let i = 0; i < keys.length; i += batchSize) {
          await redis.del(...keys.slice(i, i + batchSize));
        }
      }
      await redis.del(idx);
    }
  } catch {
    // Redis may be mid-connect or unavailable; always clear the fallback below.
  }

  deleteInMemory(`bidstack:cache:${orgId}:`);
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
