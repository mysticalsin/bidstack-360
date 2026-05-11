// Custom sliding-window rate limiter: 600 requests/hour per API key.
// Complements @fastify/rate-limit (60/min) with a longer window.

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

interface WindowEntry {
  count: number;
  resetAt: number;
}

const STORE = new Map<string, WindowEntry>();
const MAX_HOURLY = 600;
const WINDOW_MS = 60 * 60 * 1000;

function keyFor(req: FastifyRequest): string {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.ip ?? 'anon');
  return createHash('sha256').update(token).digest('hex');
}

function cleanup() {
  const now = Date.now();
  for (const [k, v] of STORE) {
    if (v.resetAt < now) STORE.delete(k);
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only rate-limit the /mcp endpoint
    if (req.url !== '/mcp') return;

    cleanup();

    const key = keyFor(req);
    const now = Date.now();
    let entry = STORE.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 1, resetAt: now + WINDOW_MS };
      STORE.set(key, entry);
      return;
    }

    if (entry.count >= MAX_HOURLY) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      reply.header('Retry-After', retryAfter);
      throw reply.server.httpErrors.tooManyRequests(
        `Rate limit exceeded: ${MAX_HOURLY} requests per hour. Retry after ${retryAfter}s.`,
      );
    }

    entry.count++;
  });
});

export const hourlyRateLimitPlugin = plugin;
