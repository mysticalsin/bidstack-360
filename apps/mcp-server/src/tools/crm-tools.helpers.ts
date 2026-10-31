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
