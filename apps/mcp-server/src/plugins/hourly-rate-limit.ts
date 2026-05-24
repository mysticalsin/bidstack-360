// Hourly sliding-window rate limiter (600 requests/hour per API key) backed
// by Redis so multiple replicas share a single budget.
//
// Why Redis instead of an in-memory Map: the previous implementation kept
// counters in a local Map, which meant N replicas in production amplified
// the effective budget to N x 600/hour (an attacker hitting 4 pods could
// burn 2,400 reqs/hour). The 2026-05-24 security audit rated this HIGH-1.
//
// Algorithm — minute-bucket sliding window:
//   key per minute:  bidstack:mcp:hourly:<keyHash>:<minuteEpoch>
//   on request:      INCR the current minute, EXPIRE 3600s, sum the last 60
//                    minutes, reject above MAX_HOURLY.
//   storage cost:    60 ints per active API key. TTL self-cleans expired
//                    buckets, so no manual sweep is needed.
//
// Failure mode: if Redis is unreachable, we fail OPEN (allow the request)
// rather than block all MCP traffic. This matches @fastify/rate-limit's
// `skipOnError: true` default elsewhere in the stack. Tradeoff: a Redis
// outage temporarily disables the long-window guard, but the 60/min
// @fastify/rate-limit (also Redis-backed) still caps the short-window
// budget, and the immediate availability hit of failing closed is worse
// than the brief enforcement gap. Document this in operations runbook.

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type Redis from 'ioredis';

import { redis as defaultRedis } from '../redis.js';

export const MAX_HOURLY = 600;
const WINDOW_SECONDS = 60 * 60;
const BUCKET_SECONDS = 60;
const BUCKET_COUNT = WINDOW_SECONDS / BUCKET_SECONDS; // 60 one-minute buckets
const KEY_PREFIX = 'bidstack:mcp:hourly';

interface PluginOptions {
  /** Override the Redis client used by the plugin. Tests share a single
   *  replica's perspective by passing the same client to two server
   *  instances. */
  redis?: Redis;
}

function hashedKeyFor(req: FastifyRequest): string {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.ip ?? 'anon');
  return createHash('sha256').update(token).digest('hex');
}

function currentMinuteEpoch(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / BUCKET_SECONDS);
}

function bucketKey(hashedKey: string, minuteEpoch: number): string {
  return `${KEY_PREFIX}:${hashedKey}:${minuteEpoch}`;
}

/** Build the list of bucket keys covering the last 60 minutes inclusive of
 *  the current minute. Exported for tests that need to assert the exact
 *  key shape Redis sees. */
export function bucketsForWindow(hashedKey: string, nowMs = Date.now()): string[] {
  const currentBucket = currentMinuteEpoch(nowMs);
  const keys: string[] = new Array(BUCKET_COUNT);
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    keys[i] = bucketKey(hashedKey, currentBucket - i);
  }
  return keys;
}

interface RateState {
  total: number;
  added: number;
  oldestNonZeroAgeSeconds: number;
}

/** Increment the current bucket, then read the full window and return the
 *  total request count plus the age of the oldest non-zero bucket (used to
 *  compute Retry-After). Pipelined so it costs one RTT. */
async function tickAndRead(
  redis: Redis,
  hashedKey: string,
  nowMs = Date.now(),
): Promise<RateState> {
  const currentBucket = currentMinuteEpoch(nowMs);
  const currentKey = bucketKey(hashedKey, currentBucket);
  const windowKeys = bucketsForWindow(hashedKey, nowMs);

  const pipeline = redis.pipeline();
  pipeline.incr(currentKey);
  pipeline.expire(currentKey, WINDOW_SECONDS);
  pipeline.mget(...windowKeys);
  const results = await pipeline.exec();
  if (!results) {
    throw new Error('Redis pipeline returned no results');
  }

  const incrResult = results[0];
  if (!incrResult || incrResult[0]) {
    throw incrResult?.[0] ?? new Error('INCR failed');
  }
  const added = typeof incrResult[1] === 'number' ? incrResult[1] : Number(incrResult[1]);

  const mgetResult = results[2];
  if (!mgetResult || mgetResult[0]) {
    throw mgetResult?.[0] ?? new Error('MGET failed');
  }
  const counts = (mgetResult[1] as Array<string | null>) ?? [];
  let total = 0;
  let oldestNonZeroIndex = -1;
  for (let i = 0; i < counts.length; i += 1) {
    const raw = counts[i];
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      total += value;
      // Index 0 is the current minute, BUCKET_COUNT-1 is 59 minutes ago.
      if (i > oldestNonZeroIndex) oldestNonZeroIndex = i;
    }
  }

  // Age of the oldest contributing bucket in seconds, clamped to the window.
  const oldestNonZeroAgeSeconds =
    oldestNonZeroIndex === -1 ? 0 : Math.min(oldestNonZeroIndex * BUCKET_SECONDS, WINDOW_SECONDS);

  return { total, added, oldestNonZeroAgeSeconds };
}

const pluginImpl: FastifyPluginAsync<PluginOptions> = async (server, opts) => {
  const redis = opts.redis ?? defaultRedis;

  server.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (path !== '/mcp' && path !== '/mcp/sse' && path !== '/mcp/messages') return;

    const hashedKey = hashedKeyFor(req);

    let state: RateState;
    try {
      state = await tickAndRead(redis, hashedKey);
    } catch (err) {
      // Fail open — see header comment for rationale.
      req.log.warn({ err }, 'mcp hourly rate-limit: Redis unreachable, allowing request');
      return;
    }

    if (state.total > MAX_HOURLY) {
      // Retry-After: how long until the oldest bucket falls out of the window.
      const retryAfter = Math.max(1, WINDOW_SECONDS - state.oldestNonZeroAgeSeconds);
      reply.header('Retry-After', String(retryAfter));
      throw reply.server.httpErrors.tooManyRequests(
        `Rate limit exceeded: ${MAX_HOURLY} requests per hour. Retry after ${retryAfter}s.`,
      );
    }
  });
};

export const hourlyRateLimitPlugin = fp(pluginImpl, {
  name: 'mcp-hourly-rate-limit',
});
