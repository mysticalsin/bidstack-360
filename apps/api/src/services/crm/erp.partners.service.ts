/**
 * erp.partners.service.ts — searchErpPartners and searchLocalCompanies.
 *
 * Extracted from erp.service.ts (BS-R1 file-size refactor).
 * Handles both ERP MCP partner lookup and local Polo PreSales company search.
 */
import { prisma, type Prisma } from '@bidstack/db';
import type { OdooMcpClient as ErpMcpClient } from '@bidstack/odoo-mcp-client';

import {
  asUrl,
  mergeSuggestions,
  normalizeDomain,
  normalizeName,
  normalizeRows,
  normalizeToken,
  rowNumber,
  rowString,
  stringRegistry,
  type CompanyAutocompleteInput,
  type CompanySuggestion,
} from './erp.helpers.js';

// ─── ERP Partner Search ──────────────────────────────────────────────────────

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

// ─── Local Company Search ────────────────────────────────────────────────────

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

// ─── Private helpers ─────────────────────────────────────────────────────────

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
