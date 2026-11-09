import type { Redis } from 'ioredis';

export const RATE_LIMIT_RETRY_AFTER_SECONDS = 5;

// @fastify/rate-limit's Redis store runs these two custom commands.
const STORE_COMMANDS = new Set<PropertyKey>(['rateLimit', 'rateLimitRead']);

/**
 * The rate-limit store could not be reached. Only surfaces where the limiter
 * does not fail open (POLO_DATA_MODE=real): the request is refused, never let
 * through unlimited.
 */
export class RateLimitStoreUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'RATE_LIMIT_STORE_UNAVAILABLE';
  readonly retryAfterSeconds = RATE_LIMIT_RETRY_AFTER_SECONDS;

  constructor(override readonly cause: unknown) {
    super('Rate limiting is temporarily unavailable; retry shortly');
    this.name = 'RateLimitStoreUnavailableError';
  }
}

export function isRateLimitStoreUnavailableError(err: unknown): err is RateLimitStoreUnavailableError {
  return err instanceof RateLimitStoreUnavailableError;
}

type Callback = (err: unknown, result?: unknown) => void;

/**
 * The client to hand to @fastify/rate-limit. Errors from the store's commands
 * come back as RateLimitStoreUnavailableError so the error handler can answer
 * 503 instead of a masked 500; every other call goes to the client unchanged.
 * The commands are bounded by the client's commandTimeout.
 */
export function tagRateLimitStoreErrors(client: Redis): Redis {
  return new Proxy(client, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!STORE_COMMANDS.has(prop)) return value.bind(target);
      return (...args: unknown[]) => {
        const callback = args.pop() as Callback;
        return (value as (...a: unknown[]) => unknown).apply(target, [
          ...args,
          (err: unknown, result?: unknown) =>
            err ? callback(new RateLimitStoreUnavailableError(err)) : callback(null, result),
        ]);
      };
    },
  });
}
