// ERP integration service layer — extracted from erp-integration.ts route controller.
// Contains: presales kit builder, partner search/normalize, local company search,
// merge logic, and all utility functions.

import { prisma, type Prisma } from '@bidstack/db';
import type { OdooMcpClient as ErpMcpClient } from '@bidstack/odoo-mcp-client';
import { z } from 'zod';

// ─── Schemas (re-exported for route layer) ──────────────────────────────

export const ErpBidModule = z.object({
  id: z.string(),
  label: z.string(),
  erpModels: z.array(z.string()),
  bidstackSurface: z.string(),
  value: z.string(),
  status: z.enum(['ready', 'sidecar', 'planned']),
  availableTools: z.array(z.string()),
});

export const ErpPresalesKit = z.object({
  generatedAt: z.string().datetime(),
  configured: z.boolean(),
  reachable: z.boolean(),
  modules: z.array(ErpBidModule),
  partnerAutocomplete: z.object({
    inputs: z.array(z.string()),
    fallback: z.string(),
    validates: z.array(z.string()),
  }),
  fieldMap: z.array(
    z.object({
      erp: z.string(),
      bidstack: z.string(),
      mode: z.enum(['read', 'write', 'enrich']),
    }),
  ),
  nextActions: z.array(z.string()),
  lastError: z.string().nullable(),
});

export const ErpCompanySuggestion = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  vat: z.string().nullable(),
  duns: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.enum(['external_erp', 'verified_data', 'external_crm', 'bidstack']),
  confidence: z.number().min(0).max(1),
  matchKeys: z.array(z.string()),
  sourceUrl: z.string().url().nullable(),
});

export const CompanyAutocompleteQuery = z.object({
  q: z.string().trim().max(255).optional(),
  domain: z.string().trim().max(255).optional(),
  vat: z.string().trim().max(100).optional(),
  duns: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

export type CompanyAutocompleteInput = z.infer<typeof CompanyAutocompleteQuery>;
export type CompanySuggestion = z.infer<typeof ErpCompanySuggestion>;

// ─── Presales Kit Builder ───────────────────────────────────────────────

export function buildPresalesKit({
  configured,
  reachable,
  tools,
  lastError,
}: {
  configured: boolean;
  reachable: boolean;
  tools: string[];
  lastError: string | null;
}): z.infer<typeof ErpPresalesKit> {
  const toolSet = new Set(tools);
  const module = (
    id: string,
    label: string,
    erpModels: string[],
    bidstackSurface: string,
    value: string,
    requiredTools: string[],
  ): z.infer<typeof ErpBidModule> => ({
    id,
    label,
    erpModels,
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
        'Company lookup and data enhancement',
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
        'Mirror ERP activity discipline for calls, meetings, reminders, and notes.',
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
        'ERP MCP when configured; otherwise BidStack verified data, external CRM customers, and verified data adapters.',
      validates: [
        'country/state normalization',
        'industry mapping',
        'VAT-style identifiers',
        'source confidence',
      ],
    },
    fieldMap: [
      { erp: 'res.partner.name', bidstack: 'CrmCompany.name', mode: 'enrich' },
      {
        erp: 'res.partner.commercial_company_name',
        bidstack: 'CrmCompany.legalName',
        mode: 'enrich',
      },
      { erp: 'res.partner.website', bidstack: 'CrmCompany.website/domain', mode: 'enrich' },
      {
        erp: 'res.partner.vat/company_registry',
        bidstack: 'CrmCompany.registryIds',
        mode: 'enrich',
      },
      {
        erp: 'crm.lead.stage_id/probability',
        bidstack: 'CrmDeal.stage/probability',
        mode: 'write',
      },
      { erp: 'sale.order.amount_total', bidstack: 'CrmDeal.amountMicros', mode: 'read' },
      { erp: 'mail.activity', bidstack: 'CrmActivity/Task', mode: 'write' },
      {
        erp: 'documents.document/ir.attachment',
        bidstack: 'FileAttachment/Document',
        mode: 'read',
      },
    ],
    nextActions: configured
      ? reachable
        ? [
            'Map res.partner rows into BidStack verified data cache.',
            'Sync ERP crm.lead stage changes into bid opportunity audit logs.',
            'Attach sale.order commercial context to proposal readiness scoring.',
          ]
        : ['Fix ERP_MCP_URL or sidecar credentials; local BidStack fallback remains active.']
      : [
          'Set ERP_MCP_URL when the ERP sidecar is ready.',
          'Keep using BidStack verified data and verified data connectors until then.',
        ],
    lastError,
  };
}

// ─── ERP Partner Search ────────────────────────────────────────────────

export async function searchErpPartners(
  client: ErpMcpClient,
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
    .map((row) => normalizeErpPartner(row, query))
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

function normalizeErpPartner(
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
    id: `external_erp:${id}`,
    name,
    legalName: rowString(row, 'commercial_company_name') ?? name,
    domain,
    website,
    vat,
    duns,
    phone: rowString(row, 'phone'),
    email: rowString(row, 'email'),
    source: 'external_erp',
    confidence: 0.9,
    matchKeys: matchKeys({ query, name, domain, vat, duns }),
    sourceUrl: null,
  };
}

// ─── Local Company Search ───────────────────────────────────────────────

export async function searchLocalCompanies(
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

  const [dataRows, opportunities] = await Promise.all([
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

  const dataItems = dataRows.map((row) => ({
    id: `verified:${row.id}`,
    name: row.tradeName ?? row.legalName,
    legalName: row.legalName,
    domain: normalizeDomain(row.domain),
    website: asUrl(row.website),
    vat: stringRegistry(row.registryIds, 'vat'),
    duns: stringRegistry(row.registryIds, 'duns'),
    phone: null,
    email: null,
    source: 'verified_data' as const,
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

  const seenCustomers = new Set(dataItems.map((item) => normalizeName(item.name)));
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
        id: `external_crm:${normalizeName(row.customer)}`,
        name: row.customer,
        legalName: row.customer,
        domain: derivedDomain,
        website: derivedDomain ? `https://${derivedDomain}/` : null,
        vat: null,
        duns: null,
        phone: null,
        email: null,
        source: 'external_crm' as const,
        confidence: 0.56,
        matchKeys: matchKeys({ query, name: row.customer, domain: derivedDomain }),
        sourceUrl: null,
      };
    });

  return mergeSuggestions(dataItems, opportunityItems);
}

// ─── Merge & Match Utilities ────────────────────────────────────────────

export function mergeSuggestions(...groups: CompanySuggestion[][]): CompanySuggestion[] {
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

// ─── Low-level Utilities ────────────────────────────────────────────────

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

export function asUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw =
    value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

export function normalizeDomain(value: string | null | undefined): string | null {
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
// caller to see "ERP MCP unavailable" not the upstream URL (which may carry
// inline creds or a path token) and not a bearer string.
export function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  const upstream = process.env.ERP_MCP_URL ?? process.env.ODOO_MCP_URL;
  let msg = err.message;
  if (upstream) msg = msg.split(upstream).join('[erp]');
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
