// MCP server hosted over Streamable HTTP per the JSON-RPC 2.0 transport described in
// the Model Context Protocol spec. Legacy HTTP+SSE stays available during migration.
//
// Auth: Authorization: Bearer <bidstack API key with `mcp` + read/write scopes>
// Rate-limited: 60/min and 600/hour per key.

import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { z } from 'zod';

import { prisma } from '@bidstack/db';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { mcpAuth, requireMcpScope, type McpAuthCtx } from './auth.js';
import { hourlyRateLimitPlugin, mcpRateLimitFailsClosed } from './plugins/hourly-rate-limit.js';
import { pingRedis, redis } from './redis.js';
import { assertSerumAllowsMcpToolCall } from './serum-policy.js';
import { requiredScopeForTool, tools, type ToolName } from './tools/index.js';

type LooseTool = {
  description: string;
  input: z.ZodTypeAny;
  inputJsonSchema: Record<string, unknown>;
  handler: (args: unknown, ctx: McpAuthCtx) => Promise<unknown>;
};

type SseSession = {
  transport: SSEServerTransport;
  ctx: McpAuthCtx;
  mcp: McpServer;
  /** Unix ms — used by the TTL sweep to evict sessions that never closed cleanly. */
  createdAt: number;
};

type StreamableSession = {
  transport: StreamableHTTPServerTransport;
  ctx: McpAuthCtx;
  mcp: McpServer;
  /** Unix ms — used by the TTL sweep to evict sessions that never closed cleanly. */
  createdAt: number;
};

/** Reject new session creation when combined Map size reaches this. */
const MAX_SESSIONS = 500;
/** Evict sessions still open beyond this age (handles unclean client disconnects). */
const SESSION_TTL_MS = 2 * 60 * 60 * 1_000; // 2 hours

function releaseMetadata(env: NodeJS.ProcessEnv = process.env): {
  commit: string | null;
  branch: string | null;
} {
  return {
    commit:
      env.BIDSTACK_RELEASE_COMMIT?.trim() ||
      env.GIT_COMMIT?.trim() ||
      env.GIT_SHA?.trim() ||
      null,
    branch:
      env.BIDSTACK_RELEASE_BRANCH?.trim() ||
      env.GIT_BRANCH?.trim() ||
      env.VERCEL_GIT_COMMIT_REF?.trim() ||
      null,
  };
}

