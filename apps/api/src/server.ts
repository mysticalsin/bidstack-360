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

import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rbacPlugin } from './plugins/rbac.js';
import { auditLogsRoutes } from './routes/audit-logs.js';
import { collaborationRoutes } from './routes/collaboration.js';
import { contactsRoutes } from './routes/contacts.js';
import { crmDashboardRoutes } from './routes/crm/dashboard.js';
import { crmCompanyRoutes } from './routes/crm/companies.js';
import { crmHealthRoutes } from './routes/crm/health.js';
import { crmConnectorRoutes } from './routes/crm/connectors.js';
import { crmWidgetRoutes } from './routes/crm/widgets.js';
import { dustRoutes } from './routes/dust-integration.js';
import { filesRoutes } from './routes/files.js';
import { healthRoute } from './routes/health.js';
import { invoicesRoutes } from './routes/invoices.js';
import { leadRoutes } from './routes/leads.js';
import { notesRoutes } from './routes/notes.js';
import { opportunityContactsRoutes } from './routes/opportunity-contacts.js';
import { odooRoutes } from './routes/odoo-integration.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { opportunityTimelineRoutes } from './routes/opportunity-timeline.js';
import { predictiveRoutes } from './routes/predictive.js';
import { searchRoutes } from './routes/search.js';
import { serviceDeskRoutes } from './routes/service-desk.js';
import { reportsRoutes } from './routes/reports.js';
import { salesDashboardRoutes } from './routes/sales-dashboard.js';
import { salesOrdersRoutes } from './routes/sales-orders.js';
import { tasksRoutes } from './routes/tasks.js';
import { territoryRoutes } from './routes/territories.js';
import { accountIntelRoutes } from './routes/account-intel.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { workflowRoutes } from './routes/workflows.js';
import { pluginRoutes } from './routes/plugins.js';
import { productsRoutes } from './routes/products.js';
import { usersRoutes } from './routes/users.js';
import { webhookSubscriptionsRoutes } from './routes/webhook-subscriptions.js';
import { companiesRoutes } from './routes/companies.js';
import { customFieldsRoutes } from './routes/custom-fields.js';
import { roleRoutes } from './routes/roles.js';

const CONNECT_SRC = [
  "'self'",
  'https://api.clerk.com',
  'https://*.clerk.accounts.dev',
  'https://dust.tt',
  'https://*.dust.tt',
  'https://*.sentry.io',
  'https://api.apollo.io',
];

const FRAME_SRC = ["'self'", 'https://*.clerk.accounts.dev', 'https://challenges.cloudflare.com'];

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Strip bearer tokens, cookies, and any obvious credential fields before they
      // ever hit stdout / log aggregation. The Odoo MCP client also has its own
      // URL-scrubbing layer (see packages/odoo-mcp-client/src/index.ts).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
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
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
    },
    trustProxy: process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(',').map((s) => s.trim())
      : false,
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc:
          process.env.NODE_ENV === 'development' ? ["'self'", "'unsafe-inline'"] : ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: CONNECT_SRC,
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: FRAME_SRC,
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
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
    // permissionsPolicy removed in @fastify/helmet v12 — set via custom header if needed
  });
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = [process.env.PUBLIC_BASE_URL].filter(Boolean);
      if (process.env.NODE_ENV === 'development') {
        allowed.push('http://localhost:5173', 'http://localhost:4173');
      }
      // Production safety: never allow localhost origins.
      if (process.env.NODE_ENV === 'production' && origin.includes('localhost')) {
        return cb(new Error('localhost origin rejected in production'), false);
      }
      cb(null, allowed.includes(origin));
    },
    credentials: true,
  });
  await server.register(sensible);
  await server.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
    keyGenerator: (req) => {
      // Per-user rate limiting: authenticated users get their own bucket.
      // Fall back to IP for public routes (health, webhooks).
      const auth = (req as unknown as { auth?: { userId?: string } }).auth;
      return auth?.userId ?? req.ip;
    },
  });

  // Permissions-Policy is not exposed by @fastify/helmet@12 (helmet@7), so we
  // set it manually on every outbound response.
  server.addHook('onSend', async (_req, reply) => {
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );
  });

  await server.register(errorHandlerPlugin);
  await server.register(authPlugin);
  await server.register(rbacPlugin);

  await server.register(healthRoute);
  await server.register(opportunityRoutes, { prefix: '/api' });
  await server.register(contactsRoutes, { prefix: '/api' });
  await server.register(tasksRoutes, { prefix: '/api' });
  await server.register(reportsRoutes, { prefix: '/api' });
  await server.register(searchRoutes, { prefix: '/api' });
  await server.register(salesDashboardRoutes, { prefix: '/api' });
  await server.register(salesOrdersRoutes, { prefix: '/api' });
  await server.register(invoicesRoutes, { prefix: '/api' });
  await server.register(productsRoutes, { prefix: '/api' });
  await server.register(auditLogsRoutes, { prefix: '/api' });
  await server.register(crmDashboardRoutes, { prefix: '/api' });
  await server.register(crmCompanyRoutes, { prefix: '/api' });
  await server.register(crmHealthRoutes, { prefix: '/api' });
  await server.register(crmConnectorRoutes, { prefix: '/api' });
  await server.register(crmWidgetRoutes, { prefix: '/api' });
  await server.register(notesRoutes, { prefix: '/api' });
  await server.register(opportunityContactsRoutes, { prefix: '/api' });
  await server.register(filesRoutes, { prefix: '/api' });
  await server.register(dustRoutes, { prefix: '/api/integrations' });
  await server.register(odooRoutes, { prefix: '/api/integrations' });
  await server.register(webhooksRoutes); // mounted at /webhooks/*
  await server.register(territoryRoutes, { prefix: '/api' });
  await server.register(accountIntelRoutes, { prefix: '/api' });
  await server.register(opportunityTimelineRoutes, { prefix: '/api' });
  await server.register(collaborationRoutes, { prefix: '/api' });
  await server.register(predictiveRoutes, { prefix: '/api' });
  await server.register(serviceDeskRoutes, { prefix: '/api' });
  await server.register(workflowRoutes, { prefix: '/api' });
  await server.register(leadRoutes, { prefix: '/api' });
  await server.register(pluginRoutes, { prefix: '/api' });
  await server.register(usersRoutes, { prefix: '/api' });
  await server.register(webhookSubscriptionsRoutes, { prefix: '/api' });
  await server.register(companiesRoutes, { prefix: '/api' });
  await server.register(customFieldsRoutes, { prefix: '/api' });
  await server.register(roleRoutes, { prefix: '/api' });

  return server;
}
