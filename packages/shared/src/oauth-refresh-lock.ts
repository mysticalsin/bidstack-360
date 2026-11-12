/**
 * One refresh of an OAuth grant at a time. The API and the worker share this
 * lock, keyed by the token id, so a rotated refresh token is not used twice.
 */
import { randomUUID } from 'node:crypto';

type RefreshLockLogger = {
  debug: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
};

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

export interface OAuthRefreshLockRedis {
  ready: () => Promise<boolean>;
  set: (
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ) => Promise<string | null>;
  eval: (script: string, numKeys: number, key: string, owner: string) => Promise<unknown>;
}

interface OAuthRefreshLockOptions<T> {
  tokenId: string;
  log: RefreshLockLogger;
  getFreshValue: () => Promise<T | null>;
  refresh: () => Promise<T>;
  redis: OAuthRefreshLockRedis | null;
  redisRequired: boolean;
}

function timeoutMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runWithOAuthRefreshLock<T>({
  tokenId,
  log,
  getFreshValue,
  refresh,
  redis,
  redisRequired,
}: OAuthRefreshLockOptions<T>): Promise<T> {
  const key = `bidstack:oauth-refresh-lock:${tokenId}`;
  const ttlMs = timeoutMs('OAUTH_REFRESH_LOCK_TTL_MS', 30_000);
  const waitMs = timeoutMs('OAUTH_REFRESH_LOCK_WAIT_MS', 10_000);
  const pollMs = timeoutMs('OAUTH_REFRESH_LOCK_POLL_MS', 250);
  const deadline = Date.now() + waitMs;

  for (;;) {
    const owner = randomUUID();
    const acquired = await acquireRefreshLock(key, owner, ttlMs, redis, redisRequired, log);

    if (acquired) {
      try {
        const alreadyFresh = await getFreshValue();
        if (alreadyFresh !== null) return alreadyFresh;
        return await refresh();
      } finally {
        await releaseRefreshLock(key, owner, redis, log);
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
  redis: OAuthRefreshLockRedis | null,
  redisRequired: boolean,
  log: RefreshLockLogger,
): Promise<boolean> {
  try {
    if (redis && (await redis.ready())) {
      const result = await redis.set(key, owner, 'PX', ttlMs, 'NX');
      return result === 'OK';
    }
    if (redisRequired) throw new OAuthRefreshLockUnavailableError();
  } catch (err) {
    if (err instanceof OAuthRefreshLockUnavailableError) throw err;
    if (redisRequired) throw new OAuthRefreshLockUnavailableError();
    log.warn({ err }, 'OAuth refresh Redis lock unavailable; using process-local fallback');
  }

  return acquireMemoryLock(key, owner, ttlMs);
}

async function releaseRefreshLock(
  key: string,
  owner: string,
  redis: OAuthRefreshLockRedis | null,
  log: RefreshLockLogger,
): Promise<void> {
  try {
    if (redis && (await redis.ready())) {
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
