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
import { auditLogsRoutes } from './routes/audit-logs.js';
import { contactsRoutes } from './routes/contacts.js';
import { crmRoutes } from './routes/crm.js';
import { dustRoutes } from './routes/dust-integration.js';
import { filesRoutes } from './routes/files.js';
import { healthRoute } from './routes/health.js';
import { notesRoutes } from './routes/notes.js';
import { odooRoutes } from './routes/odoo-integration.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { reportsRoutes } from './routes/reports.js';
import { salesDashboardRoutes } from './routes/sales-dashboard.js';
import { salesOrdersRoutes } from './routes/sales-orders.js';
import { tasksRoutes } from './routes/tasks.js';
import { webhooksRoutes } from './routes/webhooks.js';

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
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await server.register(cors, {
    origin: (origin, cb) => {
      // Dev: allow any localhost / vite dev server.
      if (!origin) return cb(null, true);
      const allowed = [process.env.PUBLIC_BASE_URL].filter(Boolean);
      if (process.env.NODE_ENV === 'development') {
        allowed.push('http://localhost:5173', 'http://localhost:4173');
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
  });

  await server.register(errorHandlerPlugin);
  await server.register(authPlugin);

  await server.register(healthRoute);
  await server.register(opportunityRoutes, { prefix: '/api' });
  await server.register(contactsRoutes, { prefix: '/api' });
  await server.register(tasksRoutes, { prefix: '/api' });
  await server.register(reportsRoutes, { prefix: '/api' });
  await server.register(salesDashboardRoutes, { prefix: '/api' });
  await server.register(salesOrdersRoutes, { prefix: '/api' });
  await server.register(auditLogsRoutes, { prefix: '/api' });
  await server.register(crmRoutes, { prefix: '/api' });
  await server.register(notesRoutes, { prefix: '/api' });
  await server.register(filesRoutes, { prefix: '/api' });
  await server.register(dustRoutes, { prefix: '/api/integrations' });
  await server.register(odooRoutes, { prefix: '/api/integrations' });
  await server.register(webhooksRoutes); // mounted at /webhooks/*

  return server;
}
