import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { prisma } from '@bidstack/db';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RICH_AUDITED_PATHS = [
  /^\/api\/v1\/companies$/i,
  /^\/api\/v1\/companies\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^\/api\/v1\/companies\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/tier$/i,
  /^\/api\/v1\/roles$/i,
  /^\/api\/v1\/roles\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
];
const SAFETY_NET_PREFIXES = [
  '/api/v1/account-intel',
  '/api/v1/accounts',
  '/api/v1/activities',
  '/api/v1/admin',
  '/api/v1/ai-assistant',
  '/api/v1/bid-scores',
  // Demo-feedback program surfaces — auto-audit successes + 403 denials.
  '/api/v1/cross-sell-actions',
  '/api/v1/governance-meetings',
  '/api/v1/project-references',
  '/api/v1/org-settings',
  '/api/v1/user-groups',
  '/api/v1/booking-pages',
  '/api/v1/bookings',
  '/api/v1/calendar',
  '/api/v1/calls',
  '/api/v1/comments',
  '/api/v1/companies',
  '/api/v1/competitors',
  '/api/v1/crews',
  '/api/v1/crew-runs',
  '/api/v1/crew-agents',
  '/api/v1/cs',
  '/api/v1/custom-fields',
  '/api/v1/custom-objects',
  '/api/v1/document-templates',
  '/api/v1/email',
  '/api/v1/email-templates',
  '/api/v1/entities',
  '/api/v1/forecasts',
  '/api/v1/integrations/dust',
  '/api/v1/integrations/email',
  '/api/v1/integrations/integrations/gmail',
  '/api/v1/integrations/integrations/microsoft',
  '/api/v1/integrations/integrations/slack',
  '/api/v1/integrations/gmail',
  '/api/v1/integrations/microsoft',
  '/api/v1/integrations/slack',
  '/api/v1/integrations/twilio',
  '/api/v1/integrations/zapier',
  '/api/v1/lead-rot',
  '/api/v1/lead-routing-rules',
  '/api/v1/mentions',
  '/api/v1/migrations/mappings',
  '/api/v1/onboarding',
  '/api/v1/opportunity-contacts',
  '/api/v1/plugins',
  '/api/v1/predictive',
  '/api/v1/predictive-scoring',
  '/api/v1/proposals',
  '/api/v1/realtime',
  '/api/v1/references',
  '/api/v1/roles',
  '/api/v1/service-desk',
  '/api/v1/service-cases',
  '/api/v1/settings/microsoft',
  '/api/v1/signatures/requests',
  '/api/v1/sms',
  '/api/v1/tags',
  '/api/v1/territories',
  '/api/v1/users',
  '/api/v1/webhook-subscriptions',
  '/api/v1/workflows',
  '/api/v1/crm/widgets',
];

function actorUserId(req: FastifyRequest): string | null {
  const userId = req.auth?.userId;
  return userId && UUID_RE.test(userId) ? userId : null;
}

function auditPath(url: string): string {
  return url.split('?')[0] ?? url;
}

function needsSafetyNet(path: string): boolean {
  if (RICH_AUDITED_PATHS.some((pattern) => pattern.test(path))) return false;
  return SAFETY_NET_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function shouldAudit(req: FastifyRequest, statusCode: number): boolean {
  if (!MUTATION_METHODS.has(req.method)) return false;
  if (!req.auth?.orgId) return false;
  if (req.routeOptions?.config?.public) return false;
  if (!needsSafetyNet(auditPath(req.url))) return false;

  const isSuccess = statusCode >= 200 && statusCode < 300;
  const isDenied = statusCode === 403;
  return isSuccess || isDenied;
}

export const mutationAuditPlugin: FastifyPluginAsync = fp(async (server) => {
  server.addHook('onResponse', async (req, reply) => {
    if (!shouldAudit(req, reply.statusCode)) return;

    const isDenied = reply.statusCode === 403;
    const route = req.routeOptions?.url ?? null;
    const path = auditPath(req.url);
    const actorId = req.auth.userId ?? null;
    const userAgent = req.headers['user-agent'];

    try {
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: actorUserId(req),
          action: isDenied ? 'http.mutation.denied' : 'http.mutation.success',
          targetType: 'http_request',
          targetId: req.id,
          diff: {
            method: req.method,
            path,
            route,
            statusCode: reply.statusCode,
            requestId: req.id,
            actorId,
            actorKind: actorId ? (actorId.startsWith('apikey:') ? 'api_key' : 'user') : 'unknown',
            ip: req.ip,
            userAgent: typeof userAgent === 'string' ? userAgent : null,
            scopes: req.auth.scopes,
          },
        },
      });
    } catch (err) {
      req.log.warn(
        {
          err,
          method: req.method,
          path,
          route,
          statusCode: reply.statusCode,
        },
        'mutation audit-log safety-net write failed',
      );
    }
  });
});
