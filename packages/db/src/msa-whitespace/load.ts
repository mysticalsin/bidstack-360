// Load ranked whitespace flags for the accounts a caller can see (slice 13b).
// Shared by the API routes, the weekly digest and the agent tools. Scoring is
// pure (@bidstack/shared evaluateWhitespace); this file only gathers inputs.
import {
  detectBusinessLines,
  evaluateWhitespace,
  rankWhitespace,
  resolveWhitespaceDecision,
  whitespaceHeadline,
  type AccountActivity,
  type MsaCitation,
  type WhitespaceDecisionRef,
  type WhitespaceFlag,
  type WhitespaceInput,
} from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../../generated/client/index.js';

const MAX_MSAS = 500;

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

function rateRoles(value: unknown): Array<{ role: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => (r && typeof r === 'object' && typeof (r as { role?: unknown }).role === 'string' ? { role: (r as { role: string }).role } : null))
    .filter((r): r is { role: string } => r !== null);
}

function lines(text: string | null | undefined): string[] {
  return text ? detectBusinessLines(text) : [];
}

/** Lines the account already buys: open opportunities, projects, revenue. */
export async function loadAccountActivityLines(
  db: PrismaClient,
  orgId: string,
  companyIds: string[],
): Promise<Map<string, AccountActivity>> {
  const out = new Map<string, AccountActivity>();
  for (const id of companyIds) out.set(id, { opportunityLines: [], projectLines: [], revenueLines: [] });
  if (companyIds.length === 0) return out;
  const [opps, projects, subscriptions] = await Promise.all([
    db.opportunity.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null, stage: { not: 'closed_lost' } },
      select: { companyId: true, name: true, industry: true },
      take: 1000,
    }),
    db.projectReference.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null },
      select: { companyId: true, title: true, technicalSummary: true, businessSummary: true },
      take: 1000,
    }),
    db.subscription.findMany({
      where: { orgId, accountId: { in: companyIds }, deletedAt: null },
      select: { accountId: true, planTier: true },
      take: 1000,
    }),
  ]);
  for (const o of opps) if (o.companyId) out.get(o.companyId)?.opportunityLines.push(...lines(`${o.name} ${o.industry ?? ''}`));
  for (const p of projects) {
    if (p.companyId) out.get(p.companyId)?.projectLines.push(...lines(`${p.title} ${p.technicalSummary ?? ''} ${p.businessSummary ?? ''}`));
  }
  for (const s of subscriptions) out.get(s.accountId)?.revenueLines.push(...lines(s.planTier));
  return out;
}

async function loadIntel(db: PrismaClient, orgId: string, companyIds: string[]) {
  const [postings, themes, posts, firmo] = await Promise.all([
    db.companyJobPosting.findMany({
      where: { orgId, companyId: { in: companyIds } },
      orderBy: { fetchedAt: 'desc' },
      select: { companyId: true, title: true, skills: true, url: true },
      take: 1000,
    }),
    db.investmentTheme.findMany({
      where: { orgId, companyId: { in: companyIds }, direction: { not: 'cutting' } },
      select: { companyId: true, label: true, summary: true, evidenceIds: true },
      take: 1000,
    }),
    db.companyPost.findMany({
      where: { orgId, companyId: { in: companyIds } },
      orderBy: { publishedAt: 'desc' },
      select: { companyId: true, title: true, url: true },
      take: 1000,
    }),
    db.companyFirmographics.findMany({
      where: { orgId, companyId: { in: companyIds } },
      select: { companyId: true, employeeCount: true },
      take: companyIds.length || 1,
    }),
  ]);
  const evidenceIds = [...new Set(themes.flatMap((t) => t.evidenceIds))].slice(0, 2000);
  const evidence = evidenceIds.length
    ? await db.intelEvidence.findMany({ where: { orgId, id: { in: evidenceIds } }, select: { id: true, url: true }, take: 1000 })
    : [];
  const urlById = new Map(evidence.map((e) => [e.id, e.url]));
  const byCompany = new Map<string, WhitespaceInput['intel']>();
  const get = (id: string) => {
    let row = byCompany.get(id);
    if (!row) {
      row = { hiring: [], themes: [], news: [] };
      byCompany.set(id, row);
    }
    return row;
  };
  for (const p of postings) {
    const row = get(p.companyId);
    if (row.hiring.length < 50) row.hiring.push({ title: p.title, skills: p.skills, url: p.url });
  }
  for (const t of themes) {
    get(t.companyId).themes.push({ title: `${t.label} ${t.summary}`.slice(0, 300), url: t.evidenceIds.map((id) => urlById.get(id)).find(Boolean) ?? null });
  }
  for (const p of posts) {
    const row = get(p.companyId);
    if (row.news.length < 30) row.news.push({ title: p.title, url: p.url });
  }
  return { intel: byCompany, employees: new Map(firmo.map((f) => [f.companyId, f.employeeCount])) };
}

export interface LoadWhitespaceOptions {
  companyId?: string;
  msaId?: string;
  now?: number;
}

