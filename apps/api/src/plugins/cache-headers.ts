import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { createHash } from 'crypto';

// Route-pattern → cache directive. Patterns are checked in order; first match wins.
const READ_ROUTE_PATTERNS: Array<{ pattern: RegExp; directive: string; etag: boolean }> = [
  { pattern: /^GET \/api\/v1\/crm\/summary/, directive: 'max-age=60, stale-while-revalidate=300', etag: true },
  { pattern: /^GET \/api\/v1\/crm\/dashboard/, directive: 'max-age=30, stale-while-revalidate=120', etag: true },
  { pattern: /^GET \/api\/v1\/opportunities/, directive: 'max-age=30, stale-while-revalidate=120', etag: true },
  { pattern: /^GET \/api\/v1\/companies/, directive: 'max-age=60, stale-while-revalidate=300', etag: true },
  { pattern: /^GET \/api\/v1\/contacts/, directive: 'max-age=60, stale-while-revalidate=300', etag: true },
  { pattern: /^GET \/api\/v1\/reports\/pipeline/, directive: 'max-age=120, stale-while-revalidate=600', etag: true },
  { pattern: /^GET \/api\/v1\/integrations\/[^/]+\/status/, directive: 'max-age=15, stale-while-revalidate=60', etag: true },
  { pattern: /^GET \/api\/v1\/health/, directive: 'max-age=5', etag: false },
];

function etagFor(body: unknown): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return `W/"${createHash('sha256').update(raw).digest('hex').slice(0, 16)}"`;
}

export const cacheHeadersPlugin: FastifyPluginAsync = fp(async (server) => {
  server.addHook('onSend', async (req, reply, payload) => {
    const method = req.method;
    const url = req.url;
    const routeKey = `${method} ${url.split('?')[0]}`;

    // Skip cache for mutations and explicit nocache
    if (method !== 'GET' || url.includes('nocache=1')) {
      reply.header('Cache-Control', 'no-store');
      return payload;
    }

    for (const { pattern, directive, etag } of READ_ROUTE_PATTERNS) {
      if (pattern.test(routeKey)) {
        reply.header('Cache-Control', directive);
        if (etag && payload) {
          const tag = etagFor(payload);
          reply.header('ETag', tag);
          const ifNoneMatch = req.headers['if-none-match'];
          if (ifNoneMatch === tag) {
            reply.code(304);
            return '';
          }
        }
        return payload;
      }
    }

    // Default for unmatched GET routes: no-store to be safe
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
});
