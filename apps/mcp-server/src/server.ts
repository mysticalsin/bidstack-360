// MCP server hosted over HTTP/SSE per the JSON-RPC 2.0 transport described in
// the Model Context Protocol spec. Tools per handoff/mcp.tools.md.
//
// Auth: Authorization: Bearer <bidstack API key with `mcp` scope>
// Rate-limited: 60/min and 600/hour per key.

import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { handleRpc } from './rpc.js';
import { mcpAuth } from './auth.js';
import { hourlyRateLimitPlugin } from './plugins/hourly-rate-limit.js';

export async function buildMcpServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
    },
    trustProxy: process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(',').map((s) => s.trim())
      : false,
  });

  await server.register(sensible);
  await server.register(hourlyRateLimitPlugin);
  await server.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : 'anon';
      return createHash('sha256').update(token).digest('hex').slice(0, 16);
    },
  });

  // Health endpoint — public, used by Dust to verify the URL.
  server.get('/health', async () => ({ ok: true, name: 'bidstack-mcp' }));

  // Lookup the metadata Dust expects when registering an MCP server.
  server.get('/.well-known/mcp', async () => ({
    name: 'BidStack 360°',
    vendor: 'Mantu',
    version: '0.1.0',
    transport: 'http+sse',
    endpoints: { rpc: '/mcp', sse: '/mcp/sse' },
  }));

  // POST /mcp — JSON-RPC 2.0 over HTTP. The SSE leg is omitted from v0.1
  // (servers are allowed to support either; Dust accepts HTTP-only).
  server.post('/mcp', async (req, _reply) => {
    const ctx = await mcpAuth(req, prisma);
    return handleRpc(req.body, ctx, server.log);
  });

  return server;
}