/** Every whitespace flag the scope can see, ranked, with its decision state. */
export async function loadWhitespaceFlags(
  db: PrismaClient,
  orgId: string,
  companyWhere: Prisma.CompanyWhereInput,
  opts: LoadWhitespaceOptions = {},
): Promise<WhitespaceFlag[]> {
  const now = opts.now ?? Date.now();
  const rows = await db.contractAgreement.findMany({
    where: {
      orgId,
      deletedAt: null,
      parentId: null,
      status: 'active',
      signingEntityId: { not: null },
      companyId: { not: null },
      ...(opts.msaId ? { id: opts.msaId } : {}),
      company: { is: { AND: [companyWhere, opts.companyId ? { id: opts.companyId } : {}] } },
    },
    select: {
      id: true,
      title: true,
      reference: true,
      status: true,
      expiryDate: true,
      companyId: true,
      countries: true,
      rateCard: true,
      ownerId: true,
      scopeOfServices: true,
      affiliatesClause: true,
      fieldCitations: true,
      company: { select: { name: true, countryCode: true, employeeCount: true, keyAccountOwnerId: true, children: { where: { deletedAt: null }, select: { countryCode: true }, take: 100 } } },
      signingEntity: { select: { id: true, slug: true, name: true, brandFamily: true, businessLines: true, verificationStatus: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_MSAS,
  });
  const companyIds = [...new Set(rows.map((r) => r.companyId).filter((id): id is string => Boolean(id)))];
  if (companyIds.length === 0) return [];
  const [activity, { intel, employees }, oppCountries, decisions] = await Promise.all([
    loadAccountActivityLines(db, orgId, companyIds),
    loadIntel(db, orgId, companyIds),
    db.opportunity.findMany({
      where: { orgId, companyId: { in: companyIds }, deletedAt: null, country: { not: null } },
      select: { companyId: true, country: true },
      distinct: ['companyId', 'country'],
      take: 1000,
    }),
    db.msaWhitespaceDecision.findMany({
      where: { orgId, contractId: { in: rows.map((r) => r.id) } },
      orderBy: { decidedAt: 'desc' },
      take: 1000,
    }),
  ]);
  const ownerIds = [...new Set([...rows.map((r) => r.ownerId ?? r.company?.keyAccountOwnerId), ...decisions.map((d) => d.decidedById)].filter((id): id is string => Boolean(id)))];
  const users = ownerIds.length
    ? await db.user.findMany({ where: { orgId, id: { in: ownerIds } }, select: { id: true, name: true }, take: ownerIds.length })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name ?? 'Unknown']));

  const flags: WhitespaceFlag[] = [];
  for (const row of rows) {
    if (!row.companyId || !row.signingEntity || !row.company) continue;
    const citations = (row.fieldCitations ?? {}) as Record<string, unknown>;
    const accountCountries = new Set<string>();
    if (row.company.countryCode) accountCountries.add(row.company.countryCode.toUpperCase());
    for (const c of row.company.children) if (c.countryCode) accountCountries.add(c.countryCode.toUpperCase());
    for (const o of oppCountries) if (o.companyId === row.companyId && o.country) accountCountries.add(o.country.toUpperCase());
    const evaluation = evaluateWhitespace(
      {
        msa: {
          msaId: row.id,
          msaTitle: row.title ?? row.reference,
          status: row.status,
          expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
          companyId: row.companyId,
          companyName: row.company.name,
          signingEntity: {
            ...row.signingEntity,
            brandFamily: row.signingEntity.brandFamily as 'mantu' | 'amaris' | 'other',
            verificationStatus: row.signingEntity.verificationStatus as 'verified' | 'unverified',
          },
          scopeOfServices: row.scopeOfServices,
          affiliatesClause: row.affiliatesClause,
          scopeCitation: asCitation(citations.scopeOfServices),
          affiliatesCitation: asCitation(citations.affiliatesClause),
          countries: row.countries,
          rateCard: rateRoles(row.rateCard),
        },
        activity: activity.get(row.companyId) ?? { opportunityLines: [], projectLines: [], revenueLines: [] },
        accountCountries: [...accountCountries],
        intel: intel.get(row.companyId) ?? { hiring: [], themes: [], news: [] },
        size: { employees: employees.get(row.companyId) ?? row.company.employeeCount ?? null },
      },
      now,
    );
    if (!evaluation) continue;
    const mine = decisions
      .filter((d) => d.contractId === row.id)
      .map((d) => ({ ...d, decidedAt: d.decidedAt.toISOString(), state: d.state as 'accepted' | 'dismissed' }));
    const newLines: string[] = [];
    const accepted: string[] = [];
    const refs: WhitespaceDecisionRef[] = [];
    const decidedLines = mine.map((d) => d.line).filter((l) => !evaluation.lines.includes(l as never));
    for (const line of [...evaluation.lines, ...new Set(decidedLines)]) {
      const r = resolveWhitespaceDecision(mine, line, evaluation.evidenceHash, now);
      if (r.state === 'new' && !evaluation.lines.includes(line as never)) continue;
      if (r.state === 'new') newLines.push(line);
      if (r.state === 'accepted') accepted.push(line);
      if (r.state !== 'new' && r.decision) {
        const full = mine.find((d) => d.line === line && d.decidedAt === r.decision!.decidedAt);
        refs.push({
          line,
          state: r.state,
          reason: r.decision.reason,
          decidedAt: r.decision.decidedAt,
          decidedBy: full ? (userName.get(full.decidedById) ?? null) : null,
          crossSellActionId: full?.crossSellActionId ?? null,
          opportunityId: full?.opportunityId ?? null,
        });
      }
    }
    const state = newLines.length ? 'new' : accepted.length ? 'accepted' : 'dismissed';
    const ownerId = row.ownerId ?? row.company.keyAccountOwnerId ?? null;
    flags.push({
      ...evaluation,
      headline: state === 'new' ? whitespaceHeadline(evaluation.global, row.signingEntity, newLines) : evaluation.headline,
      lines: state === 'new' ? newLines : evaluation.lines,
      state,
      owner: ownerId ? { id: ownerId, name: userName.get(ownerId) ?? 'Unknown' } : null,
      decisions: refs,
    });
  }
  return rankWhitespace(flags);
}
