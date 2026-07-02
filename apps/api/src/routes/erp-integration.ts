// ERP MCP integration routes.
// BIDCRM acts as an MCP client of ivnvxd/mcp-server-odoo. The actual Python
// MCP server runs as a docker-compose sidecar (`mcp-server-erp`) on a private
// network; this route is the only thing in our stack that talks to it.
//
// Multi-tenancy note: v0.1 ships with a single global ERP connection
// (ERP_MCP_URL + the credentials baked into the sidecar). Per-org ERP
// instances are tracked as a follow-up; for now every org in this BIDCRM
// deployment sees the same ERP backend. Because of that shared-backend risk,
// registration of this whole route surface is opt-in via ERP_ENABLED
// (apps/api/src/env.ts, default false) and every route additionally gates on
// the integrations:read RBAC permission (apps/api/src/server.routes.ts).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  SERUM_RUNTIME_CONFIG_KEYS,
  checkSerumConnectorRuntimePolicy,
  recordSerumConnectorConnectionTest,
} from '@bidstack/db/serum-runtime-policy';
import { OdooMcpClient as ErpMcpClient, OdooMcpError as ErpMcpError } from '@bidstack/odoo-mcp-client';
import type { SerumConfigEnvironment } from '@bidstack/shared';

import {
  buildPresalesKit,
  searchErpPartners,
  searchLocalCompanies,
  mergeSuggestions,
  safeErrorMessage,
  ErpPresalesKit,
  ErpCompanySuggestion,
  CompanyAutocompleteQuery,
} from '../services/crm/erp.service.js';

let cached: ErpMcpClient | undefined;

function getClient(): ErpMcpClient | null {
  const url = process.env.ERP_MCP_URL ?? process.env.ODOO_MCP_URL;
  if (!url) return null;
  if (!cached) {
    cached = new ErpMcpClient({
      url,
      bearerToken: process.env.ERP_MCP_BEARER_TOKEN ?? process.env.ODOO_MCP_BEARER_TOKEN,
      timeoutMs: Number(process.env.ERP_MCP_TIMEOUT_MS ?? process.env.ODOO_MCP_TIMEOUT_MS ?? 15_000),
    });
  }
  return cached;
}

// For tests: clear the memoized client so a remock of fetch is picked up.
export function __resetErpClient(): void {
  cached = undefined;
}

const ErpStatus = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  database: z.string().nullable(),
  reachable: z.boolean(),
  toolCount: z.number().int().nullable(),
  lastError: z.string().nullable(),
});

const ErpCompanyAutocompleteResponse = z.object({
  generatedAt: z.string().datetime(),
  configured: z.boolean(),
  reachable: z.boolean(),
  source: z.enum(['external_erp', 'local', 'mixed', 'none']),
  items: z.array(ErpCompanySuggestion),
  warnings: z.array(z.string()),
});

// Models that BIDCRM is allowed to read through the ERP MCP proxy.
const ALLOWED_ERP_MODELS = [
  'res.partner',
  'res.partner.industry',
  'res.partner.title',
  'res.country',
  'res.country.state',
  'res.currency',
  'crm.lead',
  'crm.stage',
  'crm.team',
  'crm.lost.reason',
  'sale.order',
  'sale.order.line',
  'product.template',
  'product.product',
  'product.category',
  'mail.activity',
  'mail.message',
  'calendar.event',
  'documents.document',
  'ir.attachment',
  'project.project',
  'project.task',
  'helpdesk.ticket',
] as const;
const AllowedErpModel = z.enum(ALLOWED_ERP_MODELS);

const SearchBody = z.object({
  model: AllowedErpModel,
  domain: z.array(z.unknown()).max(64).optional(),
  fields: z.array(z.string()).max(64).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  order: z.string().max(200).optional(),
});

const RecordParams = z.object({
  model: AllowedErpModel,
  id: z.coerce.number().int().positive(),
});

