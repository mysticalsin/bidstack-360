// Odoo MCP integration routes.
// BIDCRM acts as an MCP client of ivnvxd/mcp-server-odoo. The actual Python
// MCP server runs as a docker-compose sidecar (`mcp-server-odoo`) on a private
// network; this route is the only thing in our stack that talks to it.
//
// Multi-tenancy note: v0.1 ships with a single global Odoo connection
// (ODOO_MCP_URL + the credentials baked into the sidecar). Per-org Odoo
// instances are tracked as a follow-up; for now every org in this BIDCRM
// deployment sees the same Odoo backend.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { OdooMcpClient, OdooMcpError } from '@bidstack/odoo-mcp-client';

let cached: OdooMcpClient | undefined;

function getClient(): OdooMcpClient | null {
  const url = process.env.ODOO_MCP_URL;
  if (!url) return null;
  if (!cached) {
    cached = new OdooMcpClient({
      url,
      bearerToken: process.env.ODOO_MCP_BEARER_TOKEN,
      timeoutMs: Number(process.env.ODOO_MCP_TIMEOUT_MS ?? 15_000),
    });
  }
  return cached;
}

// For tests: clear the memoized client so a remock of fetch is picked up.
export function __resetOdooClient(): void {
  cached = undefined;
}

const OdooStatus = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  database: z.string().nullable(),
  reachable: z.boolean(),
  toolCount: z.number().int().nullable(),
  lastError: z.string().nullable(),
});

const OdooBidModule = z.object({
  id: z.string(),
  label: z.string(),
  odooModels: z.array(z.string()),
  bidstackSurface: z.string(),
  value: z.string(),
  status: z.enum(['ready', 'sidecar', 'planned']),
  availableTools: z.array(z.string()),
});

const OdooPresalesKit = z.object({
  generatedAt: z.string().datetime(),
  configured: z.boolean(),
  reachable: z.boolean(),
  modules: z.array(OdooBidModule),
  partnerAutocomplete: z.object({
    inputs: z.array(z.string()),
    fallback: z.string(),
    validates: z.array(z.string()),
  }),
  fieldMap: z.array(
    z.object({
      odoo: z.string(),
      bidstack: z.string(),
      mode: z.enum(['read', 'write', 'enrich']),
    }),
  ),
  nextActions: z.array(z.string()),
  lastError: z.string().nullable(),
});

const CompanyAutocompleteQuery = z.object({
  q: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  vat: z.string().trim().optional(),
  duns: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

const OdooCompanySuggestion = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  vat: z.string().nullable(),
  duns: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.enum(['odoo', 'company_enrichment', 'twenty', 'bidstack']),
  confidence: z.number().min(0).max(1),
  matchKeys: z.array(z.string()),
  sourceUrl: z.string().url().nullable(),
});

const OdooCompanyAutocompleteResponse = z.object({
  generatedAt: z.string().datetime(),
  configured: z.boolean(),
  reachable: z.boolean(),
  source: z.enum(['odoo', 'local', 'mixed', 'none']),
  items: z.array(OdooCompanySuggestion),
  warnings: z.array(z.string()),
});

