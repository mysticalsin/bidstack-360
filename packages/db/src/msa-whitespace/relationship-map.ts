// "Who works with them" (slice 13b): for one account and its parent and
// affiliates, which of our entities hold MSAs, who owns the opportunities,
// projects, revenue and contacts, and who touched the account last.
import { detectBusinessLines, type RelationshipMap, type RelationshipRow } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../../generated/client/index.js';

const TAKE = 200;
const ACTIVITY_TYPES = ['company', 'account', 'opportunity', 'deal', 'contact'];

function firstLine(text: string): string | null {
  return detectBusinessLines(text)[0] ?? null;
}

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : value;
  return Number.isSafeInteger(n) ? n : null;
}

export async function loadRelationshipMap(
  db: PrismaClient,
  orgId: string,
  companyId: string,
  companyWhere: Prisma.CompanyWhereInput,
  /** The caller's opportunity visibility; hidden deals never reach rows, activity or totals. */
  opportunityWhere: Prisma.OpportunityWhereInput,
): Promise<RelationshipMap | null> {
  const company = await db.company.findFirst({
    where: { AND: [companyWhere, { id: companyId, orgId, deletedAt: null }] },
    select: { id: true, name: true, countryCode: true, parentId: true },
  });
  if (!company) return null;

  // Family: the account, its parent, its children and its siblings, each
  // still inside the caller's scope.
  const family = await db.company.findMany({
    where: {
      AND: [
        companyWhere,
        {
          orgId,
          deletedAt: null,
          OR: [
            { id: company.id },
            { parentId: company.id },
            ...(company.parentId ? [{ id: company.parentId }, { parentId: company.parentId }] : []),
          ],
        },
      ],
    },
    select: { id: true, name: true, countryCode: true, parentId: true },
    take: TAKE,
  });
  const ids = family.map((c) => c.id);
  const nameById = new Map(family.map((c) => [c.id, c.name]));
  const countryById = new Map(family.map((c) => [c.id, c.countryCode]));

  const [msas, opps, projects, subs, contacts] = await Promise.all([
    db.contractAgreement.findMany({
      where: { orgId, companyId: { in: ids }, deletedAt: null, parentId: null },
      select: {
        id: true,
        title: true,
        reference: true,
        status: true,
        companyId: true,
        countries: true,
        ownerId: true,
        updatedAt: true,
        signingEntity: { select: { id: true, slug: true, name: true, businessLines: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: TAKE,
    }),
    db.opportunity.findMany({
      where: { AND: [opportunityWhere, { orgId, companyId: { in: ids }, deletedAt: null }] },
      select: { id: true, name: true, industry: true, companyId: true, ownerId: true, valueMicros: true, country: true, stage: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: TAKE,
    }),
    db.projectReference.findMany({
      where: { orgId, companyId: { in: ids }, deletedAt: null },
      select: { id: true, title: true, technicalSummary: true, companyId: true, validatedById: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: TAKE,
    }),
    db.subscription.findMany({
      where: { orgId, accountId: { in: ids }, deletedAt: null },
      select: { id: true, planTier: true, accountId: true, ownerId: true, arrAmountMicros: true, currency: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: TAKE,
    }),
    db.contact.findMany({
      where: { orgId, companyId: { in: ids }, deletedAt: null },
      select: { id: true, name: true, role: true, companyId: true, createdAt: true },
      take: TAKE,
    }),
  ]);

  const entityIds = [...ids, ...opps.map((o) => o.id), ...contacts.map((c) => c.id)];
  const activities = await db.activity.findMany({
    where: { orgId, deletedAt: null, entityType: { in: ACTIVITY_TYPES }, entityId: { in: entityIds } },
    select: { id: true, subject: true, entityType: true, entityId: true, ownerId: true, occurredAt: true },
    orderBy: { occurredAt: 'desc' },
    take: TAKE,
  });
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const activityCompany = (a: { entityType: string; entityId: string }): string | null => {
    if (a.entityType === 'company' || a.entityType === 'account') return a.entityId;
    if (a.entityType === 'contact') return contactById.get(a.entityId)?.companyId ?? null;
    return oppById.get(a.entityId)?.companyId ?? null;
  };
  const lastByEntity = new Map<string, { at: Date; ownerId: string | null }>();
  for (const a of activities) if (!lastByEntity.has(a.entityId)) lastByEntity.set(a.entityId, { at: a.occurredAt, ownerId: a.ownerId });

  const userIds = new Set<string>();
  const rememberUser = (id: string | null | undefined) => {
    if (id) userIds.add(id);
  };
  msas.forEach((m) => rememberUser(m.ownerId));
  opps.forEach((o) => rememberUser(o.ownerId));
  projects.forEach((p) => rememberUser(p.validatedById));
  subs.forEach((s) => rememberUser(s.ownerId));
  activities.forEach((a) => rememberUser(a.ownerId));
  const users = userIds.size
    ? await db.user.findMany({ where: { orgId, id: { in: [...userIds] } }, select: { id: true, name: true }, take: userIds.size })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name ?? 'Unknown']));
  const owner = (id: string | null | undefined) => (id && userName.has(id) ? { id, name: userName.get(id)! } : null);

  const rows: RelationshipRow[] = [];
  const base = (cid: string) => ({ companyId: cid, companyName: nameById.get(cid) ?? '', country: countryById.get(cid) ?? null });
  for (const m of msas) {
    if (!m.companyId) continue;
    rows.push({
      kind: 'msa',
      id: m.id,
      label: m.title ?? m.reference,
      ...base(m.companyId),
      country: m.countries[0] ?? countryById.get(m.companyId) ?? null,
      entity: m.signingEntity?.name ?? null,
      line: m.signingEntity?.businessLines[0] ?? null,
      owner: owner(m.ownerId),
      lastActivityAt: m.updatedAt.toISOString(),
      valueMicros: null,
      currency: null,
    });
  }
  for (const o of opps) {
    if (!o.companyId) continue;
    const last = lastByEntity.get(o.id);
    rows.push({
      kind: 'opportunity',
      id: o.id,
      label: o.name,
      ...base(o.companyId),
      country: o.country ?? countryById.get(o.companyId) ?? null,
      entity: null,
      line: firstLine(`${o.name} ${o.industry ?? ''}`),
      owner: owner(o.ownerId),
      lastActivityAt: (last?.at ?? o.updatedAt).toISOString(),
      valueMicros: toNumber(o.valueMicros),
      currency: 'EUR',
    });
  }
  for (const p of projects) {
    if (!p.companyId) continue;
    rows.push({
      kind: 'project',
      id: p.id,
      label: p.title,
      ...base(p.companyId),
      entity: null,
      line: firstLine(`${p.title} ${p.technicalSummary ?? ''}`),
      owner: owner(p.validatedById),
      lastActivityAt: p.updatedAt.toISOString(),
      valueMicros: null,
      currency: null,
    });
  }
  for (const s of subs) {
    rows.push({
      kind: 'revenue',
      id: s.id,
      label: s.planTier,
      ...base(s.accountId),
      entity: null,
      line: firstLine(s.planTier),
      owner: owner(s.ownerId),
      lastActivityAt: s.updatedAt.toISOString(),
      valueMicros: toNumber(s.arrAmountMicros),
      currency: s.currency,
    });
  }
  for (const c of contacts) {
    if (!c.companyId) continue;
    const last = lastByEntity.get(c.id);
    rows.push({
      kind: 'contact',
      id: c.id,
      label: c.role ? `${c.name}, ${c.role}` : c.name,
      ...base(c.companyId),
      entity: null,
      line: null,
      owner: owner(last?.ownerId),
      lastActivityAt: last ? last.at.toISOString() : null,
      valueMicros: null,
      currency: null,
    });
  }
  for (const a of activities.slice(0, 50)) {
    const cid = activityCompany(a);
    if (!cid || !nameById.has(cid)) continue;
    rows.push({
      kind: 'activity',
      id: a.id,
      label: a.subject ?? a.entityType,
      ...base(cid),
      entity: null,
      line: a.subject ? firstLine(a.subject) : null,
      owner: owner(a.ownerId),
      lastActivityAt: a.occurredAt.toISOString(),
      valueMicros: null,
      currency: null,
    });
  }

  // People: one line per owner across everything above.
  const people = new Map<string, RelationshipMap['people'][number]>();
  for (const r of rows) {
    if (!r.owner) continue;
    let p = people.get(r.owner.id);
    if (!p) {
      p = { owner: r.owner, entities: [], lines: [], lastActivityAt: null, totals: [], counts: { msas: 0, opportunities: 0, projects: 0, contacts: 0, activities: 0 } };
      people.set(r.owner.id, p);
    }
    if (r.entity && !p.entities.includes(r.entity)) p.entities.push(r.entity);
    if (r.line && !p.lines.includes(r.line)) p.lines.push(r.line);
    if (r.lastActivityAt && (!p.lastActivityAt || r.lastActivityAt > p.lastActivityAt)) p.lastActivityAt = r.lastActivityAt;
    if ((r.kind === 'opportunity' || r.kind === 'revenue') && r.valueMicros !== null && r.currency) {
      const currency = r.currency.toUpperCase();
      const total = p.totals.find((t) => t.currency === currency);
      if (total) total.valueMicros += r.valueMicros;
      else p.totals.push({ currency, valueMicros: r.valueMicros });
    }
    if (r.kind === 'msa') p.counts.msas += 1;
    else if (r.kind === 'opportunity') p.counts.opportunities += 1;
    else if (r.kind === 'project') p.counts.projects += 1;
    else if (r.kind === 'contact') p.counts.contacts += 1;
    else if (r.kind === 'activity') p.counts.activities += 1;
  }
  for (const p of people.values()) p.totals.sort((a, b) => b.valueMicros - a.valueMicros);

  const entities = new Map<string, RelationshipMap['entities'][number]>();
  for (const m of msas) {
    if (!m.signingEntity) continue;
    const e = entities.get(m.signingEntity.id) ?? { id: m.signingEntity.id, slug: m.signingEntity.slug, name: m.signingEntity.name, lines: m.signingEntity.businessLines, msaIds: [] };
    e.msaIds.push(m.id);
    entities.set(e.id, e);
  }
  const lineCounts = new Map<string, number>();
  for (const r of rows) if (r.line && r.kind !== 'activity') lineCounts.set(r.line, (lineCounts.get(r.line) ?? 0) + 1);
  const countries = new Set<string>();
  for (const c of family) if (c.countryCode) countries.add(c.countryCode.toUpperCase());
  for (const m of msas) m.countries.forEach((c) => countries.add(c.toUpperCase()));
  for (const o of opps) if (o.country) countries.add(o.country.toUpperCase());

  return {
    companyId: company.id,
    companies: family.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.countryCode,
      relation: c.id === company.id ? 'self' : c.id === company.parentId ? 'parent' : 'affiliate',
    })),
    entities: [...entities.values()],
    people: [...people.values()].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
    rows,
    lines: [...lineCounts.entries()].map(([line, count]) => ({ line, count })).sort((a, b) => b.count - a.count),
    countries: [...countries].sort(),
  };
}
