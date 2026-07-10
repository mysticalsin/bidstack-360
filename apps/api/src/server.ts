import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { apiVersioningPlugin } from './plugins/api-versioning.js';
import { authPlugin } from './plugins/auth.js';
import { cacheHeadersPlugin } from './plugins/cache-headers.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { idempotencyPlugin } from './plugins/idempotency.js';
import { mutationAuditPlugin } from './plugins/mutation-audit.js';
import { openapiPlugin } from './plugins/openapi.js';
import { queryGuardPlugin } from './plugins/query-guard.js';
import { redisCachePlugin } from './plugins/redis-cache.js';
import { sentryPlugin } from './plugins/sentry.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { buildAllowedCorsOrigins, isLoopbackOrigin } from './lib/cors-origins.js';
import { privacyLogHooks, privacyLogSerializers } from './lib/logger.js';
// Wave 7 — Real-time collaboration
import { realtimePlugin } from './plugins/realtime.js';
// Wave 8 — Y.js CRDT collaborative text editing
import { yjsCollabPlugin } from './plugins/yjs-collab.js';
import { config } from './env.js';
import { rbacPlugin } from './plugins/rbac.js';
import { redis, waitForRedisReady } from './redis.js';
import { healthRoute, httpRequestsTotal, httpRequestDuration } from './routes/health.js';
import { registerRoutes } from './server.routes.js';

/**
 * Parse TRUSTED_PROXIES into a Fastify trustProxy value. Behind Azure Front Door
 * + Container Apps Envoy the client IP is N hops upstream, so a hop COUNT (e.g.
 * "2") or "true" is the correct setting; a CIDR/IP allowlist is also supported.
 * Empty disables proxy trust (direct-exposure default).
 */