// Models that BIDCRM is allowed to read through the Odoo MCP proxy. Anything
// outside this list — `res.users`, `ir.config_parameter`, accounting moves,
// HR data — is refused. This is the only thing standing between an
// authenticated tenant and the entire Odoo backend until per-org Odoo
// credentials are introduced.
const ALLOWED_ODOO_MODELS = [
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
const AllowedOdooModel = z.enum(ALLOWED_ODOO_MODELS);

const SearchBody = z.object({
  model: AllowedOdooModel,
  // Domain is Odoo's polish-notation filter; we accept it raw and forward.
  domain: z.array(z.unknown()).optional(),
  fields: z.array(z.string()).max(64).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  order: z.string().max(200).optional(),
});

const RecordParams = z.object({
  model: AllowedOdooModel,
  id: z.coerce.number().int().positive(),
});

export const odooRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/integrations/odoo/status
  server.get('/odoo/status', { schema: { response: { 200: OdooStatus } } }, async (req) => {
    const url = process.env.ODOO_MCP_URL ?? null;
    const database = process.env.ODOO_DB ?? null;
    const client = getClient();
    if (!client) {
      return {
        configured: false,
        url,
        database,
        reachable: false,
        toolCount: null,
        lastError: null,
      };
    }
    try {
      const tools = await client.listTools();
      return {
        configured: true,
        url,
        database,
        reachable: true,
        toolCount: tools.length,
        lastError: null,
      };
    } catch (err) {
      req.log.warn({ err }, 'odoo status probe failed');
      return {
        configured: true,
        url,
        database,
        reachable: false,
        toolCount: null,
        lastError: safeErrorMessage(err),
      };
    }
  });

  // GET /api/integrations/odoo/presales-kit
  server.get(
    '/odoo/presales-kit',
    { schema: { response: { 200: OdooPresalesKit } } },
    async (req) => {
      const client = getClient();
      if (!client) {
        return buildPresalesKit({
          configured: false,
          reachable: false,
          tools: [],
          lastError: null,
        });
      }
      try {
        const tools = await client.listTools();
        return buildPresalesKit({
          configured: true,
          reachable: true,
          tools: tools.map((tool) => tool.name),
          lastError: null,
        });
      } catch (err) {
        req.log.warn({ err }, 'odoo presales kit probe failed');
        return buildPresalesKit({
          configured: true,
          reachable: false,
          tools: [],
          lastError: safeErrorMessage(err),
        });
      }
    },
  );

  // GET /api/integrations/odoo/company-autocomplete
  server.get(
    '/odoo/company-autocomplete',
    {
      schema: {
        querystring: CompanyAutocompleteQuery,
        response: { 200: OdooCompanyAutocompleteResponse },
      },
    },
    async (req) => {
      const warnings: string[] = [];
      const client = getClient();
      let odooItems: Array<z.infer<typeof OdooCompanySuggestion>> = [];
      let reachable = false;

      if (client) {
        try {
          odooItems = await searchOdooPartners(client, req.query);
          reachable = true;
        } catch (err) {
          warnings.push(safeErrorMessage(err));
          req.log.warn({ err }, 'odoo company autocomplete failed');
        }
      } else {
        warnings.push('Odoo MCP is not configured; using local BidStack records.');
      }

      const orgId = authOrgId(req);
      const localItems = orgId
        ? await searchLocalCompanies(orgId, req.query)
        : ([] as Array<z.infer<typeof OdooCompanySuggestion>>);

      const items = mergeSuggestions(odooItems, localItems).slice(0, req.query.limit);
      const source: z.infer<typeof OdooCompanyAutocompleteResponse>['source'] =
        odooItems.length && localItems.length
          ? 'mixed'
          : odooItems.length
            ? 'odoo'
            : localItems.length
              ? 'local'
              : 'none';
      return {
        generatedAt: new Date().toISOString(),
        configured: Boolean(client),
        reachable,
        source,
        items,
        warnings,
      };
    },
  );

  // GET /api/integrations/odoo/models
  server.get(
    '/odoo/models',
    {
      schema: {
        response: {
          200: z.object({ items: z.unknown() }),
        },
      },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('Odoo MCP not configured');
      try {
        const items = await client.listModels();
        return { items };
      } catch (err) {
        req.log.warn({ err }, 'odoo list models failed');
        if (err instanceof OdooMcpError) {
          throw server.httpErrors.badGateway('Odoo MCP unavailable');
        }
        throw err;
      }
    },
  );

  // POST /api/integrations/odoo/search
  server.post(
    '/odoo/search',
    {
      schema: {
        body: SearchBody,
        response: { 200: z.object({ rows: z.unknown() }) },
      },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('Odoo MCP not configured');
      try {
        const rows = await client.searchRecords(req.body);
        return { rows };
      } catch (err) {
        req.log.warn({ err, model: req.body.model }, 'odoo search failed');
        if (err instanceof OdooMcpError) {
          throw server.httpErrors.badGateway('Odoo MCP unavailable');
        }
        throw err;
      }
    },
  );

  // GET /api/integrations/odoo/:model/:id
  server.get(
    '/odoo/:model/:id',
    {
      schema: {
        params: RecordParams,
        response: { 200: z.object({ record: z.unknown() }) },
      },
    },
    async (req) => {
      const client = getClient();
      if (!client) throw server.httpErrors.serviceUnavailable('Odoo MCP not configured');
      try {
        const record = await client.getRecord({
          model: req.params.model,
          id: req.params.id,
        });
        return { record };
      } catch (err) {
        req.log.warn({ err, model: req.params.model, id: req.params.id }, 'odoo get failed');
        if (err instanceof OdooMcpError) {
          // 404 if Odoo says the record doesn't exist; 502 otherwise.
          if (/not\s*found|does not exist/i.test(err.message)) {
            throw server.httpErrors.notFound('Record not found in Odoo');
          }
          throw server.httpErrors.badGateway('Odoo MCP unavailable');
        }
        throw err;
      }
    },
  );
};