function authOrgId(req: { auth?: { orgId?: string } }): string | null {
  return req.auth?.orgId ?? null;
}

export const erpRoutes: FastifyPluginAsyncZod = async (server) => {
  function defaultSerumConfigEnvironment(): SerumConfigEnvironment {
    const env = process.env.SERUM_CONFIG_ENVIRONMENT;
    if (env === 'staging' || env === 'production') return env;
    return 'dev';
  }

  async function checkErpConnector(
    req: { auth?: { orgId?: string } },
    operation: string,
    options: { connectionTestProbe?: boolean } = {},
  ): Promise<Awaited<ReturnType<typeof checkSerumConnectorRuntimePolicy>>> {
    const orgId = authOrgId(req);
    if (!orgId) {
      throw server.httpErrors.unauthorized('Authenticated org context is required for connector execution.');
    }
    return checkSerumConnectorRuntimePolicy({
      orgId,
      environment: defaultSerumConfigEnvironment(),
      configKey: SERUM_RUNTIME_CONFIG_KEYS.connectors,
      connectorId: 'odoo',
      operation,
      writeRequested: false,
      connectionTestProbe: options.connectionTestProbe ?? false,
      approvalConfirmed: false,
    });
  }

  async function requireErpConnector(
    req: { auth?: { orgId?: string } },
    operation: string,
  ): Promise<void> {
    const decision = await checkErpConnector(req, operation);
    if (!decision.allowed) {
      throw server.httpErrors.forbidden(`SERUM connector policy denied: ${decision.reason}`);
    }
  }

  // GET /api/integrations/erp/status
  server.get(
    '/erp/status',
    {
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: ErpStatus } },
    },
    async (req) => {
      const url = process.env.ERP_MCP_URL ?? process.env.ODOO_MCP_URL ?? null;
      const database = process.env.ERP_DB ?? process.env.ODOO_DB ?? null;
      const client = getClient();
      if (!client) {
        return { configured: false, url, database, reachable: false, toolCount: null, lastError: null };
      }
      const decision = await checkErpConnector(req, 'erp.status', { connectionTestProbe: true });
      if (!decision.allowed) {
        return {
          configured: true,
          url,
          database,
          reachable: false,
          toolCount: null,
          lastError: `SERUM connector policy denied: ${decision.reason}`,
        };
      }
      try {
        const tools = await client.listTools();
        await recordSerumConnectorConnectionTest({
          orgId: req.auth.orgId,
          environment: defaultSerumConfigEnvironment(),
          connectorId: 'odoo',
          operation: 'erp.status',
          testedByUserId: req.auth.userId,
          evidence: { toolCount: tools.length, database },
        });
        return { configured: true, url, database, reachable: true, toolCount: tools.length, lastError: null };
      } catch (err) {
        req.log.warn({ err }, 'erp status probe failed');
        return { configured: true, url, database, reachable: false, toolCount: null, lastError: safeErrorMessage(err) };
      }
    },
  );

  // GET /api/integrations/erp/presales-kit
  server.get(
    '/erp/presales-kit',
    {
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: ErpPresalesKit } },
    },
    async (req) => {
      const client = getClient();
      if (!client) {
        return buildPresalesKit({ configured: false, reachable: false, tools: [], lastError: null });
      }
      const decision = await checkErpConnector(req, 'erp.presalesKit');
      if (!decision.allowed) {
        return buildPresalesKit({
          configured: true,
          reachable: false,
          tools: [],
          lastError: `SERUM connector policy denied: ${decision.reason}`,
        });
      }
      try {
        const tools = await client.listTools();
        return buildPresalesKit({ configured: true, reachable: true, tools: tools.map((t) => t.name), lastError: null });
      } catch (err) {
        req.log.warn({ err }, 'erp presales kit probe failed');
        return buildPresalesKit({ configured: true, reachable: false, tools: [], lastError: safeErrorMessage(err) });
      }
    },
  );

  // GET /api/integrations/erp/company-autocomplete
  server.get(
    '/erp/company-autocomplete',
    {
      preHandler: server.requirePermission('integrations:read'),
      schema: { querystring: CompanyAutocompleteQuery, response: { 200: ErpCompanyAutocompleteResponse } },
    },
    async (req) => {
      const warnings: string[] = [];
      const client = getClient();
      let erpItems: z.infer<typeof ErpCompanySuggestion>[] = [];
      let reachable = false;

      if (client) {
        try {
          const decision = await checkErpConnector(req, 'erp.companyAutocomplete');
          if (decision.allowed) {
            erpItems = await searchErpPartners(client, req.query);
            reachable = true;
          } else {
            warnings.push(`SERUM connector policy denied: ${decision.reason}`);
          }
        } catch (err) {
          warnings.push(safeErrorMessage(err));
          req.log.warn({ err }, 'erp company autocomplete failed');
        }
      } else {
        warnings.push('ERP MCP is not configured; using local BidStack records.');
      }

      const orgId = authOrgId(req);
      const localItems = orgId
        ? await searchLocalCompanies(orgId, req.query)
        : ([] as z.infer<typeof ErpCompanySuggestion>[]);

      const items = mergeSuggestions(erpItems, localItems).slice(0, req.query.limit);
      const source: z.infer<typeof ErpCompanyAutocompleteResponse>['source'] =
        erpItems.length && localItems.length
          ? 'mixed'
          : erpItems.length
            ? 'external_erp'
            : localItems.length
              ? 'local'
              : 'none';
      return { generatedAt: new Date().toISOString(), configured: Boolean(client), reachable, source, items, warnings };
    },
  );

  // GET /api/integrations/erp/models
  server.get(
    '/erp/models',
    {
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: z.object({ items: z.unknown() }) } },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('ERP MCP not configured');
      await requireErpConnector(req, 'erp.listModels');
      try {
        const items = await client.listModels();
        return { items };
      } catch (err) {
        req.log.warn({ err }, 'erp list models failed');
        if (err instanceof ErpMcpError) throw server.httpErrors.badGateway('ERP MCP unavailable');
        throw err;
      }
    },
  );

  // POST /api/integrations/erp/search
  server.post(
    '/erp/search',
    {
      // Read-only proxy (searchRecords queries ERP; no BidStack or ERP mutation
      // in this file), so it gates on integrations:read like every other route
      // here despite the POST verb (chosen for the structured query body).
      preHandler: server.requirePermission('integrations:read'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: SearchBody, response: { 200: z.object({ rows: z.unknown() }) } },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('ERP MCP not configured');
      await requireErpConnector(req, 'erp.search');
      try {
        const rows = await client.searchRecords(req.body);
        return { rows };
      } catch (err) {
        req.log.warn({ err, model: req.body.model }, 'erp search failed');
        if (err instanceof ErpMcpError) throw server.httpErrors.badGateway('ERP MCP unavailable');
        throw err;
      }
    },
  );

  // GET /api/integrations/erp/:model/:id
  server.get(
    '/erp/:model/:id',
    {
      preHandler: server.requirePermission('integrations:read'),
      schema: { params: RecordParams, response: { 200: z.object({ record: z.unknown() }) } },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('ERP MCP not configured');
      await requireErpConnector(req, 'erp.getRecord');
      try {
        const record = await client.getRecord({ model: req.params.model, id: req.params.id });
        return { record };
      } catch (err) {
        req.log.warn({ err, model: req.params.model, id: req.params.id }, 'erp get failed');
        if (err instanceof ErpMcpError) {
          if (/not\s*found|does not exist/i.test(err.message)) {
            throw server.httpErrors.notFound('Record not found in ERP');
          }
          throw server.httpErrors.badGateway('ERP MCP unavailable');
        }
        throw err;
      }
    },
  );
};
