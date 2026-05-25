import { prisma } from '@bidstack/db';
import { type Company, type CompanyDetail } from '@bidstack/shared';
import { type z } from 'zod';

export function serializeCompany(c: {
  id: string;
  orgId: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  countryCode: string | null;
  address: unknown;
  billingEmail: string | null;
  taxId: string | null;
  logoUrl: string | null;
  website: string | null;
  source: string;
  confidence: number;
  enrichedAt: Date | null;
  tier: string;
  parentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Company> {
  return {
    id: c.id,
    orgId: c.orgId,
    name: c.name,
    legalName: c.legalName,
    domain: c.domain,
    industry: c.industry,
    employeeCount: c.employeeCount,
    countryCode: c.countryCode,
    address: c.address as Record<string, unknown> | null,
    billingEmail: c.billingEmail,
    taxId: c.taxId,
    logoUrl: c.logoUrl,
    website: c.website,
    source: c.source,
    confidence: c.confidence,
    enrichedAt: c.enrichedAt?.toISOString() ?? null,
    tier: c.tier as 'key' | 'top' | 'standard',
    parentId: c.parentId ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function serializeCompanyDetail(
  c: {
    id: string;
    orgId: string;
    name: string;
    legalName: string | null;
    domain: string | null;
    industry: string | null;
    employeeCount: number | null;
    countryCode: string | null;
    address: unknown;
    billingEmail: string | null;
    taxId: string | null;
    logoUrl: string | null;
    website: string | null;
    source: string;
    confidence: number;
    enrichedAt: Date | null;
    tier: string;
    parentId?: string | null;
    createdAt: Date;
    updatedAt: Date;
  } & {
    contacts: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null }>;
    opportunities: Array<{
      id: string;
      code: string;
      name: string;
      stage: string;
      valueMicros: bigint | number;
      probability: number;
      dueDate: Date | null;
    }>;
    serviceCases: Array<{ id: string; number: string; subject: string; status: string; priority: string }>;
    notes: Array<{ id: string; title: string; author: { name: string | null } | null; createdAt: Date }>;
    parent?: { id: string; name: string } | null;
    children?: Array<{ id: string; name: string }>;
  },
): Promise<z.infer<typeof CompanyDetail>> {
  const customFieldValues = await prisma.customFieldValue.findMany({
    where: { orgId: c.orgId, entityType: 'company', entityId: c.id },
    select: { id: true, definitionId: true, value: true },
  });

  return {
    ...serializeCompany(c),
    contacts: c.contacts.map((x) => ({ ...x, email: x.email ?? null, phone: x.phone ?? null })),
    opportunities: c.opportunities.map((x) => ({
      ...x,
      valueMicros: x.valueMicros.toString(),
      dueDate: x.dueDate?.toISOString() ?? null,
    })),
    openCases: c.serviceCases.map((x) => ({ ...x })),
    notes: c.notes.map((x) => ({
      id: x.id,
      title: x.title,
      authorName: x.author?.name ?? null,
      createdAt: x.createdAt.toISOString(),
    })),
    parent: c.parent ?? null,
    children: c.children ?? [],
    customFieldValues,
  };
}