type CompanyAutocompleteInput = z.infer<typeof CompanyAutocompleteQuery>;
type CompanySuggestion = z.infer<typeof OdooCompanySuggestion>;

function buildPresalesKit({
  configured,
  reachable,
  tools,
  lastError,
}: {
  configured: boolean;
  reachable: boolean;
  tools: string[];
  lastError: string | null;
}): z.infer<typeof OdooPresalesKit> {
  const toolSet = new Set(tools);
  const module = (
    id: string,
    label: string,
    odooModels: string[],
    bidstackSurface: string,
    value: string,
    requiredTools: string[],
  ): z.infer<typeof OdooBidModule> => ({
    id,
    label,
    odooModels,
    bidstackSurface,
    value,
    status: requiredTools.every((tool) => toolSet.has(tool))
      ? 'sidecar'
      : configured && !reachable
        ? 'planned'
        : 'ready',
    availableTools: requiredTools.filter((tool) => toolSet.has(tool)),
  });

  return {
    generatedAt: new Date().toISOString(),
    configured,
    reachable,
    modules: [
      module(
        'partner-autocomplete',
        'Partner autocomplete',
        ['res.partner', 'res.partner.industry', 'res.country'],
        'Company lookup and enrichment',
        'Search by legal name, domain, VAT, DUNS, and company registry identifiers.',
        ['search_records', 'get_record'],
      ),
      module(
        'crm-opportunities',
        'CRM opportunities',
        ['crm.lead', 'crm.stage', 'crm.team'],
        'Bid pipeline and opportunity cockpit',
        'Keep lead, opportunity, stage, probability, and team discipline aligned.',
        ['search_records', 'aggregate_records', 'update_record'],
      ),
      module(
        'quotations',
        'Quotations and orders',
        ['sale.order', 'sale.order.line', 'product.template'],
        'Proposal value and commercial shaping',
        'Bring quote, product, pricing, and margin context into bid/no-bid reviews.',
        ['search_records', 'get_record'],
      ),
      module(
        'activities',
        'Activities and chatter',
        ['mail.activity', 'mail.message', 'calendar.event'],
        'Presales next actions and audit trail',
        'Mirror Odoo activity discipline for calls, meetings, reminders, and notes.',
        ['search_records', 'post_message'],
      ),
      module(
        'documents',
        'Documents and evidence',
        ['documents.document', 'ir.attachment'],
        'Proposal tracker, RFP files, compliance evidence',
        'Centralize bid packs, SoWs, NDAs, diagrams, and submission evidence.',
        ['search_records', 'get_record'],
      ),
      module(
        'delivery-handoff',
        'Projects and delivery handoff',
        ['project.project', 'project.task', 'helpdesk.ticket'],
        'Won-bid transition and implementation risk',
        'Use presales commitments to seed delivery plans and renewal risk tracking.',
        ['search_records', 'create_record'],
      ),
    ],
    partnerAutocomplete: {
      inputs: ['legal name', 'domain', 'VAT', 'DUNS', 'GST', 'registry id'],
      fallback:
        'Odoo MCP when configured; otherwise BidStack company enrichment, Twenty customers, and official API adapters.',
      validates: [
        'country/state normalization',
        'industry mapping',
        'VAT-style identifiers',
        'source confidence',
      ],
    },
    fieldMap: [
      { odoo: 'res.partner.name', bidstack: 'CrmCompany.name', mode: 'enrich' },
      {
        odoo: 'res.partner.commercial_company_name',
        bidstack: 'CrmCompany.legalName',
        mode: 'enrich',
      },
      { odoo: 'res.partner.website', bidstack: 'CrmCompany.website/domain', mode: 'enrich' },
      {
        odoo: 'res.partner.vat/company_registry',
        bidstack: 'CrmCompany.registryIds',
        mode: 'enrich',
      },
      {
        odoo: 'crm.lead.stage_id/probability',
        bidstack: 'CrmDeal.stage/probability',
        mode: 'write',
      },
      { odoo: 'sale.order.amount_total', bidstack: 'CrmDeal.amountMicros', mode: 'read' },
      { odoo: 'mail.activity', bidstack: 'CrmActivity/Task', mode: 'write' },
      {
        odoo: 'documents.document/ir.attachment',
        bidstack: 'FileAttachment/Document',
        mode: 'read',
      },
    ],
    nextActions: configured
      ? reachable
        ? [
            'Map res.partner rows into BidStack company enrichment cache.',
            'Sync Odoo crm.lead stage changes into bid opportunity audit logs.',
            'Attach sale.order commercial context to proposal readiness scoring.',
          ]
        : ['Fix ODOO_MCP_URL or sidecar credentials; local BidStack fallback remains active.']
      : [
          'Set ODOO_MCP_URL when the Odoo sidecar is ready.',
          'Keep using BidStack verified enrichment and official open-data connectors until then.',
        ],
    lastError,
  };
}