function parseTrustProxy(value: string | undefined): boolean | number | string[] {
  if (!value) return false;
  const v = value.trim();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    bodyLimit: 10485760, // 10 MiB to allow large Dust AI webhooks
    // Bound per-request and idle-socket lifetimes so a slow query or hung
    // downstream cannot pin a Node worker (+ its DB connection) indefinitely.
    // Defaults are 0 (unbounded) — dangerous at 100k scale. See env.ts.
    requestTimeout: config.REQUEST_TIMEOUT_MS,
    keepAliveTimeout: config.KEEPALIVE_TIMEOUT_MS,
    rewriteUrl: (req) => {
      const url = req.url ?? '';
      if (url.startsWith('/api/') && !url.startsWith('/api/v')) {
        return url.replace(/^\/api\//, '/api/v1/');
      }
      return url;
    },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length >= 8 && incoming.length <= 255) {
        return incoming;
      }
      return crypto.randomUUID();
    },
    logger: {
      level: config.LOG_LEVEL,
      // Strip bearer tokens, cookies, and any obvious credential fields before they
      // ever hit stdout / log aggregation. The ERP MCP client also has its own
      // URL-scrubbing layer (see packages/odoo-mcp-client/src/index.ts).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-bidstack-sentry-smoke-token"]',
          'req.headers["x-api-key"]',
          'req.headers["x-clerk-session"]',
          'res.headers["set-cookie"]',
          '*.bearerToken',
          '*.bearer_token',
          '*.apiKey',
          '*.api_key',
          '*.password',
          '*.secret',
          'err.config.headers.Authorization',
          'err.config.headers.authorization',
        ],
        remove: true,
      },
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
      serializers: privacyLogSerializers,
      hooks: privacyLogHooks,
    },
    trustProxy: parseTrustProxy(config.TRUSTED_PROXIES),
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Record Prometheus HTTP metrics on every completed response. Use the route
  // TEMPLATE (req.routeOptions.url, e.g. /api/v1/accounts/:id) as the label —
  // never the raw path — so path params like ids don't blow up label
  // cardinality. Unmatched requests (404s with no route) fall back to 'unknown'.
  // reply.elapsedTime is the wall-clock request duration in ms; convert to s.
  server.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe({ method: req.method, route }, reply.elapsedTime / 1000);
  });

  server.addHook('onSend', async (_req, reply) => {
    reply.header('X-Request-Id', _req.id);
  });

  await server.register(helmet, {
    // CSP is owned by securityHeadersPlugin so the effective policy has one
    // source of truth instead of a dead Helmet policy overwritten onSend.
    contentSecurityPolicy: false,
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: { allow: false },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xssFilter: true,
    xFrameOptions: { action: 'deny' },
    // Permissions-Policy removed in @fastify/helmet v12; securityHeadersPlugin owns it.
  });
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = buildAllowedCorsOrigins(config.PUBLIC_BASE_URL, config.NODE_ENV);
      // Production safety: never allow loopback origins.
      if (config.NODE_ENV === 'production' && isLoopbackOrigin(origin)) {
        return cb(new Error('loopback origin rejected in production'), false);
      }
      cb(null, allowed.includes(origin));
    },
    credentials: true,
  });
  await server.register(sensible);

  // Response compression — JSON list/dashboard/analytics payloads are large and
  // dominate egress at scale. brotli+gzip, only above 1KB (tiny bodies cost more
  // to compress than they save). Honors the client's Accept-Encoding.
  await server.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  // OpenAPI: register BEFORE route plugins so swagger sees all schemas.
  // Endpoints (/api/docs, /api/openapi.json, /api/openapi.yaml) only expose
  // when OPENAPI_DOCS_ENABLED=true — see plugins/openapi.ts.
  await server.register(openapiPlugin);

  await server.register(apiVersioningPlugin);
  await server.register(errorHandlerPlugin);
  await server.register(authPlugin);
  await server.register(sentryPlugin);
  await server.register(rbacPlugin);
  await server.register(securityHeadersPlugin);
  await server.register(idempotencyPlugin);
  await server.register(mutationAuditPlugin);
  await server.register(cacheHeadersPlugin);
  await server.register(queryGuardPlugin);
  await server.register(redisCachePlugin);
  // Wave 7 — Real-time WebSocket plugin (must come before route registration)
  await server.register(realtimePlugin);
  // Wave 8 — Y.js CRDT WebSocket plugin (depends on realtime for @fastify/websocket)
  await server.register(yjsCollabPlugin);
  await server.register(healthRoute);

  // ── Rate-limit store selection (Redis vs in-memory) ──────────────────────
  // The store is chosen ONCE here. In production the limit must hold across
  // replicas, so we require the shared Redis store; otherwise each Node process
  // keeps its own counter and the effective global limit is multiplied by the
  // replica count. Fail loud at boot rather than silently degrading.
  // Await readiness (bounded) so a still-connecting Redis at boot does not
  // falsely trip the production guard below — a status-only check was a boot race.
  const redisReady = config.NODE_ENV !== 'test' && (await waitForRedisReady());
  const rateLimitRedis = redisReady ? redis : undefined;
  if (
    config.NODE_ENV === 'production' &&
    config.RATE_LIMIT_REDIS_REQUIRED === 'true' &&
    !rateLimitRedis
  ) {
    throw new Error(
      'Rate-limit Redis store is required in production (RATE_LIMIT_REDIS_REQUIRED=true) ' +
        `but Redis is not connected (status=${redis.status}). Set RATE_LIMIT_REDIS_REQUIRED=false ` +
        'only for single-process deploys.',
    );
  }

  const isLowEnv = config.NODE_ENV === 'development' || config.NODE_ENV === 'test';

  await server.register(rateLimit, {
    max: isLowEnv ? 10_000 : config.API_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: rateLimitRedis,
    keyGenerator: (req) => {
      // Registered after auth so authenticated routes get per-user buckets.
      // Fold in orgId so the per-user bucket is partitioned per tenant and keys
      // can never collide across tenants. Public routes (health, webhooks) have
      // no auth context and intentionally fall back to IP.
      const auth = (req as unknown as { auth?: { userId?: string; orgId?: string } }).auth;
      if (auth?.userId) return `u:${auth.orgId ?? 'no-org'}:${auth.userId}`;
      return `ip:${req.ip}`;
    },
  });

  // Per-tenant (org) aggregate cap — OPT-IN (0 = disabled, the default). Enforced
  // alongside the per-user/IP limit so, in a MULTI-TENANT deployment, one tenant's
  // users cannot exhaust shared capacity and starve other tenants. Intentionally
  // OFF by default: a single large (100k-employee) tenant's legitimate aggregate
  // traffic would trip a low org cap. Operators running shared SaaS set
  // API_RATE_LIMIT_PER_ORG_MAX > 0. Uses the same store (Redis in prod).
  if (config.API_RATE_LIMIT_PER_ORG_MAX > 0) {
    const orgRateLimit = server.createRateLimit({
      max: config.API_RATE_LIMIT_PER_ORG_MAX,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const auth = (req as unknown as { auth?: { orgId?: string } }).auth;
        return auth?.orgId ? `org:${auth.orgId}` : `ip:${req.ip}`;
      },
    });
    server.addHook('onRequest', async (req, reply) => {
      // Only authenticated requests carry an org; unauthenticated/public routes
      // are already covered by the per-IP bucket above.
      const auth = (req as unknown as { auth?: { orgId?: string } }).auth;
      if (!auth?.orgId) return;
      const result = await orgRateLimit(req);
      if (!result.isAllowed) {
        reply.header('retry-after', String(result.ttlInSeconds));
        return reply.code(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Tenant rate limit exceeded. Please retry later.',
        });
      }
    });
  }

  await registerRoutes(server);

  return server;
}
