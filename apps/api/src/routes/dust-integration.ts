// Dust integration management routes.
// Real sync logic lives in apps/worker; these routes return status and
// enqueue jobs. In v0.1 the queue is a stub if Redis is unreachable.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import { prisma, type Opportunity } from '@bidstack/db';
import type { Logger as PinoLogger } from 'pino';
import { DustClient } from '@bidstack/dust-client';

import { config } from '../config.js';
import { isPublicHostname } from '../lib/ssrf-guard.js';
import { enqueueDustResync } from '../queues/dust-poll.js';

interface DustAgentStatus {
  agents: Array<{ id: string; label: string; description: string | null }>;
  error: string | null;
}

// Fetch the Dust workspace's assistant agents. Returns an empty list in local
// stub mode, and captures provider errors as status metadata so the
// integrations page can fail loud without breaking the whole route.
async function listDustAgents(log: {
  warn: (a: object, msg?: string) => void;
}): Promise<DustAgentStatus> {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return { agents: [], error: null };
  try {
    const dust = new DustClient({
      apiKey,
      workspaceId,
      baseUrl: process.env.DUST_BASE_URL,
      timeoutMs: 5_000,
    });
    return { agents: await dust.listAgents(), error: null };
  } catch (err) {
    log.warn({ err }, 'dust agents fetch error');
    return {
      agents: [],
      error: err instanceof Error ? err.message : 'Dust agent list failed',
    };
  }
}

const DustStatus = z.object({
  workspace: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  nextSyncAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  pulled24h: z.number().int(),
  pushed24h: z.number().int(),
  configured: z.boolean(),
  agentsError: z.string().nullable(),
  agents: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string().nullable() }),
  ),
});
type DustStatusPayload = z.infer<typeof DustStatus>;
type DustStatusCacheEntry = {
  expiresAt: number;
  promise: Promise<DustStatusPayload>;
};

const ApiKeySummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const IntegrationSetupGuide = z.object({
  generatedAt: z.string().datetime(),
  dust: z.object({
    configured: z.boolean(),
    workspaceId: z.string().nullable(),
    dataSourceConfigured: z.boolean(),
    webhookReceiverUrl: z.string(),
  }),
  mcp: z.object({
    publicUrl: z.string(),
    healthUrl: z.string(),
    wellKnownUrl: z.string(),
    transport: z.literal('streamable-http'),
    configured: z.boolean(),
    readScopes: z.array(z.string()),
    writeScopes: z.array(z.string()),
  }),
  rest: z.object({
    baseUrl: z.string(),
    authHeader: z.literal('Authorization: Bearer <BIDSTACK_API_KEY>'),
    recommendedScopes: z.array(z.string()),
  }),
  webhooks: z.object({
    subscriptionsUrl: z.string(),
    receiverUrl: z.string(),
    requiredHeaders: z.array(z.string()),
    recommendedEvents: z.array(z.string()),
  }),
  snippets: z.object({
    dustMcpToolConfig: z.string(),
    mcpHealthCheck: z.string(),
    restOpportunitySearch: z.string(),
    webhookReceiver: z.string(),
  }),
});

const IntegrationProbeBody = z.object({
  kind: z.enum(['mcp', 'rest', 'webhook']),
  url: z.string().url().max(500),
});

const IntegrationProbeResult = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  latencyMs: z.number().int().nonnegative(),
  checkedUrl: z.string(),
  message: z.string(),
  warnings: z.array(z.string()),
});

