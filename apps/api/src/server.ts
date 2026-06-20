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
// Wave 7 — Real-time collaboration
import { realtimePlugin } from './plugins/realtime.js';
// Wave 8 — Y.js CRDT collaborative text editing
import { yjsCollabPlugin } from './plugins/yjs-collab.js';
import { config } from './env.js';
import { rbacPlugin } from './plugins/rbac.js';
import { redis } from './redis.js';
import { healthRoute } from './routes/health.js';
import { registerRoutes } from './server.routes.js';

const CONNECT_SRC = [
  "'self'",
  'https://api.clerk.com',
  'https://*.clerk.accounts.dev',
  'https://dust.tt',
  'https://*.dust.tt',
  'https://*.sentry.io',
  'https://api.apollo.io',
  // Wave 8 — Video call providers
  'https://api.zoom.us',
  'https://zoom.us',
  'https://api.deepgram.com',
  'https://graph.microsoft.com',
  'https://www.googleapis.com',
  'https://api.twilio.com',
];

const FRAME_SRC = ["'self'", 'https://*.clerk.accounts.dev', 'https://challenges.cloudflare.com'];

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
    },
    trustProxy: config.TRUSTED_PROXIES
      ? config.TRUSTED_PROXIES.split(',').map((s) => s.trim())
      : false,
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.addHook('onSend', async (_req, reply) => {
    reply.header('X-Request-Id', _req.id);
  });

  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: config.NODE_ENV === 'development' ? ["'self'", "'unsafe-inline'"] : ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: CONNECT_SRC,
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: FRAME_SRC,
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'none'"],
        mediaSrc: ["'none'"],
        ...(config.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
      },
    },
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
    // permissionsPolicy removed in @fastify/helmet v12 — set via custom header if needed
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

  // Permissions-Policy is not exposed by @fastify/helmet@12 (helmet@7), so we
  // set it manually on every outbound response.
  server.addHook('onSend', async (_req, reply) => {
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );
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

  await server.register(rateLimit, {
    max:
      config.NODE_ENV === 'development' || config.NODE_ENV === 'test'
        ? 10_000
        : config.API_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis:
      config.NODE_ENV !== 'test' && (redis.status === 'ready' || redis.status === 'connect')
        ? redis
        : undefined,
    keyGenerator: (req) => {
      // Registered after auth so authenticated routes get per-user buckets.
      // Public routes (health, webhooks) intentionally fall back to IP.
      const auth = (req as unknown as { auth?: { userId?: string } }).auth;
      return auth?.userId ?? req.ip;
    },
  });

  await registerRoutes(server);

  return server;
}
