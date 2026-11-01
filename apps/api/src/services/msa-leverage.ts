import {
  detectBusinessLines,
  evaluateLeverage,
  isHemaPharmaLines,
  type AccountActivity,
  type LeverageMsaInput,
  type MsaCitation,
  type MsaLeverageFlag,
} from '@bidstack/shared';
import { prisma } from '@bidstack/db';

import { applyCompanyScope, type AccessScope } from '../lib/access-scope.js';

function asCitation(value: unknown): MsaCitation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { page?: unknown; clause?: unknown; excerpt?: unknown };
  if (typeof row.excerpt !== 'string') return null;
  return {
    page: typeof row.page === 'number' ? row.page : null,
    clause: typeof row.clause === 'string' ? row.clause : null,
    excerpt: row.excerpt,
  };
}

function linesFrom(text: string | null | undefined): string[] {
  return text ? detectBusinessLines(text) : [];
}

export async function loadAccountActivity(orgId: string, companyIds: string[]): Promise<Map<string, AccountActivity>> {
  const out = new Map<string, AccountActivity>();
  for (const id of companyIds) out.set(id, { opportunityLines: [], projectLines: [], revenueLines: [] });
  if (companyIds.length === 0) return out;

  const [opps, projects, subscriptions] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null, stage: { not: 'closed_lost' } },
      select: { companyId: true, name: true, industry: true },
      take: 1000,
    }),
    prisma.projectReference.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null },
      select: { companyId: true, title: true, technicalSummary: true, businessSummary: true },
      take: 1000,
    }),
    prisma.subscription.findMany({
      where: { orgId, accountId: { in: companyIds }, deletedAt: null },
      select: { accountId: true, planTier: true },
      take: 1000,
    }),
  ]);

  for (const opp of opps) {
    if (!opp.companyId) continue;
    const row = out.get(opp.companyId);
    if (!row) continue;
    row.opportunityLines.push(...linesFrom(`${opp.name} ${opp.industry ?? ''}`));
  }
  for (const project of projects) {
    if (!project.companyId) continue;
    const row = out.get(project.companyId);
    if (!row) continue;
    row.projectLines.push(...linesFrom(`${project.title} ${project.technicalSummary ?? ''} ${project.businessSummary ?? ''}`));
  }
  for (const sub of subscriptions) {
    const row = out.get(sub.accountId);
    if (!row) continue;
    row.revenueLines.push(...linesFrom(sub.planTier));
  }
  return out;
}

export async function listLeverageFlags(orgId: string, scope: AccessScope, companyId?: string): Promise<MsaLeverageFlag[]> {
  const companyWhere = applyCompanyScope(
    { orgId, deletedAt: null, ...(companyId ? { id: companyId } : {}) },
    scope,
  );
  const rows = await prisma.contractAgreement.findMany({
    where: {
      orgId,
      deletedAt: null,
      parentId: null,
      status: 'active',
      signingEntityId: { not: null },
      company: { is: companyWhere },
    },
    select: {
      id: true,
      title: true,
      reference: true,
      status: true,
      expiryDate: true,
      companyId: true,
      scopeOfServices: true,
      affiliatesClause: true,
      fieldCitations: true,
      company: { select: { name: true } },
      signingEntity: {
        select: {
          id: true,
          slug: true,
          name: true,
          brandFamily: true,
          businessLines: true,
          verificationStatus: true,
        },
      },
    },
    take: 500,
  });
  const companyIds = [...new Set(rows.map((r) => r.companyId).filter((id): id is string => Boolean(id)))];
  const activity = await loadAccountActivity(orgId, companyIds);
  const flags: MsaLeverageFlag[] = [];
  for (const row of rows) {
    if (!row.companyId || !row.signingEntity) continue;
    const citations = (row.fieldCitations ?? {}) as Record<string, unknown>;
    const input: LeverageMsaInput = {
      msaId: row.id,
      msaTitle: row.title ?? row.reference,
      status: row.status,
      expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
      companyId: row.companyId,
      companyName: row.company?.name ?? row.companyId,
      signingEntity: {
        id: row.signingEntity.id,
        slug: row.signingEntity.slug,
        name: row.signingEntity.name,
        brandFamily: row.signingEntity.brandFamily as LeverageMsaInput['signingEntity']['brandFamily'],
        businessLines: row.signingEntity.businessLines,
        verificationStatus: row.signingEntity.verificationStatus as LeverageMsaInput['signingEntity']['verificationStatus'],
      },
      scopeOfServices: row.scopeOfServices,
      affiliatesClause: row.affiliatesClause,
      scopeCitation: asCitation(citations.scopeOfServices),
      affiliatesCitation: asCitation(citations.affiliatesClause),
    };
    const flag = evaluateLeverage(input, activity.get(row.companyId) ?? { opportunityLines: [], projectLines: [], revenueLines: [] });
    if (flag) flags.push(flag);
  }
  return flags;
}

export async function leverageSummary(orgId: string, scope: AccessScope) {
  const items = await listLeverageFlags(orgId, scope);
  const companies = new Set(items.map((i) => i.companyId));
  const hema = new Set(
    items.filter((i) => i.signingEntity.slug === 'hema' || isHemaPharmaLines(i.signingEntity.businessLines)).map((i) => i.companyId),
  );
  return { underLeveragedAccounts: companies.size, hemaPharmaAccounts: hema.size };
}