async function searchOdooPartners(
  client: OdooMcpClient,
  query: CompanyAutocompleteInput,
): Promise<CompanySuggestion[]> {
  const domain = buildPartnerDomain(query);
  const rows = await client.searchRecords<unknown>({
    model: 'res.partner',
    domain,
    fields: [
      'id',
      'name',
      'commercial_company_name',
      'website',
      'vat',
      'company_registry',
      'duns',
      'phone',
      'email',
      'is_company',
    ],
    limit: query.limit,
  });

  return normalizeRows(rows)
    .map((row) => normalizeOdooPartner(row, query))
    .filter((item): item is CompanySuggestion => item !== null);
}

function buildPartnerDomain(query: CompanyAutocompleteInput): unknown[] {
  const domain: unknown[] = [['is_company', '=', true]];
  if (query.domain) domain.push(['website', 'ilike', normalizeDomain(query.domain)]);
  if (query.vat) domain.push(['vat', 'ilike', query.vat]);
  if (query.duns) domain.push(['duns', '=', query.duns]);
  if (query.q) domain.push(['name', 'ilike', query.q]);
  return domain;
}

function normalizeRows(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.records)
      ? value.records
      : isRecord(value) && Array.isArray(value.rows)
        ? value.rows
        : isRecord(value) && Array.isArray(value.results)
          ? value.results
          : [];
  return rows.filter(isRecord);
}

function normalizeOdooPartner(
  row: Record<string, unknown>,
  query: CompanyAutocompleteInput,
): CompanySuggestion | null {
  const id = rowNumber(row, 'id')?.toString() ?? rowString(row, 'id');
  const name = rowString(row, 'name') ?? rowString(row, 'display_name');
  if (!id || !name) return null;
  const website = asUrl(rowString(row, 'website'));
  const domain = normalizeDomain(website ?? rowString(row, 'website'));
  const vat = rowString(row, 'vat') ?? rowString(row, 'company_registry');
  const duns = rowString(row, 'duns');
  return {
    id: `odoo:${id}`,
    name,
    legalName: rowString(row, 'commercial_company_name') ?? name,
    domain,
    website,
    vat,
    duns,
    phone: rowString(row, 'phone'),
    email: rowString(row, 'email'),
    source: 'odoo',
    confidence: 0.9,
    matchKeys: matchKeys({ query, name, domain, vat, duns }),
    sourceUrl: null,
  };
}