const DUST_STATUS_RATE_LIMIT_MAX = Math.max(120, Math.min(config.API_RATE_LIMIT_MAX, 1_000));
const DUST_STATUS_CACHE_TTL_MS = 15_000;
const INTEGRATION_PROBE_TIMEOUT_MS = 5_000;
const dustStatusCache = new Map<string, DustStatusCacheEntry>();

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function envString(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function publicApiBaseUrl(): string {
  return trimTrailingSlash(envString('PUBLIC_API_URL') ?? 'http://localhost:4000');
}

function normalizeMcpUrl(value: string): string {
  const trimmed = trimTrailingSlash(value);
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

function publicMcpUrl(): string {
  const configured = envString('DUST_MCP_PUBLIC_URL');
  if (configured) return normalizeMcpUrl(configured);
  const port = envString('PORT_MCP') ?? '4001';
  return normalizeMcpUrl(`http://localhost:${port}/mcp`);
}

async function buildDustStatus(
  orgId: string,
  log: { warn: (a: object, msg?: string) => void },
): Promise<DustStatusPayload> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pulled, pushed, lastErr, lastSync, agentStatus] = await Promise.all([
    prisma.syncEvent.count({
      where: {
        orgId,
        source: 'dust.poll',
        receivedAt: { gte: since },
      },
    }),
    prisma.syncEvent.count({
      where: {
        orgId,
        source: 'dust.push',
        receivedAt: { gte: since },
      },
    }),
    prisma.syncEvent.findFirst({
      where: { orgId, status: 'error' },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.syncEvent.findFirst({
      where: { orgId, source: 'dust.poll', status: 'processed' },
      orderBy: { receivedAt: 'desc' },
    }),
    listDustAgents(log),
  ]);

  const configured = Boolean(process.env.DUST_API_KEY && process.env.DUST_WORKSPACE_ID);

  return {
    workspace: process.env.DUST_WORKSPACE_ID ?? 'mantu-presales',
    lastSyncAt: lastSync?.processedAt?.toISOString() ?? lastSync?.receivedAt.toISOString() ?? null,
    nextSyncAt: lastSync
      ? new Date(lastSync.receivedAt.getTime() + 5 * 60 * 1000).toISOString()
      : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    lastError: lastErr?.error ?? null,
    pulled24h: pulled,
    pushed24h: pushed,
    configured,
    agentsError: agentStatus.error,
    agents: agentStatus.agents,
  };
}

async function cachedDustStatus(
  orgId: string,
  log: { warn: (a: object, msg?: string) => void },
): Promise<DustStatusPayload> {
  const now = Date.now();
  const cached = dustStatusCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = buildDustStatus(orgId, log);
  dustStatusCache.set(orgId, { expiresAt: now + DUST_STATUS_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    dustStatusCache.delete(orgId);
    throw err;
  }
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.startsWith('127.') || h === '::1' || h === '[::1]';
}

function sanitizeProbeUrl(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  return url.toString();
}

function assertProbeUrlAllowed(value: string): string {
  const sanitized = sanitizeProbeUrl(value);
  const url = new URL(sanitized);
  const isLocal = isLocalDevelopmentHostname(url.hostname);
  const isDevLike = process.env.NODE_ENV !== 'production';

  if (url.protocol !== 'https:' && !(isDevLike && isLocal && url.protocol === 'http:')) {
    throw new Error('Probe URL must use HTTPS, except localhost during local development.');
  }

  if (!isLocal && !isPublicHostname(url.hostname)) {
    throw new Error('Probe URL cannot target localhost, private networks, or internal hostnames.');
  }

  if (isLocal && !isDevLike) {
    throw new Error('Probe URL cannot target localhost or loopback addresses in production.');
  }

  return sanitized;
}

function probeMessage(status: number | null): string {
  if (status === null) return 'Endpoint did not respond.';
  if (status >= 200 && status < 400) return 'Endpoint is reachable.';
  if (status === 401 || status === 403) return 'Endpoint is reachable and requires authentication.';
  if (status === 404) return 'Endpoint responded, but this path was not found.';
  if (status >= 500) return 'Endpoint responded with a server error.';
  return `Endpoint responded with HTTP ${status}.`;
}

async function probeIntegrationEndpoint(kind: z.infer<typeof IntegrationProbeBody>['kind'], url: string) {
  const checkedUrl = assertProbeUrlAllowed(url);
  const warnings: string[] = [];
  if (kind === 'mcp' && !new URL(checkedUrl).pathname.endsWith('/mcp')) {
    warnings.push('MCP Streamable HTTP endpoints usually end with /mcp.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEGRATION_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(checkedUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept:
          kind === 'mcp'
            ? 'application/json, text/event-stream;q=0.9, */*;q=0.1'
            : 'application/json, */*;q=0.1',
        Range: 'bytes=0-0',
      },
    });
    const status = res.status;
    if (status === 401 || status === 403) {
      warnings.push('Authentication is required, which is expected for protected MCP/API targets.');
    }
    if (status >= 300 && status < 400) {
      warnings.push('Redirects are not followed during probes; configure the final public URL.');
    }
    return {
      ok: status >= 200 && status < 500 && status !== 404,
      status,
      latencyMs: Date.now() - startedAt,
      checkedUrl,
      message: probeMessage(status),
      warnings,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      checkedUrl,
      message:
        err instanceof Error && err.name === 'AbortError'
          ? 'Probe timed out after 5 seconds.'
          : 'Endpoint could not be reached from the API service.',
      warnings,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildIntegrationSetupGuide() {
  const apiBase = publicApiBaseUrl();
  const restBase = `${apiBase}/api/v1`;
  const mcpUrl = publicMcpUrl();
  const mcpBase = trimTrailingSlash(mcpUrl.replace(/\/mcp$/, ''));
  const receiverUrl = `${apiBase}/api/webhooks/dust`;
  const workspaceId = envString('DUST_WORKSPACE_ID');
  const dustMcpToolConfig = JSON.stringify(
    {
      name: 'BidStack 360 CRM',
      transport: 'streamable-http',
      url: mcpUrl,
      headers: {
        Authorization: 'Bearer <BIDSTACK_API_KEY>',
      },
    },
    null,
    2,
  );

  return {
    generatedAt: new Date().toISOString(),
    dust: {
      configured: Boolean(envString('DUST_API_KEY') && workspaceId),
      workspaceId,
      dataSourceConfigured: Boolean(envString('DUST_DATA_SOURCE_ID')),
      webhookReceiverUrl: receiverUrl,
    },
    mcp: {
      publicUrl: mcpUrl,
      healthUrl: `${mcpBase}/health`,
      wellKnownUrl: `${mcpBase}/.well-known/mcp`,
      transport: 'streamable-http' as const,
      configured: Boolean(envString('DUST_MCP_PUBLIC_URL')),
      readScopes: ['mcp', 'read'],
      writeScopes: ['mcp', 'write'],
    },
    rest: {
      baseUrl: restBase,
      authHeader: 'Authorization: Bearer <BIDSTACK_API_KEY>' as const,
      recommendedScopes: ['read', 'write'],
    },
    webhooks: {
      subscriptionsUrl: `${restBase}/webhook-subscriptions`,
      receiverUrl,
      requiredHeaders: ['x-dust-signature', 'x-dust-event', 'x-dust-event-id', 'x-dust-timestamp'],
      recommendedEvents: [
        'opportunity.created',
        'opportunity.stage_changed',
        'bid.score_updated',
        'proposal.submitted',
        'dust.agent.completed',
        'document.extracted',
      ],
    },
    snippets: {
      dustMcpToolConfig,
      mcpHealthCheck: `curl -H "Authorization: Bearer <BIDSTACK_API_KEY>" ${mcpUrl}`,
      restOpportunitySearch: `curl -H "Authorization: Bearer <BIDSTACK_API_KEY>" "${restBase}/opportunities?limit=25"`,
      webhookReceiver: `curl -X POST "${receiverUrl}" \\\n  -H "x-dust-event: dust.agent.completed" \\\n  -H "x-dust-event-id: evt_example" \\\n  -H "x-dust-timestamp: <epoch_ms>" \\\n  -H "x-dust-signature: sha256=<hmac>" \\\n  -d '{"orgId":"<org_id>"}'`,
    },
  };
}

function serializeOpportunityToMarkdown(opp: Opportunity): string {
  const value =
    typeof opp.valueMicros === 'bigint'
      ? (Number(opp.valueMicros) / 1_000_000).toString()
      : typeof opp.valueMicros === 'number'
        ? (opp.valueMicros / 1_000_000).toString()
        : String(opp.valueMicros);

  return [
    `# ${opp.name}`,
    ``,
    `- **Code:** ${opp.code}`,
    `- **Customer:** ${opp.customer}`,
    `- **Stage:** ${opp.stage}`,
    `- **Value (EUR):** ${value}`,
    `- **Probability:** ${opp.probability}%`,
    `- **Due Date:** ${opp.dueDate?.toISOString() ?? 'N/A'}`,
    `- **Industry:** ${opp.industry ?? 'N/A'}`,
    ``,
    `## Intel`,
    ``,
    '```json',
    JSON.stringify(opp.intel, null, 2),
    '```',
  ].join('\n');
}

export const dustRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/integrations/setup-guide
  server.get(
    '/setup-guide',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: IntegrationSetupGuide } },
    },
    async () => buildIntegrationSetupGuide(),
  );

  // POST /api/integrations/probe
  server.post(
    '/probe',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
      schema: {
        body: IntegrationProbeBody,
        response: { 200: IntegrationProbeResult },
      },
    },
    async (req) => {
      try {
        const result = await probeIntegrationEndpoint(req.body.kind, req.body.url);
        await prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'integration.probe',
            targetType: 'integration_probe',
            diff: {
              kind: req.body.kind,
              checkedUrl: result.checkedUrl,
              ok: result.ok,
              status: result.status,
              latencyMs: result.latencyMs,
            },
          },
        });
        return result;
      } catch (err) {
        if (err instanceof Error) {
          throw server.httpErrors.badRequest(err.message);
        }
        throw err;
      }
    },
  );

  // POST /api/integrations/dust/push-deal/:id
  server.post(
    '/dust/push-deal/:id',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ dustDocId: z.string() }) },
      },
    },
    async (req, _reply) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const apiKey = process.env.DUST_API_KEY;
      const workspaceId = process.env.DUST_WORKSPACE_ID;
      const dataSourceId = process.env.DUST_DATA_SOURCE_ID;
      if (!apiKey || !workspaceId || !dataSourceId) {
        throw server.httpErrors.serviceUnavailable('Dust integration not configured');
      }

      const text = serializeOpportunityToMarkdown(opp);
      const documentId = `bidstack-deal-${opp.code}`;

      const dust = new DustClient({
        apiKey,
        workspaceId,
        baseUrl: process.env.DUST_BASE_URL,
        timeoutMs: 10_000,
        logger: req.log.child({ kind: 'dust' }) as unknown as PinoLogger,
      });

      const doc = await dust.upsertDocument(dataSourceId, documentId, text, {
        opportunity_code: opp.code,
        org_id: req.auth.orgId,
        source: 'bidstack',
        pushed_at: new Date().toISOString(),
      });

      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.opportunity.updateMany({
          where: { id: opp.id, orgId: req.auth.orgId },
          data: { dustDocId: doc.document_id },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Opportunity not found');
        }
        await tx.syncEvent.create({
          data: {
            orgId: req.auth.orgId,
            source: 'dust.push',
            eventType: 'deal.pushed',
            payload: { opportunityId: opp.id, dustDocId: doc.document_id, code: opp.code },
            status: 'processed',
            processedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'dust.push.deal',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: { dustDocId: doc.document_id, code: opp.code },
          },
        });
      });

      return { dustDocId: doc.document_id };
    },
  );

  // GET /api/integrations/dust/status
  server.get(
    '/dust/status',
    {
      config: { rateLimit: { max: DUST_STATUS_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
      schema: { response: { 200: DustStatus } },
    },
    async (req) => {
      return cachedDustStatus(req.auth.orgId, req.log);
    },
  );

  // POST /api/integrations/dust/resync
  server.post(
    '/dust/resync',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
      schema: {
        response: { 202: z.object({ jobId: z.string() }) },
      },
    },
    async (req, reply) => {
      // Real enqueue into the dust-poll queue. The worker in apps/worker
      // consumes the same shape its scheduled tick uses, so a manual resync
      // runs the same code path as the cron-style poll. If Redis is
      // unreachable, the helper returns null. We still record the request as a
      // sync_event so the audit trail captures the attempt.
      const queuedId = await enqueueDustResync({ source: 'manual', orgId: req.auth.orgId });
      const jobId = queuedId ?? `manual-${Date.now()}`;
      await prisma.syncEvent.create({
        data: {
          orgId: req.auth.orgId,
          source: 'manual',
          eventType: 'dust.resync.requested',
          payload: { jobId, queued: queuedId !== null },
          status: queuedId ? 'received' : 'error',
          error: queuedId ? null : 'Redis unreachable; resync was not enqueued',
        },
      });
      dustStatusCache.delete(req.auth.orgId);
      if (!queuedId) {
        req.log.warn({ orgId: req.auth.orgId }, 'dust resync: Redis unreachable, no real job');
      }
      return reply.code(202).send({ jobId });
    },
  );

  // API keys
  server.get(
    '/api-keys',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: z.object({ items: z.array(ApiKeySummary) }) } },
    },
    async (req) => {
      const keys = await prisma.apiKey.findMany({
        where: { orgId: req.auth.orgId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return {
        items: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        })),
      };
    },
  );

  server.post(
    '/api-keys',
    {
      preHandler: server.requirePermission('integrations:write'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          name: z.string().min(1).max(80),
          scopes: z.array(z.enum(['read', 'write', 'mcp'])).min(1),
        }),
        response: {
          201: ApiKeySummary.extend({ secret: z.string(), warning: z.string().optional() }),
        },
      },
    },
    async (req, reply) => {
      const raw = `bidstack_${randomBytes(28).toString('hex')}`;
      const prefix = raw.slice(0, 12);
      const hashedKey = createHash('sha256').update(raw).digest('hex');

      const created = await prisma.$transaction(async (tx) => {
        const key = await tx.apiKey.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.name,
            hashedKey,
            prefix,
            scopes: req.body.scopes,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'apikey.create',
            targetType: 'api_key',
            targetId: key.id,
            diff: { name: req.body.name, scopes: req.body.scopes, prefix },
          },
        });
        return key;
      });

      return reply.code(201).send({
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        lastUsedAt: null,
        createdAt: created.createdAt.toISOString(),
        secret: raw,
        warning: 'This secret will never be shown again. Store it securely.',
      });
    },
  );

  server.delete(
    '/api-keys/:id',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, revokedAt: null },
      });
      if (!key) throw server.httpErrors.notFound('API key not found');
      await prisma.$transaction([
        prisma.apiKey.update({
          where: { id: key.id },
          data: { revokedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'apikey.revoke',
            targetType: 'api_key',
            targetId: key.id,
            diff: { name: key.name, prefix: key.prefix },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );

  // GET /api/integrations/webhooks
  server.get(
    '/webhooks',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                receivedAt: z.string().datetime(),
                source: z.string(),
                eventType: z.string(),
                status: z.string(),
                error: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const events = await prisma.syncEvent.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      });
      return {
        items: events.map((e) => ({
          id: e.id.toString(),
          receivedAt: e.receivedAt.toISOString(),
          source: e.source,
          eventType: e.eventType,
          status: e.status,
          error: e.error,
        })),
      };
    },
  );
};
