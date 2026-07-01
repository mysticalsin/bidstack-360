import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import { ensureRedisReady, redis } from '../redis.js';
import { parseTimeoutMs } from './fetch-timeout.js';

type RefreshLockLogger = Pick<pino.Logger, 'debug' | 'warn'>;

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const memoryLocks = new Map<string, { owner: string; expiresAt: number }>();

export class OAuthRefreshLockUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'OAUTH_REFRESH_LOCK_UNAVAILABLE';

  constructor() {
    super('OAuth refresh lock store is unavailable');
    this.name = 'OAuthRefreshLockUnavailableError';
  }
}

export class OAuthRefreshLockTimeoutError extends Error {
  readonly statusCode = 503;
  readonly code = 'OAUTH_REFRESH_LOCK_TIMEOUT';

  constructor(readonly waitMs: number) {
    super('OAuth token refresh is already in progress; retry shortly');
    this.name = 'OAuthRefreshLockTimeoutError';
  }
}

export function isOAuthRefreshLockError(
  err: unknown,
): err is OAuthRefreshLockUnavailableError | OAuthRefreshLockTimeoutError {
  return (
    err instanceof OAuthRefreshLockUnavailableError ||
    err instanceof OAuthRefreshLockTimeoutError ||
    (typeof err === 'object' &&
      err !== null &&
      ((err as { code?: unknown }).code === 'OAUTH_REFRESH_LOCK_UNAVAILABLE' ||
        (err as { code?: unknown }).code === 'OAUTH_REFRESH_LOCK_TIMEOUT'))
  );
}

interface OAuthRefreshLockOptions<T> {
  tokenId: string;
  log: RefreshLockLogger;
  getFreshValue: () => Promise<T | null>;
  refresh: () => Promise<T>;
}

export async function runWithOAuthRefreshLock<T>({
  tokenId,
  log,
  getFreshValue,
  refresh,
}: OAuthRefreshLockOptions<T>): Promise<T> {
  const key = `bidstack:oauth-refresh-lock:${tokenId}`;
  const ttlMs = parseTimeoutMs(process.env.OAUTH_REFRESH_LOCK_TTL_MS, 30_000);
  const waitMs = parseTimeoutMs(process.env.OAUTH_REFRESH_LOCK_WAIT_MS, 10_000);
  const pollMs = parseTimeoutMs(process.env.OAUTH_REFRESH_LOCK_POLL_MS, 250);
  const deadline = Date.now() + waitMs;

  for (;;) {
    const owner = randomUUID();
    const acquired = await acquireRefreshLock(key, owner, ttlMs, log);

    if (acquired) {
      try {
        const alreadyFresh = await getFreshValue();
        if (alreadyFresh !== null) return alreadyFresh;
        return await refresh();
      } finally {
        await releaseRefreshLock(key, owner, log);
      }
    }

    const fresh = await waitForFreshValue(getFreshValue, deadline, pollMs);
    if (fresh !== null) return fresh;

    if (Date.now() >= deadline) {
      throw new OAuthRefreshLockTimeoutError(waitMs);
    }
  }
}

async function acquireRefreshLock(
  key: string,
  owner: string,
  ttlMs: number,
  log: RefreshLockLogger,
): Promise<boolean> {
  try {
    if (await ensureRedisReady()) {
      const result = await redis.set(key, owner, 'PX', ttlMs, 'NX');
      return result === 'OK';
    }
    failIfRedisRequired();
  } catch (err) {
    if (err instanceof OAuthRefreshLockUnavailableError) throw err;
    failIfRedisRequired();
    log.warn({ err }, 'OAuth refresh Redis lock unavailable; using process-local fallback');
  }

  return acquireMemoryLock(key, owner, ttlMs);
}

async function releaseRefreshLock(
  key: string,
  owner: string,
  log: RefreshLockLogger,
): Promise<void> {
  try {
    if (await ensureRedisReady()) {
      await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, owner);
      return;
    }
  } catch (err) {
    log.debug({ err }, 'OAuth refresh Redis lock release skipped');
  }

  releaseMemoryLock(key, owner);
}

function acquireMemoryLock(key: string, owner: string, ttlMs: number): boolean {
  const now = Date.now();
  const existing = memoryLocks.get(key);
  if (existing && existing.expiresAt > now) return false;
  memoryLocks.set(key, { owner, expiresAt: now + ttlMs });
  return true;
}

function releaseMemoryLock(key: string, owner: string): void {
  const existing = memoryLocks.get(key);
  if (existing?.owner === owner) memoryLocks.delete(key);
}

function failIfRedisRequired(): void {
  const required =
    process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED !== 'false' &&
    process.env.NODE_ENV === 'production';
  if (required) throw new OAuthRefreshLockUnavailableError();
}

async function waitForFreshValue<T>(
  getFreshValue: () => Promise<T | null>,
  deadline: number,
  pollMs: number,
): Promise<T | null> {
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;
    await sleep(Math.min(pollMs, remainingMs));
    const fresh = await getFreshValue();
    if (fresh !== null) return fresh;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