async function searchLocalCompanies(
  orgId: string,
  query: CompanyAutocompleteInput,
): Promise<CompanySuggestion[]> {
  const q = query.q?.trim();
  const domain = normalizeDomain(query.domain);
  const where: Prisma.CompanyEnrichmentWhereInput = { orgId };
  const clauses: Prisma.CompanyEnrichmentWhereInput[] = [];
  if (q) {
    clauses.push(
      { legalName: { contains: q, mode: 'insensitive' } },
      { tradeName: { contains: q, mode: 'insensitive' } },
      { domain: { contains: q, mode: 'insensitive' } },
    );
  }
  if (domain) clauses.push({ domain: { equals: domain, mode: 'insensitive' } });
  if (clauses.length) where.OR = clauses;

  const [enrichments, opportunities] = await Promise.all([
    prisma.companyEnrichment.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
    }),
    prisma.opportunity.findMany({
      where: {
        orgId,
        ...(q
          ? {
              OR: [
                { customer: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: query.limit * 2,
    }),
  ]);

  const enrichmentItems = enrichments.map((row) => ({
    id: `enrichment:${row.id}`,
    name: row.tradeName ?? row.legalName,
    legalName: row.legalName,
    domain: normalizeDomain(row.domain),
    website: asUrl(row.website),
    vat: stringRegistry(row.registryIds, 'vat'),
    duns: stringRegistry(row.registryIds, 'duns'),
    phone: null,
    email: null,
    source: 'company_enrichment' as const,
    confidence: row.confidenceBps / 10_000,
    matchKeys: matchKeys({
      query,
      name: row.tradeName ?? row.legalName,
      domain: normalizeDomain(row.domain),
      vat: stringRegistry(row.registryIds, 'vat'),
      duns: stringRegistry(row.registryIds, 'duns'),
    }),
    sourceUrl: asUrl(row.website),
  }));

  const seenCustomers = new Set(enrichmentItems.map((item) => normalizeName(item.name)));
  const opportunityItems = opportunities
    .filter((row) => {
      const key = normalizeName(row.customer);
      if (seenCustomers.has(key)) return false;
      seenCustomers.add(key);
      return true;
    })
    .map((row) => {
      const derivedDomain = normalizeDomain(row.logoUrl) ?? null;
      return {
        id: `twenty:${normalizeName(row.customer)}`,
        name: row.customer,
        legalName: row.customer,
        domain: derivedDomain,
        website: derivedDomain ? `https://${derivedDomain}/` : null,
        vat: null,
        duns: null,
        phone: null,
        email: null,
        source: 'twenty' as const,
        confidence: 0.56,
        matchKeys: matchKeys({ query, name: row.customer, domain: derivedDomain }),
        sourceUrl: null,
      };
    });

  return mergeSuggestions(enrichmentItems, opportunityItems);
}

function mergeSuggestions(...groups: CompanySuggestion[][]): CompanySuggestion[] {
  const byKey = new Map<string, CompanySuggestion>();
  for (const item of groups.flat()) {
    const key = item.domain ?? normalizeName(item.legalName ?? item.name);
    const existing = byKey.get(key);
    if (!existing || item.confidence > existing.confidence) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

function matchKeys({
  query,
  name,
  domain,
  vat,
  duns,
}: {
  query: CompanyAutocompleteInput;
  name: string;
  domain?: string | null;
  vat?: string | null;
  duns?: string | null;
}): string[] {
  const keys: string[] = [];
  const q = query.q?.toLowerCase();
  if (q && name.toLowerCase().includes(q)) keys.push('name');
  if (query.domain && domain === normalizeDomain(query.domain)) keys.push('domain');
  if (query.vat && vat && normalizeToken(vat).includes(normalizeToken(query.vat))) keys.push('vat');
  if (query.duns && duns && normalizeToken(duns) === normalizeToken(query.duns)) keys.push('duns');
  if (!keys.length) keys.push('profile');
  return keys;
}

function authOrgId(req: { auth?: { orgId?: string } }): string | null {
  return req.auth?.orgId ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rowString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[1] === 'string') return value[1].trim();
  return null;
}

function rowNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringRegistry(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const direct = value[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const upper = value[key.toUpperCase()];
  if (typeof upper === 'string' && upper.trim()) return upper.trim();
  return null;
}

function asUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw =
    value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const urlish =
    value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(urlish).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return value
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Sanitize an error message before sending it to the browser. We want the
// caller to see "Odoo MCP unavailable" not the upstream URL (which may carry
// inline creds or a path token) and not a bearer string.
function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  const upstream = process.env.ODOO_MCP_URL;
  let msg = err.message;
  if (upstream) msg = msg.split(upstream).join('[odoo]');
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