function createAuthenticatedMcp(ctx: McpAuthCtx): McpServer {
  const mcp = new McpServer({ name: 'Polo PreSales', version: '0.1.0' });

  for (const name of Object.keys(tools) as ToolName[]) {
    const tool = tools[name];
    const requiredScope = requiredScopeForTool(name);

    mcp.tool(
      name,
      tool.description,
      (tool.input as z.ZodObject<z.ZodRawShape>).shape,
      async (args: unknown) => {
        try {
          requireMcpScope(ctx, requiredScope);
          await assertSerumAllowsMcpToolCall(ctx, name);
          const out = await (tool as LooseTool).handler(args, ctx);
          return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Internal error';
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      },
    );
  }

  return mcp;
}

function sendJsonRpcError(reply: FastifyReply, statusCode: number, message: string): void {
  reply.status(statusCode).send({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

export async function buildMcpServer(): Promise<FastifyInstance> {
  const failClosedOnRateLimitError = mcpRateLimitFailsClosed();
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
  await server.register(hourlyRateLimitPlugin, {
    failClosedOnRedisError: failClosedOnRateLimitError,
  });
  await server.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // Redis-backed store so the per-minute budget is shared across replicas.
    // Without this, every pod ran its own LRU cache and the effective budget
    // scaled linearly with replica count — see 2026-05-24 audit HIGH-1.
    redis,
    // Namespace under our own prefix so it can't collide with the hourly
    // plugin's keys or with any future app reuse of the same Redis.
    nameSpace: 'bidstack:mcp:perminute:',
    // Production fails closed so all replicas keep a real shared budget.
    // Development/test can fail open for local resilience.
    skipOnError: !failClosedOnRateLimitError,
    keyGenerator: (req) => {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : 'anon';
      return createHash('sha256').update(token).digest('hex').slice(0, 16);
    },
  });

  // Public readiness endpoint — probes the DB (every MCP tool hits Prisma) AND
  // Redis. pingRedis() also reconnects the never-auto-retrying client, and in
  // fail-closed mode a dead Redis means every /mcp call 503s — health must not
  // stay green while the service is effectively down.
  server.get('/health', async (_req, reply) => {
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    const redisOk = await pingRedis();
    const ok = dbOk && (redisOk || !mcpRateLimitFailsClosed());
    const body = {
      ok,
      name: 'bidstack-mcp',
      db: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      release: releaseMetadata(),
    };
    return ok ? body : reply.code(503).send(body);
  });

  server.get('/.well-known/mcp', async () => ({
    name: 'Polo PreSales',
    vendor: 'Mantu',
    version: '0.1.0',
    release: releaseMetadata(),
    transport: 'streamable-http',
    endpoints: {
      mcp: '/mcp',
      legacySse: '/mcp/sse',
      legacyMessages: '/mcp/messages',
    },
    legacy: {
      transport: 'http+sse',
      deprecated: true,
    },
  }));

  const sseTransports = new Map<string, SseSession>();
  const streamableTransports = new Map<string, StreamableSession>();

  server.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      const ctx = await mcpAuth(req, prisma);
      const sessionHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      let transport: StreamableHTTPServerTransport;

      if (sessionId) {
        const session = streamableTransports.get(sessionId);
        if (!session) {
          sendJsonRpcError(reply, 404, 'Session not found');
          return;
        }
        if (session.ctx.keyId !== ctx.keyId) {
          sendJsonRpcError(reply, 403, 'Session belongs to a different API key');
          return;
        }
        transport = session.transport;
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        // Cap check: guard against runaway session creation before the sweep can evict.
        if (sseTransports.size + streamableTransports.size >= MAX_SESSIONS) {
          sendJsonRpcError(reply, 503, 'Server at session capacity — try again later');
          return;
        }
        const sessionCreatedAt = Date.now();
        const mcp = createAuthenticatedMcp(ctx);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            streamableTransports.set(initializedSessionId, {
              transport,
              ctx,
              mcp,
              createdAt: sessionCreatedAt,
            });
          },
        });
        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (!closedSessionId) return;
          const session = streamableTransports.get(closedSessionId);
          streamableTransports.delete(closedSessionId);
          if (session) {
            void session.mcp.close().catch((err) => req.log.warn({ err }, 'mcp close failed'));
          }
        };
        await mcp.connect(transport);
      } else {
        sendJsonRpcError(reply, 400, 'No valid MCP session ID provided');
        return;
      }

      try {
        await transport.handleRequest(req.raw, reply.raw, req.body);
        reply.hijack();
      } catch (err) {
        req.log.error({ err }, 'streamable mcp request failed');
        if (!reply.raw.headersSent) {
          sendJsonRpcError(reply, 500, 'Internal server error');
        }
      }
    },
  });

  // Deprecated HTTP+SSE transport, kept for older clients during migration.
  server.get('/mcp/sse', async (req, reply) => {
    const ctx = await mcpAuth(req, prisma);

    if (sseTransports.size + streamableTransports.size >= MAX_SESSIONS) {
      sendJsonRpcError(reply, 503, 'Server at session capacity — try again later');
      return;
    }

    const mcp = createAuthenticatedMcp(ctx);
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    await mcp.connect(transport);

    sseTransports.set(transport.sessionId, { transport, ctx, mcp, createdAt: Date.now() });

    const originalOnClose = transport.onclose;
    transport.onclose = () => {
      const session = sseTransports.get(transport.sessionId);
      sseTransports.delete(transport.sessionId);
      if (session) {
        void session.mcp.close().catch((err) => req.log.warn({ err }, 'legacy mcp close failed'));
      }
      originalOnClose?.();
    };

    reply.hijack();
  });

  server.post('/mcp/messages', async (req, reply) => {
    const ctx = await mcpAuth(req, prisma);
    const sessionId = (req.query as Record<string, unknown>)?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) {
      reply.status(400).send('Missing sessionId');
      return;
    }

    const session = sseTransports.get(sessionId);
    if (!session) {
      reply.status(404).send('Session not found');
      return;
    }
    if (session.ctx.keyId !== ctx.keyId) {
      reply.status(403).send('Session belongs to a different API key');
      return;
    }

    await session.transport.handlePostMessage(req.raw, reply.raw, req.body);
    reply.hijack();
  });

  // WHY sweep: transport.onclose handles graceful closes, but a client that
  // drops the network without sending Close never triggers it — leaving its
  // Map entry until the process restarts. The sweep evicts sessions idle beyond
  // SESSION_TTL_MS, bounding memory growth from unclean disconnects.
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  server.addHook('onReady', (done) => {
    sweepTimer = setInterval(
      () => {
        const cutoff = Date.now() - SESSION_TTL_MS;
        for (const [id, session] of sseTransports) {
          if (session.createdAt < cutoff) {
            sseTransports.delete(id);
            void session.mcp.close().catch(() => undefined);
          }
        }
        for (const [id, session] of streamableTransports) {
          if (session.createdAt < cutoff) {
            streamableTransports.delete(id);
            void session.mcp.close().catch(() => undefined);
          }
        }
      },
      15 * 60 * 1_000,
    ); // sweep every 15 minutes
    sweepTimer.unref(); // don't pin the event loop during shutdown
    done();
  });
  server.addHook('onClose', async () => {
    if (sweepTimer) clearInterval(sweepTimer);
  });

  return server;
}
