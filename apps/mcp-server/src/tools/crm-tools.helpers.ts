/**
 * crm-tools.helpers.ts — Pure helpers and the mintNextCode sequence generator.
 *
 * Extracted from crm-tools.ts (BS-R1 file-size refactor).
 * Import via crm-tools.ts (consumed internally, not re-exported to callers).
 */
import { prisma } from '@bidstack/db';

export async function mintNextCode(orgId: string): Promise<string> {
  const last = await prisma.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

export function serializeDeal(deal: {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: string;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  updatedAt: Date;
}) {
  return {
    id: deal.id,
    code: deal.code,
    customer: deal.customer,
    name: deal.name,
    stage: deal.stage,
    value: Number(deal.valueMicros) / 1_000_000,
    probability: deal.probability,
    dueDate: deal.dueDate?.toISOString().slice(0, 10) ?? null,
    industry: deal.industry,
    updatedAt: deal.updatedAt.toISOString(),
  };
}

const COMPANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCompanyUuid(value: string): boolean {
  return COMPANY_UUID.test(value);
}

/** One company, or a refusal. A name that matches none or several is not a link. */
export function uniqueCompanyLink(
  matches: readonly { id: string; name: string }[],
): { id: string; name: string } {
  if (matches.length === 1 && matches[0]) return matches[0];
  throw new Error('Pass a company id. A name is not a company link unless it matches one company.');
}

export async function requireCompanyLink(
  orgId: string,
  input: { companyId?: string; name?: string },
): Promise<{ id: string; name: string }> {
  if (input.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, orgId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) throw new Error('Company not found');
    return company;
  }
  const name = input.name?.trim();
  if (!name) throw new Error('Pass a company id.');
  const matches = await prisma.company.findMany({
    where: { orgId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
    take: 2,
  });
  return uniqueCompanyLink(matches);
}

/**
 * A renamed customer label. One exact company stores that id. None clears the
 * link. Several is a refusal so the previous id is left untouched by the caller.
 */
export async function companyIdForCustomerRename(
  orgId: string,
  customer: string,
): Promise<string | null> {
  const name = customer.trim();
  if (!name) return null;
  const matches = await prisma.company.findMany({
    where: { orgId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('Company name matches more than one company');
  return matches[0]?.id ?? null;
}

export function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function logoUrl(_name: string, domain: string | null) {
  if (!domain) return null;
  return `https://${domain.replace(/^www\./, '')}/favicon.ico`;
}

export function source(name: string, sourceUrl: string | null, confidence: number | null) {
  return {
    source: sourceUrl?.includes('mantu.com') ? 'official_website' : 'mcp_enrichment',
    label: `${name} enrichment profile. Not a scored source.`,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: confidence === null ? { confidenceBasis: 'not_scored' } : {},
  };
}
