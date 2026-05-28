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
import { openapiPlugin } from './plugins/openapi.js';
import { queryGuardPlugin } from './plugins/query-guard.js';
import { redisCachePlugin } from './plugins/redis-cache.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
// Wave 7 — Real-time collaboration
import { realtimePlugin } from './plugins/realtime.js';
import { realtimeRoutes } from './routes/realtime.js';
// Wave 8 — Y.js CRDT collaborative text editing
import { yjsCollabPlugin } from './plugins/yjs-collab.js';
import { config } from './config.js';
import { rbacPlugin } from './plugins/rbac.js';
import { redis } from './redis.js';
import { auditLogsRoutes } from './routes/audit-logs.js';
import { collaborationRoutes } from './routes/collaboration.js';
import { contactsRoutes } from './routes/contacts.js';
import { crmDashboardRoutes } from './routes/crm/dashboard.js';
import { crmCompanyRoutes } from './routes/crm/companies.js';
import { crmHealthRoutes } from './routes/crm/health.js';
import { crmConnectorRoutes } from './routes/crm/connectors.js';
import { crmWidgetRoutes } from './routes/crm/widgets.js';
import { crmSummaryRoutes } from './routes/crm/summary.js';
import { dustRoutes } from './routes/dust-integration.js';
import { exchangeRatesRoutes } from './routes/exchange-rates.js';
import { filesRoutes } from './routes/files.js';
import { healthRoute } from './routes/health.js';
import { invoicesRoutes } from './routes/invoices.js';
import { leadRoutes } from './routes/leads.js';
import { notesRoutes } from './routes/notes.js';
import { opportunityContactsRoutes } from './routes/opportunity-contacts.js';
import { erpRoutes } from './routes/erp-integration.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { opportunityTimelineRoutes } from './routes/opportunity-timeline.js';
import { predictiveRoutes } from './routes/predictive.js';
import { predictiveScoringRoutes } from './routes/predictive-scoring.js';
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
// Sprint 1 — Krayin import
import { tagRoutes } from './routes/tags.js';
import { emailTemplateRoutes } from './routes/email-templates.js';
import { leadRotRoutes } from './routes/lead-rot.js';
import { pluginRoutes } from './routes/plugins.js';
import { productsRoutes } from './routes/products.js';
import { usersRoutes } from './routes/users.js';
import { webhookSubscriptionsRoutes } from './routes/webhook-subscriptions.js';
import { companiesRoutes } from './routes/companies.js';
import { customFieldsRoutes } from './routes/custom-fields.js';
import { roleRoutes } from './routes/roles.js';
import { microsoftRoutes } from './routes/microsoft.js';
import { accountsRoutes } from './routes/accounts.js';
import { referencesRoutes } from './routes/references.js';
import { agentsRoutes } from './routes/agents.js';
import { bidScoreRoutes } from './routes/bid-scores.js';
import { proposalRoutes } from './routes/proposals.js';
import { activityRoutes } from './routes/activities.js';
import { bidWorkspaceRoutes } from './routes/bid-workspace.js';
import { calendarRoutes } from './routes/calendar.js';
import { bookingsRoutes } from './routes/bookings.js';
// NocoBase RFP integration
import rfpNocobaseRoutes from './routes/rfp-nocobase.js';
// Wave 4 — AI assistant
import { aiAssistantRoutes } from './routes/ai-assistant.js';
// Wave 5 — Outlook / Microsoft Graph Mail
import { gmailOAuthRoutes } from './routes/integrations/gmail.js';
import { microsoftMailOAuthRoutes } from './routes/integrations/microsoft-mail.js';
import { emailRoutes } from './routes/integrations/email.js';
import { microsoftWebhookRoutes } from './routes/integrations/microsoft-webhook.js';
// Wave 5 — Onboarding (templates + sample data)
import { onboardingRoutes } from './routes/onboarding.js';
// Wave 5 — Help center feedback
import { helpRoutes } from './routes/help.js';
// Wave 7 — Custom Objects (Salesforce parity)
import { customObjectRoutes } from './routes/custom-objects.js';
// Wave 7 — Twilio SMS (webhook = unauthenticated, sms routes = authenticated)
import { twilioWebhookRoutes, smsRoutes } from './routes/integrations/twilio.js';
// Wave 7 — Mobile native push registration
import { nativePushRoutes } from './routes/notifications.js';
// Wave 8 — Voice + Video calls
import { callsRoutes } from './routes/calls.js';
import {
  zoomCallWebhookRoutes,
  teamsCallWebhookRoutes,
  twilioVoiceWebhookRoutes,
} from './routes/integrations/calls-webhooks.js';
// Wave 8 — Customer Success
import { csRoutes } from './routes/cs.js';
// Wave 9 — Public NPS response page (server-rendered HTML, no auth, no JS)
import { publicNpsRoutes } from './routes/public-nps.js';
// Wave 9 — RFP pipeline HTTP endpoints (upload, SSE stream, autofill, approval gate)
import { rfpPipelineRoutes } from './routes/rfp-pipeline.js';
// Wave 10 — Operational monitoring (queue depths, embedding failure rate, alerts)
import { monitoringRoutes } from './routes/monitoring.js';
// Data migration: CSV import, HubSpot sync, cancel/undo destructive operations
import { migrationRoutes } from './routes/migrations.js';

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
      const allowed = [process.env.PUBLIC_BASE_URL].filter(Boolean);
      if (config.NODE_ENV === 'development') {
        allowed.push('http://localhost:5173', 'http://localhost:4173');
      }
      // Production safety: never allow localhost origins.
      if (config.NODE_ENV === 'production' && origin.includes('localhost')) {
        return cb(new Error('localhost origin rejected in production'), false);
      }
      cb(null, allowed.includes(origin));
    },
    credentials: true,
  });
  await server.register(sensible);

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
  await server.register(rbacPlugin);
  await server.register(securityHeadersPlugin);
  await server.register(idempotencyPlugin);
  await server.register(cacheHeadersPlugin);
  await server.register(queryGuardPlugin);
  await server.register(redisCachePlugin);
  // Wave 7 — Real-time WebSocket plugin (must come before route registration)
  await server.register(realtimePlugin);
  // Wave 8 — Y.js CRDT WebSocket plugin (depends on realtime for @fastify/websocket)
  await server.register(yjsCollabPlugin);
  await server.register(healthRoute);
  if (config.NODE_ENV !== 'test') {
    await server.register(rateLimit, {
      max: config.NODE_ENV === 'development' ? 10_000 : config.API_RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      redis: redis.status === 'ready' || redis.status === 'connect' ? redis : undefined,
      keyGenerator: (req) => {
        // Registered after auth so authenticated routes get per-user buckets.
        // Public routes (health, webhooks) intentionally fall back to IP.
        const auth = (req as unknown as { auth?: { userId?: string } }).auth;
        return auth?.userId ?? req.ip;
      },
    });
  }

  await server.register(opportunityRoutes, { prefix: '/api/v1' });
  await server.register(contactsRoutes, { prefix: '/api/v1' });
  await server.register(tasksRoutes, { prefix: '/api/v1' });
  await server.register(reportsRoutes, { prefix: '/api/v1' });
  await server.register(searchRoutes, { prefix: '/api/v1' });
  await server.register(salesDashboardRoutes, { prefix: '/api/v1' });
  await server.register(salesOrdersRoutes, { prefix: '/api/v1' });
  await server.register(invoicesRoutes, { prefix: '/api/v1' });
  await server.register(productsRoutes, { prefix: '/api/v1' });
  await server.register(auditLogsRoutes, { prefix: '/api/v1' });
  await server.register(crmDashboardRoutes, { prefix: '/api/v1' });
  await server.register(crmCompanyRoutes, { prefix: '/api/v1' });
  await server.register(crmHealthRoutes, { prefix: '/api/v1' });
  await server.register(crmConnectorRoutes, { prefix: '/api/v1' });
  await server.register(crmWidgetRoutes, { prefix: '/api/v1' });
  await server.register(crmSummaryRoutes, { prefix: '/api/v1' });
  await server.register(notesRoutes, { prefix: '/api/v1' });
  await server.register(opportunityContactsRoutes, { prefix: '/api/v1' });
  await server.register(filesRoutes, { prefix: '/api/v1' });
  await server.register(dustRoutes, { prefix: '/api/v1/integrations' });
  await server.register(erpRoutes, { prefix: '/api/v1/integrations' });

  // Backward-compatible redirects: /api/v1/integrations/odoo/* → /api/v1/integrations/erp/*
  server.get('/api/v1/integrations/odoo/*', async (req, reply) => {
    const target = req.url.replace('/odoo/', '/erp/');
    return reply.redirect(target, 307);
  });
  server.post('/api/v1/integrations/odoo/*', async (req, reply) => {
    const target = req.url.replace('/odoo/', '/erp/');
    return reply.redirect(target, 307);
  });
  await server.register(webhooksRoutes, { prefix: '/webhooks' });
  await server.register(territoryRoutes, { prefix: '/api/v1' });
  await server.register(accountIntelRoutes, { prefix: '/api/v1' });
  await server.register(opportunityTimelineRoutes, { prefix: '/api/v1' });
  await server.register(collaborationRoutes, { prefix: '/api/v1' });
  await server.register(predictiveRoutes, { prefix: '/api/v1' });
  await server.register(predictiveScoringRoutes, { prefix: '/api/v1' });
  await server.register(serviceDeskRoutes, { prefix: '/api/v1' });
  await server.register(workflowRoutes, { prefix: '/api/v1' });
  await server.register(leadRoutes, { prefix: '/api/v1' });
  // Sprint 1 — Krayin import
  await server.register(tagRoutes, { prefix: '/api/v1' });
  await server.register(emailTemplateRoutes, { prefix: '/api/v1' });
  await server.register(leadRotRoutes, { prefix: '/api/v1' });
  await server.register(pluginRoutes, { prefix: '/api/v1' });
  await server.register(usersRoutes, { prefix: '/api/v1' });
  await server.register(webhookSubscriptionsRoutes, { prefix: '/api/v1' });
  await server.register(companiesRoutes, { prefix: '/api/v1' });
  await server.register(customFieldsRoutes, { prefix: '/api/v1' });
  await server.register(roleRoutes, { prefix: '/api/v1' });
  await server.register(microsoftRoutes, { prefix: '/api/v1' });
  await server.register(accountsRoutes, { prefix: '/api/v1' });
  await server.register(referencesRoutes, { prefix: '/api/v1' });
  await server.register(agentsRoutes, { prefix: '/api/v1' });
  await server.register(bidScoreRoutes, { prefix: '/api/v1' });
  await server.register(proposalRoutes, { prefix: '/api/v1' });
  await server.register(activityRoutes, { prefix: '/api/v1' });
  await server.register(bidWorkspaceRoutes, { prefix: '/api/v1' });
  await server.register(exchangeRatesRoutes, { prefix: '/api/v1' });
  // Wave 3 — calendar + booking
  await server.register(calendarRoutes, { prefix: '/api/v1' });
  // Public booking routes skip auth middleware — register without /api/v1 prefix
  // so /book/:slug resolves cleanly for the public page
  await server.register(bookingsRoutes, { prefix: '/api/v1' });
  // NocoBase RFP workspace routes
  await server.register(rfpNocobaseRoutes, { prefix: '/api/v1' });
  // Public booking page route (no auth): /book/:slug — served by the frontend SPA.
  // The API backing it is /api/v1/booking-pages/:slug/availability (above).

  // Wave 4 — AI Assistant
  await server.register(aiAssistantRoutes, { prefix: '/api/v1' });

  // Wave 5 — Outlook (Microsoft Graph Mail) + Gmail OAuth flows
  // WHY /api/v1/integrations prefix: consistent with other integration routes (dust, erp)
  await server.register(gmailOAuthRoutes, { prefix: '/api/v1/integrations' });
  await server.register(microsoftMailOAuthRoutes, { prefix: '/api/v1/integrations' });
  await server.register(emailRoutes, { prefix: '/api/v1' });
  // Webhook endpoint: NO auth prefix — Graph calls this as an unauthenticated third party.
  // clientState secret provides the anti-forgery verification layer.
  await server.register(microsoftWebhookRoutes, { prefix: '/api/v1/integrations' });

  // Wave 5 — Onboarding templates + sample data management
  await server.register(onboardingRoutes, { prefix: '/api/v1' });
  // Wave 5 — Help center article feedback
  await server.register(helpRoutes, { prefix: '/api/v1' });

  // Wave 7 — Custom Objects (Salesforce parity)
  await server.register(customObjectRoutes, { prefix: '/api/v1' });

  // Wave 7 — Twilio SMS
  // WHY /api/v1/integrations for webhook: unauthenticated, Twilio calls it; consistent with
  // microsoft-webhook pattern. WHY /api/v1 for sms routes: user-facing, needs auth middleware.
  await server.register(twilioWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(smsRoutes, { prefix: '/api/v1' });

  // Wave 7 — Real-time collaboration REST endpoints (lock + presence snapshot)
  // WHY /api/v1: consistent with other authenticated endpoints.
  // The WebSocket endpoint /api/realtime is registered by the realtimePlugin above.
  await server.register(realtimeRoutes, { prefix: '/api/v1' });

  // Wave 7 — Mobile native push token registration (Expo push service)
  await server.register(nativePushRoutes, { prefix: '/api/v1' });

  // Wave 8 — Voice + Video calls
  // Authenticated call management routes
  await server.register(callsRoutes, { prefix: '/api/v1' });
  // Unauthenticated webhook routes (signature-validated per provider)
  await server.register(zoomCallWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(teamsCallWebhookRoutes, { prefix: '/api/v1/integrations' });
  await server.register(twilioVoiceWebhookRoutes, { prefix: '/api/v1/integrations' });

  // Wave 8 — Customer Success (authenticated + NPS public respond endpoint)
  await server.register(csRoutes, { prefix: '/api/v1' });

  // Wave 9 — Public NPS response page (server-rendered HTML, no auth)
  // Mounted at /api/v1/public/nps/:token. The /api → /api/v1 rewrite hook
  // means email links can use the shorter /api/public/nps/:token form.
  await server.register(publicNpsRoutes, { prefix: '/api/v1' });

  // Wave 9 — RFP pipeline: upload, SSE progress stream, matrix autofill, approval gate
  await server.register(rfpPipelineRoutes, { prefix: '/api/v1' });

  // Wave 10 — Operational monitoring: live queue depths, embedding failure rate, alert conditions
  await server.register(monitoringRoutes, { prefix: '/api/v1' });

  // Data migration: CSV import, HubSpot sync, cancel/undo — was never registered (bug fix)
  await server.register(migrationRoutes, { prefix: '/api/v1' });

  return server;
}
